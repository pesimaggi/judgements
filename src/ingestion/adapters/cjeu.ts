/**
 * The Court of Justice of the European Union — its judgments, from EUR-Lex.
 *
 * WHY THIS SOURCE EXISTS. The EEA Agreement is interpreted homogeneously with
 * EU law. The EFTA Court follows the Court of Justice, Icelandic courts follow
 * both, and a directive incorporated into the Agreement means here what the
 * Court of Justice says it means. This app already carried the directives and
 * the EFTA Court; the half both of those defer to was missing.
 *
 * TWO COURTS, TWO SOURCES. The Court of Justice (~21,200 judgments) and the
 * General Court (~12,200) are separate boxes in the search panel, because they
 * are separate courts and because a researcher after a preliminary ruling on a
 * directive should not have to wade through EU trade-mark appeals to find it.
 * `CJEU_TYPES=CJ` drops the General Court entirely.
 *
 * JUDGMENTS ONLY. Sector 6 also holds orders (`CO`, `TO`), Advocate General
 * opinions (`CC`) and the wound-up Civil Service Tribunal (`FJ`). An order is
 * procedure, an opinion is not the Court speaking, and staff cases of a court
 * abolished in 2016 are nobody's research here. See parseCaseCelex.
 *
 * HOW IT RUNS. Two passes, priced differently, in the shape the other large
 * archives here use:
 *
 *   INGEST_MODE=listing — one SPARQL query per calendar year, newest year
 *     first from a cursor, writing a "pending" gap row for every judgment not
 *     already held. No document fetches at all.
 *   the default pass   — the gap ledger and nothing else: one Cellar request
 *     per outstanding judgment until INGEST_MAX_CASES is spent. First attempts
 *     and re-attempts are rows in one queue, ordered by how often they have
 *     failed, so a judgment that keeps failing cannot monopolise a run.
 *
 * The whole corpus is about 33,000 judgments, so a cold start is days of
 * polite fetching. That is why the listing sweeps newest-first: the case law
 * anyone is looking for arrives first, and the 1950s arrive last.
 */
import { prisma } from "@/lib/db";
import { normalizeJudgmentText } from "@/lib/judgment-text";
import { CELLAR_HEADERS, celexTextFromHtml, cellarTextUrl } from "@/lib/eur-lex";
import {
  CJEU_COURTS,
  caseLawUrl,
  composeCaseTitle,
  parseCaseCelex,
  parseCaseTitle,
  type CjeuLetters,
} from "@/lib/cjeu";
import { listJudgments } from "../eurlex-sparql";
import {
  politeFetchText,
  type IngestionAdapter,
  type IngestContext,
  type IngestStats,
} from "../adapter";

/** Which courts to sweep, as CELEX instrument letters. */
const TYPES = (process.env.CJEU_TYPES ?? "CJ,TJ")
  .split(",")
  .map((t) => t.trim().toUpperCase())
  .filter((t): t is CjeuLetters => t in CJEU_COURTS);

/** The first case year swept. The Court's first judgments are from 1954. */
const FIRST_YEAR = Number(process.env.CJEU_FIRST_YEAR ?? 1954);

/** Cursor key for the listing sweep, in the table the court sweeps use. */
const CURSOR_KEY = "cjeu-listing";

/**
 * Below this a judgment is recorded as a gap rather than stored. Cellar
 * answers a throttled or unavailable request with a short body and a 2xx, and
 * the shortest real judgment runs to several thousand characters.
 */
const MIN_JUDGMENT_CHARS = 900;

const SOURCE_KEYS = Object.values(CJEU_COURTS).map((court) => court.source);

/**
 * Seeds the ledger from EUR-Lex's listing, newest case year first.
 *
 * A judgment already stored is not queued again, and neither is one already in
 * the ledger — matched on its CELEX, which is what the row is keyed by, so a
 * re-listed year writes nothing.
 */
async function runListing(ctx: IngestContext, stats: IngestStats): Promise<void> {
  const thisYear = new Date().getUTCFullYear();
  const perRun = Math.max(1, Number(process.env.CJEU_YEARS_PER_RUN ?? 3));

  const cursor = await prisma.ingestCursor.findUnique({ where: { key: CURSOR_KEY } });
  let year =
    cursor?.year && cursor.year >= FIRST_YEAR && cursor.year <= thisYear ? cursor.year : thisYear;

  for (let swept = 0; swept < perRun; swept++) {
    if (year < FIRST_YEAR) {
      ctx.log(`Reached ${FIRST_YEAR}; starting the sweep again at ${thisYear}.`);
      year = thisYear;
    }
    try {
      const listed = await listJudgments(year, TYPES);
      // What is already accounted for: everything stored, and every ledger row
      // whether or not it has been tried.
      const urls = listed.map((judgment) => caseLawUrl(judgment.celex));
      const [stored, ledger] = await Promise.all([
        prisma.document.findMany({
          where: { source: { in: SOURCE_KEYS }, officialUrl: { in: urls } },
          select: { officialUrl: true },
        }),
        prisma.ingestGap.findMany({
          where: { source: { in: SOURCE_KEYS }, officialUrl: { in: urls } },
          select: { officialUrl: true },
        }),
      ]);
      const known = new Set([...stored, ...ledger].map((row) => row.officialUrl));

      let queued = 0;
      for (const judgment of listed) {
        const url = caseLawUrl(judgment.celex);
        if (known.has(url)) continue;
        const celex = parseCaseCelex(judgment.celex);
        if (!celex) continue;
        if (ctx.dryRun) {
          queued++;
          continue;
        }
        await ctx.recordGap({
          adapter: cjeuAdapter.key,
          source: celex.source,
          officialUrl: url,
          court: celex.court,
          caseNumber: celex.caseNumber,
          // EUR-Lex's own title, unaltered — not the one this app displays.
          // It is five fields in one string and the only statement of the
          // parties, the referring court and the Court's index terms; storing
          // the composed form here would throw all but the parties away before
          // the fetch pass could read them.
          title: judgment.title,
          date: judgment.date,
          reason: "pending",
          detail: judgment.ecli ? `ECLI ${judgment.ecli}` : null,
        });
        queued++;
      }
      stats.indexed += queued;
      ctx.log(`${year}: ${listed.length} judgment(s) listed, ${queued} queued.`);
    } catch (e) {
      stats.errors++;
      stats.errorSample = stats.errorSample ?? `${year}: ${String(e)}`;
      ctx.log(`  error on ${year}: ${String(e).slice(0, 200)}`);
    }
    year--;
  }

  if (!ctx.dryRun) {
    await prisma.ingestCursor.upsert({
      where: { key: CURSOR_KEY },
      create: { key: CURSOR_KEY, year, nextPage: 0 },
      update: { year },
    });
  }
  ctx.log(`Cursor: next run resumes at ${year < FIRST_YEAR ? thisYear : year}`);
}

/** The CELEX a ledger row's URL was built from. */
function celexFromUrl(url: string): string | null {
  return /CELEX[:%3A]+([0-9A-Z()]+)/i.exec(url)?.[1]?.toUpperCase() ?? null;
}

/** The fetch pass: one Cellar request per outstanding judgment. */
async function runFetch(ctx: IngestContext, stats: IngestStats): Promise<void> {
  const budget = Number(process.env.INGEST_MAX_CASES ?? 200);
  const open = await ctx.openGaps(SOURCE_KEYS);
  const held = await prisma.document.count({ where: { source: { in: SOURCE_KEYS } } });

  ctx.log(
    `${held} judgment(s) stored; ${open.length} outstanding. Up to ${budget} fetches this run.`
  );
  if (open.length === 0) {
    ctx.log("Nothing outstanding — no requests made. Run INGEST_MODE=listing to find more.");
    return;
  }

  let fetches = 0;
  for (const gap of open) {
    if (fetches >= budget) {
      ctx.log(`Reached INGEST_MAX_CASES=${budget}; ${open.length - fetches} left for next run.`);
      break;
    }
    const celexRaw = celexFromUrl(gap.officialUrl);
    const celex = celexRaw ? parseCaseCelex(celexRaw) : null;
    if (!celex) {
      // The row cannot name a judgment, so nothing can fetch it. Left in the
      // ledger rather than deleted: a row that needs a human should stay
      // visible until it gets one.
      ctx.log(`  skipped a ledger row with no case CELEX: ${gap.officialUrl}`);
      continue;
    }
    fetches++;

    const identity = {
      adapter: cjeuAdapter.key,
      source: celex.source,
      officialUrl: gap.officialUrl,
      court: celex.court,
      caseNumber: celex.caseNumber,
      title: gap.title ?? celex.caseNumber,
      date: gap.date ?? null,
    };

    try {
      const html = await politeFetchText(cellarTextUrl(celex.celex), CELLAR_HEADERS);
      const body = normalizeJudgmentText(celexTextFromHtml(html));
      if (body.length < MIN_JUDGMENT_CHARS) {
        stats.skipped++;
        await ctx.recordGap({
          ...identity,
          reason: "no-text",
          detail: body.length
            ? `the judgment extracted only ${body.length} chars`
            : "the judgment extracted no text at all",
        });
        continue;
      }

      // The ledger carries what the listing knew: the composed title and the
      // date. Its own text is the body; everything else about a judgment is
      // stated in the title EUR-Lex gives it, which the listing already read.
      const parsed = parseCaseTitle(gap.title ?? "");
      const result = await ctx.save({
        source: celex.source,
        court: celex.court,
        caseNumber: celex.caseNumber,
        caseName: parsed.parties ?? undefined,
        // What a result list is scanned for: the case number, then who it was
        // between. EUR-Lex's own title opens with "Judgment of the Court
        // (Grand Chamber) of 21 December 2016", which identifies nothing.
        title: composeCaseTitle(celex.caseNumber, parsed),
        date: gap.date ?? undefined,
        year: gap.date?.getUTCFullYear() ?? celex.year,
        language: "en",
        // The Court's own index terms, so a judgment is findable by what it is
        // about and not only by the words in it.
        subjectTags: parsed.keywords,
        officialUrl: gap.officialUrl,
        fullText: body,
      });
      if (result === "indexed") stats.indexed++;
      else stats.skipped++;
    } catch (e) {
      stats.errors++;
      stats.errorSample = stats.errorSample ?? `${celex.caseNumber}: ${String(e)}`;
      ctx.log(`  ${celex.caseNumber}: ${String(e).slice(0, 140)}`);
      await ctx.recordGap({ ...identity, reason: "fetch-failed", detail: String(e).slice(0, 300) });
    }
  }

  ctx.log(`${fetches} judgment(s) fetched.`);
}

export const cjeuAdapter: IngestionAdapter = {
  key: "cjeu",
  name: "Court of Justice of the European Union (EUR-Lex)",
  sourceKeys: SOURCE_KEYS,

  async run(ctx: IngestContext): Promise<IngestStats> {
    const stats: IngestStats = { indexed: 0, skipped: 0, errors: 0 };
    if (TYPES.length === 0) {
      ctx.log("CJEU_TYPES names no court this adapter knows — nothing to do.");
      return stats;
    }

    if ((process.env.INGEST_MODE ?? "") === "listing") await runListing(ctx, stats);
    else await runFetch(ctx, stats);

    return stats;
  },
};
