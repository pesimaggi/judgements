import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { parseQuery } from "../query-parser";
import { extractSummary, SUMMARY_SCAN_CHARS } from "../judgment-text";
import type {
  SearchRequest,
  SearchHit,
  ActSearchRequest,
  ActHit,
  ProvisionSearchRequest,
  ProvisionHit,
} from "../types";
import type { SearchProvider, ProviderResult } from "./provider";

/**
 * Counting is capped: a broad query like "gæsluvarðhald" matches thousands of
 * judgments, and an exact count means visiting every one of them. Stopping at
 * the cap keeps the count cheap; the UI shows "10,000+" and paginates up to
 * that point, which is far beyond what anyone actually pages through.
 */
export const COUNT_CAP = 10_000;

/**
 * ts_headline() re-tokenises the text it is given, so its cost grows with the
 * document length. Judgments are almost always well under this; capping the
 * input bounds the worst case (a 200-page scanned PDF) without changing the
 * snippet for normal documents.
 */
const HEADLINE_MAX_CHARS = 60_000;

/**
 * Default provider. Uses:
 *  - websearch_to_tsquery('simple', ...) → phrases ("..."), implicit AND,
 *    OR, and -negation, with Icelandic characters preserved.
 *  - pg_trgm's `%` operator as a fuzzy fallback for spelling variants and
 *    case-number lookups.
 * Requires prisma/sql/setup-search.sql to have been run once — in particular
 * the materialized `search_vector` column it creates, which is what makes
 * relevance ranking cheap enough to run over a large result set.
 */
export class PostgresSearchProvider implements SearchProvider {
  async search(req: SearchRequest): Promise<ProviderResult> {
    const parsed = parseQuery(req.query);
    const page = Math.max(1, req.page ?? 1);
    const pageSize = Math.min(50, Math.max(1, req.pageSize ?? 15));
    const offset = (page - 1) * pageSize;

    const filters: Prisma.Sql[] = [
      Prisma.sql`d.source IN (${Prisma.join(req.sources)})`,
    ];
    if (req.dateFrom) filters.push(Prisma.sql`d.date >= ${new Date(req.dateFrom)}`);
    if (req.dateTo) filters.push(Prisma.sql`d.date <= ${new Date(req.dateTo)}`);
    if (req.year) filters.push(Prisma.sql`d.year = ${req.year}`);
    if (req.tag) filters.push(Prisma.sql`d.subject_tags @> ARRAY[${req.tag}]::text[]`);

    // Citation filters. EXISTS rather than a join so a judgment citing the
    // same provision five times still counts once and cannot multiply the
    // result rows — the same distinct-judgment rule the provision badges use.
    // Both are served by the (provision_id, match_type) and act_id indexes.
    if (req.provisionId) {
      filters.push(Prisma.sql`EXISTS (
        SELECT 1 FROM case_provision_links l
         WHERE l.document_id = d.id AND l.provision_id = ${req.provisionId}
      )`);
    }
    if (req.actId) {
      filters.push(Prisma.sql`(
        EXISTS (
          SELECT 1 FROM case_provision_links l
            JOIN provisions p ON p.id = l.provision_id
           WHERE l.document_id = d.id AND p.act_id = ${req.actId}
        ) OR EXISTS (
          SELECT 1 FROM case_act_links al
           WHERE al.document_id = d.id AND al.act_id = ${req.actId}
        )
      )`);
    }
    const filterSql = Prisma.join(filters, " AND ");

    // Indexed match conditions: FTS (GIN on the stored vector) + case-number
    // match/fuzzy (trigram index on case_number itself). Both index-backed.
    const indexedMatchParts: Prisma.Sql[] = [];
    if (parsed.websearch) {
      indexedMatchParts.push(
        Prisma.sql`d.search_vector @@ websearch_to_tsquery('simple', ${parsed.websearch})`
      );
    }
    for (const cn of parsed.caseNumbers) {
      indexedMatchParts.push(Prisma.sql`d.case_number ILIKE ${cn}`);
      indexedMatchParts.push(Prisma.sql`d.case_number % ${cn}`);
    }

    const rankExpr = parsed.websearch
      ? Prisma.sql`ts_rank(d.search_vector, websearch_to_tsquery('simple', ${parsed.websearch}))`
      : Prisma.sql`0`;

    const order =
      req.sort === "newest"
        ? Prisma.sql`d.date DESC NULLS LAST`
        : req.sort === "oldest"
          ? Prisma.sql`d.date ASC NULLS LAST`
          : Prisma.sql`rank DESC, d.date DESC NULLS LAST`;

    const headlineExpr = parsed.websearch
      ? Prisma.sql`ts_headline('simple', left(p.full_text, ${HEADLINE_MAX_CHARS}::int), websearch_to_tsquery('simple', ${parsed.websearch}),
          'StartSel=<mark>, StopSel=</mark>, MaxFragments=2, FragmentDelimiter= … , MinWords=8, MaxWords=28')`
      : Prisma.sql`left(p.full_text, 240)`;

    /**
     * One round of "count + page of rows", run as two queries in parallel.
     *
     * The count used to ride along as `count(*) OVER()` on the row query.
     * That forced the planner to rank and sort every matching row before it
     * could return the first page; splitting it means the count never pays
     * for ts_rank at all, and the two halves overlap in the pool.
     *
     * The page of rows is selected first and the snippet computed *outside*
     * that subquery, so ts_headline() only ever runs on the rows actually
     * returned rather than on every candidate the sort considered.
     */
    const runQuery = async (matchParts: Prisma.Sql[]) => {
      const where = Prisma.sql`(${Prisma.join(matchParts, " OR ")}) AND ${filterSql}`;

      const [rows, countRows] = await Promise.all([
        prisma.$queryRaw<any[]>(Prisma.sql`
          SELECT p.id, p.source, p.court, p.case_number, p.case_name, p.title, p.date, p.year,
                 p.subject_tags, p.official_url, p.pdf_url, p.is_sample,
                 ${headlineExpr} AS snippet,
                 left(p.full_text, ${SUMMARY_SCAN_CHARS}::int) AS summary_source
          FROM (
            SELECT d.id, d.source, d.court, d.case_number, d.case_name, d.title, d.date, d.year,
                   d.subject_tags, d.official_url, d.pdf_url, d.is_sample, d.full_text,
                   ${rankExpr} AS rank
            FROM "Document" d
            WHERE ${where}
            ORDER BY ${order}
            LIMIT ${pageSize} OFFSET ${offset}
          ) p
        `),
        prisma.$queryRaw<{ total: number }[]>(Prisma.sql`
          SELECT count(*)::int AS total
          FROM (SELECT 1 FROM "Document" d WHERE ${where} LIMIT ${COUNT_CAP}) capped
        `),
      ]);

      return { rows, total: Number(countRows[0]?.total ?? 0) };
    };

    let matchParts: Prisma.Sql[];
    if (indexedMatchParts.length === 0) {
      // Empty query with filters only: allow browsing within selected courts.
      matchParts = [Prisma.sql`TRUE`];
    } else {
      matchParts = indexedMatchParts;
    }

    let { rows, total } = await runQuery(matchParts);

    // Fuzzy metadata fallback for Icelandic spelling variants and typos. Only
    // reached when the indexed match found nothing at all — previously this
    // was decided by an extra EXISTS round trip fired *before* every single
    // search; deriving it from the result we already have makes the common
    // case (a query that does match) one round trip cheaper.
    if (total === 0 && indexedMatchParts.length > 0 && parsed.raw) {
      const fuzzy = [
        ...indexedMatchParts,
        // `%` compares against pg_trgm.similarity_threshold and is served by
        // the trigram GIN indexes, unlike an explicit similarity() call — and
        // it is left unwrapped (no coalesce) so the index still applies; a
        // NULL case_name simply doesn't match, which is what we want anyway.
        Prisma.sql`d.title % ${parsed.raw}`,
        Prisma.sql`d.case_name % ${parsed.raw}`,
      ];
      ({ rows, total } = await runQuery(fuzzy));
    }

    const hits: SearchHit[] = rows.map((r) => ({
      id: r.id,
      source: r.source,
      court: r.court,
      caseNumber: r.case_number,
      caseName: r.case_name,
      title: r.title,
      date: r.date ? new Date(r.date).toISOString() : null,
      year: r.year,
      subjectTags: r.subject_tags ?? [],
      officialUrl: r.official_url,
      pdfUrl: r.pdf_url,
      snippet: r.snippet ?? "",
      summary: extractSummary(r.summary_source ?? ""),
      isSample: r.is_sample,
    }));

    return { total, totalIsCapped: total >= COUNT_CAP, hits };
  }

  searchActs(req: ActSearchRequest): Promise<ActHit[]> {
    return searchActsPostgres(req);
  }

  searchProvisions(req: ProvisionSearchRequest) {
    return searchProvisionsPostgres(req);
  }
}

/**
 * Act lookup for the specific-search panel.
 *
 * Three ways in, because that is how people actually reach for an act:
 *  - by citation number, "91/1991" or "nr. 91/1991" — an exact hit, ranked first;
 *  - by title, with trigram fuzziness for Icelandic spelling variants;
 *  - by one of the short names harvested from the corpus, because acts are
 *    routinely cited by a name their official title does not contain
 *    ("vaxtalög" for "Lög um vexti og verðtryggingu", nr. 38/2001).
 *
 * The alias match goes through act_alias_text(), the same immutable wrapper
 * the trigram index in setup-search.sql is built on — using a different
 * expression here would silently drop the index.
 */
export async function searchActsPostgres(req: ActSearchRequest): Promise<ActHit[]> {
  const q = req.query.trim();
  const limit = Math.min(25, Math.max(1, req.limit ?? 10));
  if (!q) return [];

  // "91/1991", "nr. 91/1991", or "91 1991".
  const num = /(\d{1,3})\s*[\/ ]\s*(\d{4})/.exec(q);
  const like = `%${q}%`;

  const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT a.id, a.act_number, a.year, a.title,
           (SELECT count(*)::int FROM provisions p WHERE p.act_id = a.id AND p.kind = 'article') AS provision_count,
           CASE
             WHEN ${num ? Number(num[1]) : null}::int IS NOT NULL
              AND a.act_number = ${num ? Number(num[1]) : null}::int
              AND a.year = ${num ? Number(num[2]) : null}::int THEN 0
             WHEN a.title ILIKE ${like} THEN 1
             WHEN act_alias_text(a.aliases) ILIKE ${like} THEN 2
             ELSE 3
           END AS bucket,
           GREATEST(
             similarity(a.title, ${q}),
             similarity(act_alias_text(a.aliases), ${q})
           ) AS sim
      FROM acts a
     WHERE (${num ? Number(num[1]) : null}::int IS NOT NULL
            AND a.act_number = ${num ? Number(num[1]) : null}::int
            AND a.year = ${num ? Number(num[2]) : null}::int)
        OR a.title ILIKE ${like}
        OR act_alias_text(a.aliases) ILIKE ${like}
        OR a.title % ${q}
        OR act_alias_text(a.aliases) % ${q}
     ORDER BY bucket ASC, sim DESC, a.year DESC
     LIMIT ${limit}
  `);

  return rows.map((r) => ({
    id: r.id,
    actNumber: r.act_number,
    year: r.year,
    title: r.title,
    citation: `lög nr. ${r.act_number}/${r.year}`,
    path: `/log/${r.act_number}-${r.year}`,
    provisionCount: Number(r.provision_count ?? 0),
  }));
}

/**
 * Provision search, over the materialized `search_vector` column that
 * setup-search.sql maintains on `provisions` — the same 'simple'-config,
 * trigger-backed arrangement judgments use, so Icelandic characters survive
 * and ranking does not re-tokenise the text on every query.
 *
 * A bare article reference ("5. gr.") is matched against the label directly
 * as well: inside a chosen act that is a lookup, not a search, and it is what
 * the provision picker sends.
 */
export async function searchProvisionsPostgres(
  req: ProvisionSearchRequest
): Promise<{ total: number; hits: ProvisionHit[] }> {
  const parsed = parseQuery(req.query);
  const page = Math.max(1, req.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, req.pageSize ?? 20));
  const offset = (page - 1) * pageSize;

  const filters: Prisma.Sql[] = [Prisma.sql`p.kind = 'article'`];
  if (req.actId) filters.push(Prisma.sql`p.act_id = ${req.actId}`);

  const q = req.query.trim();
  const match: Prisma.Sql[] = [];
  if (parsed.websearch) {
    match.push(Prisma.sql`p.search_vector @@ websearch_to_tsquery('simple', ${parsed.websearch})`);
  }
  // "5. gr.", "5 gr", or just "5" when an act is already selected.
  const artNum = /^(\d+)\s*\.?\s*(?:gr\.?)?\s*([a-záðéíóúýþæö])?\.?$/i.exec(q);
  if (artNum) {
    const exact = Prisma.sql`(p.article_number = ${Number(artNum[1])}::int AND p.article_letter IS NOT DISTINCT FROM ${
      artNum[2] ? artNum[2].toLowerCase() : null
    })`;
    if (req.actId) {
      // Inside a chosen act, "6" is a lookup, not a search: the user wants
      // article 6, not every provision whose text happens to contain a 6 —
      // which, for a numeral, is most of them.
      match.length = 0;
      match.push(exact);
    } else {
      match.push(exact);
    }
  }
  if (match.length === 0) match.push(Prisma.sql`TRUE`);

  const where = Prisma.sql`(${Prisma.join(match, " OR ")}) AND ${Prisma.join(filters, " AND ")}`;
  // Cast the constant: a bare `ORDER BY 0` is read by Postgres as an ordinal
  // column position, not as a value, and errors with "ORDER BY position 0 is
  // not in select list" — which is the empty-query path the provision picker
  // uses to list an act's provisions before anything is typed.
  const rank = parsed.websearch
    ? Prisma.sql`ts_rank(p.search_vector, websearch_to_tsquery('simple', ${parsed.websearch}))`
    : Prisma.sql`0::float`;

  // Typing "6" into the provision picker means article 6, not "any provision
  // whose text mentions 6" — and every long provision mentions some number.
  // The exact article match is ordered ahead of the full-text one explicitly
  // rather than being left to the relevance score, which does not rank the
  // exact row at all when the query is a bare numeral.
  const exactFirst = artNum
    ? Prisma.sql`(p.article_number = ${Number(artNum[1])}::int) DESC,`
    : Prisma.empty;

  const [rows, countRows] = await Promise.all([
    prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT p.id, p.act_id, p.display_label, p.heading, p.anchor,
             a.act_number, a.year, a.title AS act_title,
             left(p.full_text, 400) AS snippet,
             -- Distinct judgments, not link rows: one link is one citing
             -- passage, and a judgment often cites the same provision twice.
             (SELECT count(DISTINCT l.document_id)::int
                FROM case_provision_links l WHERE l.provision_id = p.id) AS case_count
        FROM provisions p
        JOIN acts a ON a.id = p.act_id
       WHERE ${where}
       ORDER BY ${exactFirst} ${rank} DESC, a.year DESC, p.ordering ASC
       LIMIT ${pageSize} OFFSET ${offset}
    `),
    prisma.$queryRaw<{ total: number }[]>(Prisma.sql`
      SELECT count(*)::int AS total FROM provisions p WHERE ${where}
    `),
  ]);

  return {
    total: Number(countRows[0]?.total ?? 0),
    hits: rows.map((r) => ({
      id: r.id,
      actId: r.act_id,
      actNumber: r.act_number,
      year: r.year,
      actTitle: r.act_title,
      displayLabel: r.display_label,
      heading: r.heading,
      anchor: r.anchor,
      snippet: r.snippet ?? "",
      caseCount: Number(r.case_count ?? 0),
      path: `/log/${r.act_number}-${r.year}#${r.anchor}`,
    })),
  };
}
