/**
 * How well an act answers what was typed — the rule that decides whether an
 * act belongs above the case results.
 *
 * WHY THIS EXISTS. The act lookup behind the type-ahead is deliberately
 * forgiving: it falls back to trigram similarity so that a misspelled
 * "hegningarlög" still offers the right act to *choose from a list*. Putting
 * that same forgiveness above the case results would be a different thing
 * entirely — a search for "gæsluvarðhald" would be headed by whichever act
 * title happens to share three letters with it, and the answer to the question
 * actually asked would be pushed down the page.
 *
 * So the search page shows an act only when the query genuinely names one:
 * by its number, by its short name, or by words that appear in its title. A
 * near-match is still offered in the type-ahead, where a human picks; it is
 * not promoted to an answer on its own.
 *
 * Pure and provider-independent, so it holds whether the hits came from
 * Postgres or Meilisearch — the two rank differently and neither ranking means
 * "this is what was asked for".
 */

/**
 * "number" — the query states the act's number ("38/2001", "2016/679") or its
 *   CELEX. Nothing else can mean that, so it is the strongest signal there is.
 * "alias" — the query is one of the short names the act is cited by
 *   ("vaxtalög", "gdpr"). Also unambiguous in practice.
 * "title" — the query's words appear in the act's title. Right often enough to
 *   show, weak enough to rank last of the three.
 * "weak" — none of the above: the act came back on a fuzzy match and is not
 *   shown as an answer.
 */
export type ActMatchQuality = "number" | "alias" | "title" | "weak";

export interface ActMatchCandidate {
  title: string;
  citation: string;
  actNumber: number;
  year: number;
  aliases?: string[];
  celex?: string | null;
  /** The number the act is cited by, where it differs from actNumber. */
  naturalNumber?: number | null;
}

/** Lowercase, unpunctuated, single-spaced — what two strings are compared as. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.,:;()'"“”„–—]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The words that are only scaffolding around a citation, dropped before the
 * rest is compared to a title. "lög um vexti" should match the act whose title
 * is "Lög um vexti og verðtryggingu", and "nr. 38/2001" should not have to
 * carry "nr." into the comparison.
 */
const SCAFFOLDING = /\b(lög|laga|lögum|laganna|lagas|nr|no|reglugerð|tilskipun|ákvörðun)\b/g;

/** Every number pair in the query, as written and reversed. */
function numberPairs(query: string): { first: number; second: number }[] {
  const pairs: { first: number; second: number }[] = [];
  for (const m of query.matchAll(/(\d{1,4})\s*[\/\-]\s*(\d{1,4})/g)) {
    pairs.push({ first: Number(m[1]), second: Number(m[2]) });
  }
  return pairs;
}

/**
 * Scores one act against the query.
 *
 * The order of the tests is the order of their confidence, and the first that
 * holds wins: a query naming a number is answered by number even if its words
 * also appear in some title.
 */
export function actMatchQuality(query: string, act: ActMatchCandidate): ActMatchQuality {
  const q = normalize(query);
  if (!q) return "weak";

  // ---- by number, in either of the two conventions ------------------------
  const cited = act.naturalNumber ?? act.actNumber;
  for (const { first, second } of numberPairs(q)) {
    if (first === act.actNumber && second === act.year) return "number";
    if (first === act.year && second === cited) return "number";
  }
  if (act.celex && q.replace(/\s+/g, "").toUpperCase() === act.celex.toUpperCase()) return "number";

  // ---- by the short name it is cited under --------------------------------
  // Compared both ways: "gdpr" is the whole query, and "gdpr reglugerðin"
  // contains it. Two characters is not a name, it is a coincidence.
  const bare = q.replace(SCAFFOLDING, " ").replace(/\s+/g, " ").trim();
  for (const alias of act.aliases ?? []) {
    const a = normalize(alias);
    if (a.length < 3) continue;
    if (q === a || bare === a || q.includes(a) || (bare.length >= 3 && a.includes(bare))) {
      return "alias";
    }
  }

  // ---- by words in the title ----------------------------------------------
  // The whole query has to appear, not merely overlap: "um" appears in half
  // the corpus and means nothing, while "lög um vexti" names one act.
  const title = normalize(act.title);
  const citation = normalize(act.citation);
  if (bare.length >= 3 && (title.includes(bare) || citation.includes(bare))) return "title";
  if (q.length >= 3 && (title.includes(q) || citation.includes(q))) return "title";

  return "weak";
}

const RANK: Record<ActMatchQuality, number> = { number: 0, alias: 1, title: 2, weak: 3 };

/** True for a match strong enough to head the results. */
export function isStrongActMatch(quality: ActMatchQuality): boolean {
  return quality !== "weak";
}

/**
 * The acts that answer the query, best first, weak matches dropped.
 *
 * Ties keep the order the search provider returned them in, which is its own
 * relevance ranking — this decides *whether* an act is an answer, not which of
 * two equally-named acts is the better one.
 */
export function rankActMatches<T extends ActMatchCandidate>(
  query: string,
  acts: T[]
): { act: T; quality: ActMatchQuality }[] {
  return acts
    .map((act, index) => ({ act, quality: actMatchQuality(query, act), index }))
    .filter((hit) => isStrongActMatch(hit.quality))
    .sort((a, b) => RANK[a.quality] - RANK[b.quality] || a.index - b.index)
    .map(({ act, quality }) => ({ act, quality }));
}
