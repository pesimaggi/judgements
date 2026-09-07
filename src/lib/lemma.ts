/**
 * The query half of Icelandic lemmatisation.
 *
 * prisma/sql/setup-lemmas.sql lemmatises the *corpus* into `lemma_vector`.
 * That alone finds nothing: a reader who types `ríkisborgararéttinum` is
 * typing a surface form, and the vector holds `ríkisborgararéttur`. Both sides
 * have to be mapped through the same dictionary before they can meet.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 *
 * It does not replace the existing query. `search_vector` and its
 * `websearch_to_tsquery('simple', …)` are untouched and still match exactly
 * what they matched before; the lemma query is OR'd in beside them in
 * lib/search/postgres.ts. So this can only ever *add* results. That property is
 * what makes it safe to switch on for every search at once, and it is worth
 * preserving in anything built on top of this.
 *
 * TWO CONCESSIONS, both of which follow from that
 *
 * 1. A quoted phrase is never lemmatised. `websearch_to_tsquery` matches a
 *    quoted phrase by adjacency, and the lemma vector's positions are only
 *    approximately those of the source text — an ambiguous form contributes
 *    all of its lemmas at one position and shifts what follows. Lemmatising a
 *    phrase would therefore match it as loose words, which is precisely the
 *    regression `everyHitContains` in the search evaluation exists to catch.
 *    It is also wrong on its own terms: somebody who quotes a phrase is asking
 *    for those words.
 *
 * 2. An ambiguous surface form contributes only its first lemma. Websearch
 *    syntax has no parentheses, so `(a OR b) AND c` cannot be expressed, and
 *    switching this path to `to_tsquery` would mean reimplementing the operator
 *    handling in lib/query-parser.ts rather than reusing it. 2.9% of BÍN's
 *    surface forms are ambiguous, the first lemma is chosen deterministically,
 *    and the exact vector is still matching alongside — so the cost is bounded
 *    and one-directional.
 */

/** form → its lemmas, best first. What `bin_lemma` holds, in memory. */
export type LemmaMap = Map<string, string[]>;

/**
 * True when the query contains a quoted phrase.
 *
 * Counts quote characters rather than matching a pair, so an unbalanced quote
 * — which `websearch_to_tsquery` tolerates and readers produce — is also
 * treated as a phrase and kept off this path. Erring towards "leave it alone"
 * is the safe direction: the worst case is a query that misses the recall
 * boost, not one that returns the wrong thing.
 */
export function hasPhrase(websearch: string): boolean {
  return /["“”„«»]/.test(websearch);
}

/**
 * Splits a websearch string into the pieces that may be rewritten and the
 * pieces that must not be.
 *
 * `OR` is an operator and is passed through untouched; a leading `-` is
 * negation and has to survive on the front of the word it negates. Everything
 * else is a term.
 */
function tokens(websearch: string): string[] {
  return websearch.split(/\s+/).filter(Boolean);
}

/** A word stripped of the punctuation `websearch_to_tsquery` would drop anyway. */
function bareWord(token: string): { prefix: string; word: string; suffix: string } {
  const m = /^([-!]*)(.*?)([.,;:!?)\]]*)$/u.exec(token);
  if (!m) return { prefix: "", word: token, suffix: "" };
  return { prefix: m[1], word: m[2], suffix: m[3] };
}

/**
 * The words in a query whose lemmas need looking up.
 *
 * Lowercased, because `bin_lemma.form` is stored lowercased — `to_tsvector`
 * lowercases as it tokenises, and the table was built to match it.
 */
export function queryWords(websearch: string): string[] {
  if (hasPhrase(websearch)) return [];
  const words = new Set<string>();
  for (const token of tokens(websearch)) {
    if (token === "OR") continue;
    const { word } = bareWord(token);
    if (word.length > 1) words.add(word.toLowerCase());
  }
  return Array.from(words);
}

/**
 * Rewrites a websearch query into its lemmas.
 *
 * Returns null when there is nothing to gain — a phrase query, an empty query,
 * or one where no word was in the dictionary — so the caller can leave the
 * lemma condition out of the SQL entirely rather than adding one that cannot
 * match. A word BÍN does not know keeps its own spelling, which mirrors what
 * `bin_lemma_vector` does on the corpus side; the two have to agree, or an
 * unknown word would be indexed under itself and searched for as nothing.
 */
export function lemmaQuery(websearch: string, lemmas: LemmaMap): string | null {
  if (hasPhrase(websearch)) return null;

  const list = tokens(websearch);
  if (list.length === 0) return null;

  let known = false;
  const out = list.map((token) => {
    if (token === "OR") return token;
    const { prefix, word, suffix } = bareWord(token);
    if (word.length <= 1) return token;
    const candidates = lemmas.get(word.toLowerCase());
    if (!candidates?.length) return token;
    known = true;
    // The first lemma only — see the header. Sorted at lookup, so the choice is
    // the same on every run and a ranking difference between two runs is real.
    return `${prefix}${candidates[0]}${suffix}`;
  });

  // The test is whether any word was *in the dictionary*, not whether the
  // string changed. A query already in dictionary form — `ríkisborgararéttur`,
  // `stjórnsýslulög`, which is exactly what the well's planner produces —
  // rewrites to itself and is still worth running: the plain condition matches
  // it against `search_vector`, which holds surface forms, while this one
  // matches it against `lemma_vector`, which holds lemmas. Same string, two
  // different indexes, different documents. Skipping it here was a bug that
  // made the feature miss the case it exists for.
  //
  // No word in the dictionary at all is the one genuinely redundant case: every
  // token would be carried through unchanged on both sides, so the second GIN
  // scan can only return what the first already did.
  if (!known) return null;
  return out.join(" ");
}
