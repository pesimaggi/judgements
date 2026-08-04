import { MeiliSearch } from "meilisearch";
import { prisma } from "../db";
import type {
  SearchRequest,
  SearchHit,
  ActSearchRequest,
  ActHit,
  ProvisionSearchRequest,
  ProvisionHit,
} from "../types";
import type { SearchProvider, ProviderResult } from "./provider";
import { extractSummary, SUMMARY_SCAN_CHARS } from "../judgment-text";

const INDEX = "documents";

/**
 * Optional Meilisearch provider (SEARCH_PROVIDER=meilisearch).
 * Meilisearch gives typo tolerance / fuzzy Icelandic matching out of the box.
 * Documents must be pushed to the index during ingestion (see
 * src/ingestion/adapter.ts, which calls syncDocumentToMeilisearch when this
 * provider is active).
 */
export class MeilisearchProvider implements SearchProvider {
  readonly client = new MeiliSearch({
    host: process.env.MEILISEARCH_HOST ?? "http://localhost:7700",
    apiKey: process.env.MEILISEARCH_API_KEY,
  });

  async ensureIndex() {
    const index = this.client.index(INDEX);
    await index.updateSettings({
      filterableAttributes: ["source", "year", "dateTimestamp", "subjectTags"],
      sortableAttributes: ["dateTimestamp"],
      searchableAttributes: ["title", "caseName", "caseNumber", "parties", "fullText"],
    });
    return index;
  }

  async search(req: SearchRequest): Promise<ProviderResult> {
    const index = this.client.index(INDEX);
    const filter: string[] = [
      `source IN [${req.sources.map((s) => JSON.stringify(s)).join(", ")}]`,
    ];
    if (req.dateFrom) filter.push(`dateTimestamp >= ${new Date(req.dateFrom).getTime()}`);
    if (req.dateTo) filter.push(`dateTimestamp <= ${new Date(req.dateTo).getTime()}`);
    if (req.year) filter.push(`year = ${req.year}`);
    if (req.tag) filter.push(`subjectTags = ${JSON.stringify(req.tag)}`);

    // Citation links live in Postgres, not in the Meilisearch index — they
    // change whenever the citation job runs, on a cadence unrelated to the
    // judgments themselves, so indexing them would mean rewriting documents
    // constantly. The matching ids are resolved here and passed as a filter.
    // Capped: an act like almenn hegningarlög is cited by a large share of
    // the corpus, and an unbounded id list would be a filter expression
    // megabytes long. Beyond the cap the result set is truncated, which the
    // Postgres provider (the default) does not do — see citationFilterIds().
    if (req.actId || req.provisionId) {
      const ids = await citationFilterIds(req);
      if (ids.length === 0) return { total: 0, hits: [] };
      filter.push(`id IN [${ids.map((i) => JSON.stringify(i)).join(", ")}]`);
    }

    const page = Math.max(1, req.page ?? 1);
    const pageSize = Math.min(50, Math.max(1, req.pageSize ?? 20));

    const res = await index.search(req.query, {
      filter,
      limit: pageSize,
      offset: (page - 1) * pageSize,
      sort:
        req.sort === "newest" ? ["dateTimestamp:desc"]
        : req.sort === "oldest" ? ["dateTimestamp:asc"]
        : undefined,
      attributesToHighlight: ["fullText", "title"],
      highlightPreTag: "<mark>",
      highlightPostTag: "</mark>",
      attributesToCrop: ["fullText"],
      cropLength: 40,
    });

    const hits: SearchHit[] = res.hits.map((h: any) => ({
      id: h.id,
      source: h.source,
      court: h.court,
      caseNumber: h.caseNumber ?? null,
      caseName: h.caseName ?? null,
      title: h.title,
      date: h.dateTimestamp ? new Date(h.dateTimestamp).toISOString() : null,
      year: h.year ?? null,
      subjectTags: h.subjectTags ?? [],
      officialUrl: h.officialUrl,
      pdfUrl: h.pdfUrl ?? null,
      snippet: h._formatted?.fullText ?? "",
      summary: extractSummary((h.fullText ?? "").slice(0, SUMMARY_SCAN_CHARS)),
      isSample: h.isSample ?? false,
    }));

    return { total: res.estimatedTotalHits ?? hits.length, hits };
  }

  async searchActs(req: ActSearchRequest): Promise<ActHit[]> {
    const limit = Math.min(25, Math.max(1, req.limit ?? 10));
    const res = await this.client.index(ACTS_INDEX).search(req.query, { limit });
    return res.hits.map((h: any) => ({
      id: h.id,
      actNumber: h.actNumber,
      year: h.year,
      title: h.title,
      citation: h.citation ?? `lög nr. ${h.actNumber}/${h.year}`,
      path: `/log/${h.actNumber}-${h.year}`,
      provisionCount: h.provisionCount ?? 0,
    }));
  }

  async searchProvisions(req: ProvisionSearchRequest) {
    const page = Math.max(1, req.page ?? 1);
    const pageSize = Math.min(50, Math.max(1, req.pageSize ?? 20));
    const res = await this.client.index(PROVISIONS_INDEX).search(req.query, {
      filter: [`kind = "article"`, ...(req.actId ? [`actId = "${req.actId}"`] : [])],
      limit: pageSize,
      offset: (page - 1) * pageSize,
      attributesToCrop: ["fullText"],
      cropLength: 60,
    });

    // Case counts are read live rather than indexed — see ensureActIndexes().
    const ids = res.hits.map((h: any) => h.id);
    // Distinct judgments per provision, not link rows — a judgment often
    // cites the same provision more than once and each occurrence is its own
    // link. groupBy cannot express COUNT(DISTINCT …), so this counts the
    // distinct pairs itself.
    const pairs = ids.length
      ? await prisma.caseProvisionLink.findMany({
          where: { provisionId: { in: ids } },
          select: { provisionId: true, documentId: true },
          distinct: ["provisionId", "documentId"],
        })
      : [];
    const countBy = new Map<string, number>();
    for (const p of pairs) countBy.set(p.provisionId, (countBy.get(p.provisionId) ?? 0) + 1);

    const hits: ProvisionHit[] = res.hits.map((h: any) => ({
      id: h.id,
      actId: h.actId,
      actNumber: h.actNumber,
      year: h.year,
      actTitle: h.actTitle,
      displayLabel: h.displayLabel,
      heading: h.heading ?? null,
      anchor: h.anchor,
      snippet: h._formatted?.fullText ?? (h.fullText ?? "").slice(0, 400),
      caseCount: countBy.get(h.id) ?? 0,
      path: `/log/${h.actNumber}-${h.year}#${h.anchor}`,
    }));
    return { total: res.estimatedTotalHits ?? hits.length, hits };
  }
}

/** Push one document into the Meilisearch index (called from ingestion). */
export async function syncDocumentToMeilisearch(doc: any) {
  const provider = new MeilisearchProvider();
  const index = await provider.ensureIndex();
  await index.addDocuments([
    {
      ...doc,
      dateTimestamp: doc.date ? new Date(doc.date).getTime() : null,
    },
  ]);
}

/**
 * Document ids citing the requested act or provision.
 *
 * DISTINCT because a judgment cites the same provision more than once as a
 * matter of course, and the ids are only useful once each.
 */
async function citationFilterIds(req: SearchRequest): Promise<string[]> {
  const CAP = Number(process.env.MEILI_CITATION_ID_CAP ?? 5000);
  const rows = req.provisionId
    ? await prisma.caseProvisionLink.findMany({
        where: { provisionId: req.provisionId },
        select: { documentId: true },
        distinct: ["documentId"],
        take: CAP,
      })
    : await prisma.document.findMany({
        where: {
          OR: [
            { provisionLinks: { some: { provision: { actId: req.actId } } } },
            { actLinks: { some: { actId: req.actId } } },
          ],
        },
        select: { id: true },
        take: CAP,
      });
  return rows.map((r) => ("documentId" in r ? r.documentId : r.id));
}

const ACTS_INDEX = "acts";
const PROVISIONS_INDEX = "provisions";

/**
 * Acts and provisions get their own Meilisearch indexes, pushed during
 * Lagasafn ingestion (syncActToMeilisearch, called from the adapter when this
 * provider is active) — the same arrangement judgments already use.
 *
 * One thing deliberately does not live in the index: the per-provision case
 * count. It changes every time the citation job runs over new judgments,
 * which would mean rewriting provision documents on a schedule unrelated to
 * the law itself. Meilisearch does the matching; the counts are read from
 * Postgres for the handful of rows actually returned.
 */
export async function ensureActIndexes(client: MeiliSearch) {
  await client.index(ACTS_INDEX).updateSettings({
    filterableAttributes: ["actNumber", "year"],
    searchableAttributes: ["title", "aliases", "citation"],
  });
  await client.index(PROVISIONS_INDEX).updateSettings({
    filterableAttributes: ["actId", "articleNumber", "kind"],
    sortableAttributes: ["ordering"],
    searchableAttributes: ["displayLabel", "heading", "fullText", "actTitle"],
  });
}

/** Push one act and its provisions into the indexes (called from ingestion). */
export async function syncActToMeilisearch(act: {
  id: string;
  actNumber: number;
  year: number;
  title: string;
  aliases: string[];
  provisions: {
    id: string;
    kind: string;
    displayLabel: string;
    heading: string | null;
    anchor: string;
    fullText: string;
    articleNumber: number | null;
    ordering: number;
  }[];
}) {
  const provider = new MeilisearchProvider();
  const client = provider.client;
  await ensureActIndexes(client);
  await client.index(ACTS_INDEX).addDocuments([
    {
      id: act.id,
      actNumber: act.actNumber,
      year: act.year,
      title: act.title,
      aliases: act.aliases,
      citation: `lög nr. ${act.actNumber}/${act.year}`,
      provisionCount: act.provisions.filter((p) => p.kind === "article").length,
    },
  ]);
  if (act.provisions.length) {
    await client.index(PROVISIONS_INDEX).addDocuments(
      act.provisions.map((p) => ({
        id: p.id,
        actId: act.id,
        actNumber: act.actNumber,
        year: act.year,
        actTitle: act.title,
        kind: p.kind,
        articleNumber: p.articleNumber,
        displayLabel: p.displayLabel,
        heading: p.heading,
        anchor: p.anchor,
        fullText: p.fullText,
        ordering: p.ordering,
      }))
    );
  }
}
