import { load } from "cheerio";
import pdfParse from "pdf-parse";
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
 *    archive (43k+ items) when `searchTerm` is left empty, paginated 20/page.
 *  - Full text: the case detail page (island.is/domar/{id}) is server-rendered
 *    and has no separate GraphQL call for the document body. Instead the
 *    page embeds the judgment as a base64-encoded PDF (`pdfString`, under a
 *    `WebVerdictByIdItem`-typed object) inside its Next.js `__NEXT_DATA__`
 *    payload, rendered client-side via pdf.js. We fetch that page directly
 *    and extract the PDF text ourselves rather than scraping the rendered
 *    pdf.js text layer (which loses reading order).
 *
 * The archive is large (43k+ judgments); INGEST_MAX_PAGES bounds how much a
 * single run pulls (20 items/page) and INGEST_START_PAGE offsets where it
 * starts — run repeatedly with an advancing start page to backfill the rest
 * rather than raising INGEST_MAX_PAGES to cover everything in one pass.
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

/** Recursively finds the first string value stored under `key`, anywhere in a nested object. */
function findKey(o: unknown, key: string): string | null {
  if (o && typeof o === "object") {
    const rec = o as Record<string, unknown>;
    if (typeof rec[key] === "string") return rec[key] as string;
    for (const v of Object.values(rec)) {
      const r = findKey(v, key);
      if (r) return r;
    }
  }
  return null;
}

/** Fetches a case's detail page and extracts the judgment's full text from its embedded PDF. */
async function fetchVerdictText(ctx: IngestContext, officialUrl: string): Promise<string> {
  const html = await ctx.fetchText(officialUrl);
  const $ = load(html);
  const nextDataRaw = $("#__NEXT_DATA__").html();
  if (!nextDataRaw) return "";
  const nextData = JSON.parse(nextDataRaw);
  const pdfBase64 = findKey(nextData, "pdfString");
  if (!pdfBase64) return "";
  const { text } = await pdfParse(Buffer.from(pdfBase64, "base64"));
  return text.replace(/\s{2,}/g, " ").trim();
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
    const startPage = Number(process.env.INGEST_START_PAGE ?? 1);
    const maxPages = Number(process.env.INGEST_MAX_PAGES ?? 5);
    const court = process.env.INGEST_COURT ? [process.env.INGEST_COURT] : [];
    ctx.log(`Court filter: ${court.length ? court.join(", ") : "(none — all courts)"}`);

    let page = startPage;
    const lastPage = startPage + maxPages - 1;
    while (page <= lastPage) {
      let items: any[] = [];
      try {
        const data = await gql(LIST_QUERY, {
          input: {
            page,
            searchTerm: "",
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

      for (const it of items) {
        try {
          const sourceKey = courtToSourceKey(it.court ?? "");
          if (!sourceKey) { stats.skipped++; continue; }

          const officialUrl = `https://island.is/domar/${it.id}`;
          const fullText = await fetchVerdictText(ctx, officialUrl);
          if (!fullText) { stats.skipped++; continue; }

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
          result === "indexed" ? stats.indexed++ : stats.skipped++;
        } catch (e) {
          stats.errors++;
          stats.errorSample = stats.errorSample ?? String(e);
        }
      }
      page++;
    }
    return stats;
  },
};
