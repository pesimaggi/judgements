/**
 * Ranking metrics, as pure functions over a list of graded results.
 *
 * Kept separate from the runner so they can be tested without a database,
 * and so a change to how a score is computed is visible as a change to this
 * file rather than buried in a reporting routine.
 *
 * Grades follow the convention in queries.json:
 *
 *   3  the primary answer — the document the query is really asking for
 *   2  strongly relevant — a researcher would want it in the first page
 *   1  contextual — related, reasonable to return, not what was asked for
 *   0  everything else, including anything unlabelled
 *
 * Unlabelled is treated as 0 by design. The alternative — dropping unknown
 * documents from the ranking — would score an engine on a corpus that hides
 * its own mistakes, and would make two engines that return different wrong
 * answers look identical.
 */

/** Graded relevance of each returned result, in rank order. */
export type GradedRanking = number[];

/** True if any of the top `k` results is relevant at all. */
export function recallAt(ranking: GradedRanking, k: number): number {
  return ranking.slice(0, k).some((g) => g > 0) ? 1 : 0;
}

/**
 * Whether the *primary* answer is in the top `k`.
 *
 * Distinct from `recallAt` and usually the number that matters: a search for
 * "vaxtalög" that returns eight cases mentioning interest is not a success if
 * the act itself is not among them.
 */
export function strictRecallAt(ranking: GradedRanking, k: number, primaryGrade = 3): number {
  return ranking.slice(0, k).some((g) => g >= primaryGrade) ? 1 : 0;
}

/** Reciprocal rank of the first relevant result; 0 if there is none. */
export function reciprocalRank(ranking: GradedRanking): number {
  const i = ranking.findIndex((g) => g > 0);
  return i === -1 ? 0 : 1 / (i + 1);
}

function dcg(grades: GradedRanking): number {
  // Standard gain, not the exponential variant: with a 0–3 scale the
  // exponential form makes a single grade-3 hit dominate everything, and the
  // question here is usually "did the whole first page make sense", not only
  // "was the top hit right".
  return grades.reduce((sum, g, i) => sum + g / Math.log2(i + 2), 0);
}

/**
 * Normalized discounted cumulative gain over the top `k`.
 *
 * `allGrades` is every grade the case declares, which is what the ideal
 * ranking is built from — including relevant documents the engine failed to
 * return at all. Without them the denominator is the engine's own output and
 * a run that misses half the answers still scores 1.0.
 */
export function ndcgAt(ranking: GradedRanking, allGrades: number[], k: number): number {
  const ideal = [...allGrades].sort((a, b) => b - a).slice(0, k);
  const idealDcg = dcg(ideal);
  if (idealDcg === 0) return 0;
  return dcg(ranking.slice(0, k)) / idealDcg;
}

/**
 * Share of `mustOutrank` pairs the ranking got right.
 *
 * A pair is scored only when both documents were returned; a pair where
 * neither appears says nothing about ordering. A pair where only the winner
 * appears counts as correct, and only the loser as incorrect — returning the
 * wrong one of a pair and not the right one is an ordering failure even
 * though nothing was strictly "out of order".
 */
export function pairwiseAccuracy(
  positions: Map<string, number>,
  pairs: { before: string; after: string }[]
): { correct: number; total: number } {
  let correct = 0;
  let total = 0;
  for (const { before, after } of pairs) {
    const a = positions.get(before);
    const b = positions.get(after);
    if (a === undefined && b === undefined) continue;
    total++;
    if (a !== undefined && (b === undefined || a < b)) correct++;
  }
  return { correct, total };
}

/** Mean of a list, or 0 for an empty one. */
export function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

/**
 * A deterministic paired bootstrap over per-case deltas.
 *
 * Answers the only question that matters when comparing two configurations:
 * is the difference bigger than the noise in a query set this small? An
 * interval that includes zero means the change is not supported by this
 * evidence, however good the headline average looks.
 *
 * Seeded so that two runs of the same inputs give the same interval; an
 * evaluation that moves on its own is not evidence of anything.
 */
export function pairedBootstrapCI(
  deltas: number[],
  { samples = 10_000, seed = 20260831, alpha = 0.05 } = {}
): { mean: number; lower: number; upper: number } {
  if (deltas.length === 0) return { mean: 0, lower: 0, upper: 0 };

  // xorshift32 — small, deterministic, and adequate for resampling.
  let state = seed >>> 0 || 1;
  const next = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };

  const means: number[] = [];
  for (let s = 0; s < samples; s++) {
    let sum = 0;
    for (let i = 0; i < deltas.length; i++) {
      sum += deltas[Math.floor(next() * deltas.length)];
    }
    means.push(sum / deltas.length);
  }
  means.sort((a, b) => a - b);

  return {
    mean: mean(deltas),
    lower: means[Math.floor((alpha / 2) * samples)],
    upper: means[Math.min(samples - 1, Math.floor((1 - alpha / 2) * samples))],
  };
}
