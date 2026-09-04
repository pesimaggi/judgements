/**
 * Stage two: finding the law before saying anything about it.
 *
 * This is the half of the well that makes it worth having. A model asked
 * about Icelandic citizenship from memory will produce something that reads
 * like an answer and cites an article number it invented. So it is not asked
 * from memory: the plan's terms go through the same search this app already
 * runs — the act library, the provisions, and every decision source — and the
 * model only ever sees what came back, numbered, with the route to each one.
 *
 * Three kinds of source, in the order they are numbered:
 *
 *   acts        the instrument itself, when the question names one. A pointer,
 *               not text: an act's text lives in its provisions.
 *   provisions  the articles, in full. This is what an answer is built out of.
 *   decisions   judgments, úrskurðir and opinions, with the court's own
 *               summary where it wrote one — the demonstration that the
 *               provision means in practice what it appears to mean.
 */
import { prisma } from "../db";
import { getSearchProvider } from "../search";
import { SOURCES, isScholarship } from "../sources";
import { actMatchQuality, isStrongActMatch } from "../act-match";
import { termsToQuery } from "./plan";
import type { AskSource, QueryPlan } from "./types";

/** Every live source. The well searches all of them; nothing is opt-in here. */
const ALL_LIVE_SOURCES = SOURCES.map((s) => s.key);

/**
 * How much of each kind is retrieved. Tuned to fill a useful context without
 * burying the answer: eight provisions is more law than most questions turn
 * on, and eight decisions is enough for a pattern to be visible.
 */
const MAX_ACTS = 4;
const MAX_PROVISIONS = 8;
const MAX_DECISIONS = 8;

/** Per-source text budgets, in characters. */
const PROVISION_CHARS = 2400;
const SUMMARY_CHARS = 1500;
const SNIPPET_CHARS = 600;

export interface Retrieval {
  /** The numbered sources, in the order the model sees them. */
  sources: AskSource[];
  /** Those sources rendered for the prompt. Empty when nothing was found. */
  context: string;
  counts: { acts: number; provisions: number; decisions: number };
}

export async function retrieve(plan: QueryPlan): Promise<Retrieval> {
  const provider = getSearchProvider();
  const scope = "eea" as const;
  const query = termsToQuery(plan.terms);

  // The act lookups and the judgment search have nothing to say to each other
  // and both take a round trip to the database, so they go together.
  const [actMatches, decisionResult] = await Promise.all([
    findActs(plan, scope),
    provider
      .search({
        query,
        sources: ALL_LIVE_SOURCES,
        sort: "relevance",
        page: 1,
        // Over-fetched, because the sample judgments are dropped below and a
        // page of results that turned out to be seed data would leave the
        // answer with no case law at all.
        pageSize: MAX_DECISIONS + 4,
      })
      .catch((e) => {
        console.error("Ask: decision search failed:", e);
        return { total: 0, hits: [] };
      }),
  ]);

  // Provisions are looked up after the acts, because an act the question
  // actually named is the best place to look for the article that answers it —
  // better than the whole corpus, where a common word ranks a stranger's act
  // above the right one.
  const provisions = await findProvisions(plan, actMatches, query, scope);

  const sources: AskSource[] = [];
  const blocks: string[] = [];
  let n = 0;

  for (const act of actMatches.slice(0, MAX_ACTS)) {
    n += 1;
    sources.push({
      n,
      kind: "act",
      title: act.citation,
      subtitle: act.title,
      path: act.path,
      cited: false,
    });
    blocks.push(
      [
        `[${n}] ACT — ${act.citation}`,
        `Title: ${act.title}`,
        `Articles held: ${act.provisionCount}`,
        `Read at: ${act.path}`,
      ].join("\n")
    );
  }

  for (const provision of provisions) {
    n += 1;
    const label = `${provision.displayLabel} ${provision.actCitation}`;
    sources.push({
      n,
      kind: "provision",
      title: label,
      subtitle: provision.heading
        ? `${provision.heading} — ${provision.actTitle}`
        : provision.actTitle,
      path: provision.path,
      cited: false,
    });
    blocks.push(
      [
        `[${n}] PROVISION — ${label}`,
        provision.heading ? `Heading: ${provision.heading}` : null,
        `Act: ${provision.actTitle}`,
        provision.caseCount > 0 ? `Decisions citing it: ${provision.caseCount}` : null,
        `Read at: ${provision.path}`,
        "Text:",
        truncate(provision.text, PROVISION_CHARS),
      ]
        .filter(Boolean)
        .join("\n")
    );
  }

  const decisions = decisionResult.hits
    // Seed data is flagged and stays out: an answer that rests on a sample
    // judgment is a fabricated answer, however clearly the card labels it.
    .filter((hit) => !hit.isSample)
    .slice(0, MAX_DECISIONS);

  for (const hit of decisions) {
    n += 1;
    const scholarship = isScholarship(hit.source);
    const label = hit.caseNumber ? `${hit.court} ${hit.caseNumber}` : hit.court;
    sources.push({
      n,
      kind: "decision",
      title: hit.caseName ?? hit.title,
      subtitle: [label, hit.date?.slice(0, 10)].filter(Boolean).join(" — "),
      // A journal article is read at the journal that published it, never here.
      path: scholarship ? hit.officialUrl : `/document/${hit.id}`,
      officialUrl: hit.officialUrl,
      cited: false,
    });
    blocks.push(
      [
        `[${n}] ${scholarship ? "COMMENTARY" : "DECISION"} — ${label}`,
        `Title: ${hit.caseName ?? hit.title}`,
        hit.date ? `Date: ${hit.date.slice(0, 10)}` : null,
        hit.subjectTags.length ? `Subjects: ${hit.subjectTags.join(", ")}` : null,
        `Read at: ${scholarship ? hit.officialUrl : `/document/${hit.id}`}`,
        // A journal article's text never leaves the server; the search snippet
        // is all this app ever shows of one, here as everywhere else.
        !scholarship && hit.summary
          ? `Court's own summary: ${truncate(hit.summary, SUMMARY_CHARS)}`
          : null,
        `Matched passage: ${truncate(stripMarks(hit.snippet), SNIPPET_CHARS)}`,
      ]
        .filter(Boolean)
        .join("\n")
    );
  }

  return {
    sources,
    context: blocks.join("\n\n---\n\n"),
    counts: {
      acts: Math.min(actMatches.length, MAX_ACTS),
      provisions: provisions.length,
      decisions: decisions.length,
    },
  };
}

interface MatchedAct {
  id: string;
  title: string;
  citation: string;
  path: string;
  provisionCount: number;
}

/**
 * The acts the question names, if it names any.
 *
 * The lookup behind this is deliberately forgiving — it has to be, for a
 * type-ahead someone picks from. Here nobody picks: whatever comes back is
 * quoted to the model as the governing act. So the same rule the search page
 * uses to decide whether an act may head the results is applied, and a
 * near-match is dropped rather than promoted. See lib/act-match.ts.
 */
async function findActs(plan: QueryPlan, scope: "eea" | "eu"): Promise<MatchedAct[]> {
  const provider = getSearchProvider();
  // With no act named — which is every question the keyword fallback plans —
  // the leading term is tried as one. It costs a lookup, and the strong-match
  // rule below drops it again unless it really is an act's name or number.
  const queries = plan.actQueries.length ? plan.actQueries : plan.terms.slice(0, 1);
  const found = new Map<string, MatchedAct>();

  const results = await Promise.all(
    queries.map((q) =>
      provider
        .searchActs({ query: q, limit: 4, scope })
        .then((hits) => ({ q, hits }))
        .catch((e) => {
          console.error("Ask: act lookup failed:", e);
          return { q, hits: [] };
        })
    )
  );

  for (const { q, hits } of results) {
    for (const hit of hits) {
      if (!isStrongActMatch(actMatchQuality(q, hit))) continue;
      if (!found.has(hit.id)) {
        found.set(hit.id, {
          id: hit.id,
          title: hit.title,
          citation: hit.citation,
          path: hit.path,
          provisionCount: hit.provisionCount,
        });
      }
    }
  }

  return Array.from(found.values());
}

interface RetrievedProvision {
  id: string;
  displayLabel: string;
  heading: string | null;
  actTitle: string;
  actCitation: string;
  path: string;
  caseCount: number;
  text: string;
}

/**
 * The articles the answer is built out of.
 *
 * Searched twice over: once inside each act the question named, and once
 * across the whole library. The first is what finds the right article of the
 * right act; the second is what finds the article in the act nobody thought
 * to name — which, for a question asked by somebody who does not know the law
 * yet, is most of them.
 */
async function findProvisions(
  plan: QueryPlan,
  acts: MatchedAct[],
  query: string,
  scope: "eea" | "eu"
): Promise<RetrievedProvision[]> {
  const provider = getSearchProvider();

  const searches = [
    ...acts.slice(0, 3).map((act) =>
      provider.searchProvisions({ query, actId: act.id, page: 1, pageSize: 3, scope })
    ),
    provider.searchProvisions({ query, page: 1, pageSize: MAX_PROVISIONS, scope }),
  ];

  const results = await Promise.all(
    searches.map((p) =>
      p.catch((e) => {
        console.error("Ask: provision search failed:", e);
        return { total: 0, hits: [] };
      })
    )
  );

  // Named acts first, then the rest of the library, deduplicated: an article
  // reached both ways is the same article and is quoted once.
  const ordered = results.flatMap((r) => r.hits);
  const chosen = new Map<string, (typeof ordered)[number]>();
  for (const hit of ordered) {
    if (chosen.size >= MAX_PROVISIONS) break;
    if (!chosen.has(hit.id)) chosen.set(hit.id, hit);
  }
  if (chosen.size === 0) return [];

  // The search returns a snippet; an answer needs the article. One query for
  // the bodies of the handful that were chosen.
  const bodies = await prisma.provision.findMany({
    where: { id: { in: Array.from(chosen.keys()) } },
    select: { id: true, fullText: true },
  });
  const textById = new Map(bodies.map((b) => [b.id, b.fullText]));

  return Array.from(chosen.values()).map((hit) => ({
    id: hit.id,
    displayLabel: hit.displayLabel,
    heading: hit.heading,
    actTitle: hit.actTitle,
    actCitation: hit.actCitation,
    path: hit.path,
    caseCount: hit.caseCount,
    text: textById.get(hit.id) ?? hit.snippet,
  }));
}

/** The <mark> tags a search snippet carries are for the page, not the model. */
function stripMarks(html: string): string {
  return html.replace(/<\/?mark>/g, "").replace(/\s+/g, " ").trim();
}

function truncate(text: string, max: number): string {
  const clean = text.trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max).trimEnd()} …`;
}
