/**
 * Browsing the ingested act corpus.
 *
 * Deliberately a plain query rather than part of the SearchProvider
 * abstraction: listing every act in order is not a search, and routing it
 * through the provider would oblige the Meilisearch implementation to
 * paginate its whole index to answer "what have we got". Searching acts still
 * goes through the provider (searchActs) — this is the catalogue view.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "./db";

export type ActSort = "title" | "number" | "cases" | "provisions";

export interface ActListItem {
  id: string;
  actNumber: number;
  year: number;
  title: string;
  citation: string;
  path: string;
  aliases: string[];
  provisionCount: number;
  /** Judgments citing any provision of this act, or the act itself. */
  citingCases: number;
  currentVersionUrl: string;
}

export interface ActListResult {
  acts: ActListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  /** Corpus-wide figures, so the page can say what it is showing. */
  totals: { acts: number; provisions: number; linkedProvisions: number };
}

/**
 * One page of the act catalogue.
 *
 * The counts are computed in the same statement rather than per row: at ~900
 * acts a count query each would be ~900 round trips to render one page.
 * `citingCases` counts distinct judgments across both link tables, so an act
 * cited once by article and once bare does not count twice.
 */
export async function listActs(opts: {
  page?: number;
  pageSize?: number;
  sort?: ActSort;
  /** Show only acts that at least one judgment cites. */
  citedOnly?: boolean;
}): Promise<ActListResult> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(1000, Math.max(1, opts.pageSize ?? 100));
  const offset = (page - 1) * pageSize;
  const sort: ActSort = opts.sort ?? "title";

  // Column names as the CTE below exposes them: the `acts a` alias is scoped
  // to the CTE body and is not in scope for the outer SELECT that sorts.
  const order =
    sort === "number"
      ? Prisma.sql`year DESC, act_number DESC`
      : sort === "cases"
        ? Prisma.sql`citing_cases DESC, title ASC`
        : sort === "provisions"
          ? Prisma.sql`provision_count DESC, title ASC`
          : Prisma.sql`title ASC`;

  const having = opts.citedOnly ? Prisma.sql`WHERE citing_cases > 0` : Prisma.empty;

  const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
    WITH counted AS (
      SELECT a.id, a.act_number, a.year, a.title, a.aliases, a.current_version_url,
             (SELECT count(*)::int FROM provisions p
               WHERE p.act_id = a.id AND p.kind = 'article') AS provision_count,
             (SELECT count(DISTINCT d)::int FROM (
                SELECT l.document_id AS d FROM case_provision_links l
                  JOIN provisions p ON p.id = l.provision_id
                 WHERE p.act_id = a.id
                UNION
                SELECT al.document_id FROM case_act_links al WHERE al.act_id = a.id
              ) refs) AS citing_cases
        FROM acts a
    )
    SELECT * FROM counted
    ${having}
    ORDER BY ${order}
    LIMIT ${pageSize} OFFSET ${offset}
  `);

  const [{ total }] = await prisma.$queryRaw<{ total: number }[]>(Prisma.sql`
    SELECT count(*)::int AS total FROM acts a
    ${
      opts.citedOnly
        ? Prisma.sql`WHERE EXISTS (
            SELECT 1 FROM case_act_links al WHERE al.act_id = a.id
             UNION ALL
            SELECT 1 FROM case_provision_links l
              JOIN provisions p ON p.id = l.provision_id
             WHERE p.act_id = a.id)`
        : Prisma.empty
    }
  `);

  const [totals] = await prisma.$queryRaw<
    { acts: number; provisions: number; linked_provisions: number }[]
  >(Prisma.sql`
    SELECT (SELECT count(*)::int FROM acts) AS acts,
           (SELECT count(*)::int FROM provisions WHERE kind = 'article') AS provisions,
           (SELECT count(DISTINCT provision_id)::int FROM case_provision_links) AS linked_provisions
  `);

  return {
    acts: rows.map((r) => ({
      id: r.id,
      actNumber: r.act_number,
      year: r.year,
      title: r.title,
      citation: `lög nr. ${r.act_number}/${r.year}`,
      path: `/log/${r.act_number}-${r.year}`,
      aliases: r.aliases ?? [],
      provisionCount: Number(r.provision_count ?? 0),
      citingCases: Number(r.citing_cases ?? 0),
      currentVersionUrl: r.current_version_url,
    })),
    total: Number(total ?? 0),
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(Number(total ?? 0) / pageSize)),
    totals: {
      acts: Number(totals?.acts ?? 0),
      provisions: Number(totals?.provisions ?? 0),
      linkedProvisions: Number(totals?.linked_provisions ?? 0),
    },
  };
}
