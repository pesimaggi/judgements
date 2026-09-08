/**
 * Stage two: finding the law before saying anything about it.
 *
 * This is the half of the well that makes it worth having. A model asked
 * about Icelandic citizenship from memory will produce something that reads
 * like an answer and cites an article number it invented. So it is not asked
 * from memory: the plan goes through the same search this app already runs —
 * the act library, the provisions, and every decision source — and the model
 * only ever sees what came back, numbered, with the route to each one.
 *
 * Three things changed here, and they are the reasons this file is no longer
 * a straight line:
 *
 * MANY SEARCHES, NOT ONE. The plan used to become a single OR query over every
 * term at once. That makes the terms compete: a case number the user typed
 * exactly ranks against five synonyms, and the phrase that had to match as a
 * phrase is diluted by the words around it. Now each phrase, each concept and
 * each named decision is its own focused search, and the rankings are fused
 * with weighted reciprocal-rank fusion (lib/ask/fusion.ts) — deterministic, so
 * the same question over the same corpus retrieves the same sources.
 *
 * A LARGER CANDIDATE SET, THEN A RANKING. Retrieval gathers ~30 candidates and
 * shows ~10, so that something other than `ts_rank` chooses among them: which
 * court decided it, whether it is legislation or somebody's article about
 * legislation, whether the quoted phrase is really in the text. See
 * lib/ask/rank.ts.
 *
 * EVIDENCE, NOT SNIPPETS. A decision used to arrive as a 600-character search
 * headline, which is enough to know it is about the right subject and nowhere
 * near enough to say what it held. Now each one arrives as labelled evidence —
 * the matched passage with room around it, the court's own summary, its
 * Niðurstaða, its Dómsorð. See lib/ask/evidence.ts. Never the whole judgment:
 * Óbyggðanefnd's rulings are several hundred pages.
 */
import { prisma } from "../db";
import { getSearchProvider } from "../search";
import { SOURCES, isScholarship } from "../sources";
import { actMatchQuality, isStrongActMatch } from "../act-match";
import type { SearchHit } from "../types";
import { termsToQuery, termToQuery } from "./plan";
import { fuse, maxPossibleScore, type RankedList } from "./fusion";
import { rankCandidates, authorityName, type RankCandidate } from "./rank";
import {
  buildDecisionEvidence,
  isRegisterOnly,
  provisionEvidence,
  sanitizeEvidence,
  stripMarks,
  DEFAULT_EVIDENCE_BUDGET,
} from "./evidence";
import { askConfig, type AskConfig } from "./config";
import { rerankWithModel } from "./rerank";
import type { AskModel } from "./llm";
import { looksConflicting, type RetrievalShape } from "./complexity";
import type { AskAuthorityTier, AskSource, AskSourceKind, QueryPlan } from "./types";

/** Every live source. The well searches all of them; nothing is opt-in here. */
const ALL_LIVE_SOURCES = SOURCES.map((s) => s.key);

/**
 * How much each kind of focused search counts in the fusion.
 *
 * The order is the order of how much the query tells us. A case number the
 * user typed is unambiguous; a quoted phrase is a term of art they meant
 * literally; a single concept is one of several names for the subject; the
 * combined OR query is the old broad net, kept because it is what finds the
 * document that uses none of the concepts by name.
 */
export const QUERY_WEIGHTS = {
  decision: 2.0,
  phrase: 1.5,
  provisionQuery: 1.5,
  actScoped: 1.2,
  concept: 1.0,
  broad: 0.7,
} as const;

/** Acts are pointers, not text, and more than a couple is noise. */
const MAX_ACTS = 3;
/**
 * Commentary is somebody's argument about the law. It is retrievable and
 * citable — sometimes a journal article is the only thing written on a point —
 * but it never crowds out the law, so at most this many survive selection
 * unless the plan actually asked for commentary.
 */
const MAX_UNREQUESTED_COMMENTARY = 1;

/**
 * How much of a stored document is read back for evidence extraction.
 *
 * The head carries the útdráttur and almost always the matched passage; the
 * tail carries Niðurstaða and Dómsorð in the documents long enough for the
 * head to miss them. Together they bound what a 400-page Óbyggðanefnd ruling
 * costs to fetch, which is the difference between this being affordable per
 * question and not.
 */
const DOC_HEAD_CHARS = 120_000;
const DOC_TAIL_CHARS = 40_000;

export interface Retrieval {
  /** The numbered sources, in the order the model sees them. */
  sources: AskSource[];
  /** Those sources rendered for the prompt. Empty when nothing was found. */
  context: string;
  counts: {
    acts: number;
    provisions: number;
    decisions: number;
    /** Everything ranking chose from, which is the number worth watching. */
    candidates: number;
  };
  /**
   * The evidence text for each numbered source, so the citation verifier can
   * check a claim against exactly what the answer stage was shown.
   */
  evidence: Map<number, string>;
  /**
   * What the corpus could not do for this question. Carried into the answer
   * context so the answer states it, rather than quietly answering as if the
   * limitation did not exist.
   */
  limitations: string[];
  /** What the complexity classifier needs to know about what came back. */
  shape: RetrievalShape;
}

/**
 * The limitation that matters today: the act library is Lagasafn's *current*
 * consolidated text. There are no repealed acts and no earlier versions of a
 * live one, so a question about the law as it stood cannot be answered from
 * the legislation here — only from decisions that happen to quote the old
 * wording.
 */
/**
 * What to say when the only record of a decision is its register entry.
 *
 * Stated as a limitation of the *search*, in the same channel as the
 * historical-law one, because it is the same kind of fact: something the
 * corpus cannot do for this question, which the answer must say out loud
 * rather than work around.
 */
export function registerOnlyLimitation(language: "is" | "en", cases: string[]): string {
  const list = cases.join(", ");
  return language === "is"
    ? `Fyrir eftirfarandi mál EFTA-dómstólsins geymir þessi gagnagrunnur aðeins málaskrárfærslu dómstólsins — aðila, álitaefni og lista yfir birt skjöl — en ekki texta dómsins sjálfs: ${list}. Svarið verður að taka fram að niðurstaða dómsins verði ekki lesin úr þessum heimildum og vísa lesanda á dómstólinn sjálfan, í stað þess að segja einungis að heimildirnar sýni hana ekki.`
    : `For the following EFTA Court cases this database holds only the Court's case-register entry — the parties, the subject and the list of published documents — and not the text of the decision itself: ${list}. The answer must say that the outcome cannot be read from these sources and point the reader to the Court, rather than merely reporting that the sources do not show it.`;
}

export function historicalLimitation(language: "is" | "en"): string {
  return language === "is"
    ? "Lagasafnið í brunninum geymir aðeins gildandi texta laga eins og hann stendur í dag — hvorki brottfelld lög né eldri útgáfur ákvæða. Spurningin virðist varða réttarástand á fyrri tíma. Svarið verður að taka fram að ekki er unnt að staðfesta orðalag ákvæðis eins og það hljóðaði þá, nema úrlausn í heimildunum vitni beinlínis til eldra orðalags."
    : "The act library in this well holds only the current consolidated text of legislation — no repealed acts and no earlier versions of a provision. This question appears to turn on the law as it stood at an earlier time. The answer must say that the wording as it then stood cannot be confirmed from these sources, unless one of the decisions quotes the earlier wording directly.";
}

export interface RetrieveOptions {
  scope?: "eea" | "eu";
  /**
   * The model, for the optional rerank. Passing none simply means the
   * deterministic ranking is final — which is also what happens when the model
   * is passed and `ASK_RERANK_WITH_MODEL` is off.
   */
  model?: AskModel;
  /** Reports whether the optional rerank ran, and how long it took. */
  onRerank?: (info: { ran: boolean; ms: number }) => void;
}

export async function retrieve(
  plan: QueryPlan,
  config: AskConfig = askConfig(),
  options: RetrieveOptions = {}
): Promise<Retrieval> {
  const scope = options.scope ?? "eea";
  const [actMatches, decisionLists] = await Promise.all([
    findActs(plan, scope),
    searchDecisions(plan, config),
  ]);

  const provisionLists = await searchProvisions(plan, actMatches, scope, config);

  const acts = actMatches.slice(0, MAX_ACTS);
  const provisions = fuse(provisionLists, (hit) => hit.id).slice(0, config.maxCandidates);
  const decisions = fuse(decisionLists, (hit) => hit.id).slice(0, config.maxCandidates);

  const provisionCeiling = maxPossibleScore(provisionLists);
  const decisionCeiling = maxPossibleScore(decisionLists);

  // ---- one flat candidate list, ranked on features rather than on ts_rank --
  const candidates: (RankCandidate & { payload: CandidatePayload })[] = [];

  for (const act of acts) {
    candidates.push({
      key: `act:${act.id}`,
      kind: "act",
      actId: act.id,
      jurisdiction: act.jurisdiction,
      text: `${act.citation} ${act.title}`,
      // An act is here because the question named it, which the act-match rule
      // already established. It is not competing on textual relevance.
      relevance: 1,
      matchedBy: ["act-lookup"],
      bestRank: 1,
      payload: { type: "act", act },
    });
  }

  for (const { item, score, matchedBy } of provisions) {
    candidates.push({
      key: `provision:${item.id}`,
      kind: "provision",
      actId: item.actId,
      jurisdiction: item.jurisdiction,
      text: `${item.displayLabel} ${item.actCitation} ${item.actTitle} ${item.heading ?? ""} ${stripMarks(item.snippet)}`,
      relevance: score / provisionCeiling,
      matchedBy: matchedBy.map((m) => m.label),
      bestRank: Math.min(...matchedBy.map((m) => m.rank)),
      payload: { type: "provision", hit: item },
    });
  }

  for (const { item, score, matchedBy } of decisions) {
    candidates.push({
      key: `decision:${item.id}`,
      kind: decisionKind(item.source),
      sourceKey: item.source,
      court: item.court,
      date: item.date,
      jurisdiction: "is",
      text: `${item.caseName ?? item.title} ${item.summary ?? ""} ${stripMarks(item.snippet)}`,
      relevance: score / decisionCeiling,
      matchedBy: matchedBy.map((m) => m.label),
      bestRank: Math.min(...matchedBy.map((m) => m.rank)),
      payload: { type: "decision", hit: item },
    });
  }

  const deterministic = rankCandidates(candidates, plan);

  // The optional model rerank. It can only reorder — never add a source, never
  // remove one — and any failure leaves the deterministic order standing. See
  // lib/ask/rerank.ts.
  let ranked = deterministic;
  if (config.rerankWithModel && options.model) {
    const at = Date.now();
    const result = await rerankWithModel(deterministic, plan, options.model, config);
    ranked = result.ranked;
    options.onRerank?.({ ran: result.ran, ms: Date.now() - at });
  }

  const chosen = select(ranked, plan, config);

  // ---- the text, fetched only for what survived ranking -------------------
  const [provisionBodies, documentBodies] = await Promise.all([
    fetchProvisionBodies(chosen.flatMap((c) => (c.candidate.payload.type === "provision" ? [c.candidate.payload.hit.id] : []))),
    fetchDocumentBodies(chosen.flatMap((c) => (c.candidate.payload.type === "decision" ? [c.candidate.payload.hit.id] : []))),
  ]);

  const sources: AskSource[] = [];
  const blocks: string[] = [];
  const registerOnly: string[] = [];
  const evidence = new Map<number, string>();
  const counts = { acts: 0, provisions: 0, decisions: 0, candidates: candidates.length };
  let n = 0;

  for (const { candidate, score, tier } of chosen) {
    n += 1;
    const payload = candidate.payload;

    if (payload.type === "act") {
      const act = payload.act;
      counts.acts += 1;
      sources.push({
        n,
        kind: "act",
        title: act.citation,
        subtitle: act.title,
        path: act.path,
        jurisdiction: act.jurisdiction,
        tier,
        score,
        cited: false,
      });
      const body = [
        `Title: ${act.title}`,
        `Articles held: ${act.provisionCount}`,
        `Read at: ${act.path}`,
      ].join("\n");
      evidence.set(n, body);
      blocks.push(block(n, "ACT (legislation)", act.citation, body));
      continue;
    }

    if (payload.type === "provision") {
      const hit = payload.hit;
      counts.provisions += 1;
      const stored = provisionBodies.get(hit.id);
      const { text, truncated } = provisionEvidence(
        stored?.fullText ?? stripMarks(hit.snippet),
        config.provisionChars,
        stored?.paragraphs
      );
      const label = `${hit.displayLabel} ${hit.actCitation}`;
      sources.push({
        n,
        kind: "provision",
        title: label,
        subtitle: hit.heading ? `${hit.heading} — ${hit.actTitle}` : hit.actTitle,
        path: hit.path,
        jurisdiction: hit.jurisdiction,
        tier,
        score,
        excerpt: firstLines(text),
        cited: false,
      });
      const body = [
        hit.heading ? `Heading: ${hit.heading}` : null,
        `Act: ${hit.actTitle}`,
        hit.caseCount > 0 ? `Decisions citing it: ${hit.caseCount}` : null,
        `Read at: ${hit.path}`,
        "Provision text:",
        sanitizeEvidence(text),
        truncated
          ? "(This article is longer than the extract above. Later paragraphs, which may contain exceptions or conditions, are not shown — do not state that the article contains no exception.)"
          : null,
      ]
        .filter(Boolean)
        .join("\n");
      evidence.set(n, body);
      blocks.push(block(n, "PROVISION (legislation)", label, body));
      continue;
    }

    const hit = payload.hit;
    counts.decisions += 1;
    const scholarship = isScholarship(hit.source);
    const stored = documentBodies.get(hit.id);
    const label = hit.caseNumber ? `${hit.court} ${hit.caseNumber}` : hit.court;
    const path = scholarship ? hit.officialUrl : `/document/${hit.id}`;

    // A journal article's text never leaves the server; the search snippet is
    // all this app ever shows of one, here as everywhere else.
    const registerEntry = isRegisterOnly(hit.source, stored);
    if (registerEntry) registerOnly.push(label);

    const ev = buildDecisionEvidence(
      {
        fullText: scholarship ? null : stored,
        snippet: hit.snippet,
        summary: scholarship ? null : hit.summary,
        terms: [...plan.phrases, ...plan.concepts],
      },
      { ...DEFAULT_EVIDENCE_BUDGET, window: config.evidenceWindow }
    );

    sources.push({
      n,
      kind: candidate.kind,
      title: hit.caseName ?? hit.title,
      subtitle: [label, hit.date?.slice(0, 10)].filter(Boolean).join(" — "),
      path,
      officialUrl: hit.officialUrl,
      authority: authorityName(hit.source, hit.court),
      tier,
      date: hit.date ?? undefined,
      score,
      excerpt: firstLines(ev.summary ?? ev.matched ?? ""),
      cited: false,
    });

    const body = [
      `Title: ${hit.caseName ?? hit.title}`,
      hit.date ? `Date: ${hit.date.slice(0, 10)}` : null,
      `Decided by: ${authorityName(hit.source, hit.court) ?? hit.court}`,
      hit.subjectTags.length ? `Subjects: ${hit.subjectTags.join(", ")}` : null,
      `Read at: ${path}`,
      ev.summary ? `\nCOURT'S OWN SUMMARY:\n${sanitizeEvidence(ev.summary)}` : null,
      ev.matched
        ? `\nMATCHED PASSAGE${ev.matchedInFullText ? "" : " (search extract only)"}:\n${sanitizeEvidence(ev.matched)}`
        : null,
      ev.reasoning ? `\nREASONING (Niðurstaða):\n${sanitizeEvidence(ev.reasoning)}` : null,
      ev.holding ? `\nHOLDING (Dómsorð):\n${sanitizeEvidence(ev.holding)}` : null,
      registerEntry
        ? "\nWHAT THIS RECORD IS: the EFTA Court's case-register entry, not the decision. It carries the parties, the subject and the list of documents the Court has published; the text of the decision is not held in this database. Do not state what the Court held from this record. Say that the decision itself is not among these sources and send the reader to the Court."
        : null,
    ]
      .filter(Boolean)
      .join("\n");

    evidence.set(n, body);
    blocks.push(
      block(
        n,
        scholarship ? "COMMENTARY (not law)" : candidate.kind === "opinion" ? "OPINION" : "DECISION",
        label,
        body
      )
    );
  }

  const limitations = [
    ...(plan.historical ? [historicalLimitation(plan.language)] : []),
    ...(registerOnly.length ? [registerOnlyLimitation(plan.language, registerOnly)] : []),
  ];

  return {
    sources,
    context: blocks.join("\n\n"),
    counts,
    evidence,
    limitations,
    shape: {
      distinctActs: new Set(
        chosen.map((c) => c.candidate.actId).filter((id): id is string => Boolean(id))
      ).size,
      jurisdictions: Array.from(
        new Set(chosen.map((c) => c.candidate.jurisdiction).filter(Boolean) as string[])
      ),
      decisions: counts.decisions,
      conflicting: looksConflicting(sources),
    },
  };
}

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

interface MatchedAct {
  id: string;
  title: string;
  citation: string;
  path: string;
  jurisdiction: string;
  provisionCount: number;
}

type ProvisionHitLike = Awaited<
  ReturnType<ReturnType<typeof getSearchProvider>["searchProvisions"]>
>["hits"][number];

type CandidatePayload =
  | { type: "act"; act: MatchedAct }
  | { type: "provision"; hit: ProvisionHitLike }
  | { type: "decision"; hit: SearchHit };

/**
 * Umboðsmaður Alþingis issues álit — opinions, not decisions in a case — and
 * the journals publish commentary. Both are labelled as what they are, because
 * a model handed an opinion beside a judgment will otherwise cite the opinion
 * as if a court had held it.
 */
const OPINION_SOURCES = new Set(["umbodsmadur"]);

function decisionKind(sourceKey: string): AskSourceKind {
  if (isScholarship(sourceKey)) return "commentary";
  if (OPINION_SOURCES.has(sourceKey)) return "opinion";
  return "decision";
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
  // the leading concept is tried as one. It costs a lookup, and the
  // strong-match rule below drops it again unless it really is an act's name.
  const queries = [
    ...plan.actQueries,
    ...plan.provisionQueries,
    ...(plan.actQueries.length ? [] : plan.concepts.slice(0, 1)),
  ];
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
          jurisdiction: hit.jurisdiction,
          provisionCount: hit.provisionCount,
        });
      }
    }
  }

  return Array.from(found.values());
}

/**
 * The articles the answer is built out of, from several focused searches.
 *
 * Inside each named act first, because an act the question actually named is
 * the best place to look for the article that answers it. Then each phrase and
 * each concept across the whole library, separately, so that the article in
 * the act nobody thought to name is still found — which, for a question asked
 * by somebody who does not know the law yet, is most of them.
 */
async function searchProvisions(
  plan: QueryPlan,
  acts: MatchedAct[],
  scope: "eea" | "eu",
  config: AskConfig
): Promise<RankedList<ProvisionHitLike>[]> {
  const provider = getSearchProvider();
  const broad = termsToQuery([...plan.concepts, ...plan.phrases]);
  const perQuery = Math.max(4, Math.ceil(config.maxCandidates / 3));

  const planned: { label: string; weight: number; run: () => Promise<{ hits: ProvisionHitLike[] }> }[] =
    [];

  for (const q of plan.provisionQueries) {
    planned.push({
      label: `provision:${q}`,
      weight: QUERY_WEIGHTS.provisionQuery,
      run: () => provider.searchProvisions({ query: q, page: 1, pageSize: 4, scope }),
    });
  }
  for (const act of acts.slice(0, 3)) {
    planned.push({
      label: `act:${act.citation}`,
      weight: QUERY_WEIGHTS.actScoped,
      run: () =>
        provider.searchProvisions({
          query: broad || act.title,
          actId: act.id,
          page: 1,
          pageSize: 4,
          scope,
        }),
    });
  }
  for (const phrase of plan.phrases) {
    planned.push({
      label: `phrase:${phrase}`,
      weight: QUERY_WEIGHTS.phrase,
      run: () =>
        provider.searchProvisions({ query: termToQuery(phrase), page: 1, pageSize: perQuery, scope }),
    });
  }
  for (const concept of plan.concepts.slice(0, 4)) {
    planned.push({
      label: `concept:${concept}`,
      weight: QUERY_WEIGHTS.concept,
      run: () =>
        provider.searchProvisions({ query: termToQuery(concept), page: 1, pageSize: perQuery, scope }),
    });
  }
  if (broad) {
    planned.push({
      label: "broad",
      weight: QUERY_WEIGHTS.broad,
      run: () => provider.searchProvisions({ query: broad, page: 1, pageSize: perQuery, scope }),
    });
  }

  return runAll(planned, "provision search");
}

/**
 * The decisions, likewise as several focused searches.
 *
 * A case number the user typed goes in as its own query, unquoted and
 * uncombined, because the search provider has an exact case-number path and
 * folding the number into an OR query is what loses it.
 */
async function searchDecisions(
  plan: QueryPlan,
  config: AskConfig
): Promise<RankedList<SearchHit>[]> {
  const provider = getSearchProvider();
  const broad = termsToQuery([...plan.concepts, ...plan.phrases]);
  const perQuery = Math.max(5, Math.ceil(config.maxCandidates / 3));

  const planned: { label: string; weight: number; run: () => Promise<{ hits: SearchHit[] }> }[] = [];

  const search = (query: string, pageSize: number) => () =>
    provider.search({
      query,
      sources: ALL_LIVE_SOURCES,
      sort: "relevance",
      page: 1,
      pageSize,
    });

  for (const q of plan.decisionQueries) {
    // Exactly as typed: the provider matches a case number against the column
    // and only falls back to trigrams when that finds nothing.
    planned.push({ label: `case:${q}`, weight: QUERY_WEIGHTS.decision, run: search(q, 5) });
  }
  for (const phrase of plan.phrases) {
    planned.push({
      label: `phrase:${phrase}`,
      weight: QUERY_WEIGHTS.phrase,
      run: search(termToQuery(phrase), perQuery),
    });
  }
  for (const concept of plan.concepts.slice(0, 4)) {
    planned.push({
      label: `concept:${concept}`,
      weight: QUERY_WEIGHTS.concept,
      run: search(termToQuery(concept), perQuery),
    });
  }
  if (broad) {
    planned.push({ label: "broad", weight: QUERY_WEIGHTS.broad, run: search(broad, perQuery) });
  }

  const lists = await runAll(planned, "decision search");
  // Seed data is flagged and stays out: an answer that rests on a sample
  // judgment is a fabricated answer, however clearly the card labels it.
  return lists.map((list) => ({ ...list, items: list.items.filter((hit) => !hit.isSample) }));
}

/**
 * Runs the planned searches together, and treats a failed one as an empty
 * list rather than a failed question. Losing one of six rankings costs a
 * little recall; losing the answer costs the reader everything.
 */
async function runAll<T>(
  planned: { label: string; weight: number; run: () => Promise<{ hits: T[] }> }[],
  what: string
): Promise<RankedList<T>[]> {
  const results = await Promise.all(
    planned.map((p) =>
      p
        .run()
        .then((r) => ({ label: p.label, weight: p.weight, items: r.hits }))
        .catch((e) => {
          console.error(`Ask: ${what} failed for ${p.label}:`, e);
          return { label: p.label, weight: p.weight, items: [] as T[] };
        })
    )
  );
  return results;
}

/**
 * The candidates that make it into the answer's context.
 *
 * Ranking has already put them in order; this applies the two composition
 * rules that a score alone cannot express — a couple of act pointers at most,
 * and commentary kept from crowding out the law when the question did not ask
 * for commentary.
 */
function select<T extends RankCandidate & { payload: CandidatePayload }>(
  ranked: { candidate: T; score: number; tier: AskAuthorityTier }[],
  plan: QueryPlan,
  config: AskConfig
): { candidate: T; score: number; tier: AskAuthorityTier }[] {
  const commentaryWanted =
    plan.sourceCategories.length === 0 || plan.sourceCategories.includes("commentary");
  const commentaryCap = commentaryWanted ? config.maxSources : MAX_UNREQUESTED_COMMENTARY;

  const chosen: typeof ranked = [];
  let acts = 0;
  let commentary = 0;

  for (const entry of ranked) {
    if (chosen.length >= config.maxSources) break;
    if (entry.candidate.kind === "act") {
      if (acts >= MAX_ACTS) continue;
      acts += 1;
    }
    if (entry.candidate.kind === "commentary") {
      if (commentary >= commentaryCap) continue;
      commentary += 1;
    }
    chosen.push(entry);
  }
  return chosen;
}

// ---------------------------------------------------------------------------
// Bodies
// ---------------------------------------------------------------------------

async function fetchProvisionBodies(
  ids: string[]
): Promise<Map<string, { fullText: string; paragraphs: string[] }>> {
  if (ids.length === 0) return new Map();
  try {
    const rows = await prisma.provision.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        fullText: true,
        // Lagasafn's own paragraph split, which is what makes it possible to
        // shorten an article by dropping whole málsgreinar instead of cutting
        // one in half. See provisionEvidence.
        paragraphs: { select: { text: true }, orderBy: { ordering: "asc" } },
      },
    });
    return new Map(
      rows.map((r) => [r.id, { fullText: r.fullText, paragraphs: r.paragraphs.map((p) => p.text) }])
    );
  } catch (e) {
    console.error("Ask: provision bodies failed, falling back to snippets:", e);
    return new Map();
  }
}

/**
 * The stored judgments, head and tail.
 *
 * Only the ends are fetched. The útdráttur and the matched passage are almost
 * always in the head; Niðurstaða and Dómsorð are at the end of anything long
 * enough for the head to have missed them. Fetching both ends of six documents
 * is affordable; fetching six complete Óbyggðanefnd rulings is not.
 */
async function fetchDocumentBodies(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  try {
    const rows = await prisma.$queryRaw<
      { id: string; head: string; tail: string; len: number }[]
    >`
      SELECT id,
             left(full_text, ${DOC_HEAD_CHARS}::int)  AS head,
             right(full_text, ${DOC_TAIL_CHARS}::int) AS tail,
             length(full_text)                         AS len
        FROM "Document"
       WHERE id = ANY(${ids}::text[])
    `;
    return new Map(
      rows.map((r) => [
        r.id,
        // Joined with a blank line and an ellipsis so the section extractor
        // does not run one end into the other and read a heading across the
        // join. A document short enough to fit is returned whole.
        r.len > DOC_HEAD_CHARS ? `${r.head}\n\n[…]\n\n${r.tail}` : r.head,
      ])
    );
  } catch (e) {
    console.error("Ask: document bodies failed, falling back to snippets:", e);
    return new Map();
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * One source, fenced.
 *
 * The fence is not decoration. Everything inside it is text somebody else
 * wrote — a judgment, a ruling, a journal article — and the answer prompt says
 * in terms that what is inside a fence is evidence and never an instruction.
 * `sanitizeEvidence` strips the fence tokens out of the text itself, so a
 * document cannot close its own block.
 */
function block(n: number, kind: string, label: string, body: string): string {
  return [`<<<SOURCE ${n}>>>`, `[${n}] ${kind} — ${label}`, body, `<<<END SOURCE ${n}>>>`].join("\n");
}

/** A short excerpt for the source list in the UI. */
function firstLines(text: string, max = 320): string | undefined {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return undefined;
  return clean.length <= max ? clean : `${clean.slice(0, max).trimEnd()} …`;
}
