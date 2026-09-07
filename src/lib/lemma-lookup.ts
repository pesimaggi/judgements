/**
 * Reading the BÍN dictionary out of the database, for one query at a time.
 *
 * Kept apart from lib/lemma.ts on purpose: that module is pure string
 * rewriting and is tested as such, with no database and no fixtures. This one
 * is the part that talks to Postgres, and the part that has to stay cheap.
 *
 * WHY THIS IS CHEAP
 *
 * A query has a handful of words. The lookup is one statement, keyed on
 * `bin_lemma`'s primary key, and its result is cached in process — search
 * traffic repeats the same words relentlessly ("gæsluvarðhald", "uppsögn",
 * "stjórnsýslulög"), so the cache does most of the work after the first
 * minute. The dictionary is static between deploys, so nothing here has to
 * think about invalidation.
 *
 * A failure is never fatal. If the table is missing — a deployment that ran
 * setup-search but not setup-lemmas — or the lookup errors, the callers fall
 * back to the plain query, which is exactly the search that ran before any of
 * this existed.
 */
import { prisma } from "./db";
import type { LemmaMap } from "./lemma";

/**
 * Bounded so a long tail of one-off words cannot grow without limit. Legal
 * search vocabulary is small and heavily repeated, so this holds effectively
 * all of the traffic; eviction is oldest-first, which for a Map means
 * insertion order.
 */
const CACHE_MAX = 20_000;
const lemmaCache = new Map<string, string[]>();
const siblingCache = new Map<string, string[]>();

/** True once a lookup has established the dictionary is not there. */
let dictionaryMissing = false;

function remember(cache: Map<string, string[]>, key: string, value: string[]): void {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, value);
}

/**
 * The lemmas for each of `words`, and every surface form those lemmas cover.
 *
 * Both halves come back from one statement because both are needed for the
 * same search: the lemmas rewrite the query, and the sibling forms expand the
 * headline query so the word actually present in the judgment gets marked.
 *
 * A word that is not in BÍN is cached as having no lemmas, so an unknown word
 * costs one lookup per process rather than one per search.
 */
export async function lookupLemmas(
  words: string[]
): Promise<{ lemmas: LemmaMap; siblings: Map<string, string[]> }> {
  const lemmas: LemmaMap = new Map();
  const siblings = new Map<string, string[]>();

  const missing: string[] = [];
  for (const word of words) {
    const hit = lemmaCache.get(word);
    if (hit === undefined) {
      missing.push(word);
      continue;
    }
    if (hit.length) {
      lemmas.set(word, hit);
      const sib = siblingCache.get(hit[0]);
      if (sib?.length) siblings.set(hit[0], sib);
    }
  }

  if (missing.length === 0 || dictionaryMissing) return { lemmas, siblings };

  try {
    const rows = await prisma.$queryRaw<{ form: string; lemmas: string[]; siblings: string[] | null }[]>`
      SELECT b.form,
             b.lemmas,
             (SELECT array_agg(s.form) FROM bin_lemma s WHERE s.lemmas && b.lemmas) AS siblings
        FROM bin_lemma b
       WHERE b.form = ANY(${missing}::text[])
    `;

    const found = new Set<string>();
    for (const row of rows) {
      // Sorted so the first lemma — the only one lemmaQuery uses — is the same
      // on every run, whatever order the planner returned the rows in.
      const sorted = [...row.lemmas].sort();
      found.add(row.form);
      remember(lemmaCache, row.form, sorted);
      lemmas.set(row.form, sorted);
      if (row.siblings?.length) {
        const sib = [...row.siblings].sort();
        remember(siblingCache, sorted[0], sib);
        siblings.set(sorted[0], sib);
      }
    }
    // Negative caching: an unknown word is a fact about the dictionary, and
    // re-asking on every search is how a rare word becomes a per-request cost.
    for (const word of missing) {
      if (!found.has(word)) remember(lemmaCache, word, []);
    }
  } catch (e) {
    // 42P01 is undefined_table: setup-lemmas.sql has not been run on this
    // database. Said once, then stopped asking — the answer will not change
    // until a deploy.
    const code = (e as { code?: string })?.code;
    if (code === "42P01") {
      dictionaryMissing = true;
      console.warn(
        "Search: bin_lemma is missing, so Icelandic lemma matching is off. Run `npm run db:setup-lemmas` and `npm run db:load-bin`."
      );
    } else {
      console.error("Search: BÍN lemma lookup failed, falling back to exact matching:", e);
    }
  }

  return { lemmas, siblings };
}

/** Clears the caches. For tests, and for a reload of the dictionary. */
export function resetLemmaCache(): void {
  lemmaCache.clear();
  siblingCache.clear();
  dictionaryMissing = false;
}
