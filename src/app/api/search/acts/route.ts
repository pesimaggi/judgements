import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSearchProvider } from "@/lib/search";
import { parseActScope } from "@/lib/acts";
import { rankActMatches, type ActMatchQuality } from "@/lib/act-match";
import { parseProvisionQuery } from "@/lib/provision-query";

export const dynamic = "force-dynamic";

/** How many acts may head the results. Three is a shortlist; ten is a page. */
const MAX_ACTS = 3;

/**
 * The act-side answer to the query the case search is running.
 *
 * Someone typing "vaxtalög" into the main search box is not asking for the
 * judgments that mention the word — they are asking for the act, and the
 * judgments after it. So the search page asks this route the same question it
 * asks /api/search, and puts what comes back above the case results.
 *
 * Two things keep that from becoming noise:
 *
 *   - Only acts the query genuinely *names* are returned. The lookup behind
 *     the type-ahead falls back to trigram similarity, which is right when a
 *     human is picking from a list and wrong when the top of the page is being
 *     decided; lib/act-match.ts is the gate, and a search for a subject
 *     ("gæsluvarðhald") returns nothing here at all.
 *   - An article reference is resolved to the article. "5. gr. vaxtalaga" and
 *     "Article 6 gdpr" are answered by that provision rather than by the whole
 *     act, because that is what was asked for.
 *
 * `scope` is the EES/ESB toggle, so the act that heads a search obeys the same
 * setting as every other act lookup in the app.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const query = (searchParams.get("q") ?? "").trim();
  const scope = parseActScope(searchParams.get("scope"));
  if (query.length < 2) return NextResponse.json({ acts: [], provisions: [] });

  try {
    const parsed = parseProvisionQuery(query);
    // With an article but no act named, there is nothing to resolve it in.
    if (parsed.hasArticle && !parsed.actQuery) {
      return NextResponse.json({ acts: [], provisions: [] });
    }

    // The act part of the query is what an act is matched against: "5. gr.
    // vaxtalaga" names vaxtalög, and asking whether the whole string names an
    // act would answer no.
    const actQuery = parsed.actQuery || query;
    const candidates = await getSearchProvider().searchActs({
      query: actQuery,
      // Wider than what is shown: the gate below drops most of these, and a
      // strong match ranked fourth by the provider should still be found.
      limit: 10,
      scope,
    });

    const ranked = rankActMatches(actQuery, candidates).slice(0, MAX_ACTS);
    if (ranked.length === 0) return NextResponse.json({ acts: [], provisions: [] });

    const actIds = ranked.map((r) => r.act.id);

    // How many judgments cite each act, counted across both link tables so an
    // act cited once by article and once bare is one case, not two. One
    // statement for the whole shortlist rather than a query per act.
    const counts = await prisma.$queryRaw<{ act_id: string; judgments: number }[]>`
      SELECT a.id AS act_id, count(DISTINCT d)::int AS judgments
        FROM acts a
        LEFT JOIN LATERAL (
          SELECT l.document_id AS d FROM case_provision_links l
            JOIN provisions p ON p.id = l.provision_id
           WHERE p.act_id = a.id
          UNION
          SELECT al.document_id FROM case_act_links al WHERE al.act_id = a.id
        ) refs ON TRUE
       WHERE a.id = ANY(${actIds})
       GROUP BY a.id
    `;
    const citingCases = new Map(counts.map((c) => [c.act_id, Number(c.judgments)]));

    const acts = ranked.map(({ act, quality }) => ({
      id: act.id,
      jurisdiction: act.jurisdiction,
      title: act.title,
      citation: act.citation,
      path: act.path,
      provisionCount: act.provisionCount,
      citingCases: citingCases.get(act.id) ?? 0,
      eeaRelevant: act.eeaRelevant ?? false,
      eeaIncorporatedBy: act.eeaIncorporatedBy ?? [],
      /** Why this act is here, for the line under it. */
      matchedBy: quality as ActMatchQuality,
    }));

    // The article, where one was asked for, inside the acts that matched.
    const provisions = parsed.hasArticle
      ? await prisma.provision.findMany({
          where: {
            actId: { in: actIds },
            kind: "article",
            articleNumber: parsed.articleNumber,
            articleLetter: parsed.articleLetter,
          },
          include: { act: true, paragraphs: { orderBy: { ordering: "asc" }, take: 1 } },
          take: MAX_ACTS,
        })
      : [];

    const order = new Map(actIds.map((id, i) => [id, i]));
    provisions.sort((a, b) => (order.get(a.actId) ?? 0) - (order.get(b.actId) ?? 0));

    const provisionCaseCounts = provisions.length
      ? await prisma.caseProvisionLink.findMany({
          where: { provisionId: { in: provisions.map((p) => p.id) } },
          select: { provisionId: true, documentId: true },
          distinct: ["provisionId", "documentId"],
        })
      : [];
    const perProvision = new Map<string, number>();
    for (const link of provisionCaseCounts) {
      perProvision.set(link.provisionId, (perProvision.get(link.provisionId) ?? 0) + 1);
    }

    return NextResponse.json({
      acts,
      provisions: provisions.map((p) => {
        const act = acts.find((a) => a.id === p.actId);
        return {
          id: p.id,
          actId: p.actId,
          displayLabel: p.displayLabel,
          heading: p.heading,
          snippet: p.paragraphs[0]?.text.slice(0, 400) ?? p.fullText.slice(0, 400),
          citation: act?.citation ?? "",
          actTitle: act?.title ?? p.act.title,
          path: `${act?.path ?? ""}#${p.anchor}`,
          caseCount: perProvision.get(p.id) ?? 0,
        };
      }),
    });
  } catch (e) {
    console.error("Act search failed:", e);
    // Never fatal to the page: the case results are the rest of the answer,
    // and they are already on their way from /api/search.
    return NextResponse.json({ acts: [], provisions: [] });
  }
}
