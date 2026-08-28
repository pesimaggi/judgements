import { load, type CheerioAPI, type Cheerio } from "cheerio";
import type { AnyNode } from "domhandler";
import pdfParse from "pdf-parse";
import { prisma } from "@/lib/db";
import { normalizeJudgmentText } from "@/lib/judgment-text";
import {
  ADR_BOARDS,
  boardListUrl,
  decisionUrl,
  STJORNARRADID_BASE,
  type AdrBoard,
} from "@/lib/adr-boards";
import {
  politeFetchBytes,
  type IngestionAdapter,
  type IngestContext,
  type IngestStats,
} from "../adapter";

/**
 * Úrskurðir og álit — stjornarradid.is
 *
 * Iceland's administrative appeal bodies: 41 úrskurðarnefndir, kærunefndir,
 * matsnefndir and ministry appeal desks, publishing about 23,700 rulings
 * through one search page. This is the decision layer between an agency and
 * the courts, and for whole areas of law — immigration, tenancy, benefits,
 * procurement — it is where the case law actually is.
 *
 * They arrive together but they are not one body, so each board is its own
 * source (src/lib/adr-boards.ts) with its own checkbox and its own row on the
 * progress page. This adapter feeds all 41.
 *
 * VERIFIED against the live site (August 2026):
 *
 *  - robots.txt allows the crawl. `User-agent: *` is `Allow: /`, and the
 *    Cloudflare content signals are `search=yes, ai-train=no, use=reference`
 *    — which is exactly what this project does: index for search, show a
 *    snippet, link back to the official page. Several named AI crawlers are
 *    disallowed by user-agent; ours is not one of them and must not pretend
 *    to be any of them.
 *
 *  - The listing is a plain GET. `/gogn/urskurdir-og-alit-/$LisasticSearch/
 *    Search/?Committee=…&PageIndex=…&SortByDate=True` returns server-rendered
 *    HTML: 200 results a page, newest first, and a "Sýni 1-200 af 23714
 *    niðurstöðum" line that gives the board's live total for free. No
 *    __VIEWSTATE, no JavaScript, no session — the query string is the whole
 *    API.
 *
 *  - `Committee=` is the site's own key for a board, so it is copied verbatim
 *    from the dropdown, exotic characters and all. See adr-boards.ts.
 *
 *  - One fetch per decision. Its page carries the whole ruling in
 *    `section.single-news__content`, and `meta[name=category]`'s
 *    `data-category` labels it with its ministry, its board and its document
 *    type — which is what lets a stored case be checked against the board we
 *    filed it under, rather than trusted blindly. Read as a set, never by
 *    position: the order is not fixed, and one kosningamál ruling names the
 *    ministry first where the next names the board first.
 *
 *  - `?newsid=…` alone resolves. The site's own links append `cname` and
 *    `cid`; dropping them keeps the stored officialUrl stable if a board is
 *    renamed, and stops the same ruling being stored twice under two spellings.
 *
 *  - Not every board writes its rulings into the page. Úrskurðarnefnd
 *    raforkumála and Nefnd vegna lausnar um stundarsakir publish a one-line
 *    page linking a PDF, and that PDF is the ruling — so the whole of those
 *    two boards would be stored as empty stubs, or dropped as gaps, without
 *    the attachment fallback below.
 *
 * Three modes, matching the Icelandic courts adapter:
 *
 *   INGEST_MODE=recent    (default) each board's first pages, stopping once a
 *                         run of already-stored cases appears. A quiet week
 *                         costs one list query per board and no detail fetches.
 *   INGEST_MODE=backfill  walk every page of every board, fetching only what
 *                         is missing. Resumable: each board keeps its own
 *                         cursor, so a bounded run carries the sweep forward
 *                         instead of restarting at page 0.
 *   INGEST_MODE=retry     work the gap ledger and nothing else — one detail
 *                         fetch per case we know exists but failed to store.
 */

const BASE = (process.env.STJORNARRADID_BASE ?? STJORNARRADID_BASE).replace(/\/$/, "");

/** Results a listing page returns. Fixed by the site, not by us. */
const PAGE_SIZE = 200;

/** Below this a decision page is treated as a gap rather than a ruling. */
const MIN_TEXT_CHARS = 200;

const MONTHS: Record<string, number> = {
  janúar: 0, febrúar: 1, mars: 2, apríl: 3, maí: 4, júní: 5,
  júlí: 6, ágúst: 7, september: 8, október: 9, nóvember: 10, desember: 11,
};
const DATE_RE = new RegExp(`(\\d{1,2})\\.\\s*(${Object.keys(MONTHS).join("|")})\\s*(\\d{4})`, "i");

/**
 * "Mál nr. 10/2026", "Úrskurður nr. 18/2025", "1372/2026. Úrskurður frá …".
 *
 * The separator is usually a slash but not always: Úrskurðarnefnd raforkumála
 * writes "í máli nr. 7. 2025", and matching only the slash left that whole
 * board with no case numbers at all. Captured in two parts and rejoined, so
 * whichever the board wrote, what we store is "7/2025".
 */
const CASE_NUMBER_RE = /\b(\d{1,5})\s*[/.]\s*(\d{4})\b/;

/**
 * A ministry's own case reference: "IRN26050091", "DMR19070007", "MNH25030169".
 *
 * The nefndir number their rulings "12/2026"; the ministry appeal desks
 * mostly do not — they title by subject and carry the file reference instead,
 * and that reference is what a researcher has in hand when they come looking.
 * Without this a third of the ministry desks' rulings had no case number at
 * all, and none of them were findable by the number printed on the decision.
 */
const MINISTRY_REF_RE = /\b([A-ZÁÐÉÍÓÚÝÞÆÖ]{3}\d{6,10})\b/;

function caseNumberIn(title: string): string | undefined {
  const m = CASE_NUMBER_RE.exec(title);
  if (m) return `${m[1]}/${m[2]}`;
  return MINISTRY_REF_RE.exec(title)?.[1];
}

/**
 * Guards against a PDF whose text came out as mojibake.
 *
 * Some boards attach rulings whose PDFs carry a custom font encoding with no
 * usable ToUnicode map, and pdf-parse then returns confident-looking rubbish:
 * "Urskurdur f rskurdarnefndar raforkum6la i m6li nr. 712025". Stored, that is
 * worse than storing nothing — 90 kB of noise in the search index, under a
 * title that reads as a real ruling, which no reader could tell from the real
 * thing until they opened it.
 *
 * The tell is that Icelandic is dense with á ð é í ó ú ý þ æ ö: every ruling
 * checked runs 9–12% of them, and the mangled ones 0.01%. Anything under this
 * is not Icelandic text, whatever else it is, and goes to the gap ledger with
 * a reason rather than into the index.
 */
const ICELANDIC_CHARS_RE = /[áðéíóúýþæöÁÐÉÍÓÚÝÞÆÖ]/g;
const MIN_ICELANDIC_RATIO = 0.02;

function looksLikeIcelandic(text: string): boolean {
  if (text.length < MIN_TEXT_CHARS) return false;
  return (text.match(ICELANDIC_CHARS_RE)?.length ?? 0) / text.length >= MIN_ICELANDIC_RATIO;
}

/** "Sýni 1-200 af 23714 niðurstöðum." — the board's live total. */
const TOTAL_RE = /af\s+([\d.]+)\s+niðurstöðum/;

/**
 * The heading a board writes over its own summary of the case. Matched on a
 * line of its own, the same way src/lib/judgment-text.ts matches it.
 */
const SUMMARY_HEADING_RE = /^(?:Útdráttur|Reifun|Ágrip)\s*:?$/i;

/**
 * The kind of document, taken from the title so the heading closing a summary
 * names what actually follows it.
 */
const DOC_KIND_RE = /\b(Úrskurður|Ákvörðun|Álit|Dómur)\b/i;

/** How many blocks a summary may run to before it is closed regardless. */
const MAX_SUMMARY_BLOCKS = 8;

function squish(text: string): string {
  return text.replace(/[ ​]/g, " ").replace(/\s+/g, " ").trim();
}

function parseIcelandicDate(text: string): Date | undefined {
  const m = DATE_RE.exec(text);
  if (!m) return undefined;
  const month = MONTHS[m[2].toLowerCase()];
  if (month === undefined) return undefined;
  const date = new Date(Date.UTC(Number(m[3]), month, Number(m[1])));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * The ruling's own date, which is not the same as the date it was published.
 *
 * Most boards publish as they decide and the two agree, but not all: a
 * procurement ruling of 3 July 2026 turned up in the feed on 27 August, and
 * an immigration ruling of January 2025 eighteen months later. Filing those
 * under the publication date would put them in the wrong year for every date
 * filter in the app.
 *
 * So, in order: a date written into the title ("Úrskurður frá 3. júlí 2026"),
 * then the first date in the opening of the ruling — these decisions open by
 * saying when they were made ("Hinn 3. júlí 2026 kvað úrskurðarnefnd …",
 * "Ár 2010, mánudaginn 1. nóvember, var í Félagsdómi …") — and only then the
 * publication date. A candidate later than the publication date is rejected:
 * a ruling cannot be handed down after it was published, so that is a
 * mis-parse (a deadline, a date in a quoted letter) rather than a decision.
 */
function decisionDate(title: string, body: string, published?: Date): Date | undefined {
  const limit = published ? published.getTime() + 2 * 86_400_000 : Infinity;
  for (const candidate of [parseIcelandicDate(title), parseIcelandicDate(body.slice(0, 400))]) {
    if (candidate && candidate.getTime() <= limit && candidate.getUTCFullYear() >= 1900) {
      return candidate;
    }
  }
  return published;
}

/**
 * Block-per-line text of a rich-text container.
 *
 * One line per block node, which is the shape parseJudgmentText expects from
 * a rich-text source (see src/lib/judgment-text.ts) — it recovers headings
 * and paragraphs from there. Nested blocks are skipped so a <p> inside a
 * <div> is not emitted twice.
 *
 * <br> counts as a line break, and that is not a detail. These boards write
 * a section heading and its text as one paragraph split by a <br>:
 *
 *     <p><strong>Útdráttur</strong><br /><em>Ágreiningur aðila laut að …</em></p>
 *
 * Collapse that break and the line reads "Útdráttur Ágreiningur aðila…" — the
 * heading swallowed by its own text. The summary extractor matches a line
 * that is *only* the word "Útdráttur" (src/lib/judgment-text.ts), so every
 * ruling would lose the summary the board wrote for it, and the reading view
 * would lose every heading on the page.
 *
 * Mutates the tree it is given: the <br>s are replaced with newlines rather
 * than worked around. The document is parsed per page and discarded, so
 * there is nothing else to disturb.
 */
function blockText($: CheerioAPI, node: Cheerio<AnyNode>, bodyHeading: string): string {
  node.find("br").replaceWith("\n");

  const toLines = (text: string) =>
    text
      .split("\n")
      .map((line) => squish(line))
      .filter(Boolean);

  const blocks = node
    .find("p, li, h2, h3, h4, h5, h6, blockquote")
    .filter((_, el) => $(el).parents("p, li, blockquote").length === 0);

  const out: string[] = [];
  let inSummary = false;
  let summaryClosed = false;
  let summaryBlocks = 0;

  blocks.each((_, el) => {
    const block = $(el);
    const lines = toLines(block.text());
    if (lines.length === 0) return;

    // Wholly emphasised: everything outside the <em> and the <strong> heading
    // is gone. That is how these boards set a summary apart from the ruling.
    const stripped = block.clone();
    stripped.find("em, i, strong").remove();
    const italic = block.find("em, i").length > 0 && squish(stripped.text()) === "";

    if (inSummary && (!italic || summaryBlocks >= MAX_SUMMARY_BLOCKS)) {
      out.push("", bodyHeading);
      inSummary = false;
      summaryClosed = true;
    }
    if (inSummary) summaryBlocks++;
    if (!summaryClosed && !inSummary && italic && SUMMARY_HEADING_RE.test(lines[0])) {
      inSummary = true;
      summaryBlocks = 1;
    }
    out.push(...lines);
  });

  // A few older rulings put their text straight in the container with no
  // block wrapper at all.
  if (out.length === 0) return toLines(node.text()).join("\n");
  return out.join("\n");
}

interface ListItem {
  newsId: string;
  url: string;
  title: string;
  /** The site's publication date for the item. */
  published?: Date;
  /** The board's own index terms, from the abstract line. */
  keywords: string[];
}

interface Listing {
  items: ListItem[];
  /** Cases the site says this board has, across all pages. */
  total?: number;
}

function parseListing(html: string): Listing {
  const $ = load(html);
  const items: ListItem[] = [];

  $("li.news-item-list__items__item").each((_, el) => {
    const item = $(el);
    const link = item.find('a[href*="stakur-urskurdur"]').first();
    const href = link.attr("href") ?? "";
    const newsId = /[?&]newsid=([0-9a-f-]+)/i.exec(href)?.[1];
    if (!newsId) return;
    // The link text is the title; its `title` attribute carries the same
    // string unescaped, and is the more reliable of the two when the heading
    // wraps.
    const title = squish(link.attr("title") || link.text());
    if (!title) return;
    items.push({
      newsId,
      url: decisionUrl(newsId, BASE),
      title,
      published: parseIcelandicDate(squish(item.find(".news-startdate").first().text())),
      keywords: splitKeywords(squish(item.find(".news-item-list__items_item__abstract").first().text())),
    });
  });

  const totalText = TOTAL_RE.exec($("body").text())?.[1];
  return {
    items,
    total: totalText ? Number(totalText.replace(/\./g, "")) : undefined,
  };
}

/**
 * "Bindandi samningur. Fjárhagslegt hæfi. Álit á skaðabótaskyldu hafnað." —
 * the board's own index terms, written as one full-stop-separated line. Split
 * into tags, which is what makes them usable in the subject-tag lookup.
 *
 * Splitting on every full stop is wrong, and quietly so: these terms cite
 * legislation, and "Vörusamningur. Reglugerð nr. 340/2017. Frávísun." then
 * yields the tags "Reglugerð nr" and "340/2017" — two fragments where one
 * term belongs, both of them junk in the tag lookup. So a split needs a
 * capital after it. The terms are sentence-cased and the abbreviations that
 * cause the trouble ("nr.", "gr.", "mgr.") are always followed by a number.
 */
const TERM_SPLIT_RE = /\.\s+(?=[A-ZÁÐÉÍÓÚÝÞÆÖ])/;

function splitKeywords(text: string): string[] {
  return text
    .split(TERM_SPLIT_RE)
    .map((s) => s.trim().replace(/\.$/, "").trim())
    .filter((s) => s.length > 1);
}

interface Decision {
  title: string;
  published?: Date;
  body: string;
  keywords: string[];
  /**
   * The ruling as an attachment, where the page carries no text of its own.
   * Absolute, and only set when the page's own body is too thin to be the
   * ruling — see attachmentUrl().
   */
  pdfUrl?: string;
  /**
   * The page's own labels: the board, its ministry and the document type, as
   * `meta[name=category]` lists them. Read as a set rather than by position —
   * the order is not fixed (one kosningamál ruling names the ministry first,
   * the next names the board first), and a positional read turns that into a
   * mis-filing warning on every other case.
   */
  categories: string[];
}

/**
 * Normalizes the two characters the site uses where a comma and a space
 * belong, so a page's label can be compared with a board's name. See
 * src/lib/adr-boards.ts.
 */
function normalizeLabel(text: string): string {
  return squish(text.replace(/\u066B/g, ",").replace(/\u00A0/g, " "));
}

/**
 * The heading placed between a board's summary and the ruling itself.
 *
 * Without one the summary has no end: extractSummary() reads from "Útdráttur"
 * to the next heading (src/lib/judgment-text.ts), and these rulings put no
 * heading over their opening — they simply start, "Með kæru móttekinni …". So
 * the whole first half of the case became the "summary" on the result card.
 *
 * The boards do mark the boundary, in italics rather than in words: the
 * summary is set in <em> and the ruling is not. blockText() reads that and
 * writes the boundary out as this heading, which is the same thing the
 * Umboðsmaður adapter does with "Álit"/"Bréf" — and it names what follows,
 * taken from the title where the title says.
 */
function bodyHeading(title: string): string {
  const kind = DOC_KIND_RE.exec(title)?.[1];
  if (!kind) return "Úrskurður";
  return kind.charAt(0).toUpperCase() + kind.slice(1).toLowerCase();
}

/**
 * The PDF a stub page links to, made absolute.
 *
 * Only consulted when the page's own body is too short to be a ruling, so a
 * case that publishes its text inline *and* attaches a copy is still read
 * from the page — the text there is already structured, where the PDF has to
 * be reflowed out of one-line-per-visual-line.
 */
function attachmentUrl($: CheerioAPI, section: Cheerio<AnyNode>): string | undefined {
  const href = section
    .find('a[href$=".pdf"], a[href*=".pdf?"], a[href*="/lisalib/getfile"]')
    .first()
    .attr("href");
  if (!href) return undefined;
  return href.startsWith("http") ? href : `${BASE}${href.startsWith("/") ? "" : "/"}${href}`;
}

/** A ruling published as an attachment, reflowed into paragraphs. */
async function fetchPdfText(url: string): Promise<string> {
  const { body } = await politeFetchBytes(url);
  const { text } = await pdfParse(body);
  // pdf-parse emits one line per visual line of the page; normalizeJudgmentText
  // reflows those into real paragraphs, the same way the courts adapter does.
  return normalizeJudgmentText(text);
}

function parseDecision(html: string): Decision | null {
  const $ = load(html);
  const section = $("section.single-news__content").first();
  if (!section.length) return null;

  const title = squish($("h1.single-news__title").first().text());
  const body = blockText($, section, bodyHeading(title));
  if (!body) return null;

  // "Fjármála- og efnahagsráðuneytið,Kærunefnd útboðsmála,type:Úrskurðir"
  const categories = ($('meta[name="category"]').attr("data-category") ?? "")
    .split(",")
    .map((c) => normalizeLabel(c))
    .filter((c) => c && !c.startsWith("type:"));

  return {
    title,
    pdfUrl: body.length < MIN_TEXT_CHARS ? attachmentUrl($, section) : undefined,
    published: parseIcelandicDate(squish($("time.news-startdate").first().text())),
    body,
    // The og:description repeats the board's index terms; where the page has
    // none, the ruling's own "Lykilorð" line is left to the body.
    keywords: splitKeywords(squish($('meta[property="og:description"]').last().attr("content") ?? "")),
    categories,
  };
}

/** A "Lykilorð" line of the ruling's own, on its own line. */
const HAS_KEYWORD_HEADING = /^Lykilorð\s*:?$/m;

/**
 * The stored record: the board and the case above the ruling itself.
 *
 * The index terms are prepended only when the ruling does not already carry
 * them. Most boards write their own "Lykilorð" line at the top, and the list
 * page's abstract is a copy of it — adding ours unconditionally stored every
 * such ruling with its keywords twice, once in a header and again three lines
 * below. Where a board writes none (Mannanafnanefnd, most ministry desks) the
 * list page's terms are the only ones there are, and they are worth keeping.
 */
function composeRecord(board: AdrBoard, title: string, keywords: string[], body: string): string {
  const lines: string[] = [board.name];
  if (title) lines.push(title);
  if (keywords.length && !HAS_KEYWORD_HEADING.test(body)) {
    lines.push("", "Lykilorð", keywords.join(". ") + ".");
  }
  lines.push("", body);
  return lines.join("\n");
}

/** Boards this run covers: STJORNARRADID_BOARDS=key,key or all of them. */
function selectedBoards(ctx: IngestContext): AdrBoard[] {
  const requested = (process.env.STJORNARRADID_BOARDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (requested.length === 0) return ADR_BOARDS;

  const boards = requested
    .map((key) => {
      const board = ADR_BOARDS.find((b) => b.key === key);
      if (!board) ctx.log(`STJORNARRADID_BOARDS: no board with key "${key}" — ignored`);
      return board;
    })
    .filter((b): b is AdrBoard => b !== undefined);
  return boards;
}

/**
 * The site's live count for a board, kept on its Source row so the progress
 * page compares what we hold against what exists rather than against the
 * figure someone wrote down once.
 */
async function recordTotal(board: AdrBoard, total: number | undefined): Promise<void> {
  if (total === undefined) return;
  try {
    await prisma.source.updateMany({ where: { key: board.key }, data: { totalAvailable: total } });
  } catch {
    // Bookkeeping only — never fail a run over it.
  }
}

export const stjornarradidAdapter: IngestionAdapter = {
  key: "stjornarradid",
  name: "Úrskurðir og álit (úrskurðarnefndir og ráðuneyti)",
  sourceKeys: ADR_BOARDS.map((b) => b.key),

  async run(ctx: IngestContext): Promise<IngestStats> {
    const stats: IngestStats = { indexed: 0, skipped: 0, errors: 0 };
    const mode = process.env.INGEST_MODE || "recent";
    const maxFetches = Number(process.env.INGEST_MAX_CASES ?? 500);
    const boards = selectedBoards(ctx);

    if (boards.length === 0) {
      ctx.log("No boards selected — nothing to do.");
      return stats;
    }

    let fetches = 0;
    const budgetSpent = () => fetches >= maxFetches;

    /**
     * Fetch one decision and store it. Shared by all three modes so they
     * cannot drift in how a ruling is parsed, dated or filed.
     */
    const ingestOne = async (board: AdrBoard, item: ListItem): Promise<void> => {
      fetches++;
      let html: string;
      try {
        html = await ctx.fetchText(item.url);
      } catch (e) {
        stats.errors++;
        stats.errorSample = stats.errorSample ?? String(e);
        ctx.log(`  ${item.title.slice(0, 60)}: ${String(e).slice(0, 120)}`);
        await ctx.recordGap({
          adapter: "stjornarradid",
          source: board.key,
          officialUrl: item.url,
          court: board.name,
          caseNumber: caseNumberIn(item.title) ?? null,
          title: item.title,
          date: item.published ?? null,
          reason: "fetch-failed",
          detail: String(e).slice(0, 300),
        });
        return;
      }

      try {
        const decision = parseDecision(html);
        const title = decision?.title || item.title;
        let body = decision?.body ?? "";

        // The page had no ruling of its own but linked one. Fetching it is a
        // second request, so it is only done when there is nothing else.
        let pdfWasUnreadable = false;
        if (decision?.pdfUrl && body.length < MIN_TEXT_CHARS) {
          try {
            const pdfText = await fetchPdfText(decision.pdfUrl);
            if (!looksLikeIcelandic(pdfText)) {
              ctx.log(
                `  ${title.slice(0, 50)}: attachment extracted ${pdfText.length} chars ` +
                  `with no Icelandic in them — not stored (see looksLikeIcelandic)`
              );
              pdfWasUnreadable = pdfText.length >= MIN_TEXT_CHARS;
            } else {
              body = pdfText;
            }
          } catch (e) {
            ctx.log(`  ${title.slice(0, 50)}: attachment failed — ${String(e).slice(0, 100)}`);
          }
        }

        if (!decision || body.length < MIN_TEXT_CHARS) {
          stats.skipped++;
          await ctx.recordGap({
            adapter: "stjornarradid",
            source: board.key,
            officialUrl: item.url,
            court: board.name,
            caseNumber: caseNumberIn(title) ?? null,
            title,
            date: item.published ?? null,
            reason: "no-text",
            detail: decision
              ? `body only ${body.length} chars` +
                (pdfWasUnreadable
                  ? ` (attachment ${decision.pdfUrl} extracted as mojibake)`
                  : decision.pdfUrl
                    ? ` (attachment ${decision.pdfUrl} yielded nothing)`
                    : " and no attachment")
              : "no section.single-news__content on the page",
          });
          return;
        }

        // The page carries its own labels. If none of them is the board we
        // filtered by, the site has re-filed the case and storing it here
        // would put it under the wrong checkbox — worth a line in the log
        // rather than a silent mis-filing. (A page with no labels at all says
        // nothing either way, so it is not flagged.)
        const labels = decision.categories;
        if (
          labels.length > 0 &&
          !labels.includes(board.name) &&
          !labels.includes(normalizeLabel(board.committee))
        ) {
          ctx.log(`  ${title.slice(0, 50)}: page says "${labels.join(", ")}", filed under "${board.name}"`);
        }

        const keywords = decision.keywords.length ? decision.keywords : item.keywords;
        const published = decision.published ?? item.published;
        const date = decisionDate(title, body, published);
        const fullText = composeRecord(board, title, keywords, body);

        const result = await ctx.save({
          source: board.key,
          court: board.name,
          caseNumber: caseNumberIn(title),
          caseName: keywords.join(". ") || undefined,
          title,
          date,
          year: date?.getUTCFullYear(),
          language: "is",
          subjectTags: keywords,
          officialUrl: item.url,
          // Where the ruling is an attachment, the reader is pointed at it:
          // the PDF is the authentic document, the extracted text is ours.
          pdfUrl: decision.pdfUrl,
          fullText,
        });
        if (result === "indexed") stats.indexed++;
        else stats.skipped++;
      } catch (e) {
        stats.errors++;
        stats.errorSample = stats.errorSample ?? String(e);
        ctx.log(`  ${item.title.slice(0, 60)}: ${String(e).slice(0, 150)}`);
        await ctx.recordGap({
          adapter: "stjornarradid",
          source: board.key,
          officialUrl: item.url,
          court: board.name,
          title: item.title,
          date: item.published ?? null,
          reason: "error",
          detail: String(e).slice(0, 300),
        });
      }
    };

    // ---------------------------------------------------------------------
    // Retry sweep: the gap ledger and nothing else. No listing needed — every
    // case we know exists but could not store already has a row, so this is
    // one detail fetch per outstanding case. This is what recovers a ruling
    // lost to a one-off 5xx instead of leaving it missing forever.
    // ---------------------------------------------------------------------
    if (mode === "retry") {
      const open = await ctx.openGaps(boards.map((b) => b.key));
      ctx.log(`Retry sweep: ${open.length} outstanding case(s); up to ${maxFetches} fetches this run.`);
      const byKey = new Map(boards.map((b) => [b.key, b]));

      for (const gap of open) {
        if (budgetSpent()) {
          ctx.log(`Reached INGEST_MAX_CASES=${maxFetches}; re-run to continue.`);
          break;
        }
        const board = byKey.get(gap.source);
        if (!board) continue;
        const newsId = /[?&]newsid=([0-9a-f-]+)/i.exec(gap.officialUrl)?.[1];
        if (!newsId) continue;
        await ingestOne(board, {
          newsId,
          url: gap.officialUrl,
          title: gap.caseNumber ?? gap.officialUrl,
          keywords: [],
        });
      }
      ctx.log(`Retry sweep done: ${stats.indexed} recovered, ${stats.skipped} still without text.`);
      return stats;
    }

    // ---------------------------------------------------------------------
    // Listing sweeps. Both walk the same newest-first pages board by board;
    // they differ only in where they start and when they stop.
    // ---------------------------------------------------------------------
    const backfill = mode === "backfill";
    const stopAfterKnown = Number(process.env.INGEST_STOP_AFTER_KNOWN ?? 60);
    let pageBudget = Number(process.env.INGEST_MAX_PAGES ?? (backfill ? Infinity : boards.length * 2));

    ctx.log(
      `${backfill ? "Backfill" : "Incremental"} sweep over ${boards.length} board(s); ` +
        `up to ${maxFetches} case fetches and ` +
        `${Number.isFinite(pageBudget) ? pageBudget : "unlimited"} list pages this run.`
    );

    for (const board of boards) {
      if (budgetSpent()) {
        ctx.log(`Case budget spent — remaining boards pick up next run.`);
        break;
      }
      if (pageBudget <= 0) {
        ctx.log(`Page budget spent — remaining boards pick up next run.`);
        break;
      }

      // Which of this board's cases we already hold. One query per board
      // rather than one per case, so walking a page of known rulings costs
      // nothing: that is what lets the same walk serve both sweeps.
      const known = new Set(
        (
          await prisma.document.findMany({
            where: { source: board.key },
            select: { officialUrl: true },
          })
        ).map((d) => d.officialUrl)
      );

      // A backfill resumes from its own cursor and wraps around at the end,
      // so successive bounded runs carry the sweep forward and a board that
      // finishes goes back to re-verifying rather than idling.
      const cursorKey = `stjornarradid:${board.key}`;
      const saved = backfill
        ? await prisma.ingestCursor.findUnique({ where: { key: cursorKey } })
        : null;
      let page = backfill ? Number(process.env.INGEST_START_PAGE ?? saved?.nextPage ?? 0) : 0;
      const saveCursor = (next: number) =>
        prisma.ingestCursor.upsert({
          where: { key: cursorKey },
          create: { key: cursorKey, nextPage: next },
          update: { nextPage: next },
        });

      let consecutiveKnown = 0;
      let boardPages = 0;
      let lastPage = Infinity;

      pages: while (pageBudget > 0 && !budgetSpent()) {
        let listing: Listing;
        try {
          listing = parseListing(await ctx.fetchText(boardListUrl(board, { page, base: BASE })));
        } catch (e) {
          stats.errors++;
          stats.errorSample = stats.errorSample ?? String(e);
          ctx.log(`${board.name}: page ${page} failed — ${String(e).slice(0, 150)}`);
          break;
        }
        pageBudget--;
        boardPages++;

        if (boardPages === 1) {
          await recordTotal(board, listing.total);
          ctx.log(
            `${board.name}: site reports ${listing.total ?? "?"} case(s), ` +
              `${known.size} stored${backfill && page > 0 ? ` (resuming at page ${page})` : ""}`
          );
          if (listing.total !== undefined) {
            lastPage = Math.max(0, Math.ceil(listing.total / PAGE_SIZE) - 1);
          }
        }

        if (listing.items.length === 0) {
          // Past the end. A backfill wraps to page 0 so the board is
          // re-verified next run rather than staying parked on an empty page.
          if (backfill) {
            await saveCursor(0);
            ctx.log(`${board.name}: reached the end — cursor wrapped to page 0.`);
          }
          break;
        }

        for (const item of listing.items) {
          if (known.has(item.url)) {
            stats.skipped++;
            consecutiveKnown++;
            // Incremental only: a run of stored cases means we have caught up
            // with this board and the rest of its pages are older still.
            if (!backfill && consecutiveKnown >= stopAfterKnown) {
              ctx.log(`${board.name}: ${consecutiveKnown} consecutive stored cases — caught up.`);
              break pages;
            }
            continue;
          }
          consecutiveKnown = 0;
          if (budgetSpent()) {
            ctx.log(`${board.name}: case budget spent mid-page; resuming here next run.`);
            break pages;
          }
          await ingestOne(board, item);
        }

        page++;
        if (backfill) await saveCursor(page > lastPage ? 0 : page);
        if (page > lastPage) {
          if (backfill) ctx.log(`${board.name}: swept to the last page — cursor wrapped to page 0.`);
          break;
        }
      }
    }

    const open = await ctx.openGaps(boards.map((b) => b.key));
    if (open.length) {
      ctx.log(
        `${open.length} case(s) in the ledger still outstanding — ` +
          `run INGEST_MODE=retry to re-attempt them.`
      );
      for (const g of open.slice(0, 25)) {
        ctx.log(`  [${g.reason}, ${g.attempts}x] ${g.court ?? "?"} ${g.caseNumber ?? ""} ${g.officialUrl}`);
      }
      if (open.length > 25) ctx.log(`  …and ${open.length - 25} more`);
    }
    ctx.log(`${fetches} decision page(s) fetched.`);
    return stats;
  },
};
