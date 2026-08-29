import { load, type Cheerio } from "cheerio";
import type { AnyNode } from "domhandler";
import { prisma } from "@/lib/db";
import { normalizeJudgmentText } from "@/lib/judgment-text";
import { type IngestionAdapter, type IngestContext, type IngestStats } from "../adapter";

/**
 * Úrskurðarnefnd umhverfis- og auðlindamála — uua.is
 *
 * Planning, building and environmental appeals: the board that rules on
 * byggingarleyfi, framkvæmdaleyfi, deiliskipulag, starfsleyfi and, lately, on
 * fish farming. About **3,000 rulings back to 1998**, which makes it the
 * largest single body in the app after Kærunefnd útlendingamála — and it was
 * missing entirely, because unlike the forty boards in src/lib/adr-boards.ts
 * it does not publish through stjornarradid.is. It publishes for itself.
 *
 * The board is the successor to úrskurðarnefnd skipulags- og byggingarmála and
 * carries that body's rulings as its own archive, which is why the older ones
 * open "kom úrskurðarnefnd skipulags- og byggingarmála saman til fundar".
 *
 * VERIFIED against the live site (August 2026):
 *
 *  - robots.txt is `User-agent: *` with no Disallow line at all: nothing on
 *    the site is off limits.
 *
 *  - **The whole index is one page.** `/listi-yfir-urskurdi` is a single
 *    server-rendered table of every ruling the board has published — 2,995
 *    rows when this was written, about 3.7 MB. There is no pagination to walk
 *    and no cursor to keep: one fetch is the complete list, so a run always
 *    knows exactly what exists and exactly what it is missing.
 *
 *  - **One fetch per ruling**, which carries the whole text inline in
 *    `article .content-inner` — no PDF, no attachment, no JavaScript. The node
 *    holds the ruling and nothing else: it starts at "Árið 2026, …" and ends
 *    on the úrskurðarorð.
 *
 * THE CASE NUMBER IS IN THE LINK, NOT THE COLUMN. The index's first two
 * columns are headed "Úrskurð. númer" and "Ártal", and they are the board's
 * own ruling sequence — not the case number. For the oldest row the table says
 * 3 / 1998 while the ruling itself says "Fyrir var tekið málið nr. 2/1998".
 * The case's real reference is in the link text, in both of the schemes the
 * board has used:
 *
 *     "2/1998 Laugavegur"                    → nr. 2/1998
 *     "UUA2606010 Sjókvíaeldi í Arnarfirði"  → nr. UUA2606010
 *
 * so that is what is read, and what is left over is the case's name. Taking
 * the columns instead would have stored a number that appears nowhere in the
 * ruling and does not match how anyone cites it.
 *
 * BOUNDED, AND RESUMABLE WITHOUT A CURSOR. Three thousand rulings at the
 * polite fetch rate is more than one run, so `INGEST_MAX_CASES` bounds it. No
 * cursor is needed to carry it forward: the index is one page, so every run
 * sees the whole list, diffs it against what is stored and spends its budget
 * on the oldest thing missing. `INGEST_MODE=retry` works the gap ledger and
 * nothing else.
 */

const BASE = (process.env.UUA_BASE ?? "https://uua.is").replace(/\/$/, "");

/** The board's complete index of rulings, in one page. */
const INDEX_PATH = "/listi-yfir-urskurdi";

export const UUA_SOURCE_KEY = "uua";
export const UUA_NAME = "Úrskurðarnefnd umhverfis- og auðlindamála";

/** Below this a page is recorded as a gap rather than stored as a ruling. */
const MIN_TEXT_CHARS = 400;

const MONTHS: Record<string, number> = {
  janúar: 0, febrúar: 1, mars: 2, apríl: 3, maí: 4, júní: 5,
  júlí: 6, ágúst: 7, september: 8, október: 9, nóvember: 10, desember: 11,
};

/**
 * "Árið 2026, föstudaginn 28. ágúst, kom úrskurðarnefnd …" and, in the older
 * rulings, "Ár 1998, miðvikudaginn 25. mars kl. 12:00, kom …".
 *
 * The year and the day sit in different clauses with the weekday between them,
 * so this matches the opening as a whole rather than looking for a date: a
 * loose "D. month YYYY" would sooner find the date of the decision under
 * appeal, which these rulings name in their second paragraph.
 *
 * Not anchored to the start of the text, only to the head of it — a few of the
 * older rulings print a subject line above the opening ("Mál nr. 5/1998.
 * Melabraut 21, Hafnarfirði. Framkvæmdir stöðvaðar."). The "Ár(ið) YYYY," form
 * is distinctive enough to find on its own.
 *
 * The month is closed with a lookahead rather than `\b`: JavaScript's `\b` is
 * ASCII-only and does not fire after "júlí", "júní" or "maí", which silently
 * cost every ruling handed down in one of those three months its date.
 *
 * Everything between the year and the day is optional, because the board has
 * written this line four ways over thirty years and all four are in the
 * archive: with and without the comma after the year ("Ár 2000 mánudaginn 29.
 * maí"), with and without the point after the day ("miðvikudaginn 10 maí"),
 * and with no weekday at all ("Ár 2001 1. mars kom nefnd skv. 31. gr."). The
 * weekday slot is a word with no digit in it, so it can never swallow the day.
 */
const OPENING_DATE_RE = new RegExp(
  `Ári?ð?\\s+(\\d{4})\\s*,?\\s*(?:[^\\s\\d,]+\\s+)?(\\d{1,2})\\.?\\s*(${Object.keys(MONTHS).join("|")})(?!\\p{L})`,
  "iu"
);

/** How much of the opening to look at. The date is always in the first line. */
const OPENING_CHARS = 600;

function openingDate(body: string): Date | undefined {
  const m = OPENING_DATE_RE.exec(body.slice(0, OPENING_CHARS));
  if (!m) return undefined;
  const month = MONTHS[m[3].toLowerCase()];
  if (month === undefined) return undefined;
  const date = new Date(Date.UTC(Number(m[1]), month, Number(m[2])));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function squish(text: string): string {
  return text.replace(/[ ​ ]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * The case reference(s), peeled off the front of the index link's text.
 *
 * The board has used two schemes and both are what the ruling itself calls the
 * case: a file reference ("UUA2606010") from about 2023, and a plain "nr/year"
 * before that. A few rows also write "Mál " or "Mál nr. " in front of it.
 *
 * Sixty-odd rows are one ruling deciding several cases at once, and they write
 * the numbers as prose, sharing the year: "125 og 127/2021 Háafell",
 * "63, 73 og 75/2021 Hringtún", "85, 92, 96/2019 og 9/2020 Hagasel". Those are
 * expanded — the bare numbers take the year from the first full reference to
 * their right — so all of them are stored and the ruling is findable by any
 * one of them, with the first as the case number the card shows.
 *
 * Anything that matches none of this keeps the whole label as its name and is
 * stored without a case number: better unnumbered than wrongly numbered.
 */
const UUA_REF_RE = /^(UUA\d{6,10})\s+(.*)$/s;
const MAL_PREFIX_RE = /^Mál(?:\s+nr\.?)?\s+/i;

/** A complete reference, "110/2019". */
const FULL_REF_RE = /(\d{1,4})\/(\d{4})/g;

/**
 * The leading run of case references: numbers, "og", commas and full stops,
 * up to the last complete "n/yyyy" in it. Everything after that is the name.
 */
const LEADING_RUN_RE = /^[\d\s,./]*(?:og[\d\s,./]*)*/i;

export function splitIndexLabel(label: string): { caseNumbers: string[]; name: string } {
  // "24//2013" and "71/ 2005" are both written in the index; neither is a
  // different reference from the one it is trying to be.
  const text = squish(label).replace(MAL_PREFIX_RE, "").replace(/\/+\s*/g, "/");

  const ref = UUA_REF_RE.exec(text);
  if (ref) return { caseNumbers: [ref[1]], name: ref[2].trim() };

  const run = LEADING_RUN_RE.exec(text)?.[0] ?? "";
  const refs = Array.from(run.matchAll(FULL_REF_RE));
  if (refs.length === 0) return { caseNumbers: [], name: squish(label) };

  // The name starts after the *last* complete reference, so a name that opens
  // with a number of its own ("12/2020 3. hæð") keeps it.
  const last = refs[refs.length - 1];
  const name = text.slice(last.index + last[0].length).replace(/^[\s,./]+/, "").trim();

  // Bare numbers take the year from the first complete reference to their
  // right, which is how the board writes and cites them.
  const numbers: string[] = [];
  let pending: string[] = [];
  for (const token of run.slice(0, last.index + last[0].length).split(/(?:\s*[,.]\s*|\s+)(?:og(?:\s+|$))?|\s*og\s*/i)) {
    const piece = token.trim();
    if (!piece) continue;
    const full = /^(\d{1,4})\/(\d{4})$/.exec(piece);
    if (full) {
      for (const bare of pending) numbers.push(`${bare}/${full[2]}`);
      pending = [];
      numbers.push(`${full[1]}/${full[2]}`);
    } else if (/^\d{1,4}$/.test(piece)) {
      pending.push(piece);
    }
  }
  return { caseNumbers: numbers, name: name || squish(label) };
}

interface IndexItem {
  url: string;
  /** Every case this ruling decides, in the order the board writes them. */
  caseNumbers: string[];
  /** The case's name, e.g. "Sjókvíaeldi í Arnarfirði". */
  name: string;
  /** The board's own year for the ruling, from the index's "Ártal" column. */
  year?: number;
  /** The board's "Atriðisorð", comma-separated in the index. */
  keywords: string[];
}

/**
 * Every ruling in the index.
 *
 * Rows are read by their link rather than by column count, so a change to the
 * two `disable_on_mobile` columns the table hides on small screens cannot
 * silently shift the fields.
 */
export function parseIndex(html: string): IndexItem[] {
  const $ = load(html);
  const items: IndexItem[] = [];
  const seen = new Set<string>();

  $("table tr").each((_, el) => {
    const row = $(el);
    const link = row.find('a[href*="/urleits/"]').first();
    const href = link.attr("href");
    if (!href) return;
    const url = href.startsWith("http") ? href : `${BASE}${href.startsWith("/") ? "" : "/"}${href}`;
    if (seen.has(url)) return;
    seen.add(url);

    const cells = row.find("td");
    const year = Number(squish(cells.eq(1).text()));
    const { caseNumbers, name } = splitIndexLabel(link.text());

    items.push({
      url,
      caseNumbers,
      name,
      year: Number.isInteger(year) && year > 1900 ? year : undefined,
      keywords: squish(cells.last().text())
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean),
    });
  });

  return items;
}

/**
 * The ruling's text, one line per block, reflowed into paragraphs.
 *
 * A recursive walk rather than a `find("p, li, …")` sweep, because the board's
 * pages nest three different ways and one of them hides the ruling's opening
 * line. Most pages put the paragraphs straight in `.content-inner`; some wrap
 * them all in a bare `<div>`; and in both shapes the "Árið 2017, fimmtudaginn
 * 19. janúar, kom úrskurðarnefnd …" line — the one the date is read from — is
 * frequently a loose text node with no element around it at all. A sweep for
 * block elements skips it silently, and the ruling loses its date.
 *
 * So: every text node becomes text, and every block-level element is a line
 * break around whatever it contains. Inline elements (`a`, `em`, `span`) are
 * walked through without breaking, so a citation inside a sentence stays in it.
 */
const BLOCK_TAGS = new Set([
  "p", "div", "br", "li", "ul", "ol", "table", "tr", "td", "th",
  "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "section", "article",
]);

function blockText(node: Cheerio<AnyNode>): string {
  const lines: string[] = [];
  let current = "";

  const flush = () => {
    const text = squish(current);
    if (text) lines.push(text);
    current = "";
  };

  const walk = (n: AnyNode): void => {
    for (const child of (n as { children?: AnyNode[] }).children ?? []) {
      if (child.type === "text") {
        current += (child as unknown as { data: string }).data;
      } else if (child.type === "tag") {
        const name = (child as unknown as { name: string }).name.toLowerCase();
        if (BLOCK_TAGS.has(name)) {
          flush();
          walk(child);
          flush();
        } else {
          walk(child);
        }
      }
    }
  };

  const root = node.get(0);
  if (root) walk(root);
  flush();

  return normalizeJudgmentText(lines.join("\n"));
}

export function parseRuling(html: string): string {
  const inner = load(html)("article .content-inner").first();
  if (!inner.length) return "";
  return blockText(inner);
}

/** An "Úrskurðarorð" the ruling already carries, so ours is not added twice. */
const HAS_KEYWORDS_RE = /^Lykilorð\b/m;

/**
 * The stored record: the board and the case above the ruling itself.
 *
 * The same shape the other adapters compose, so a result card reads the same
 * whichever source it came from: body, name, index terms, then the ruling
 * under a heading that closes the header off.
 */
function composeRecord(item: IndexItem, body: string): string {
  const lines: string[] = [UUA_NAME];
  // Every number the ruling decides, so a search for any of them finds it —
  // not just the first, which is all the case_number column can hold.
  if (item.caseNumbers.length) lines.push(`Mál nr. ${item.caseNumbers.join(" og ")}`);
  if (item.name) lines.push(item.name);
  if (item.keywords.length && !HAS_KEYWORDS_RE.test(body)) {
    lines.push("", "Lykilorð", item.keywords.join(". ") + ".");
  }
  lines.push("", "Úrskurður", body);
  return lines.join("\n");
}

async function recordTotal(total: number): Promise<void> {
  try {
    await prisma.source.updateMany({
      where: { key: UUA_SOURCE_KEY },
      data: { totalAvailable: total },
    });
  } catch {
    // Bookkeeping only — never fail a run over it.
  }
}

export const uuaAdapter: IngestionAdapter = {
  key: "uua",
  name: "Úrskurðarnefnd umhverfis- og auðlindamála (uua.is)",
  sourceKeys: [UUA_SOURCE_KEY],

  async run(ctx: IngestContext): Promise<IngestStats> {
    const stats: IngestStats = { indexed: 0, skipped: 0, errors: 0 };
    const mode = process.env.INGEST_MODE || "recent";
    const maxFetches = Number(process.env.INGEST_MAX_CASES ?? 400);

    let fetches = 0;

    const ingestOne = async (item: IndexItem): Promise<void> => {
      fetches++;
      const identity = {
        adapter: "uua",
        source: UUA_SOURCE_KEY,
        officialUrl: item.url,
        court: UUA_NAME,
        caseNumber: item.caseNumbers[0] ?? null,
        title: item.name || (item.caseNumbers[0] ?? item.url),
        date: null,
      };

      let body: string;
      try {
        body = parseRuling(await ctx.fetchText(item.url));
      } catch (e) {
        stats.errors++;
        stats.errorSample = stats.errorSample ?? String(e);
        ctx.log(`  ${item.caseNumbers[0] ?? item.url}: ${String(e).slice(0, 140)}`);
        await ctx.recordGap({ ...identity, reason: "fetch-failed", detail: String(e).slice(0, 300) });
        return;
      }

      if (body.length < MIN_TEXT_CHARS) {
        stats.skipped++;
        await ctx.recordGap({
          ...identity,
          reason: "no-text",
          detail: body.length
            ? `article .content-inner held only ${body.length} chars`
            : "no article .content-inner on the page",
        });
        return;
      }

      try {
        const date = openingDate(body);
        const title = item.name || `${UUA_NAME} ${item.caseNumbers[0] ?? ""}`.trim();
        const result = await ctx.save({
          source: UUA_SOURCE_KEY,
          court: UUA_NAME,
          caseNumber: item.caseNumbers[0],
          caseName: title,
          title,
          date,
          // The index's own year, kept even when the opening date does not
          // parse: a ruling with no date at all still belongs in its year for
          // every year filter in the app.
          year: date?.getUTCFullYear() ?? item.year,
          language: "is",
          subjectTags: item.keywords,
          officialUrl: item.url,
          fullText: composeRecord(item, body),
        });
        if (result === "indexed") stats.indexed++;
        else stats.skipped++;
      } catch (e) {
        stats.errors++;
        stats.errorSample = stats.errorSample ?? String(e);
        ctx.log(`  ${item.caseNumbers[0] ?? item.url}: ${String(e).slice(0, 140)}`);
        await ctx.recordGap({ ...identity, reason: "error", detail: String(e).slice(0, 300) });
      }
    };

    // -----------------------------------------------------------------------
    // Retry sweep: the gap ledger and nothing else, no index fetch in front.
    // -----------------------------------------------------------------------
    if (mode === "retry") {
      const open = await ctx.openGaps([UUA_SOURCE_KEY]);
      ctx.log(`Retry sweep: ${open.length} outstanding ruling(s); up to ${maxFetches} fetches.`);
      for (const gap of open) {
        if (fetches >= maxFetches) {
          ctx.log(`Reached INGEST_MAX_CASES=${maxFetches}; re-run to continue.`);
          break;
        }
        await ingestOne({
          url: gap.officialUrl,
          caseNumbers: gap.caseNumber ? [gap.caseNumber] : [],
          name: "",
          keywords: [],
        });
      }
      ctx.log(`Retry sweep done: ${stats.indexed} recovered, ${stats.skipped} still without text.`);
      return stats;
    }

    // -----------------------------------------------------------------------
    // The index is one page, so a run always sees the whole archive.
    // -----------------------------------------------------------------------
    const items = parseIndex(await ctx.fetchText(`${BASE}${INDEX_PATH}`));
    if (items.length === 0) {
      throw new Error(
        `No rows in ${BASE}${INDEX_PATH} — the index could not be read, and an empty ` +
          `list here is indistinguishable from "nothing new".`
      );
    }
    await recordTotal(items.length);

    const known = new Set(
      (
        await prisma.document.findMany({
          where: { source: UUA_SOURCE_KEY },
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

    // Oldest first. The index is newest-first, and taking it in that order
    // would mean a bounded run re-fetched the newest end of a gap it had
    // already filled; from the back, each run's budget lands on ground no
    // previous run has covered.
    for (const item of missing.reverse()) {
      if (fetches >= maxFetches) {
        ctx.log(`Reached INGEST_MAX_CASES=${maxFetches}; ${missing.length - fetches} left for next run.`);
        break;
      }
      await ingestOne(item);
    }

    const open = await ctx.openGaps([UUA_SOURCE_KEY]);
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
