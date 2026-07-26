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
 * on each result). Results are date-sorted across all courts combined.
 *
 * When INGEST_COURT is unset, `input.court` is sent as `null`, not `[]` —
 * an empty array is apparently read as "match zero courts" by this API
 * rather than "no filter" (found the hard way: a run with `court: []`
 * came back with `total: 0` on every page). `null` is what actually
 * yields the unfiltered, all-courts result set.
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

/**
 * Refreshes Source.totalAvailable for all three courts, powering the
 * front-page ingestion progress bar. Héraðsdómar has no single court-name
 * filter (it's dozens of individual district courts), so its total is
 * derived as the grand total minus the other two, rather than queried
 * directly. Best-effort: failures are logged and swallowed so a totals
 * hiccup never fails the ingestion run itself.
 */
export async function syncAvailableTotals(ctx: IngestContext): Promise<void> {
  try {
    const totalFor = async (court: string[]) => {
      const data = await gql(LIST_QUERY, {
        input: {
          page: 1, searchTerm: "", court: court.length ? court : null, caseNumber: "", keywords: null,
          caseCategories: null, caseTypes: null, laws: null, dateFrom: null,
          dateTo: null, caseContact: "",
        },
      });
      return Number(data?.webVerdicts?.total ?? 0);
    };

    const [all, haestirettur, landsrettur] = await Promise.all([
      totalFor([]),
      totalFor(["Hæstiréttur"]),
      totalFor(["Landsréttur"]),
    ]);
    const heradsdomar = Math.max(0, all - haestirettur - landsrettur);

    await Promise.all([
      prisma.source.updateMany({ where: { key: "haestirettur" }, data: { totalAvailable: haestirettur } }),
      prisma.source.updateMany({ where: { key: "landsrettur" }, data: { totalAvailable: landsrettur } }),
      prisma.source.updateMany({ where: { key: "heradsdomar" }, data: { totalAvailable: heradsdomar } }),
    ]);
    ctx.log(`Totals synced: haestirettur=${haestirettur} landsrettur=${landsrettur} heradsdomar=${heradsdomar} (all=${all})`);
  } catch (e) {
    ctx.log(`Totals sync failed (non-fatal): ${String(e).slice(0, 200)}`);
  }
}

export const icelandicCourtsAdapter: IngestionAdapter = {
  key: "icelandic-courts",
  name: "Icelandic courts (island.is/domar, GraphQL + embedded PDF)",

  async run(ctx: IngestContext): Promise<IngestStats> {
    const stats: IngestStats = { indexed: 0, skipped: 0, errors: 0 };

    await syncAvailableTotals(ctx);

    // Diagnostic mode: fetch one known case directly, bypassing search/pagination.
    if (process.env.INGEST_TEST_ID) {
      const officialUrl = `https://island.is/domar/${process.env.INGEST_TEST_ID}`;
      ctx.log(`Diagnostic fetch: ${officialUrl}`);
      const fullText = await fetchVerdictText(ctx, officialUrl);
      ctx.log(`Result: ${fullText ? `${fullText.length} chars extracted` : "empty — no text found"}`);
      if (fullText) ctx.log(`  preview: ${fullText.slice(0, 300)}`);
      return stats;
    }

    // Diagnostic mode: probe candidate exact court-name strings against the
    // live API's own total, bypassing search/pagination. "Landsréttur" alone
    // returns total=0 (confirmed against live data), so the exact string
    // this API expects isn't what the original schema reconstruction assumed.
    if (process.env.INGEST_COURT_DIAG) {
      const candidates = [
        "Landsréttur", "Landsréttur Íslands", "landsréttur", "LANDSRÉTTUR",
        "Landsréttur ", " Landsréttur", "Landsréttur Ísland",
      ];
      for (const c of candidates) {
        const data = await gql(LIST_QUERY, {
          input: {
            page: 1, searchTerm: "", court: [c], caseNumber: "", keywords: null,
            caseCategories: null, caseTypes: null, laws: null, dateFrom: null,
            dateTo: null, caseContact: "",
          },
        });
        const total = data?.webVerdicts?.total ?? "?";
        const firstCourt = data?.webVerdicts?.items?.[0]?.court ?? "(none)";
        ctx.log(`  candidate "${c}": total=${total}, first item's court field="${firstCourt}"`);
      }
      return stats;
    }

    const maxPages = Number(process.env.INGEST_MAX_PAGES ?? 5);
    const courtEnv = process.env.INGEST_COURT ?? "";
    const court = courtEnv ? [courtEnv] : [];
    const searchTerm = process.env.INGEST_SEARCH_TERM ?? "";
    ctx.log(`Court filter: ${court.length ? court.join(", ") : "(none — all courts)"}${searchTerm ? `, searchTerm=${searchTerm}` : ""}`);

    let noCourtMatch = 0;
    let noPdf = 0;
    let unchanged = 0;

    // Shared per-item handling for both the flat-paged and year-chunked loops
    // below: bucket by court, fetch the verdict text, upsert it.
    const processItems = async (items: any[]) => {
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
    };

    if (courtEnv === "") {
      // Year-chunked sweep. island.is's search API appears to cap how deep a
      // single query can paginate — page ~3081 (offset ~30,800) returned 0
      // items despite reporting thousands still "matching", a classic
      // symptom of a fixed max result-window on the backend (many search
      // engines default to ~10k). Slicing by calendar year means each
      // year's own pagination restarts at page 1, so no single query ever
      // needs a deep offset — sidesteps the cap instead of hitting it.
      const cursor = await prisma.ingestCursor.findUnique({ where: { key: courtEnv } });
      // cursor.year is null for a cursor saved before year-chunking existed
      // (its nextPage is a flat-scheme page number, e.g. the 3081 dead end —
      // not meaningful here, so start this year fresh at page 1 instead).
      const resuming = cursor?.year != null;
      let year = Number(process.env.INGEST_YEAR ?? (resuming ? cursor!.year : new Date().getFullYear()));
      let page = Number(process.env.INGEST_START_PAGE ?? (resuming ? cursor!.nextPage : 1));
      const MIN_YEAR = 1900;
      ctx.log(`Starting at year ${year}, page ${page}${resuming ? " (resumed)" : cursor ? " (previous flat-scheme cursor discarded)" : ""}`);

      const saveCursor = (y: number, p: number) =>
        prisma.ingestCursor.upsert({
          where: { key: courtEnv },
          create: { key: courtEnv, nextPage: p, year: y },
          update: { nextPage: p, year: y },
        });

      let pagesBudget = maxPages;
      while (pagesBudget > 0 && year >= MIN_YEAR) {
        let items: any[] = [];
        try {
          const data = await gql(LIST_QUERY, {
            input: {
              page, searchTerm, court: null, caseNumber: "", keywords: null,
              caseCategories: null, caseTypes: null, laws: null,
              dateFrom: `${year}-01-01`, dateTo: `${year}-12-31`, caseContact: "",
            },
          });
          items = data?.webVerdicts?.items ?? [];
          if (page === 1) ctx.log(`Year ${year}: ${data?.webVerdicts?.total ?? "unknown"} matching`);
        } catch (e) {
          stats.errors++;
          stats.errorSample = String(e);
          break;
        }

        if (items.length === 0) {
          // This year's exhausted (or had nothing to begin with) — move to
          // the previous year rather than burning the page budget re-asking.
          year--;
          page = 1;
          await saveCursor(year, page);
          continue;
        }

        ctx.log(`Page ${page} (${year}): ${items.length} cases`);
        if (items[0]) ctx.log(`  first: ${items[0].caseNumber} — ${items[0].court} — ${items[0].verdictDate}`);
        await processItems(items);

        page++;
        pagesBudget--;
        await saveCursor(year, page);
      }
      if (year < MIN_YEAR) ctx.log(`Reached the ${MIN_YEAR} cutoff — nothing earlier to check.`);
      ctx.log(`Cursor saved: next run for "(unfiltered)" resumes at year ${year}, page ${page}`);
      ctx.log(`Skip breakdown: no-court-match=${noCourtMatch}, no-pdf-found=${noPdf}, unchanged=${unchanged}`);
      return stats;
    }

    // Court-filtered sweep: flat, ever-advancing page number. Small enough
    // archives (Hæstiréttur topped out around page 1222) that the offset
    // cap above has never been observed to bite here.
    const cursor = await prisma.ingestCursor.findUnique({ where: { key: courtEnv } });
    const startPage = Number(process.env.INGEST_START_PAGE ?? cursor?.nextPage ?? 1);
    ctx.log(`Starting at page ${startPage}${process.env.INGEST_START_PAGE ? " (explicit override)" : cursor ? " (resumed)" : ""}`);

    // Persisted after every page (not just once at the end) so a run killed
    // partway through — a platform timeout, a restart — resumes close to
    // where it stopped instead of redoing the whole batch next time.
    const saveCursor = (nextPage: number) =>
      prisma.ingestCursor.upsert({
        where: { key: courtEnv },
        create: { key: courtEnv, nextPage },
        update: { nextPage },
      });

    let page = startPage;
    const lastPage = startPage + maxPages - 1;
    while (page <= lastPage) {
      let items: any[] = [];
      try {
        const data = await gql(LIST_QUERY, {
          input: {
            page,
            searchTerm,
            court: court.length ? court : null,
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
      await processItems(items);
      page++;
      await saveCursor(page);
    }
    await saveCursor(page);
    ctx.log(`Cursor saved: next run for "${courtEnv || "(unfiltered)"}" resumes at page ${page}`);
    ctx.log(`Skip breakdown: no-court-match=${noCourtMatch}, no-pdf-found=${noPdf}, unchanged=${unchanged}`);
    return stats;
  },
};
