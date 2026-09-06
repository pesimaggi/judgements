import { prisma } from "@/lib/db";
import {
  YFIRSKATTANEFND_SOURCE_KEY,
  boardName,
  composeRecord,
  ingestOrder,
  parseActiveYear,
  parseRuling,
  parseYearIndex,
  parseYears,
  rulingTitle,
  rulingUrl,
  yearIndexUrl,
  type IndexItem,
  type YsknBoard,
} from "@/lib/yfirskattanefnd";
import { type IngestionAdapter, type IngestContext, type IngestStats } from "../adapter";

/**
 * Yfirskattanefnd — yskn.is
 *
 * The tax appeal board, and with it the ríkisskattanefnd archive it carries:
 * **4,175 rulings back to 1973**, the largest Icelandic body this library was
 * missing. See src/lib/yfirskattanefnd.ts for what the site publishes, how the
 * two eras differ and why the ríkisskattanefnd rulings are the same source.
 *
 * THE INDEX IS ONE PAGE PER YEAR, and a listing page carries the list of years
 * as well as its own year's rulings. So the shape of a run is:
 *
 *   1 fetch   `/urskurdir/`            → the years, and the newest year's list
 *   53 more   `/urskurdir/?year=YYYY`  → every other year
 *   n fetches `/urskurdir/skoda-urskurd/?nr=<id>` → the rulings that are missing
 *
 * Listing the whole archive costs 54 requests and about 3.5 MB — the same
 * order as the single-page index Úrskurðarnefnd umhverfis- og auðlindamála
 * publishes — and it buys the same two properties: a run always knows exactly
 * what exists, and it needs no cursor to be resumable. `INGEST_MAX_CASES`
 * bounds the ruling fetches; each run diffs the whole archive against what is
 * stored and spends its budget on what is missing.
 *
 * NEW RULINGS DO NOT WAIT BEHIND THE BACKFILL. A plain "oldest missing first"
 * order would mean that on a cold start nothing published this year appears
 * until 1973–2025 is complete, which is a fortnight of runs. So the queue is
 * the current and previous years first, newest first, and everything older
 * after them, oldest first: the board's new rulings land on the first run that
 * sees them, and the backfill still advances from the far end each time.
 *
 * `INGEST_MODE=retry` works the gap ledger and fetches no listings at all.
 */

const BASE = (process.env.YFIRSKATTANEFND_BASE ?? "https://www.yskn.is").replace(/\/$/, "");

/**
 * Below this a page is recorded as a gap rather than stored as a ruling.
 *
 * Low on purpose. The oldest ríkisskattanefnd rulings are genuinely tiny — nr.
 * 262/1975 is 281 characters, the whole of it — and refusing them as empty
 * would drop real rulings on the ground. What this is actually guarding
 * against is a page that answered 200 with no ruling on it.
 */
const MIN_TEXT_CHARS = 120;

interface Listed extends IndexItem {
  /** The year whose listing it appeared in — the board's own filing. */
  year: number;
  url: string;
}

/** Every ruling the board publishes, listed year by year. */
async function listArchive(ctx: IngestContext): Promise<{ items: Listed[]; complete: boolean }> {
  const first = await ctx.fetchText(`${BASE}/urskurdir/`);
  const years = parseYears(first);
  if (years.length === 0) {
    throw new Error(
      `No year links on ${BASE}/urskurdir/ — the index could not be read, and an ` +
        `empty archive here is indistinguishable from "nothing new".`
    );
  }

  // Bounded only for a constrained one-off; the default lists everything.
  const budget = Math.max(1, Number(process.env.YSKN_INDEX_YEARS ?? years.length));
  const wanted = years.slice(0, budget);
  const complete = wanted.length === years.length;

  const collect = (html: string, year: number, into: Listed[]) => {
    for (const item of parseYearIndex(html)) {
      // The ruling number carries the board's own year for the ruling and is
      // the same thing the listing is filed under; the page's year is the
      // fallback for the rare row whose number could not be read.
      const own = Number(item.rulingNumber?.split("/")[1]);
      into.push({
        ...item,
        year: Number.isInteger(own) ? own : year,
        url: rulingUrl(BASE, item.id),
      });
    }
  };

  // The first fetch is already a year's listing — `/urskurdir/` answers with
  // one year selected — so that year is not fetched a second time.
  const items: Listed[] = [];
  const active = parseActiveYear(first) ?? wanted[0];
  collect(first, active, items);
  for (const year of wanted) {
    if (year === active) continue;
    collect(await ctx.fetchText(yearIndexUrl(BASE, year)), year, items);
  }

  ctx.log(
    `Listed ${items.length} ruling(s) across ${wanted.length} year(s) ` +
      `(${wanted[wanted.length - 1]}–${wanted[0]})${complete ? "" : " — YSKN_INDEX_YEARS is set, so this is a partial listing"}.`
  );
  return { items, complete };
}

async function recordTotal(total: number): Promise<void> {
  try {
    await prisma.source.updateMany({
      where: { key: YFIRSKATTANEFND_SOURCE_KEY },
      data: { totalAvailable: total },
    });
  } catch {
    // Bookkeeping only — never fail a run over it.
  }
}

export const yfirskattanefndAdapter: IngestionAdapter = {
  key: "yfirskattanefnd",
  name: "Yfirskattanefnd (yskn.is)",
  sourceKeys: [YFIRSKATTANEFND_SOURCE_KEY],

  async run(ctx: IngestContext): Promise<IngestStats> {
    const stats: IngestStats = { indexed: 0, skipped: 0, errors: 0 };
    const mode = process.env.INGEST_MODE || "recent";
    const maxFetches = Number(process.env.INGEST_MAX_CASES ?? 300);

    let fetches = 0;

    const ingestOne = async (item: {
      url: string;
      year?: number;
      rulingNumber?: string;
      board?: YsknBoard;
      /** What a gap row already recorded the deciding body as. */
      court?: string;
    }): Promise<void> => {
      fetches++;
      const identity = {
        adapter: "yfirskattanefnd",
        source: YFIRSKATTANEFND_SOURCE_KEY,
        officialUrl: item.url,
        court: item.court ?? boardName(item.board ?? "yfirskattanefnd"),
        caseNumber: item.rulingNumber ?? null,
        title: item.rulingNumber ? `Úrskurður nr. ${item.rulingNumber}` : item.url,
        date: null,
      };

      let html: string;
      try {
        html = await ctx.fetchText(item.url);
      } catch (e) {
        stats.errors++;
        stats.errorSample = stats.errorSample ?? String(e);
        ctx.log(`  ${item.rulingNumber ?? item.url}: ${String(e).slice(0, 140)}`);
        await ctx.recordGap({ ...identity, reason: "fetch-failed", detail: String(e).slice(0, 300) });
        return;
      }

      const ruling = parseRuling(html);
      if (!ruling || ruling.body.length < MIN_TEXT_CHARS) {
        stats.skipped++;
        await ctx.recordGap({
          ...identity,
          reason: "no-text",
          detail: ruling
            ? `div.resultcontainer held only ${ruling.body.length} chars`
            : "no div.resultcontainer on the page",
        });
        return;
      }

      try {
        const title = rulingTitle(ruling);
        const result = await ctx.save({
          source: YFIRSKATTANEFND_SOURCE_KEY,
          // The board that actually decided it. One source, two bodies: see
          // src/lib/yfirskattanefnd.ts.
          court: boardName(ruling.board),
          // The ruling number, which is how these are cited — "úrskurður
          // yfirskattanefndar nr. 107/2026". The board's own case number
          // ("mál nr. 1/2026") is a different thing and is in the record's
          // header, where it is findable but cannot be mistaken for this.
          caseNumber: ruling.rulingNumber ?? item.rulingNumber,
          title,
          date: ruling.date,
          // The listing's year, which is the board's own filing of the
          // ruling and is present for every ruling — unlike the date, which
          // only the rulings from 2016 on state at all.
          year: ruling.date?.getUTCFullYear() ?? item.year,
          language: "is",
          subjectTags: ruling.terms,
          officialUrl: item.url,
          fullText: composeRecord(ruling),
        });
        if (result === "indexed") stats.indexed++;
        else stats.skipped++;
      } catch (e) {
        stats.errors++;
        stats.errorSample = stats.errorSample ?? String(e);
        ctx.log(`  ${item.rulingNumber ?? item.url}: ${String(e).slice(0, 140)}`);
        await ctx.recordGap({ ...identity, reason: "error", detail: String(e).slice(0, 300) });
      }
    };

    // -----------------------------------------------------------------------
    // Retry sweep: the gap ledger and nothing else, no listing in front.
    // -----------------------------------------------------------------------
    if (mode === "retry") {
      const open = await ctx.openGaps([YFIRSKATTANEFND_SOURCE_KEY]);
      ctx.log(`Retry sweep: ${open.length} outstanding ruling(s); up to ${maxFetches} fetches.`);
      for (const gap of open) {
        if (fetches >= maxFetches) {
          ctx.log(`Reached INGEST_MAX_CASES=${maxFetches}; re-run to continue.`);
          break;
        }
        await ingestOne({
          url: gap.officialUrl,
          rulingNumber: gap.caseNumber ?? undefined,
          court: gap.court ?? undefined,
        });
      }
      ctx.log(`Retry sweep done: ${stats.indexed} recovered, ${stats.skipped} still without text.`);
      return stats;
    }

    // -----------------------------------------------------------------------
    // The whole archive, year by year, diffed against what is stored.
    // -----------------------------------------------------------------------
    const { items, complete } = await listArchive(ctx);
    if (complete) await recordTotal(items.length);

    const stored = new Set(
      (
        await prisma.document.findMany({
          where: { source: YFIRSKATTANEFND_SOURCE_KEY },
          select: { officialUrl: true },
        })
      ).map((d) => d.officialUrl)
    );
    // A ruling whose page can never be read is not one we are still missing:
    // without this it looks missing on every run and is re-fetched for ever.
    const terminal = await ctx.terminalGaps([YFIRSKATTANEFND_SOURCE_KEY]);

    const missing = items.filter((i) => !stored.has(i.url) && !terminal.has(i.url));
    stats.skipped += items.length - missing.length;
    ctx.log(
      `${items.length} listed, ${stored.size} stored, ${missing.length} missing. ` +
        `Up to ${maxFetches} fetches this run.`
    );

    for (const item of ingestOrder(missing, new Date().getUTCFullYear())) {
      if (fetches >= maxFetches) {
        ctx.log(`Reached INGEST_MAX_CASES=${maxFetches}; ${missing.length - fetches} left for next run.`);
        break;
      }
      await ingestOne(item);
    }

    const open = await ctx.openGaps([YFIRSKATTANEFND_SOURCE_KEY]);
    if (open.length) {
      ctx.log(`${open.length} ruling(s) outstanding — run INGEST_MODE=retry to re-attempt them.`);
      for (const g of open.slice(0, 25)) {
        ctx.log(`  [${g.reason}, ${g.attempts}x] ${g.caseNumber ?? ""} ${g.officialUrl}`);
      }
    }
    ctx.log(`${fetches} ruling page(s) fetched.`);
    return stats;
  },
};
