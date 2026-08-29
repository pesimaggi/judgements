import { load } from "cheerio";
import pdfParse from "pdf-parse";
import { prisma } from "@/lib/db";
import { normalizeJudgmentText } from "@/lib/judgment-text";
import {
  politeFetchBytes,
  type IngestionAdapter,
  type IngestContext,
  type IngestStats,
} from "../adapter";

/**
 * Áfrýjunarnefnd neytendamála — neytendastofa.is
 *
 * The appeal board for consumer law: it hears appeals against Neytendastofa's
 * own decisions on misleading advertising, price marking, unfair commercial
 * practices, product safety and the rest of the consumer-protection statutes.
 * About **230 rulings**. Nominally under Atvinnuvegaráðuneytið, but it
 * publishes on the agency whose decisions it reviews rather than through
 * stjornarradid.is, which is why it was missing.
 *
 * VERIFIED against the live site (August 2026):
 *
 *  - robots.txt disallows `/extensions/` and `/lisa/`. The index is
 *    `/akvardanir/urskurdir-afryjunarnefndar-neyte/` (reached through the
 *    `?PageID=` the site's own menu links) and the rulings are under
 *    `/library/Files/`, none of which is covered.
 *
 *  - **The index is one page and a plain table.** `table.propertytable` with a
 *    row per ruling: the case number, what the case was about, and a link to
 *    the PDF. No pagination, no JavaScript.
 *
 *  - **One fetch per ruling**, the PDF. There is no page per ruling, so the
 *    PDF is the officialUrl — as with Óbyggðanefnd.
 *
 * WHAT THE TABLE DOES NOT SAY IS THE DATE. Every link is labelled "Nánar" and
 * the table has no date column, so the ruling's own opening is the only source
 * for it: "Þann 1. mars 2026 er tekið fyrir mál áfrýjunarnefndar neytendamála
 * nr. 5/2025". That is worth reading rather than falling back on the case
 * number's year, because this board runs well behind — case 5/2025 was decided
 * in March 2026, and filing it under 2025 would put it in the wrong year for
 * every date filter in the app.
 */

const BASE = (process.env.NEYTENDAMAL_BASE ?? "https://www.neytendastofa.is").replace(/\/$/, "");
const INDEX_PATH = "/akvardanir/urskurdir-afryjunarnefndar-neyte/";

export const NEYTENDAMAL_SOURCE_KEY = "afryjunarnefnd-neytendamala";
export const NEYTENDAMAL_NAME = "Áfrýjunarnefnd neytendamála";

/** Below this a PDF is recorded as a gap rather than stored as a ruling. */
const MIN_TEXT_CHARS = 1_500;

/** The mojibake guard the other PDF adapters use. */
const ICELANDIC_CHARS_RE = /[áðéíóúýþæöÁÐÉÍÓÚÝÞÆÖ]/g;
const MIN_ICELANDIC_RATIO = 0.02;

function looksLikeIcelandic(text: string): boolean {
  return (text.match(ICELANDIC_CHARS_RE)?.length ?? 0) / Math.max(text.length, 1) >= MIN_ICELANDIC_RATIO;
}

const MONTHS: Record<string, number> = {
  janúar: 0, febrúar: 1, mars: 2, apríl: 3, maí: 4, júní: 5,
  júlí: 6, ágúst: 7, september: 8, október: 9, nóvember: 10, desember: 11,
};

/**
 * "Þann 1. mars 2026 er tekið fyrir mál áfrýjunarnefndar neytendamála nr.
 * 5/2025" — the board's own statement of when it sat on the case, and the only
 * date in the record. Newer rulings open "Hinn 8. október 2024 er tekið fyrir"
 * instead; both words are matched.
 *
 * Anchored on "Þann … er tekið fyrir" rather than looking for a date, because
 * the very next sentence names the date of the decision under appeal and the
 * one after that the date of the appeal itself. The month is closed with a
 * lookahead: `\b` is ASCII-only and does not fire after "júlí" or "maí".
 *
 * Every space in it is optional, because a handful of the scanned rulings lose
 * them: "Þann 5. maí2015 ertekið fyrirmáláfryjunamefndarneytendamála". That
 * costs nothing in precision — a month followed straight by four digits cannot
 * be anything else — and buys back a date that would otherwise be missing.
 */
const SITTING_DATE_RE = new RegExp(
  `(?:Þann|Hinn)\\s*(\\d{1,2})\\.\\s*(${Object.keys(MONTHS).join("|")})(?!\\p{L})\\s*(\\d{4})[^.]{0,80}?er\\s*tekið\\s*fyrir`,
  "iu"
);

/** How much of the ruling to read the date out of. It is the first clause. */
const OPENING_CHARS = 800;

export function sittingDate(body: string): Date | undefined {
  const m = SITTING_DATE_RE.exec(body.slice(0, OPENING_CHARS));
  if (!m) return undefined;
  const month = MONTHS[m[2].toLowerCase()];
  if (month === undefined) return undefined;
  const date = new Date(Date.UTC(Number(m[3]), month, Number(m[1])));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function squish(text: string): string {
  return text.replace(/[ ​ ]/g, " ").replace(/\s+/g, " ").trim();
}

interface IndexItem {
  /** The PDF, which for this board is the ruling itself. */
  url: string;
  /** "05/2025", as the board's own table numbers it. */
  caseNumber?: string;
  /** What the case was about, from the table's "Heiti" column. */
  name: string;
}

/** "05/2025", "5/2025" — the table's Nr. column. */
const CASE_NUMBER_RE = /^\s*(\d{1,3}\/\d{4})\s*$/;

/**
 * Every ruling in the index table.
 *
 * Rows are matched on having both a case number in the first cell and a PDF
 * link, which is what separates them from the header row and from the site
 * furniture around the table.
 */
export function parseIndex(html: string, base = BASE): IndexItem[] {
  const $ = load(html);
  const items: IndexItem[] = [];
  const seen = new Set<string>();

  $("table.propertytable tr").each((_, el) => {
    const cells = $(el).find("td");
    if (cells.length < 2) return;

    const caseNumber = CASE_NUMBER_RE.exec(squish(cells.eq(0).text()))?.[1];
    if (!caseNumber) return;

    const href = $(el).find('a[href*=".pdf"]').first().attr("href");
    if (!href) return;
    const url = href.startsWith("http") ? href : `${base}${href.startsWith("/") ? "" : "/"}${href}`;
    if (seen.has(url)) return;
    seen.add(url);

    items.push({ url, caseNumber, name: squish(cells.eq(1).text()).replace(/\.$/, "") });
  });

  return items;
}

/** The stored record: the board and the case above the ruling itself. */
function composeRecord(item: IndexItem, body: string): string {
  const lines: string[] = [NEYTENDAMAL_NAME];
  if (item.caseNumber) lines.push(`Mál nr. ${item.caseNumber}`);
  if (item.name) lines.push(item.name);
  lines.push("", "Úrskurður", body);
  return lines.join("\n");
}

async function recordTotal(total: number): Promise<void> {
  try {
    await prisma.source.updateMany({
      where: { key: NEYTENDAMAL_SOURCE_KEY },
      data: { totalAvailable: total },
    });
  } catch {
    // Bookkeeping only — never fail a run over it.
  }
}

export const neytendamalAdapter: IngestionAdapter = {
  key: "neytendamal",
  name: "Áfrýjunarnefnd neytendamála (neytendastofa.is)",
  sourceKeys: [NEYTENDAMAL_SOURCE_KEY],

  async run(ctx: IngestContext): Promise<IngestStats> {
    const stats: IngestStats = { indexed: 0, skipped: 0, errors: 0 };
    const mode = process.env.INGEST_MODE || "recent";
    const maxFetches = Number(process.env.INGEST_MAX_CASES ?? 120);

    let fetches = 0;

    const ingestOne = async (item: IndexItem): Promise<void> => {
      fetches++;
      const identity = {
        adapter: "neytendamal",
        source: NEYTENDAMAL_SOURCE_KEY,
        officialUrl: item.url,
        court: NEYTENDAMAL_NAME,
        caseNumber: item.caseNumber ?? null,
        title: item.name || (item.caseNumber ?? item.url),
        date: null,
      };

      let body: string;
      try {
        const { body: bytes } = await politeFetchBytes(item.url);
        body = normalizeJudgmentText((await pdfParse(bytes)).text);
      } catch (e) {
        stats.errors++;
        stats.errorSample = stats.errorSample ?? String(e);
        ctx.log(`  ${item.caseNumber ?? item.url}: ${String(e).slice(0, 140)}`);
        await ctx.recordGap({ ...identity, reason: "fetch-failed", detail: String(e).slice(0, 300) });
        return;
      }

      if (body.length < MIN_TEXT_CHARS || !looksLikeIcelandic(body)) {
        stats.skipped++;
        await ctx.recordGap({
          ...identity,
          reason: "no-text",
          detail:
            body.length < MIN_TEXT_CHARS
              ? `the PDF extracted only ${body.length} chars`
              : `the PDF extracted ${body.length} chars with almost no Icelandic in them`,
        });
        return;
      }

      try {
        const date = sittingDate(body);
        const title = item.name || `${NEYTENDAMAL_NAME} ${item.caseNumber ?? ""}`.trim();
        const result = await ctx.save({
          source: NEYTENDAMAL_SOURCE_KEY,
          court: NEYTENDAMAL_NAME,
          caseNumber: item.caseNumber,
          caseName: title,
          title,
          date,
          // The board publishes no index terms, so there are no subject tags to
          // store; an empty list is honest where a guess would not be.
          subjectTags: [],
          year: date?.getUTCFullYear(),
          language: "is",
          officialUrl: item.url,
          pdfUrl: item.url,
          fullText: composeRecord(item, body),
        });
        if (result === "indexed") stats.indexed++;
        else stats.skipped++;
      } catch (e) {
        stats.errors++;
        stats.errorSample = stats.errorSample ?? String(e);
        ctx.log(`  ${item.caseNumber ?? item.url}: ${String(e).slice(0, 140)}`);
        await ctx.recordGap({ ...identity, reason: "error", detail: String(e).slice(0, 300) });
      }
    };

    if (mode === "retry") {
      const open = await ctx.openGaps([NEYTENDAMAL_SOURCE_KEY]);
      ctx.log(`Retry sweep: ${open.length} outstanding ruling(s); up to ${maxFetches} fetches.`);
      for (const gap of open) {
        if (fetches >= maxFetches) {
          ctx.log(`Reached INGEST_MAX_CASES=${maxFetches}; re-run to continue.`);
          break;
        }
        await ingestOne({ url: gap.officialUrl, caseNumber: gap.caseNumber ?? undefined, name: "" });
      }
      ctx.log(`Retry sweep done: ${stats.indexed} recovered, ${stats.skipped} still unread.`);
      return stats;
    }

    const items = parseIndex(await ctx.fetchText(`${BASE}${INDEX_PATH}`), BASE);
    if (items.length === 0) {
      throw new Error(
        `No rulings in table.propertytable on ${BASE}${INDEX_PATH} — the index could not ` +
          `be read, and an empty list here is indistinguishable from "nothing new".`
      );
    }
    await recordTotal(items.length);

    const known = new Set(
      (
        await prisma.document.findMany({
          where: { source: NEYTENDAMAL_SOURCE_KEY },
          select: { officialUrl: true },
        })
      ).map((d) => d.officialUrl)
    );
    const missing = items.filter((i) => !known.has(i.url));
    stats.skipped += items.length - missing.length;
    ctx.log(
      `Index lists ${items.length} ruling(s); ${known.size} stored, ${missing.length} missing. ` +
        `Up to ${maxFetches} fetches this run.`
    );

    // Oldest first, as elsewhere, so a bounded run always covers new ground.
    for (const item of missing.reverse()) {
      if (fetches >= maxFetches) {
        ctx.log(`Reached INGEST_MAX_CASES=${maxFetches}; ${missing.length - fetches} left for next run.`);
        break;
      }
      await ingestOne(item);
    }

    const open = await ctx.openGaps([NEYTENDAMAL_SOURCE_KEY]);
    if (open.length) {
      ctx.log(`${open.length} ruling(s) outstanding — run INGEST_MODE=retry to re-attempt them.`);
      for (const g of open.slice(0, 25)) {
        ctx.log(`  [${g.reason}, ${g.attempts}x] ${g.caseNumber ?? ""} ${g.officialUrl}`);
      }
    }
    ctx.log(`${fetches} ruling(s) fetched.`);
    return stats;
  },
};
