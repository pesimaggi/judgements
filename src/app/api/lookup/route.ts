import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSearchProvider } from "@/lib/search";
import { parseProvisionQuery, formatArticleLabel } from "@/lib/provision-query";
import { actFullLabel, actPath, parseActScope, provisionFullLabel } from "@/lib/acts";

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
          // The label is what becomes a chip, and a chip has to survive being
          // read on its own: "Almenn hegningarlög" is a different claim from
          // "Almenn hegningarlög nr. 19/1940" once there are three of them in
          // a row. The short names go underneath, where they help someone
          // confirm they picked the act they were thinking of.
          label: actFullLabel(a),
          sublabel: a.aliases?.length ? a.aliases.join(", ") : a.citation,
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
      include: { act: true, _count: { select: { caseLinks: true } } },
    });

    const order = new Map(acts.map((a, i) => [a.id, i]));
    provisions.sort((a, b) => (order.get(a.actId) ?? 0) - (order.get(b.actId) ?? 0));

    return NextResponse.json({
      suggestions: provisions.map((p) => ({
        kind: "provision" as const,
        id: p.id,
        actId: p.actId,
        // "4. gr." on its own was the bug this label fixes: picked from the
        // list it became a chip that named no act, and two provisions of two
        // different acts made two identical chips.
        label: provisionFullLabel(p.displayLabel, p.act),
        sublabel: provisionMeta(p),
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
              label: actFullLabel(a),
              sublabel: `${formatArticleLabel(parsed)} fannst ekki`,
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

/**
 * The second line under a provision suggestion: which act it belongs to, what
 * the article is called, and how much case law turns on it.
 *
 * The count is the deciding piece when an article number resolves to several
 * acts — "312 úrlausnir" against "engar úrlausnir" says which one the reader
 * meant far more reliably than the act titles do.
 */
function provisionMeta(provision: {
  heading: string | null;
  act: Parameters<typeof actFullLabel>[0];
  _count: { caseLinks: number };
}): string {
  const parts = [actFullLabel(provision.act)];
  if (provision.heading) parts.push(provision.heading);
  const n = provision._count.caseLinks;
  if (n > 0) {
    parts.push(
      n === 1
        ? "1 úrlausn vísar til ákvæðisins"
        : `${n.toLocaleString("is-IS")} úrlausnir vísa til ákvæðisins`
    );
  }
  return parts.join(" · ");
}
