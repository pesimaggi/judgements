import { load } from "cheerio";
import { pdfText } from "../pdf-text";
import { prisma } from "@/lib/db";
import { normalizeJudgmentText } from "@/lib/judgment-text";
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
/** Base for case detail pages. Overridable alongside ISLAND_IS_GRAPHQL so the
 *  adapter can be pointed at a stand-in during testing. */
const SITE_BASE = process.env.ISLAND_IS_BASE ?? "https://island.is";
const verdictUrl = (id: string) => `${SITE_BASE}/domar/${id}`;

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

/** The listing fields a detail page carries in its own right. */
interface VerdictMeta {
  court: string | null;
  caseNumber: string | null;
  title: string | null;
  verdictDate: string | null;
  keywords: string[];
}

/**
 * Fetches a case's detail page once and returns both its full text — from an
 * embedded PDF (older, scanned cases) or a Contentful-style rich-text document
 * (newer cases, authored directly rather than scanned) — and the listing
 * fields the same payload carries.
 *
 * Returning both matters for the retry sweep, which works from the gap ledger
 * rather than from a listing: it has a URL and needs the metadata, and this
 * way that costs one rate-limited fetch instead of two.
 */
async function fetchVerdict(
  ctx: IngestContext,
  officialUrl: string
): Promise<{ text: string; meta: VerdictMeta }> {
  const empty: VerdictMeta = { court: null, caseNumber: null, title: null, verdictDate: null, keywords: [] };
  const html = await ctx.fetchText(officialUrl);
  const $ = load(html);
  const nextDataRaw = $("#__NEXT_DATA__").html();
  if (!nextDataRaw) {
    ctx.log(`  no __NEXT_DATA__ found (html length ${html.length})`);
    return { text: "", meta: empty };
  }
  const nextData = JSON.parse(nextDataRaw);
  const item = findByTypename(nextData, "WebVerdictByIdItem");
  if (!item) {
    ctx.log(`  no WebVerdictByIdItem found (__NEXT_DATA__ ${nextDataRaw.length} chars)`);
    return { text: "", meta: empty };
  }

  const meta: VerdictMeta = {
    court: typeof item.court === "string" ? item.court : null,
    caseNumber: typeof item.caseNumber === "string" ? item.caseNumber : null,
    title: typeof item.title === "string" ? item.title : null,
    verdictDate: typeof item.verdictDate === "string" ? item.verdictDate : null,
    keywords: Array.isArray(item.keywords) ? (item.keywords as string[]) : [],
  };

  if (typeof item.pdfString === "string" && item.pdfString.length > 0) {
    const text = await pdfText(Buffer.from(item.pdfString, "base64"));
    // pdf-parse emits one line per line of the page. Reflowing into real
    // paragraphs (rather than the flat whitespace-collapse this used to do)
    // is what lets the document page render the judgment as prose instead of
    // one unbroken wall of text.
    return { text: normalizeJudgmentText(text), meta };
  }

  const richText = item.richText as Record<string, unknown> | undefined;
  if (richText && typeof richText === "object") {
    const text = extractRichText(richText.document).replace(/\n{2,}/g, "\n").trim();
    if (text) return { text, meta };
  }

  ctx.log(`  neither pdfString nor richText yielded text (fields: ${Object.keys(item).join(", ")})`);
  return { text: "", meta };
}

/** The full text alone, for callers with no use for the metadata. */
async function fetchVerdictText(ctx: IngestContext, officialUrl: string): Promise<string> {
  return (await fetchVerdict(ctx, officialUrl)).text;
}

/**
 * Source key used for a gap whose court we cannot map. Not a real source (it
 * has no row in src/lib/sources.ts and nothing is ever stored under it) — it
 * exists so an unmapped court lands in the ledger as a visible, named row
 * instead of vanishing into a skip counter, which is exactly how every
 * Endurupptökudómur case stayed invisible until someone counted the front page.
 */
export const UNMAPPED_SOURCE = "_unmapped";

/** Maps island.is court names onto our per-court source keys. */
export function courtToSourceKey(court: string): string | null {
  const c = court.toLowerCase();
  if (c.includes("hæstirétt") || c.includes("haestirett")) return "haestirettur";
  if (c.includes("landsrétt") || c.includes("landsrett")) return "landsrettur";
  if (c.includes("héraðsdóm") || c.includes("heradsdom")) return "heradsdomar";
  if (c.includes("endurupptöku") || c.includes("endurupptoku")) return "endurupptokudomur";
  return null;
}

/** The number of cases the feed reports for a court filter (null = all courts). */
async function courtTotal(court: string[] | null): Promise<number> {
  const data = await gql(LIST_QUERY, {
    input: {
      page: 1, searchTerm: "", court, caseNumber: "", keywords: null,
      caseCategories: null, caseTypes: null, laws: null, dateFrom: null,
      dateTo: null, caseContact: "",
    },
  });
  return Number(data?.webVerdicts?.total ?? 0);
}

/**
 * The `court` values this API accepts. They are *slugs*, not the court names
 * the API returns — and a value it does not recognise answers 0 rather than
 * erroring, so a wrong guess is silent.
 *
 * Found by reading what island.is/domar's own page sends: filtering the UI to
 * one district court issues `webVerdicts(input: { court: ["hd-reykjavik"] })`.
 * Every value below was then confirmed against the live endpoint, and the
 * totals sum to exactly the 43,222 the unfiltered feed reports:
 *
 *   Hæstiréttur           12,221   (the one court keyed by its display name;
 *                                   the "haestirettur" slug matches nothing)
 *   landsrettur            6,420
 *   endurupptokudomur        102
 *   the eight hd-* courts  24,479
 *
 * Covering the whole feed with per-court filters is not only about totals.
 * The unfiltered search caps how deep it will paginate — a page around 3,081
 * returned nothing while still reporting thousands of matches, the classic
 * fixed result-window symptom — so a single unfiltered walk cannot reach the
 * end of a 43k archive. Every filter below is comfortably inside that window
 * (the largest, hd-reykjavik, is ~653 pages of 20), which is what makes a
 * complete sweep possible at all.
 */
export const COURT_FILTERS: { key: string; filter: string; name: string }[] = [
  { key: "haestirettur", filter: "Hæstiréttur", name: "Hæstiréttur" },
  { key: "landsrettur", filter: "landsrettur", name: "Landsréttur" },
  { key: "endurupptokudomur", filter: "endurupptokudomur", name: "Endurupptökudómur" },
  { key: "heradsdomar", filter: "hd-reykjavik", name: "Héraðsdómur Reykjavíkur" },
  { key: "heradsdomar", filter: "hd-reykjanes", name: "Héraðsdómur Reykjaness" },
  { key: "heradsdomar", filter: "hd-vesturland", name: "Héraðsdómur Vesturlands" },
  { key: "heradsdomar", filter: "hd-vestfirdir", name: "Héraðsdómur Vestfjarða" },
  { key: "heradsdomar", filter: "hd-nordurland-vestra", name: "Héraðsdómur Norðurlands vestra" },
  { key: "heradsdomar", filter: "hd-nordurland-eystra", name: "Héraðsdómur Norðurlands eystra" },
  { key: "heradsdomar", filter: "hd-austurland", name: "Héraðsdómur Austurlands" },
  { key: "heradsdomar", filter: "hd-sudurland", name: "Héraðsdómur Suðurlands" },
];


/**
 * Refreshes Source.totalAvailable for each court, powering the front-page
 * ingestion progress bar.
 *
 * Every total is now a number the feed actually reports for a court, summed
 * where a source covers several (the eight district courts share one source).
 * Nothing is derived by subtracting one court from another: that is what let
 * a single wrong filter value corrupt a second court's figure, since the
 * remainder silently absorbed whatever the failed lookup did not account for.
 *
 * A total of 0 is never written. The filter answers 0 for a value it does not
 * recognise rather than erroring, so 0 means "we asked wrong", not "this court
 * has no cases" — storing it is what produced the "6,321 / 0" bar.
 *
 * Best-effort: failures are logged and swallowed so a totals hiccup never
 * fails the ingestion run itself.
 */
export async function syncAvailableTotals(ctx: IngestContext): Promise<void> {
  try {
    const all = await courtTotal(null);

    const totals = new Map<string, number>();
    const failed: string[] = [];
    for (const { key, filter, name } of COURT_FILTERS) {
      const n = await courtTotal([filter]);
      if (n <= 0) {
        // Never fold a zero into a source's total: it would understate a
        // court that shares its source with others, silently and forever.
        failed.push(`${name} (${filter})`);
        continue;
      }
      totals.set(key, (totals.get(key) ?? 0) + n);
    }

    if (failed.length) {
      ctx.log(`  totals: no cases matched for ${failed.join(", ")} — those courts were left out`);
    }

    const summed = Array.from(totals.values()).reduce((a, b) => a + b, 0);
    if (all > 0 && summed !== all) {
      // The per-court filters are meant to partition the feed exactly. If they
      // stop doing so, a court has been added or a slug has changed, and the
      // progress bars are about to be quietly wrong.
      ctx.log(
        `  totals: per-court figures sum to ${summed} but the feed reports ${all} ` +
          `(${all - summed} unaccounted for) — COURT_FILTERS is out of date`
      );
    }

    const written: string[] = [];
    for (const [key, value] of totals) {
      await prisma.source.updateMany({ where: { key }, data: { totalAvailable: value } });
      written.push(`${key}=${value}`);
    }
    ctx.log(`Totals synced: ${written.join(" ") || "(none)"} (feed reports ${all})`);
  } catch (e) {
    ctx.log(`Totals sync failed (non-fatal): ${String(e).slice(0, 200)}`);
  }
}

export const icelandicCourtsAdapter: IngestionAdapter = {
  key: "icelandic-courts",
  name: "Icelandic courts (island.is/domar, GraphQL + embedded PDF)",
  sourceKeys: ["haestirettur", "landsrettur", "heradsdomar", "endurupptokudomur"],

  async run(ctx: IngestContext): Promise<IngestStats> {
    const stats: IngestStats = { indexed: 0, skipped: 0, errors: 0 };

    await syncAvailableTotals(ctx);

    // Diagnostic mode: fetch one known case directly, bypassing search/pagination.
    if (process.env.INGEST_TEST_ID) {
      const officialUrl = verdictUrl(process.env.INGEST_TEST_ID);
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
    // The names, not just the count. Endurupptökudómur went missing for as
    // long as it did because an unmapped court was only ever a number in a
    // summary line; a new court in the feed should name itself instead.
    const unmatchedCourts = new Set<string>();
    let noPdf = 0;
    let unchanged = 0;

    // Shared per-item handling for every loop below: bucket by court, fetch
    // the verdict text, upsert it.
    //
    // Every path that gives up on a case now writes an IngestGap row first.
    // Before that, a case lost to a one-off 503 was a `stats.skipped++` and a
    // line in a deploy log that scrolls away — indistinguishable from a case
    // that genuinely has no text, and never revisited by anything. That is the
    // whole mechanism behind an archive that sits at 99.6% forever. A
    // successful save clears the row again (see saveDocument), so the open
    // rows are exactly the work still outstanding.
    // `prefetched` lets a caller that has already paid for a case's detail
    // page (the retry sweep, which fetches it to recover the metadata the
    // ledger does not hold) pass the text straight in, rather than fetching
    // the same rate-limited page a second time.
    const processItems = async (items: any[], prefetched?: Map<string, string>) => {
      for (const it of items) {
        const officialUrl = verdictUrl(it.id);
        const sourceKey = courtToSourceKey(it.court ?? "");
        // Common identifying fields, so a gap row can be acted on directly
        // rather than just counted.
        const identity = {
          adapter: icelandicCourtsAdapter.key,
          officialUrl,
          court: it.court ?? null,
          caseNumber: it.caseNumber ?? null,
          title: it.title ?? null,
          date: it.verdictDate ? new Date(it.verdictDate) : null,
        };

        try {
          if (!sourceKey) {
            stats.skipped++;
            noCourtMatch++;
            if (it.court) unmatchedCourts.add(it.court);
            // Filed under a reserved key rather than dropped: a court we do
            // not map yet is precisely the failure that hid Endurupptökudómur
            // for months, and it should be a row someone can see, not a
            // number in a summary line.
            await ctx.recordGap({
              ...identity,
              source: UNMAPPED_SOURCE,
              reason: "unmapped-court",
              detail: `no source key for court "${it.court ?? ""}"`,
            });
            continue;
          }

          const fullText = prefetched?.get(officialUrl) ?? (await fetchVerdictText(ctx, officialUrl));
          if (!fullText) {
            stats.skipped++;
            noPdf++;
            await ctx.recordGap({
              ...identity,
              source: sourceKey,
              reason: "no-text",
              detail: "detail page yielded neither pdfString nor richText",
            });
            continue;
          }

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
          await ctx.recordGap({
            ...identity,
            source: sourceKey ?? UNMAPPED_SOURCE,
            // A fetch that threw is the transient case worth retrying hardest;
            // anything else is a genuine bug until proven otherwise.
            reason: /HTTP \d+|fetch failed|ETIMEDOUT|ECONNRESET/i.test(String(e))
              ? "fetch-failed"
              : "error",
            detail: String(e).slice(0, 300),
          });
        }
      }
    };

    // Incremental sweep (INGEST_MODE=recent): what the scheduled weekly run
    // uses now that the archive is largely backfilled. Walks the newest-first
    // feed and stops once it has seen a run of cases it already holds, so a
    // normal week costs a handful of list queries rather than a full crawl.
    //
    // Deliberately different from the backfill sweeps in one way: a case
    // that's already stored is skipped *before* its detail page is fetched.
    // That fetch is the rate-limited, expensive part, and re-fetching it just
    // to hash the text and find nothing changed is what made a "check for new
    // cases" run cost as much as a backfill run. The trade-off is that an
    // after-the-fact correction to a judgment already stored won't be picked
    // up — set INGEST_RECHECK_KNOWN=1 (or run a backfill sweep) for that.
    if (process.env.INGEST_MODE === "recent") {
      const stopAfterKnown = Number(process.env.INGEST_STOP_AFTER_KNOWN ?? 40);
      const recheckKnown = process.env.INGEST_RECHECK_KNOWN === "1";
      ctx.log(
        `Incremental sweep: up to ${maxPages} pages, stopping after ${stopAfterKnown} ` +
          `consecutive already-stored cases${recheckKnown ? " (re-checking known cases)" : ""}`
      );

      let consecutiveKnown = 0;
      let alreadyStored = 0;
      let page = 1;

      pages: while (page <= maxPages) {
        let items: any[] = [];
        try {
          const data = await gql(LIST_QUERY, {
            input: {
              page, searchTerm, court: court.length ? court : null, caseNumber: "",
              keywords: null, caseCategories: null, caseTypes: null, laws: null,
              dateFrom: null, dateTo: null, caseContact: "",
            },
          });
          items = data?.webVerdicts?.items ?? [];
          if (page === 1) ctx.log(`Feed reports ${data?.webVerdicts?.total ?? "unknown"} cases in total`);
        } catch (e) {
          stats.errors++;
          stats.errorSample = String(e);
          break;
        }
        if (items.length === 0) break;
        ctx.log(`Page ${page}: ${items.length} cases (newest: ${items[0]?.verdictDate ?? "?"})`);

        for (const it of items) {
          const sourceKey = courtToSourceKey(it.court ?? "");
          // Not one of our courts — neither new nor known, so it must not
          // count towards the stop condition either way. It does get a ledger
          // row: an unmapped court appearing in the newest cases is how a
          // newly created court would announce itself, and a counter alone is
          // how the last one stayed invisible.
          if (!sourceKey) {
            stats.skipped++;
            noCourtMatch++;
            if (it.court) unmatchedCourts.add(it.court);
            await ctx.recordGap({
              adapter: icelandicCourtsAdapter.key,
              source: UNMAPPED_SOURCE,
              officialUrl: verdictUrl(it.id),
              court: it.court ?? null,
              caseNumber: it.caseNumber ?? null,
              title: it.title ?? null,
              date: it.verdictDate ? new Date(it.verdictDate) : null,
              reason: "unmapped-court",
              detail: `no source key for court "${it.court ?? ""}"`,
            });
            continue;
          }

          const officialUrl = verdictUrl(it.id);
          if (!recheckKnown && (await ctx.isKnown(sourceKey, officialUrl))) {
            stats.skipped++;
            alreadyStored++;
            if (++consecutiveKnown >= stopAfterKnown) {
              ctx.log(`Reached ${stopAfterKnown} consecutive already-stored cases — caught up.`);
              break pages;
            }
            continue;
          }
          consecutiveKnown = 0;
          await processItems([it]);
        }
        page++;
      }

      ctx.log(`Skip breakdown: already-stored=${alreadyStored}, no-court-match=${noCourtMatch}, no-pdf-found=${noPdf}, unchanged=${unchanged}`);
      if (unmatchedCourts.size) {
        ctx.log(`Courts with no source mapping (add them to courtToSourceKey): ${Array.from(unmatchedCourts).join(", ")}`);
      }
      return stats;
    }

    // Gap sweep (INGEST_MODE=gaps): the mode that actually finishes the
    // archive. The backfill sweeps ran to completion, but a case whose text
    // could not be extracted was skipped and never revisited, and the weekly
    // `recent` sweep stops after a run of known cases so it never reaches
    // back to them. The result is a permanent shortfall against the feed's
    // own totals — a couple of hundred cases across the courts, plus every
    // Endurupptökudómur case for as long as courtToSourceKey ignored it.
    //
    // This walks the whole feed and fetches only what is missing. The list
    // queries are the cheap part: they go over GraphQL without the polite
    // delay that rate-limits detail pages, so a full pass over 43k cases in
    // pages of 20 is minutes, and only the genuine gaps cost a real fetch.
    //
    // Cases that still yield no text are reported individually rather than
    // just counted, because after this sweep they are the entire remaining
    // difference between what the feed claims and what we hold.
    // Gap sweep (INGEST_MODE=gaps): the mode that actually finishes the
    // archive. The backfill sweeps ran to completion, but a case whose text
    // could not be extracted was skipped and never revisited, and the weekly
    // `recent` sweep stops after a run of known cases so it never reaches
    // back to them. The result was a permanent shortfall against the feed's
    // own totals, plus every Endurupptökudómur case for as long as
    // courtToSourceKey ignored that court.
    //
    // Walks court by court rather than the whole feed at once. That is not a
    // tidiness choice: the unfiltered search will not paginate past roughly
    // page 3,081, so no single unfiltered walk can reach the end of a 43k
    // archive. Each per-court filter is well inside that window.
    //
    // The list queries are the cheap part — they go over GraphQL without the
    // polite delay that rate-limits detail pages — so only genuine gaps cost
    // a real fetch. Cases that still yield no text are reported individually,
    // because after this sweep they are the entire remaining difference
    // between what the feed claims and what we hold.
    // Retry sweep (INGEST_MODE=retry): work the gap ledger and nothing else.
    //
    // This is the mode that actually closes the archive over time, and the
    // reason the ledger exists. It touches no listings at all — every case it
    // needs is already named in IngestGap — so it costs one detail fetch per
    // outstanding case and is cheap enough to run on every scheduled pass.
    // A case that succeeds is removed from the ledger by saveDocument; one
    // that fails again has its attempt count bumped and comes back next time.
    if (process.env.INGEST_MODE === "retry") {
      const budget = Number(process.env.INGEST_MAX_CASES ?? 500);
      const maxAttempts = Number(process.env.INGEST_GAP_MAX_ATTEMPTS ?? 8);

      const gaps = (await ctx.openGaps([...icelandicCourtsAdapter.sourceKeys, UNMAPPED_SOURCE]))
        // A case that has failed this many times is not going to start working
        // because we asked once more; leave it in the ledger as the honest
        // record of what this archive cannot reach, and spend the budget on
        // cases that might still land.
        .filter((g) => g.attempts < maxAttempts)
        .slice(0, budget);

      if (gaps.length === 0) {
        ctx.log(`Retry sweep: no outstanding gaps under ${maxAttempts} attempts — nothing to do.`);
        return stats;
      }
      ctx.log(`Retry sweep: ${gaps.length} outstanding gap(s) to re-attempt (budget ${budget})`);

      for (const gap of gaps) {
        // The ledger stores the case's URL, not its feed row, and the detail
        // page carries everything a save needs — so ask the feed for the row
        // by case number only when the court is one we could not map, where
        // the mapping (not the text) was the problem.
        const id = gap.officialUrl.split("/").pop() ?? "";
        let text = "";
        let meta: VerdictMeta = {
          court: gap.court, caseNumber: gap.caseNumber, title: null, verdictDate: null, keywords: [],
        };
        try {
          const fetched = await fetchVerdict(ctx, gap.officialUrl);
          text = fetched.text;
          // Prefer what the page says now; fall back to what the ledger
          // recorded when it was first seen.
          meta = {
            court: fetched.meta.court ?? gap.court,
            caseNumber: fetched.meta.caseNumber ?? gap.caseNumber,
            title: fetched.meta.title,
            verdictDate: fetched.meta.verdictDate,
            keywords: fetched.meta.keywords,
          };
        } catch (e) {
          stats.errors++;
          stats.errorSample = stats.errorSample ?? String(e);
          await ctx.recordGap({
            adapter: icelandicCourtsAdapter.key,
            source: gap.source,
            officialUrl: gap.officialUrl,
            court: gap.court,
            caseNumber: gap.caseNumber,
            reason: "fetch-failed",
            detail: String(e).slice(0, 300),
          });
          continue;
        }

        const prefetched = new Map<string, string>();
        if (text) prefetched.set(gap.officialUrl, text);
        await processItems([{ id, ...meta }], prefetched);
      }

      const left = await ctx.openGaps([...icelandicCourtsAdapter.sourceKeys, UNMAPPED_SOURCE]);
      ctx.log(`Retry sweep done: ${stats.indexed} recovered, ${left.length} gap(s) still open`);
      return stats;
    }

    // Gap sweep (INGEST_MODE=gaps): walks the feed court by court and fetches
    // only what is missing. This is what finishes an archive after a backfill
    // has left a tail behind — the weekly `recent` sweep stops after a run of
    // already-known cases, so it can never reach back to an older gap.
    //
    // Walks court by court rather than the whole feed at once. That is not a
    // tidiness choice: the unfiltered search will not paginate past roughly
    // page 3,081, so no single unfiltered walk can reach the end of a 43k
    // archive. Each per-court filter is well inside that window.
    //
    // Resumable. Each court keeps its own cursor (key "gaps:<filter>"),
    // persisted after every page, so a run cut short by a platform timeout
    // resumes where it stopped instead of re-walking from page 1 — which is
    // what made a full sweep something nobody could finish in one sitting.
    // A court that reaches the end wraps back to page 1, so repeated runs
    // keep re-verifying the archive rather than going quiet.
    if (process.env.INGEST_MODE === "gaps") {
      const known = new Set(
        (
          await prisma.document.findMany({
            where: { source: { in: icelandicCourtsAdapter.sourceKeys } },
            select: { officialUrl: true },
          })
        ).map((d) => d.officialUrl)
      );

      // Cases the ledger has already given up on. Without this the sweep
      // re-fetches every hopeless case on every pass, spending the
      // rate-limited detail-page budget on the one set of cases guaranteed
      // not to yield anything — which is what stops a repeated sweep from
      // converging. They stay in the ledger; they just stop costing a fetch.
      const maxAttempts = Number(process.env.INGEST_GAP_MAX_ATTEMPTS ?? 8);
      const exhausted = new Set(
        (await ctx.openGaps([...icelandicCourtsAdapter.sourceKeys, UNMAPPED_SOURCE]))
          .filter((g) => g.attempts >= maxAttempts)
          .map((g) => g.officialUrl)
      );

      // INGEST_COURT names one filter (e.g. hd-reykjavik) to sweep just that
      // court; otherwise every court is swept in turn.
      const targets = courtEnv
        ? COURT_FILTERS.filter((c) => c.filter === courtEnv || c.key === courtEnv)
        : COURT_FILTERS;
      if (targets.length === 0) {
        ctx.log(`INGEST_COURT="${courtEnv}" matches no known court filter. Known: ${COURT_FILTERS.map((c) => c.filter).join(", ")}`);
        return stats;
      }

      // Total list pages this run may walk, across all courts. Unbounded by
      // default (a full sweep is the point); set INGEST_MAX_PAGES to fit the
      // sweep into a scheduled run's window and let the cursors carry it over.
      let pageBudget = Number(process.env.INGEST_MAX_PAGES ?? Infinity);
      ctx.log(
        `Gap sweep over ${targets.length} court(s); ${known.size} cases already stored` +
          (exhausted.size ? `; ${exhausted.size} written off after ${maxAttempts} attempts` : "") +
          (Number.isFinite(pageBudget) ? `; page budget ${pageBudget}` : "")
      );

      for (const target of targets) {
        if (pageBudget <= 0) {
          ctx.log(`Page budget spent — remaining courts resume from their cursors next run.`);
          break;
        }

        const cursorKey = `gaps:${target.filter}`;
        const saved = await prisma.ingestCursor.findUnique({ where: { key: cursorKey } });
        let page = Number(process.env.INGEST_START_PAGE ?? saved?.nextPage ?? 1);
        const saveCursor = (next: number) =>
          prisma.ingestCursor.upsert({
            where: { key: cursorKey },
            create: { key: cursorKey, nextPage: next },
            update: { nextPage: next },
          });

        let seen = 0;
        let missingHere = 0;
        let wrapped = false;

        while (pageBudget > 0) {
          let items: any[] = [];
          try {
            const data = await gql(LIST_QUERY, {
              input: {
                page, searchTerm, court: [target.filter], caseNumber: "",
                keywords: null, caseCategories: null, caseTypes: null, laws: null,
                dateFrom: null, dateTo: null, caseContact: "",
              },
            });
            items = data?.webVerdicts?.items ?? [];
            if (seen === 0) ctx.log(`${target.name}: feed reports ${data?.webVerdicts?.total ?? "?"} cases (from page ${page})`);
          } catch (e) {
            stats.errors++;
            stats.errorSample = stats.errorSample ?? String(e);
            // Leave the cursor on the failing page so the next run retries it
            // rather than stepping over a court's worth of cases.
            ctx.log(`  ${target.name} page ${page} failed: ${String(e).slice(0, 150)} — moving on`);
            break;
          }

          if (items.length === 0) {
            // End of this court. Wrap so the next run re-verifies it from the
            // top instead of sitting past the end doing nothing forever.
            await saveCursor(1);
            wrapped = true;
            break;
          }

          seen += items.length;
          for (const it of items) {
            const url = verdictUrl(it.id);
            if (known.has(url) || exhausted.has(url)) continue;
            missingHere++;
            const before = stats.indexed;
            await processItems([it]);
            // Anything not indexed is now a row in the gap ledger (see
            // processItems), so it is retryable rather than merely logged.
            if (stats.indexed > before) known.add(verdictUrl(it.id));
          }

          page++;
          pageBudget--;
          await saveCursor(page);
        }

        ctx.log(
          `${target.name}: ${seen} seen this run, ${missingHere} were missing` +
            (wrapped ? " — reached the end, cursor wrapped to page 1" : `, cursor at page ${page}`)
        );
      }

      ctx.log(
        `Gap sweep done: ${stats.indexed} newly indexed, ` +
          `no-court-match=${noCourtMatch}, no-text=${noPdf}`
      );
      if (unmatchedCourts.size) {
        ctx.log(`Courts with no source mapping (add them to courtToSourceKey): ${Array.from(unmatchedCourts).join(", ")}`);
      }
      const open = await ctx.openGaps([...icelandicCourtsAdapter.sourceKeys, UNMAPPED_SOURCE]);
      if (open.length) {
        ctx.log(`${open.length} case(s) in the ledger still outstanding — run INGEST_MODE=retry to re-attempt them:`);
        for (const g of open.slice(0, 50)) ctx.log(`  [${g.reason}, ${g.attempts}x] ${g.court ?? "?"} ${g.caseNumber ?? ""} ${g.officialUrl}`);
        if (open.length > 50) ctx.log(`  …and ${open.length - 50} more`);
      }
      return stats;
    }

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
