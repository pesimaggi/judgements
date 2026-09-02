import { MeiliSearch } from "meilisearch";
import { prisma } from "../db";
import { actCitation, actDisplayTitle, actPath } from "../acts";
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
    // One condition per tag: Meilisearch ANDs the entries of a filter array,
    // which is the conjunctive reading the panel intends.
    const tags = req.tags?.length ? req.tags : req.tag ? [req.tag] : [];
    for (const t of tags) filter.push(`subjectTags = ${JSON.stringify(t)}`);

    // Citation links live in Postgres, not in the Meilisearch index — they
    // change whenever the citation job runs, on a cadence unrelated to the
    // judgments themselves, so indexing them would mean rewriting documents
    // constantly. The matching ids are resolved here and passed as a filter.
    // Capped: an act like almenn hegningarlög is cited by a large share of
    // the corpus, and an unbounded id list would be a filter expression
    // megabytes long. Beyond the cap the result set is truncated, which the
    // Postgres provider (the default) does not do — see citationFilterIds().
    if (req.actIds?.length || req.provisionIds?.length) {
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
      // Meilisearch applies typo tolerance inside the engine and does not
      // report whether a given hit needed it, so there is nothing honest to
      // put here but false. The consequence is worth knowing: the "svipuð
      // niðurstaða" mark the Postgres provider shows on a near-matched case
      // number does not appear under SEARCH_PROVIDER=meilisearch. Marking
      // them all fuzzy would be worse — the mark would stop meaning anything.
      isFuzzy: false,
      isSample: h.isSample ?? false,
    }));

    return { total: res.estimatedTotalHits ?? hits.length, hits };
  }

  async searchActs(req: ActSearchRequest): Promise<ActHit[]> {
    const limit = Math.min(25, Math.max(1, req.limit ?? 10));
    // The EEA/EU scope, as a Meilisearch filter rather than a SQL predicate:
    // Icelandic law always, and the EU library either whole or limited to what
    // may be part of EEA law. See src/lib/acts.ts.
    const filter =
      (req.scope ?? "eea") === "eu"
        ? undefined
        : `jurisdiction = "is" OR eeaRelevant = true OR eeaIncorporated = true`;
    const res = await this.client.index(ACTS_INDEX).search(req.query, { limit, filter });
    return res.hits.map((h: any) => ({
      id: h.id,
      jurisdiction: h.jurisdiction ?? "is",
      actNumber: h.actNumber,
      year: h.year,
      title: h.title,
      citation: h.citation ?? `lög nr. ${h.actNumber}/${h.year}`,
      path: h.path ?? `/log/${h.actNumber}-${h.year}`,
      provisionCount: h.provisionCount ?? 0,
      eeaRelevant: h.eeaRelevant ?? false,
      eeaIncorporatedBy: h.eeaIncorporatedBy ?? [],
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
      jurisdiction: h.jurisdiction ?? "is",
      actNumber: h.actNumber,
      year: h.year,
      actTitle: h.actTitle,
      actCitation: h.actCitation ?? `lög nr. ${h.actNumber}/${h.year}`,
      displayLabel: h.displayLabel,
      heading: h.heading ?? null,
      anchor: h.anchor,
      snippet: h._formatted?.fullText ?? (h.fullText ?? "").slice(0, 400),
      caseCount: countBy.get(h.id) ?? 0,
      path: `${h.actPath ?? `/log/${h.actNumber}-${h.year}`}#${h.anchor}`,
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
 * Drop documents from the Meilisearch index (called from ingestion when a
 * source withdraws something it had published). Deleting from Postgres alone
 * would leave the record searchable here, which is the one place a reader
 * would still find it.
 */
export async function deleteDocumentsFromMeilisearch(ids: string[]) {
  if (ids.length === 0) return;
  const provider = new MeilisearchProvider();
  const index = await provider.ensureIndex();
  await index.deleteDocuments(ids);
}

/**
 * Document ids citing the requested act or provision.
 *
 * DISTINCT because a judgment cites the same provision more than once as a
 * matter of course, and the ids are only useful once each.
 */
async function citationFilterIds(req: SearchRequest): Promise<string[]> {
  const CAP = Number(process.env.MEILI_CITATION_ID_CAP ?? 5000);

  // Every selection must hold, so the conditions are ANDed in one query
  // rather than intersected in JS — that way the cap applies to the final
  // set, not to each selection's set, which could otherwise truncate away
  // documents that satisfy them all.
  const AND = [
    ...(req.provisionIds ?? []).map((provisionId) => ({
      provisionLinks: { some: { provisionId } },
    })),
    ...(req.actIds ?? []).map((actId) => ({
      OR: [
        { provisionLinks: { some: { provision: { actId } } } },
        { actLinks: { some: { actId } } },
      ],
    })),
  ];

  const rows = await prisma.document.findMany({
    where: { AND },
    select: { id: true },
    take: CAP,
  });
  return rows.map((r) => r.id);
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
    filterableAttributes: [
      "actNumber",
      "year",
      "jurisdiction",
      "eeaRelevant",
      "eeaIncorporated",
    ],
    searchableAttributes: ["title", "officialTitle", "aliases", "citation", "celex"],
  });
  await client.index(PROVISIONS_INDEX).updateSettings({
    filterableAttributes: ["actId", "articleNumber", "kind", "jurisdiction"],
    sortableAttributes: ["ordering"],
    searchableAttributes: ["displayLabel", "heading", "fullText", "actTitle"],
  });
}

/** Push one act and its provisions into the indexes (called from ingestion). */
export async function syncActToMeilisearch(act: {
  id: string;
  jurisdiction?: string;
  actNumber: number;
  year: number;
  title: string;
  aliases: string[];
  citation?: string | null;
  celex?: string | null;
  eeaRelevant?: boolean;
  eeaIncorporatedBy?: string[];
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
  const jurisdiction = act.jurisdiction ?? "is";
  const identity = {
    jurisdiction,
    celex: act.celex ?? null,
    actNumber: act.actNumber,
    year: act.year,
  };
  await client.index(ACTS_INDEX).addDocuments([
    {
      id: act.id,
      jurisdiction,
      celex: act.celex ?? null,
      actNumber: act.actNumber,
      year: act.year,
      title: actDisplayTitle({ jurisdiction, title: act.title }),
      // The official title as well, so a search for the words only the full
      // form carries ("of the European Parliament and of the Council") still
      // finds the act the display title has trimmed them from.
      officialTitle: act.title,
      aliases: act.aliases,
      citation: actCitation({ ...identity, citation: act.citation ?? null }),
      path: actPath(identity),
      eeaRelevant: act.eeaRelevant ?? false,
      // A boolean as well as the list, because Meilisearch filters on a
      // scalar and the scope filter asks "is it incorporated at all".
      eeaIncorporated: (act.eeaIncorporatedBy ?? []).length > 0,
      eeaIncorporatedBy: act.eeaIncorporatedBy ?? [],
      provisionCount: act.provisions.filter((p) => p.kind === "article").length,
    },
  ]);
  if (act.provisions.length) {
    await client.index(PROVISIONS_INDEX).addDocuments(
      act.provisions.map((p) => ({
        id: p.id,
        actId: act.id,
        jurisdiction,
        actNumber: act.actNumber,
        year: act.year,
        actTitle: actDisplayTitle({ jurisdiction, title: act.title }),
        actCitation: actCitation({ ...identity, citation: act.citation ?? null }),
        actPath: actPath(identity),
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
