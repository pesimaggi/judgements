import { load } from "cheerio";
import pdfParse from "pdf-parse";
import { prisma } from "@/lib/db";
import type { IngestionAdapter, IngestContext, IngestStats } from "../adapter";

/**
 * Icelandic courts adapter — island.is/domar (Hæstiréttur, Landsréttur, Héraðsdómar).
 *
 * VERIFIED against live traffic (introspection is disabled in production on
 * this API, so the schema was reconstructed from the browser's own network
 * requests instead of guessed):
 *
 *  - List: the `webVerdicts(input: WebVerdictsInput)` query, captured from
 *    island.is/domar's own search request. Confirmed to return the full
 *    archive (43k+ items) when `searchTerm` is left empty, paginated 10/page
 *    (despite what an earlier version of this comment assumed).
 *  - Full text: the case detail page (island.is/domar/{id}) is server-rendered
 *    and has no separate GraphQL call for the document body — it's embedded in
 *    the page's own Next.js `__NEXT_DATA__` payload, under a
 *    `WebVerdictByIdItem`-typed object, in one of two shapes depending on how
 *    old the case is:
 *      - Older cases: a base64-encoded PDF (`pdfString`), rendered
 *        client-side via pdf.js. We extract the PDF text ourselves rather
 *        than scraping the rendered pdf.js text layer (loses reading order).
 *      - Newer cases (island.is appears to have migrated off scanned PDFs at
 *        some point): a Contentful-style rich-text document tree (`richText`
 *        — `{ document: { content: [{ nodeType, content, value, ... }] } }`),
 *        walked recursively to plain text.
 *
 * The archive is large (43k+ judgments; ~12.2k for Hæstiréttur alone);
 * INGEST_MAX_PAGES bounds how much a single run pulls. Each run picks up
 * where the last one for the same INGEST_COURT value left off — the next
 * page is persisted in IngestCursor (keyed by that filter value) after every
 * run, so repeated runs (e.g. clicking "Redeploy" on Railway) backfill the
 * rest incrementally without needing INGEST_START_PAGE hand-computed each
 * time. Pass INGEST_START_PAGE explicitly to override the resume point for a
 * one-off run.
 *
 * INGEST_COURT filters to one court at a time (server-side, via the API's
 * own `input.court` field — confirmed value: exactly "Hæstiréttur",
 * "Landsréttur", or a "Héraðsdómur ..." string, matching the `court` field
 * on each result). Results are date-sorted across all courts combined, so
 * without this filter a priority order (Hæstiréttur, then Landsréttur, then
 * the district courts) would mean scanning most of the archive just to
 * collect the Supreme Court's cases out of the mix.
 */

const GRAPHQL_ENDPOINT = process.env.ISLAND_IS_GRAPHQL ?? "https://island.is/api/graphql";

const LIST_QUERY = `
  query GetVerdicts($input: WebVerdictsInput!) {
    webVerdicts(input: $input) {
      total
      items {
        id
        title
        court
        caseNumber
        verdictDate
        keywords
        presentings
      }
    }
  }
`;

async function gql(query: string, variables: Record<string, unknown> = {}) {
  const res = await fetch(GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": process.env.INGEST_USER_AGENT ?? "logbrunnur-mvp/0.1",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GraphQL HTTP ${res.status}: ${body.slice(0, 500)}`);
  }
  const json = await res.json();
  if (json.errors) throw new Error(`GraphQL errors: ${JSON.stringify(json.errors).slice(0, 500)}`);
  return json.data;
}

/** Recursively finds the first object whose __typename matches, anywhere in a nested object. */
function findByTypename(o: unknown, typename: string): Record<string, unknown> | null {
  if (o && typeof o === "object") {
    const rec = o as Record<string, unknown>;
    if (rec.__typename === typename) return rec;
    for (const v of Object.values(rec)) {
      const r = findByTypename(v, typename);
      if (r) return r;
    }
  }
  return null;
}

/** Block-level node types in a Contentful-style rich-text tree; a newline follows each. */
const RICH_TEXT_BLOCK_TYPES = new Set([
  "document", "paragraph", "heading-1", "heading-2", "heading-3", "heading-4", "heading-5", "heading-6",
  "blockquote", "list-item", "unordered-list", "ordered-list", "hr", "table", "table-row", "table-cell",
]);

/** Recursively walks a Contentful-style rich-text document tree to plain text. */
function extractRichText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const rec = node as Record<string, unknown>;
  if (rec.nodeType === "text" && typeof rec.value === "string") return rec.value;
  const content = Array.isArray(rec.content) ? rec.content : [];
  const inner = content.map(extractRichText).join("");
  return RICH_TEXT_BLOCK_TYPES.has(rec.nodeType as string) ? `${inner}\n` : inner;
}

/**
 * Fetches a case's detail page and extracts the judgment's full text — from
 * an embedded PDF (older, scanned cases) or a Contentful-style rich-text
 * document (newer cases, authored directly rather than scanned).
 */
async function fetchVerdictText(ctx: IngestContext, officialUrl: string): Promise<string> {
  const html = await ctx.fetchText(officialUrl);
  const $ = load(html);
  const nextDataRaw = $("#__NEXT_DATA__").html();
  if (!nextDataRaw) {
    ctx.log(`  no __NEXT_DATA__ found (html length ${html.length})`);
    return "";
  }
  const nextData = JSON.parse(nextDataRaw);
  const item = findByTypename(nextData, "WebVerdictByIdItem");
  if (!item) {
    ctx.log(`  no WebVerdictByIdItem found (__NEXT_DATA__ ${nextDataRaw.length} chars)`);
    return "";
  }

  if (typeof item.pdfString === "string" && item.pdfString.length > 0) {
    const { text } = await pdfParse(Buffer.from(item.pdfString, "base64"));
    return text.replace(/\s{2,}/g, " ").trim();
  }

  const richText = item.richText as Record<string, unknown> | undefined;
  if (richText && typeof richText === "object") {
    const text = extractRichText(richText.document).replace(/\n{2,}/g, "\n").trim();
    if (text) return text;
  }

  ctx.log(`  neither pdfString nor richText yielded text (fields: ${Object.keys(item).join(", ")})`);
  return "";
}

/** Maps island.is court names onto our per-court source keys. */
export function courtToSourceKey(court: string): string | null {
  const c = court.toLowerCase();
  if (c.includes("hæstirétt") || c.includes("haestirett")) return "haestirettur";
  if (c.includes("landsrétt") || c.includes("landsrett")) return "landsrettur";
  if (c.includes("héraðsdóm") || c.includes("heradsdom")) return "heradsdomar";
  return null;
}

export const icelandicCourtsAdapter: IngestionAdapter = {
  key: "icelandic-courts",
  name: "Icelandic courts (island.is/domar, GraphQL + embedded PDF)",

  async run(ctx: IngestContext): Promise<IngestStats> {
    const stats: IngestStats = { indexed: 0, skipped: 0, errors: 0 };

    // Diagnostic mode: fetch one known case directly, bypassing search/pagination.
    if (process.env.INGEST_TEST_ID) {
      const officialUrl = `https://island.is/domar/${process.env.INGEST_TEST_ID}`;
      ctx.log(`Diagnostic fetch: ${officialUrl}`);
      const fullText = await fetchVerdictText(ctx, officialUrl);
      ctx.log(`Result: ${fullText ? `${fullText.length} chars extracted` : "empty — no text found"}`);
      if (fullText) ctx.log(`  preview: ${fullText.slice(0, 300)}`);
      return stats;
    }

    const maxPages = Number(process.env.INGEST_MAX_PAGES ?? 5);
    const courtEnv = process.env.INGEST_COURT ?? "";
    const court = courtEnv ? [courtEnv] : [];
    const searchTerm = process.env.INGEST_SEARCH_TERM ?? "";
    ctx.log(`Court filter: ${court.length ? court.join(", ") : "(none — all courts)"}${searchTerm ? `, searchTerm=${searchTerm}` : ""}`);

    // Resume from wherever the last run for this exact filter left off, unless
    // INGEST_START_PAGE explicitly overrides it (e.g. for a one-off re-check).
    const cursor = await prisma.ingestCursor.findUnique({ where: { key: courtEnv } });
    const startPage = Number(process.env.INGEST_START_PAGE ?? cursor?.nextPage ?? 1);
    ctx.log(`Starting at page ${startPage}${process.env.INGEST_START_PAGE ? " (explicit override)" : cursor ? " (resumed)" : ""}`);

    let noCourtMatch = 0;
    let noPdf = 0;
    let unchanged = 0;

    let page = startPage;
    const lastPage = startPage + maxPages - 1;
    while (page <= lastPage) {
      let items: any[] = [];
      try {
        const data = await gql(LIST_QUERY, {
          input: {
            page,
            searchTerm,
            court,
            caseNumber: "",
            keywords: null,
            caseCategories: null,
            caseTypes: null,
            laws: null,
            dateFrom: null,
            dateTo: null,
            caseContact: "",
          },
        });
        items = data?.webVerdicts?.items ?? [];
        if (page === startPage) ctx.log(`Total matching: ${data?.webVerdicts?.total ?? "unknown"}`);
      } catch (e) {
        stats.errors++;
        stats.errorSample = String(e);
        break;
      }
      if (items.length === 0) break;
      ctx.log(`Page ${page}: ${items.length} cases`);
      if (items[0]) {
        ctx.log(`  first: ${items[0].caseNumber} — ${items[0].court} — ${items[0].verdictDate}`);
      }

      for (const it of items) {
        try {
          const sourceKey = courtToSourceKey(it.court ?? "");
          if (!sourceKey) { stats.skipped++; noCourtMatch++; continue; }

          const officialUrl = `https://island.is/domar/${it.id}`;
          const fullText = await fetchVerdictText(ctx, officialUrl);
          if (!fullText) { stats.skipped++; noPdf++; continue; }

          const result = await ctx.save({
            source: sourceKey,
            court: it.court,
            caseNumber: it.caseNumber ?? undefined,
            caseName: it.title ?? undefined,
            title: it.title ?? it.caseNumber ?? "Dómur",
            date: it.verdictDate ? new Date(it.verdictDate) : undefined,
            language: "is",
            parties: it.title ?? undefined,
            subjectTags: it.keywords ?? [],
            officialUrl,
            fullText,
          });
          if (result === "indexed") { stats.indexed++; } else { stats.skipped++; unchanged++; }
        } catch (e) {
          stats.errors++;
          stats.errorSample = stats.errorSample ?? String(e);
          ctx.log(`  error on ${it.caseNumber ?? it.id}: ${String(e).slice(0, 200)}`);
        }
      }
      page++;
    }
    await prisma.ingestCursor.upsert({
      where: { key: courtEnv },
      create: { key: courtEnv, nextPage: page },
      update: { nextPage: page },
    });
    ctx.log(`Cursor saved: next run for "${courtEnv || "(unfiltered)"}" resumes at page ${page}`);
    ctx.log(`Skip breakdown: no-court-match=${noCourtMatch}, no-pdf-found=${noPdf}, unchanged=${unchanged}`);
    return stats;
  },
};
