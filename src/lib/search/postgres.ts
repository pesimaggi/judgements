import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { parseQuery } from "../query-parser";
import type { SearchRequest, SearchHit } from "../types";
import type { SearchProvider, ProviderResult } from "./provider";

/**
 * Default provider. Uses:
 *  - websearch_to_tsquery('simple', ...) → phrases ("..."), implicit AND,
 *    OR, and -negation, with Icelandic characters preserved.
 *  - pg_trgm similarity() as a fuzzy fallback for spelling variants and
 *    case-number lookups.
 * Requires prisma/sql/setup-search.sql to have been run once.
 */
export class PostgresSearchProvider implements SearchProvider {
  async search(req: SearchRequest): Promise<ProviderResult> {
    const parsed = parseQuery(req.query);
    const page = Math.max(1, req.page ?? 1);
    const pageSize = Math.min(50, Math.max(1, req.pageSize ?? 20));
    const offset = (page - 1) * pageSize;

    const filters: Prisma.Sql[] = [
      Prisma.sql`d.source IN (${Prisma.join(req.sources)})`,
    ];
    if (req.dateFrom) filters.push(Prisma.sql`d.date >= ${new Date(req.dateFrom)}`);
    if (req.dateTo) filters.push(Prisma.sql`d.date <= ${new Date(req.dateTo)}`);
    if (req.year) filters.push(Prisma.sql`d.year = ${req.year}`);
    if (req.tag) filters.push(Prisma.sql`d.subject_tags @> ARRAY[${req.tag}]::text[]`);

    // Match condition: FTS, plus fuzzy metadata matching, plus case-number match.
    const matchParts: Prisma.Sql[] = [];
    if (parsed.websearch) {
      matchParts.push(Prisma.sql`
        document_search_vector(d.title, d.case_name, d.case_number, d.parties, d.full_text)
          @@ websearch_to_tsquery('simple', ${parsed.websearch})
      `);
      // Fuzzy fallback on metadata for Icelandic spelling variants (pg_trgm).
      matchParts.push(Prisma.sql`similarity(coalesce(d.title,'') || ' ' || coalesce(d.case_name,''), ${parsed.raw}) > 0.35`);
    }
    for (const cn of parsed.caseNumbers) {
      matchParts.push(Prisma.sql`d.case_number ILIKE ${cn}`);
      matchParts.push(Prisma.sql`similarity(coalesce(d.case_number,''), ${cn}) > 0.5`);
    }
    if (matchParts.length === 0) {
      // Empty query with filters only: allow browsing within selected courts.
      matchParts.push(Prisma.sql`TRUE`);
    }

    const where = Prisma.sql`(${Prisma.join(matchParts, " OR ")}) AND ${Prisma.join(filters, " AND ")}`;

    const order =
      req.sort === "newest"
        ? Prisma.sql`d.date DESC NULLS LAST`
        : req.sort === "oldest"
          ? Prisma.sql`d.date ASC NULLS LAST`
          : Prisma.sql`rank DESC, d.date DESC NULLS LAST`;

    const rankExpr = parsed.websearch
      ? Prisma.sql`ts_rank(document_search_vector(d.title, d.case_name, d.case_number, d.parties, d.full_text), websearch_to_tsquery('simple', ${parsed.websearch}))`
      : Prisma.sql`0`;

    const headlineExpr = parsed.websearch
      ? Prisma.sql`ts_headline('simple', d.full_text, websearch_to_tsquery('simple', ${parsed.websearch}),
          'StartSel=<mark>, StopSel=</mark>, MaxFragments=2, FragmentDelimiter= … , MinWords=8, MaxWords=28')`
      : Prisma.sql`left(d.full_text, 240)`;

    const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT d.id, d.source, d.court, d.case_number, d.case_name, d.title, d.date, d.year,
             d.subject_tags, d.official_url, d.pdf_url, d.is_sample,
             ${rankExpr} AS rank,
             ${headlineExpr} AS snippet,
             count(*) OVER() AS total
      FROM "Document" d
      WHERE ${where}
      ORDER BY ${order}
      LIMIT ${pageSize} OFFSET ${offset}
    `);

    const total = rows.length ? Number(rows[0].total) : 0;
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
      isSample: r.is_sample,
    }));

    return { total, hits };
  }
}
