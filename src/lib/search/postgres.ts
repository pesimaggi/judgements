import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { parseQuery } from "../query-parser";
import { extractSummary, SUMMARY_SCAN_CHARS } from "../judgment-text";
import type { SearchRequest, SearchHit } from "../types";
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
}
