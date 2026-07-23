import { MeiliSearch } from "meilisearch";
import type { SearchRequest, SearchHit } from "../types";
import type { SearchProvider, ProviderResult } from "./provider";

const INDEX = "documents";

/**
 * Optional Meilisearch provider (SEARCH_PROVIDER=meilisearch).
 * Meilisearch gives typo tolerance / fuzzy Icelandic matching out of the box.
 * Documents must be pushed to the index during ingestion (see
 * src/ingestion/adapter.ts, which calls syncDocumentToMeilisearch when this
 * provider is active).
 */
export class MeilisearchProvider implements SearchProvider {
  private client = new MeiliSearch({
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
      isSample: h.isSample ?? false,
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
