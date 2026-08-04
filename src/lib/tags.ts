/**
 * The subject-tag vocabulary, for the tag lookup box.
 *
 * Tags live in `Document.subject_tags` (a text[]), so answering "which tags
 * start with «gæslu»" means unnesting the array across every judgment. That
 * is a scan of the whole table, which is fine once and wasteful per keystroke.
 *
 * The vocabulary is small and slow-moving — a few hundred to a few thousand
 * distinct tags, changing only when judgments are ingested — so it is read
 * once and cached in the process. A stale entry costs nothing: a tag that
 * appeared minutes ago simply is not suggested yet, and the counts shown may
 * lag slightly. Both are far better than a table scan on every keypress.
 */
import { prisma } from "./db";

export interface TagCount {
  tag: string;
  count: number;
}

const TTL_MS = Number(process.env.TAG_CACHE_TTL_MS ?? 5 * 60 * 1000);

let cache: { at: number; tags: TagCount[] } | null = null;
/** In-flight load, so a burst of keystrokes on a cold cache does one scan. */
let loading: Promise<TagCount[]> | null = null;

async function loadTags(): Promise<TagCount[]> {
  const rows = await prisma.$queryRaw<{ tag: string; count: number }[]>`
    SELECT t AS tag, count(*)::int AS count
      FROM "Document", unnest(subject_tags) AS t
     WHERE t <> ''
     GROUP BY t
     ORDER BY count DESC, t ASC
  `;
  return rows.map((r) => ({ tag: r.tag, count: Number(r.count) }));
}

export async function getTagVocabulary(): Promise<TagCount[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.tags;
  if (loading) return loading;
  loading = loadTags()
    .then((tags) => {
      cache = { at: Date.now(), tags };
      return tags;
    })
    .finally(() => {
      loading = null;
    });
  return loading;
}

/**
 * Tags matching `q`, most-used first.
 *
 * Matching is accent- and case-insensitive on the Icelandic letters that
 * people commonly type without diacritics, and a tag whose *start* matches is
 * ranked above one that merely contains the text — typing "gæslu" should
 * offer "Gæsluvarðhald" before "Framlenging gæsluvarðhalds".
 */
export async function searchTags(q: string, limit = 12): Promise<TagCount[]> {
  const vocabulary = await getTagVocabulary();
  const needle = fold(q);
  if (!needle) return vocabulary.slice(0, limit);

  const starts: TagCount[] = [];
  const contains: TagCount[] = [];
  for (const t of vocabulary) {
    const folded = fold(t.tag);
    if (folded.startsWith(needle)) starts.push(t);
    else if (folded.includes(needle)) contains.push(t);
  }
  return [...starts, ...contains].slice(0, limit);
}

/** Lowercase and strip the diacritics people leave off when typing quickly. */
function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/þ/g, "th")
    .replace(/æ/g, "ae")
    .replace(/ð/g, "d");
}

/** Clears the cache — used after ingestion writes new judgments. */
export function invalidateTagCache(): void {
  cache = null;
}
