import { load } from "cheerio";
import pdfParse from "pdf-parse";
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
    // pdf-parse emits one line per line of the page. Reflowing into real
    // paragraphs (rather than the flat whitespace-collapse this used to do)
    // is what lets the document page render the judgment as prose instead of
    // one unbroken wall of text.
    return normalizeJudgmentText(text);
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

    // Shared per-item handling for both the flat-paged and year-chunked loops
    // below: bucket by court, fetch the verdict text, upsert it.
    const processItems = async (items: any[]) => {
      for (const it of items) {
        try {
          const sourceKey = courtToSourceKey(it.court ?? "");
          if (!sourceKey) {
            stats.skipped++;
            noCourtMatch++;
            if (it.court) unmatchedCourts.add(it.court);
            continue;
          }

          const officialUrl = verdictUrl(it.id);
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
          // Not one of our three courts — neither new nor known, so it must
          // not count towards the stop condition either way.
          if (!sourceKey) { stats.skipped++; noCourtMatch++; continue; }

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
    if (process.env.INGEST_MODE === "gaps") {
      const known = new Set(
        (
          await prisma.document.findMany({
            where: { source: { in: icelandicCourtsAdapter.sourceKeys } },
            select: { officialUrl: true },
          })
        ).map((d) => d.officialUrl)
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
      ctx.log(`Gap sweep over ${targets.length} court(s); ${known.size} cases already stored`);

      const stillEmpty: string[] = [];

      for (const target of targets) {
        let seen = 0;
        let missingHere = 0;
        let page = 1;
        const lastPage = Number(process.env.INGEST_MAX_PAGES ?? Infinity);

        while (page <= lastPage) {
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
            if (page === 1) ctx.log(`${target.name}: feed reports ${data?.webVerdicts?.total ?? "?"} cases`);
          } catch (e) {
            stats.errors++;
            stats.errorSample = stats.errorSample ?? String(e);
            ctx.log(`  ${target.name} page ${page} failed: ${String(e).slice(0, 150)} — moving on`);
            break;
          }
          if (items.length === 0) break;
          seen += items.length;

          const missing = items.filter((it) => !known.has(verdictUrl(it.id)));
          for (const it of missing) {
            missingHere++;
            const before = stats.indexed;
            await processItems([it]);
            if (stats.indexed === before && courtToSourceKey(it.court ?? "")) {
              stillEmpty.push(`${it.court} ${it.caseNumber ?? it.id} (${verdictUrl(it.id)})`);
            } else {
              known.add(verdictUrl(it.id));
            }
          }
          page++;
        }

        ctx.log(`${target.name}: ${seen} seen, ${missingHere} were missing`);
      }

      ctx.log(
        `Gap sweep done: ${stats.indexed} newly indexed, ` +
          `no-court-match=${noCourtMatch}, no-text=${noPdf}`
      );
      if (unmatchedCourts.size) {
        ctx.log(`Courts with no source mapping (add them to courtToSourceKey): ${Array.from(unmatchedCourts).join(", ")}`);
      }
      if (stillEmpty.length) {
        ctx.log(`${stillEmpty.length} cases in the feed still yielded no text:`);
        for (const c of stillEmpty.slice(0, 50)) ctx.log(`  ${c}`);
        if (stillEmpty.length > 50) ctx.log(`  …and ${stillEmpty.length - 50} more`);
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
