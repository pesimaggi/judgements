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
 * Óbyggðanefnd — obyggdanefnd.is
 *
 * The commission that decides what is þjóðlenda: which land in Iceland is
 * public commons and which is anybody's property. It worked the country
 * through in twelve svæði from 1998 to its final report in March 2026, and its
 * rulings are the authority on land rights in the highlands — cited in every
 * þjóðlendumál that has reached the courts since.
 *
 * **Eighty-four rulings**, and they are unlike anything else in the app: each
 * is a PDF of 120 to 500 pages, a megabyte or two on the wire and up to 1.4 MB
 * of text. The whole source is about 180 MB of PDF and 60 MB of stored text,
 * so the per-run budget is small by default and a full backfill takes a
 * handful of runs.
 *
 * VERIFIED against the live site (August 2026):
 *
 *  - robots.txt disallows `/wp-admin/` and nothing else. The index is
 *    `/urskurdir/` and the rulings are under `/wp-content/uploads/`, both
 *    allowed.
 *
 *  - **The index is one page** listing every ruling under a heading per
 *    svæði — among about 300 links, the rest being úrskurðarkort (maps),
 *    yfirlitskort and summary documents. The rulings are the links whose text
 *    opens "Mál nr.", which is what separates them. The 2023 rulings are
 *    listed twice, under two headings, so the walk dedupes by URL: 90 links,
 *    84 rulings.
 *
 *  - **There is no page per ruling.** The PDF *is* the document, so it is what
 *    `officialUrl` points at — unlike every other source here, where the PDF
 *    is a copy of something also published as a page.
 *
 * The PDF's own first four lines carry everything about the case, in a form
 * the commission has kept for thirty years:
 *
 *     ÚRSKURÐUR
 *     ÓBYGGÐANEFNDAR
 *     Mál nr. 4/2018 Fjalllendið milli Elliða og Lágafells auk Baulárvalla
 *     15. ágúst 2019
 *
 * so the case number, the land the case is about and the date it was decided
 * are all read from there rather than from the index. The index is still read
 * for the svæði each case belongs to, which is the commission's own way of
 * grouping them and is stored as a subject tag.
 */

const BASE = (process.env.OBYGGDANEFND_BASE ?? "https://obyggdanefnd.is").replace(/\/$/, "");
const INDEX_PATH = "/urskurdir/";

export const OBYGGDANEFND_SOURCE_KEY = "obyggdanefnd";
export const OBYGGDANEFND_NAME = "Óbyggðanefnd";

/**
 * Below this a ruling is recorded as a gap rather than stored. Set high: the
 * smallest of these runs to 300,000 characters, so anything in the thousands
 * is a scanned PDF that gave up nothing, not a short ruling.
 */
const MIN_TEXT_CHARS = 20_000;

const MONTHS: Record<string, number> = {
  janúar: 0, febrúar: 1, mars: 2, apríl: 3, maí: 4, júní: 5,
  júlí: 6, ágúst: 7, september: 8, október: 9, nóvember: 10, desember: 11,
};

/**
 * Guards against a PDF whose text came out as mojibake — the same check the
 * stjornarradid adapter makes, and needed here for the same reason.
 *
 * The commission's oldest rulings, svæði 1 and 2 (2000 and 2001), are typeset
 * in a font with no usable ToUnicode map, and pdf-parse returns 400,000
 * characters of confident-looking rubbish: "⁄RSKUR–UR ”BYGG–ANEFNDAR m·l nr.
 * 1/2000 fiingvallakirkjuland og efstu jarir Ì fiingvallahreppi". That is
 * worse than storing nothing — half a megabyte of noise in the search index
 * under a title that reads as a real ruling.
 *
 * It is not recoverable by remapping either, tempting as the substitutions
 * look (· = á, Ì = í, fi = Þ): lowercase ð has no glyph at all in that
 * encoding and is simply dropped, so "jarðir" comes through as "jarir". The
 * text is lossy, not merely mis-decoded.
 *
 * Icelandic legal prose runs 8–10% á ð é í ó ú ý þ æ ö; these run 0.1–0.6%.
 * Below 2% the ruling goes to the gap ledger with a reason, not into the index.
 */
const ICELANDIC_CHARS_RE = /[áðéíóúýþæöÁÐÉÍÓÚÝÞÆÖ]/g;
const MIN_ICELANDIC_RATIO = 0.02;

function looksLikeIcelandic(text: string): boolean {
  return (text.match(ICELANDIC_CHARS_RE)?.length ?? 0) / Math.max(text.length, 1) >= MIN_ICELANDIC_RATIO;
}

/**
 * The PDF's own header: the case reference, the land it concerns, and the date.
 *
 * Written as one pattern rather than three, because what separates the name
 * from the date is only that the date follows it — there is no punctuation and
 * the line break is not reliable (one 2003 ruling wraps "ÓBYGGÐANEFNDAR Mál
 * nr. 8/2003 …" onto a single line). The name is therefore whatever lies
 * between the reference and the date, which is exactly what it is.
 *
 * The reference takes four shapes, all of them in the archive: "4/2018";
 * "S-1/2011", for the cases the commission numbered apart from the svæði;
 * "3/2004 og 4/2004" and "3-4/2004", both of which are two cases joined and
 * decided together, written two different ways in two different years. The
 * month is closed with a lookahead rather than `\b`, which is ASCII-only and
 * does not fire after "júlí", "júní" or "maí".
 */
const REF = `(?:[A-ZÁÐÉÍÓÚÝÞÆÖ]-)?\\d{1,3}(?:-\\d{1,3})*\\/\\d{4}`;
const HEADER_RE = new RegExp(
  `[Mm]ál\\s+nr\\.\\s*` +
    `(${REF}(?:\\s+og\\s+${REF})*)` +
    `\\s*,?\\s*` +
    `(.*?)\\s*` +
    `(\\d{1,2})\\.\\s*(${Object.keys(MONTHS).join("|")})(?!\\p{L})\\s+(\\d{4})`,
  "su"
);

/**
 * "3-4/2004" is two cases, "S-1/2011" is one. The difference is whether what
 * precedes the hyphen is a letter, so a range is expanded and a letter prefix
 * is carried through untouched.
 */
const REF_PARTS_RE = /^([A-ZÁÐÉÍÓÚÝÞÆÖ]-)?(\d{1,3}(?:-\d{1,3})*)\/(\d{4})$/;

function expandRef(ref: string): string[] {
  const m = REF_PARTS_RE.exec(ref.trim());
  if (!m) return [ref.trim()];
  return m[2].split("-").map((n) => `${m[1] ?? ""}${n}/${m[3]}`);
}

/** How much of the PDF to look at for the header. It is the first page. */
const HEADER_CHARS = 900;

export interface RulingHeader {
  caseNumbers: string[];
  /** The land the case is about, e.g. "Skagafjörður ásamt Almenningi". */
  name: string;
  date?: Date;
}

export function parseHeader(text: string): RulingHeader | null {
  const m = HEADER_RE.exec(text.slice(0, HEADER_CHARS));
  if (!m) return null;

  const month = MONTHS[m[4].toLowerCase()];
  const date =
    month === undefined ? undefined : new Date(Date.UTC(Number(m[5]), month, Number(m[3])));

  return {
    caseNumbers: m[1].split(/\s+og\s+/i).flatMap(expandRef),
    // A name that ran across the line break picks up stray whitespace; and
    // S-cases have no name at all, which is why this may come back empty.
    name: m[2].replace(/\s+/g, " ").replace(/[,;–—-]+$/, "").trim(),
    date: date && !Number.isNaN(date.getTime()) ? date : undefined,
  };
}

interface IndexItem {
  /** The PDF, which for this commission is the ruling itself. */
  url: string;
  /** The index's label, "Mál nr. 4/2018, úrskurður". A fallback for the PDF. */
  label: string;
  /** "Svæði 8A" — the commission's own grouping, from the heading above. */
  area?: string;
}

/** A ruling link, as against the maps and summaries alongside them. */
const RULING_LABEL_RE = /^Mál\s+nr\./i;

/**
 * Every ruling in the index, with the svæði it was decided under.
 *
 * The area is the nearest `h2` above the link. Walking the document in order
 * and remembering the last heading is what makes that work — the list is flat
 * HTML with the headings as siblings, not a nesting the DOM can be asked about.
 */
export function parseIndex(html: string, base = BASE): IndexItem[] {
  const $ = load(html);
  const items: IndexItem[] = [];
  const seen = new Set<string>();
  let area: string | undefined;

  $("h2, li").each((_, el) => {
    const node = $(el);
    if (node.is("h2")) {
      area = node.text().replace(/\s+/g, " ").trim() || undefined;
      return;
    }
    const link = node.find('a[href$=".pdf"]').first();
    const label = link.text().replace(/\s+/g, " ").trim();
    if (!label || !RULING_LABEL_RE.test(label)) return;

    const href = link.attr("href") ?? "";
    const url = href.startsWith("http") ? href : `${base}${href.startsWith("/") ? "" : "/"}${href}`;
    if (seen.has(url)) return;
    seen.add(url);

    items.push({ url, label, area: area?.startsWith("Svæði") ? area : undefined });
  });

  return items;
}

/**
 * The stored record: the commission and the case above the ruling itself.
 *
 * "Þjóðlendumál" is added as a subject tag on every one of them. It is the
 * only thing this commission does, it is the word a researcher reaches for,
 * and no other source in the app carries it.
 */
function composeRecord(header: RulingHeader, area: string | undefined, body: string): string {
  const lines: string[] = [OBYGGDANEFND_NAME];
  if (header.caseNumbers.length) lines.push(`Mál nr. ${header.caseNumbers.join(" og ")}`);
  if (header.name) lines.push(header.name);
  const tags = ["Þjóðlendumál", area].filter(Boolean);
  lines.push("", "Lykilorð", tags.join(". ") + ".");
  lines.push("", "Úrskurður", body);
  return lines.join("\n");
}

async function recordTotal(total: number): Promise<void> {
  try {
    await prisma.source.updateMany({
      where: { key: OBYGGDANEFND_SOURCE_KEY },
      data: { totalAvailable: total },
    });
  } catch {
    // Bookkeeping only — never fail a run over it.
  }
}

export const obyggdanefndAdapter: IngestionAdapter = {
  key: "obyggdanefnd",
  name: "Óbyggðanefnd (obyggdanefnd.is)",
  sourceKeys: [OBYGGDANEFND_SOURCE_KEY],

  async run(ctx: IngestContext): Promise<IngestStats> {
    const stats: IngestStats = { indexed: 0, skipped: 0, errors: 0 };
    const mode = process.env.INGEST_MODE || "recent";
    // Deliberately small. Each ruling is a 1–5 MB PDF of several hundred
    // pages, so a dozen of them is already a substantial run.
    const maxFetches = Number(process.env.INGEST_MAX_CASES ?? 12);

    let fetches = 0;

    const ingestOne = async (item: IndexItem): Promise<void> => {
      fetches++;
      const identity = {
        adapter: "obyggdanefnd",
        source: OBYGGDANEFND_SOURCE_KEY,
        officialUrl: item.url,
        court: OBYGGDANEFND_NAME,
        caseNumber: /nr\.\s*([^,]+)/i.exec(item.label)?.[1]?.trim() ?? null,
        title: item.label,
        date: null,
      };

      let body: string;
      try {
        const { body: bytes } = await politeFetchBytes(item.url);
        body = normalizeJudgmentText((await pdfParse(bytes)).text);
      } catch (e) {
        stats.errors++;
        stats.errorSample = stats.errorSample ?? String(e);
        ctx.log(`  ${item.label}: ${String(e).slice(0, 140)}`);
        await ctx.recordGap({ ...identity, reason: "fetch-failed", detail: String(e).slice(0, 300) });
        return;
      }

      if (body.length < MIN_TEXT_CHARS) {
        stats.skipped++;
        await ctx.recordGap({
          ...identity,
          reason: "no-text",
          detail: `the PDF extracted only ${body.length} chars; the shortest real ruling is ~300,000`,
        });
        return;
      }

      if (!looksLikeIcelandic(body)) {
        stats.skipped++;
        await ctx.recordGap({
          ...identity,
          reason: "no-text",
          detail:
            `the PDF extracted ${body.length} chars with almost no Icelandic in them — ` +
            `its font carries no usable ToUnicode map (see looksLikeIcelandic)`,
        });
        return;
      }

      // The header is the only place the ruling's date and the land it
      // concerns are stated. Without it there is a document but no case, so it
      // goes to the ledger rather than into the index under the index's label.
      const header = parseHeader(body);
      if (!header) {
        stats.skipped++;
        await ctx.recordGap({
          ...identity,
          reason: "no-text",
          detail: `no "Mál nr. … <date>" header in the first ${HEADER_CHARS} chars of the PDF`,
        });
        return;
      }

      try {
        const title = header.name || item.label.replace(/,\s*úrskurður\s*$/i, "");
        const result = await ctx.save({
          source: OBYGGDANEFND_SOURCE_KEY,
          court: OBYGGDANEFND_NAME,
          caseNumber: header.caseNumbers[0],
          caseName: title,
          title,
          date: header.date,
          year: header.date?.getUTCFullYear(),
          language: "is",
          subjectTags: ["Þjóðlendumál", item.area].filter((t): t is string => Boolean(t)),
          officialUrl: item.url,
          // The same URL: there is no page behind this one, the PDF is the
          // ruling. Set anyway so the reader gets the "open the PDF" link the
          // other sources give.
          pdfUrl: item.url,
          fullText: composeRecord(header, item.area, body),
        });
        if (result === "indexed") stats.indexed++;
        else stats.skipped++;
      } catch (e) {
        stats.errors++;
        stats.errorSample = stats.errorSample ?? String(e);
        ctx.log(`  ${item.label}: ${String(e).slice(0, 140)}`);
        await ctx.recordGap({ ...identity, reason: "error", detail: String(e).slice(0, 300) });
      }
    };

    if (mode === "retry") {
      const open = await ctx.openGaps([OBYGGDANEFND_SOURCE_KEY]);
      ctx.log(`Retry sweep: ${open.length} outstanding ruling(s); up to ${maxFetches} fetches.`);
      for (const gap of open) {
        if (fetches >= maxFetches) {
          ctx.log(`Reached INGEST_MAX_CASES=${maxFetches}; re-run to continue.`);
          break;
        }
        await ingestOne({ url: gap.officialUrl, label: gap.caseNumber ?? gap.officialUrl });
      }
      ctx.log(`Retry sweep done: ${stats.indexed} recovered, ${stats.skipped} still unread.`);
      return stats;
    }

    const items = parseIndex(await ctx.fetchText(`${BASE}${INDEX_PATH}`), BASE);
    if (items.length === 0) {
      throw new Error(
        `No "Mál nr. …" ruling links on ${BASE}${INDEX_PATH} — the index could not be ` +
          `read, and an empty list here is indistinguishable from "nothing new".`
      );
    }
    await recordTotal(items.length);

    const known = new Set(
      (
        await prisma.document.findMany({
          where: { source: OBYGGDANEFND_SOURCE_KEY },
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

    // Oldest first, as elsewhere: the index is newest-first, and taking it in
    // that order would have each bounded run re-cover ground the last one did.
    for (const item of missing.reverse()) {
      if (fetches >= maxFetches) {
        ctx.log(`Reached INGEST_MAX_CASES=${maxFetches}; ${missing.length - fetches} left for next run.`);
        break;
      }
      await ingestOne(item);
    }

    const open = await ctx.openGaps([OBYGGDANEFND_SOURCE_KEY]);
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
