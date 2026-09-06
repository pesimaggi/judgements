/**
 * Merging several rankings into one, deterministically.
 *
 * Retrieval now runs a handful of focused searches instead of one broad OR
 * query — the exact phrase on its own, each concept on its own, the case
 * number on its own, the provisions inside each named act. That is better
 * retrieval and a worse problem: five ranked lists that overlap, whose scores
 * are not comparable with each other (a `ts_rank` from a one-word query and
 * one from a phrase query are different units).
 *
 * Reciprocal-rank fusion is the standard answer and the right one here. It
 * throws the scores away and keeps only the *positions*, which are comparable
 * across queries by construction:
 *
 *     score(d) = Σ_q  weight(q) / (k + rank_q(d))
 *
 * A document that is third for the phrase and second for the act beats one
 * that is first for a single loose synonym, which is the ordering a lawyer
 * would give. `k` damps the top of each list so that first place is worth
 * about as much as second, not twice as much.
 *
 * Deterministic: same lists in, same order out, ties broken by the order the
 * caller listed the queries. That matters because it is what makes the
 * evaluation harness meaningful and a ranking change reviewable.
 */

/** The rank-damping constant. 60 is the value the original RRF paper used. */
export const RRF_K = 60;

export interface RankedList<T> {
  /** What this list was a search for, for the explanation on each result. */
  label: string;
  /** How much this query's opinion counts. See QUERY_WEIGHTS in retrieve.ts. */
  weight: number;
  /** The hits, best first. */
  items: T[];
}

export interface FusedItem<T> {
  item: T;
  /** The fused score. Comparable only against others from the same fusion. */
  score: number;
  /** Which queries found it, and where each of them put it. */
  matchedBy: { label: string; rank: number }[];
}

/**
 * Weighted reciprocal-rank fusion over any number of ranked lists.
 *
 * The first occurrence of a key wins the item itself: lists are given in
 * priority order, so the copy from the most specific search is the one whose
 * fields (its snippet, in particular — the passage *that* query matched) are
 * carried forward.
 */
export function fuse<T>(
  lists: RankedList<T>[],
  keyOf: (item: T) => string,
  k: number = RRF_K
): FusedItem<T>[] {
  const byKey = new Map<string, FusedItem<T>>();
  // Insertion order is the tiebreaker, so it has to be recorded: Map preserves
  // it, but sorting is not stable across engines for equal scores in every
  // implementation, and the eval harness compares exact orderings.
  const order = new Map<string, number>();

  for (const list of lists) {
    list.items.forEach((item, index) => {
      const key = keyOf(item);
      if (!key) return;
      const rank = index + 1;
      const contribution = list.weight / (k + rank);

      const existing = byKey.get(key);
      if (existing) {
        existing.score += contribution;
        existing.matchedBy.push({ label: list.label, rank });
      } else {
        order.set(key, order.size);
        byKey.set(key, {
          item,
          score: contribution,
          matchedBy: [{ label: list.label, rank }],
        });
      }
    });
  }

  return Array.from(byKey.entries())
    .sort((a, b) => b[1].score - a[1].score || (order.get(a[0]) ?? 0) - (order.get(b[0]) ?? 0))
    .map(([, fused]) => fused);
}

/**
 * The highest score any single list could contribute, used to put fused scores
 * on a 0-1 scale before they are combined with the ranking features in
 * `rank.ts`. Without this the two are in different units and whichever happens
 * to be larger silently decides the order.
 */
export function maxPossibleScore<T>(lists: RankedList<T>[], k: number = RRF_K): number {
  return lists.reduce((sum, list) => sum + list.weight / (k + 1), 0) || 1;
}

/**
 * Deduplicates a single list by key, keeping the first occurrence.
 *
 * Used where fusion is not wanted but duplicates still arrive — the same act
 * reached through two different act queries, for instance.
 */
export function dedupeBy<T>(items: T[], keyOf: (item: T) => string): T[] {
  const seen = new Set<string>();
  const kept: T[] = [];
  for (const item of items) {
    const key = keyOf(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    kept.push(item);
  }
  return kept;
}
