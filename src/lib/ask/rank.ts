/**
 * Which of the candidates are actually worth showing the model, and in what
 * order.
 *
 * Retrieval now gathers a much larger candidate set than the answer can hold —
 * thirty or so, against ten shown — precisely so that something other than
 * `ts_rank` gets to choose among them. Textual relevance is the wrong sole
 * criterion for law: a district court judgment that uses the query's words
 * eleven times is not better evidence than a Supreme Court judgment that uses
 * them twice, and a law review article that discusses the question at length
 * is not evidence of what the law *is* at all.
 *
 * So the ranking is over features a lawyer would actually weigh:
 *
 *   relevance      where the fused searches put it (lib/ask/fusion.ts)
 *   act match      it is in, or about, an act the question named
 *   exact phrase   the phrase the question quoted is really in the text
 *   kind           legislation is the law; a decision applies it; commentary
 *                  argues about it
 *   authority      which court or body decided it
 *   date           recent law displaces old law, weakly
 *   jurisdiction   an EU act answers an EU question; it does not answer an
 *                  Icelandic one on its own
 *   tangential     found by one loose synonym, a long way down
 *
 * Deterministic, and deliberately so: the weights are visible, a change to
 * them is reviewable in a diff, and the evaluation harness can measure it. A
 * model-assisted rerank exists behind `ASK_RERANK_WITH_MODEL` and reorders
 * *this* list rather than replacing it — see `applyModelOrder`.
 */
import { isScholarship, sourceByKey } from "../sources";
import type { AskAuthorityTier, AskSourceKind, QueryPlan } from "./types";

/** What one candidate offers the ranker. Deliberately flat and testable. */
export interface RankCandidate {
  /** Stable identity — the document id, the provision id, the act id. */
  key: string;
  kind: AskSourceKind;
  /** The source key a decision came from, for its authority. */
  sourceKey?: string;
  /** The act a provision belongs to, or a decision is about. */
  actId?: string;
  court?: string | null;
  date?: string | null;
  /** "is" | "eu". */
  jurisdiction?: string;
  /** Text the phrase and act checks look in: the evidence, plus the title. */
  text: string;
  /** The fused retrieval score, already normalised to 0-1. */
  relevance: number;
  /** Labels of the queries that found it, from fusion. */
  matchedBy: string[];
  /** The best rank it achieved in any list — 1 is first. */
  bestRank: number;
}

export interface RankedCandidate<T extends RankCandidate = RankCandidate> {
  candidate: T;
  score: number;
  tier: AskAuthorityTier;
  /** Feature-by-feature, so a surprising order can be explained. */
  features: Record<string, number>;
}

/**
 * The weights. Each is the most that feature can add or take away, so reading
 * down the list is reading the ranker's priorities in order.
 */
export const WEIGHTS = {
  relevance: 1.0,
  actMatch: 0.35,
  exactPhrase: 0.3,
  kind: 0.25,
  authority: 0.2,
  recency: 0.1,
  jurisdiction: 0.15,
  commentary: -0.25,
  tangential: -0.2,
} as const;

/** How much each kind of source counts, as a fraction of WEIGHTS.kind. */
const KIND_WEIGHT: Record<AskSourceKind, number> = {
  provision: 1, // the law itself, in the words that bind
  act: 0.4, // a pointer to the law, not the law
  decision: 0.7,
  opinion: 0.5,
  commentary: 0,
};

/** How much each tier counts, as a fraction of WEIGHTS.authority. */
const TIER_WEIGHT: Record<AskAuthorityTier, number> = {
  legislation: 1,
  supreme: 1,
  appellate: 0.7,
  "first-instance": 0.4,
  administrative: 0.35,
  oversight: 0.35,
  commentary: 0,
};

/**
 * Which tier a source key sits in.
 *
 * Written as a table rather than derived from `SourceDef.kind`, because that
 * field answers a different question (is this a decision or an article) and
 * the two would drift the moment a source needed to be in one bucket and not
 * the other. Anything unrecognised is "administrative", which is the
 * conservative answer: it is the tier that adds least.
 */
const TIER_BY_SOURCE: Record<string, AskAuthorityTier> = {
  haestirettur: "supreme",
  cjeu: "supreme",
  landsrettur: "appellate",
  eftacourt: "appellate",
  "eu-general-court": "appellate",
  endurupptokudomur: "appellate",
  heradsdomar: "first-instance",
  felagsdomur: "first-instance",
  umbodsmadur: "oversight",
};

export function authorityTier(kind: AskSourceKind, sourceKey?: string): AskAuthorityTier {
  if (kind === "act" || kind === "provision") return "legislation";
  if (!sourceKey) return "administrative";
  if (isScholarship(sourceKey)) return "commentary";
  return TIER_BY_SOURCE[sourceKey] ?? "administrative";
}

/** The institution's own name, for the label under a source. */
export function authorityName(sourceKey?: string, court?: string | null): string | undefined {
  return court ?? (sourceKey ? sourceByKey(sourceKey)?.name : undefined);
}

/** Years, as a 0-1 factor that reaches zero at thirty years old. */
function recency(date: string | null | undefined, now = Date.now()): number {
  if (!date) return 0;
  const then = Date.parse(date);
  if (Number.isNaN(then)) return 0;
  const years = (now - then) / (365.25 * 24 * 3600 * 1000);
  if (years <= 0) return 1;
  return Math.max(0, 1 - years / 30);
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ");
}

/**
 * Scores one candidate against the plan.
 *
 * `now` is a parameter so that the recency feature — the one thing here that
 * would otherwise change from one day to the next — can be pinned in a test.
 */
export function scoreCandidate<T extends RankCandidate>(
  candidate: T,
  plan: QueryPlan,
  now = Date.now()
): RankedCandidate<T> {
  const tier = authorityTier(candidate.kind, candidate.sourceKey);
  const haystack = normalize(candidate.text);

  const actMatch =
    plan.actQueries.some((q) => q.length > 3 && haystack.includes(normalize(q))) ||
    plan.provisionQueries.some((q) => q.length > 3 && haystack.includes(normalize(q)));

  const exactPhrase =
    plan.phrases.length > 0 && plan.phrases.some((p) => haystack.includes(normalize(p)));

  // An EU source answers a question that asked about EU or EEA law. On a
  // question that did not, it is background rather than authority — Icelandic
  // courts apply the Icelandic act, and the directive behind it is a second
  // step, not the first.
  const wantsEu = plan.sourceCategories.includes("eu");
  const isEu = candidate.jurisdiction === "eu";
  const jurisdiction = isEu ? (wantsEu ? 1 : -1) : 0;

  // Found by exactly one query, and not near the top of even that one. This is
  // the shape of a document that shares a common word with the question and
  // nothing else.
  const tangential = candidate.matchedBy.length <= 1 && candidate.bestRank > 5 ? 1 : 0;

  const features: Record<string, number> = {
    relevance: WEIGHTS.relevance * candidate.relevance,
    actMatch: actMatch ? WEIGHTS.actMatch : 0,
    exactPhrase: exactPhrase ? WEIGHTS.exactPhrase : 0,
    kind: WEIGHTS.kind * KIND_WEIGHT[candidate.kind],
    authority: WEIGHTS.authority * TIER_WEIGHT[tier],
    recency: WEIGHTS.recency * recency(candidate.date, now),
    jurisdiction: WEIGHTS.jurisdiction * jurisdiction,
    commentary: tier === "commentary" ? WEIGHTS.commentary : 0,
    tangential: WEIGHTS.tangential * tangential,
  };

  const score = Object.values(features).reduce((a, b) => a + b, 0);
  return { candidate, score, tier, features };
}

/**
 * The candidates in the order the answer should see them.
 *
 * Ties keep the input order, which is fusion's order, which is deterministic —
 * so two runs of the same question over the same corpus produce the same
 * ranking, and a difference between two runs is a real difference.
 */
export function rankCandidates<T extends RankCandidate>(
  candidates: T[],
  plan: QueryPlan,
  now = Date.now()
): RankedCandidate<T>[] {
  return candidates
    .map((candidate, index) => ({ ...scoreCandidate(candidate, plan, now), index }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ candidate, score, tier, features }) => ({ candidate, score, tier, features }));
}

/**
 * Reorders a ranked list to a model's stated preference, keeping every
 * candidate the model did not mention in their deterministic order behind the
 * ones it did.
 *
 * The model is allowed to *reorder*, never to introduce or remove: a key it
 * invented is ignored, and a key it dropped keeps its place at the back. That
 * is what makes this safe to put behind a flag — the worst a bad rerank can do
 * is a worse order, never a source that was not retrieved.
 */
export function applyModelOrder<T extends RankCandidate>(
  ranked: RankedCandidate<T>[],
  keys: string[]
): RankedCandidate<T>[] {
  const byKey = new Map(ranked.map((r) => [r.candidate.key, r]));
  const chosen: RankedCandidate<T>[] = [];
  const taken = new Set<string>();

  for (const key of keys) {
    const hit = byKey.get(key);
    if (hit && !taken.has(key)) {
      chosen.push(hit);
      taken.add(key);
    }
  }
  for (const r of ranked) {
    if (!taken.has(r.candidate.key)) chosen.push(r);
  }
  return chosen;
}
