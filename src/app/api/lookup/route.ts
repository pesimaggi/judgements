import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSearchProvider } from "@/lib/search";
import { parseProvisionQuery, formatArticleLabel } from "@/lib/provision-query";
import { actCitation, actPath, parseActScope } from "@/lib/acts";

export const dynamic = "force-dynamic";

/**
 * Type-ahead for the act/provision box.
 *
 * One box, because that is how a citation is written: "lög um aðbúnað og
 * hollustuhætti" narrows to the act, and "57. gr. a. laga um aðbúnað og
 * hollustuhætti" narrows to that article of it. The article part is peeled
 * off the front, the rest matched against act titles, short names and
 * citation numbers, and the article then resolved within each candidate act.
 *
 * Suggestions carry the id the search needs, so choosing one filters the
 * judgment results directly rather than navigating away.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const raw = (searchParams.get("q") ?? "").trim();
  const limit = Math.min(20, Math.max(1, Number(searchParams.get("limit")) || 8));
  // How much of the EU library the box may offer — the EEA/EU toggle above it.
  const scope = parseActScope(searchParams.get("scope"));
  if (raw.length < 2) return NextResponse.json({ suggestions: [] });

  const parsed = parseProvisionQuery(raw);

  try {
    // With an article but no act named yet, there is nothing to resolve
    // against — offer acts once the user starts naming one.
    if (parsed.hasArticle && !parsed.actQuery) {
      return NextResponse.json({ suggestions: [], needsAct: true });
    }

    const acts = await getSearchProvider().searchActs({
      query: parsed.actQuery || raw,
      limit,
      scope,
    });

    if (!parsed.hasArticle) {
      return NextResponse.json({
        suggestions: acts.map((a) => ({
          kind: "act" as const,
          id: a.id,
          actId: a.id,
          label: a.title,
          sublabel: a.citation,
          path: a.path,
          // What the EES tag beside the suggestion is drawn from — see
          // lib/eea-tag.ts. Null throughout on the Icelandic side.
          jurisdiction: a.jurisdiction,
          eeaRelevant: a.eeaRelevant ?? false,
          eeaIncorporatedBy: a.eeaIncorporatedBy ?? [],
        })),
      });
    }

    // Resolve the article inside each candidate act, so a misspelled or
    // ambiguous act name still offers the right provisions to choose between.
    const provisions = await prisma.provision.findMany({
      where: {
        actId: { in: acts.map((a) => a.id) },
        kind: "article",
        articleNumber: parsed.articleNumber,
        articleLetter: parsed.articleLetter,
      },
      include: { act: true },
    });

    const order = new Map(acts.map((a, i) => [a.id, i]));
    provisions.sort((a, b) => (order.get(a.actId) ?? 0) - (order.get(b.actId) ?? 0));

    return NextResponse.json({
      suggestions: provisions.map((p) => ({
        kind: "provision" as const,
        id: p.id,
        actId: p.actId,
        label: `${p.displayLabel}${p.heading ? ` — ${p.heading}` : ""}`,
        sublabel: `${p.act.title} (${actCitation(p.act)})`,
        path: `${actPath(p.act)}#${p.anchor}`,
        jurisdiction: p.act.jurisdiction,
        eeaRelevant: p.act.eeaRelevant,
        eeaIncorporatedBy: p.act.eeaIncorporatedBy ?? [],
      })),
      // Offered as a fallback when the article does not exist in any match —
      // better to show the act than nothing at all.
      fallbackActs:
        provisions.length === 0
          ? acts.slice(0, 3).map((a) => ({
              kind: "act" as const,
              id: a.id,
              actId: a.id,
              label: a.title,
              sublabel: `${a.citation} — ${formatArticleLabel(parsed)} fannst ekki`,
              path: a.path,
              jurisdiction: a.jurisdiction,
              eeaRelevant: a.eeaRelevant ?? false,
              eeaIncorporatedBy: a.eeaIncorporatedBy ?? [],
            }))
          : [],
    });
  } catch (e) {
    console.error("Lookup failed:", e);
    return NextResponse.json({ error: "Lookup failed." }, { status: 500 });
  }
}
