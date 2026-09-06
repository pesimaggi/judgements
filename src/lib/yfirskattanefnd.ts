/**
 * Yfirskattanefnd — the tax appeal board, at yskn.is.
 *
 * WHAT IT IS. The independent board that rules on appeals against the
 * decisions of Skatturinn (ríkisskattstjóri, tollgæslustjóri,
 * skattrannsóknarstjóri) and of the other authorities the statutes send to it.
 * Income tax, VAT, customs classification, withholding, penalties, refunds:
 * for most tax questions its úrskurðir are the last word before the courts,
 * and they are cited as authority in every one of them. It was the largest
 * Icelandic archive this library was still missing.
 *
 * TWO BOARDS, ONE ARCHIVE. Yfirskattanefnd was established by lög nr. 30/1992
 * and took over on 1 July 1992 from **ríkisskattanefnd**, whose rulings it
 * publishes as the older part of the same register — 1,657 of them, back to
 * 1973. They are a different body and say so ("Úrskurður ríkisskattanefndar",
 * numbered "rskn. nr. 728/1973"), so each record carries the board that
 * actually decided it in `court`, while the source stays one checkbox: a
 * researcher looking for tax rulings does not want to tick two boxes to reach
 * a line of authority that runs continuously through both bodies. This is the
 * same treatment Úrskurðarnefnd umhverfis- og auðlindamála's predecessor gets.
 *
 * VERIFIED against the live site (September 2026):
 *
 *  - **robots.txt** disallows the Umbraco plumbing — `/umbraco/`, `/bin/`,
 *    `/config/`, `/data/`, `/install/`, `/masterpages/`, `/python/`,
 *    `/usercontrols/`, `/xslt/`, `/aspnet_client/`, `/umbraco_client/`.
 *    Neither the index nor the rulings are under any of them.
 *
 *  - **The index is one page per year**, `/urskurdir/?year=YYYY`, and that
 *    page also carries the list of every year the board publishes. So one
 *    fetch discovers the range and lists the newest year, and each further
 *    year is one more fetch. 4,175 rulings across 1973–2026 when this was
 *    written.
 *
 *  - **One fetch per ruling**, `/urskurdir/skoda-urskurd/?nr=<id>`, fully
 *    server-rendered: heading, index terms, ruling number, gjaldár, the
 *    board's own table of the statutes it applied, the summary and the ruling
 *    itself. No PDF, no attachment, no JavaScript.
 *
 * WHAT `/urskurdir/` IS NOT. The page is headed "Úrval úrskurða" — a
 * selection — and the board does not publish every ruling it hands down:
 * 2026's listing runs 4/2026 to 107/2026 with the gaps you would expect. The
 * README used to say the full set was behind "Leit í úrskurðum". It is not:
 * that form searches the same 4,175 records (searching for a ruling number
 * the year listings omit returns nothing at all), so walking the year listings
 * gets the whole published archive and there is no second, larger corpus to
 * go after.
 *
 * THE OLDER RULINGS CARRY NO DATE. From 2016 the published text opens with the
 * board's own formula — "Ár 2026, miðvikudaginn 8. júlí, er tekið fyrir mál
 * nr. 1/2026" — which gives both the day it was decided and the case number
 * behind the ruling number. Before that the board publishes the ruling without
 * that opening, and the date appears nowhere in the record: not in the body,
 * not at the end, not in the index. So about four fifths of the archive is
 * stored with a year and no date, taken from the ruling number, which is
 * assigned by year of decision. That is honest; inventing a day from the
 * gjaldár would not be, and the gjaldár is a different year anyway — ruling
 * 107/2026 is about gjaldár 2020.
 *
 * WHAT THE BOLD PARAGRAPH IS DEPENDS ON THE ERA. Every ruling page has one
 * `p.resultparagraphBold` under the header. In the yfirskattanefnd era it is
 * the útdráttur — a paragraph of prose summarising the case — and the index
 * terms are a `<ul>` above it. In the ríkisskattanefnd era there is no list,
 * and the bold paragraph *is* the index terms: "Dánarbú — Lögaðili —
 * Skattskylda dánarbús — Búskipti". Reading one as the other would either put
 * a keyword list where the card shows a summary or bury a summary in
 * `subjectTags`, so the two are told apart structurally (a term list above
 * means the bold text is a summary) and, where there is no list, by shape.
 */

/** Source key in src/lib/sources.ts. */
export const YFIRSKATTANEFND_SOURCE_KEY = "yfirskattanefnd";

/** The board as it is named on a result card, per era. */
export const YFIRSKATTANEFND_NAME = "Yfirskattanefnd";
export const RIKISSKATTANEFND_NAME = "Ríkisskattanefnd";

/** Which of the two bodies decided a ruling. */
export type YsknBoard = "yfirskattanefnd" | "rikisskattanefnd";

export function boardName(board: YsknBoard): string {
  return board === "rikisskattanefnd" ? RIKISSKATTANEFND_NAME : YFIRSKATTANEFND_NAME;
}

/** The board's own heading over a ruling, and what tells the two eras apart. */
const RIKISSKATTANEFND_TITLE_RE = /ríkisskattanefnd/i;

export function squish(text: string): string {
  return text
    .replace(/[ ​  ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The page for one ruling — the record's officialUrl, and what is fetched. */
export function rulingUrl(base: string, id: string): string {
  return `${base}/urskurdir/skoda-urskurd/?nr=${id}`;
}

/** One year's listing. */
export function yearIndexUrl(base: string, year: number): string {
  return `${base}/urskurdir/?year=${year}`;
}

/**
 * The year a listing page is actually showing, which `/urskurdir/` with no
 * query decides for itself — it marks the link `class='active'`. Read rather
 * than assumed: "the newest year in the list" is the same thing today and
 * would quietly stop being it if the board ever left the current year
 * selected after publishing nothing in it.
 */
export function parseActiveYear(html: string): number | undefined {
  const m = /<a\b[^>]*[?&]year=(\d{4})[^>]*class=["'][^"']*\bactive\b/i.exec(html);
  return m ? Number(m[1]) : undefined;
}

/**
 * The years the board publishes, newest first, read from the "Veldu ár" links
 * every listing page carries.
 *
 * Discovered rather than written down: the range starts at 1973 and gains a
 * year every January, and a hard-coded end date is a source that quietly stops
 * ingesting on the first of some future month.
 */
export function parseYears(html: string): number[] {
  const years = new Set<number>();
  for (const m of html.matchAll(/[?&]year=(\d{4})/g)) {
    const year = Number(m[1]);
    if (year >= 1900 && year <= 2200) years.add(year);
  }
  return [...years].sort((a, b) => b - a);
}

export interface IndexItem {
  /** The site's own id for the ruling, e.g. "7882". */
  id: string;
  /** "107/2026" — the ruling number, which is how the ruling is cited. */
  rulingNumber?: string;
  /** Which body the listing labels it as: "Úrskurður" vs "Úrskurður rskn.". */
  board: YsknBoard;
}

/**
 * Every ruling in one year's listing.
 *
 * The listing is a `<ul>` of links, each carrying the ruling's id twice — in
 * the href and in `data-urskurdurid` — and its number in a nested `<div>`. The
 * text in front of that div is the board: "Úrskurður" for yfirskattanefnd,
 * "Úrskurður rskn." for ríkisskattanefnd, which is the cheapest place the two
 * eras can be told apart and is confirmed by the ruling's own heading later.
 *
 * Parsed with a regex rather than cheerio because it is one shape repeated,
 * and the module stays free of a DOM dependency this way — the adapter that
 * uses it has no other need for one.
 */
const INDEX_ITEM_RE =
  /<a\b[^>]*data-urskurdurid=["'](\d+)["'][^>]*>([\s\S]*?)<\/a>/g;
const SPLIT_TEXT_RE = /<div[^>]*class=["'][^"']*UrskurdurSplitText[^"']*["'][^>]*>([\s\S]*?)<\/div>/i;

export function parseYearIndex(html: string): IndexItem[] {
  const items: IndexItem[] = [];
  const seen = new Set<string>();

  for (const m of html.matchAll(INDEX_ITEM_RE)) {
    const id = m[1];
    if (seen.has(id)) continue;
    seen.add(id);

    const inner = m[2];
    const label = squish(stripTags(inner.replace(SPLIT_TEXT_RE, " ")));
    const number = SPLIT_TEXT_RE.exec(inner)?.[1];

    items.push({
      id,
      rulingNumber: parseRulingNumber(number ? squish(stripTags(number)) : ""),
      board: /\brskn\b/i.test(label) ? "rikisskattanefnd" : "yfirskattanefnd",
    });
  }

  return items;
}

/**
 * "nr. 107/2026", "Úrskurður rskn. nr. 728/1973", "Úrskurður nr. 128/1997 " —
 * every form the number is written in, in the listing and on the ruling.
 */
const RULING_NUMBER_RE = /(\d{1,5})\s*\/\s*(\d{4})/;

export function parseRulingNumber(text: string): string | undefined {
  const m = RULING_NUMBER_RE.exec(text);
  return m ? `${m[1]}/${m[2]}` : undefined;
}

/**
 * The order an ingestion run spends its budget in: the current and previous
 * years first, newest first, then everything older from the oldest end.
 *
 * A plain "oldest missing first" pass — which is what the single-page archives
 * here do — would mean that on a cold start nothing published this year
 * appears until 1973 onwards is complete, and that is a fortnight of runs. A
 * plain newest-first pass would spend every bounded run re-covering ground the
 * last one had already filled. Splitting the queue gets both: new rulings land
 * on the first run that sees them, and the backfill still advances from the
 * far end each time.
 */
export function ingestOrder<T extends { year: number }>(missing: T[], thisYear: number): T[] {
  const recent = missing.filter((i) => i.year >= thisYear - 1).sort((a, b) => b.year - a.year);
  const older = missing.filter((i) => i.year < thisYear - 1).sort((a, b) => a.year - b.year);
  return [...recent, ...older];
}

// ---------------------------------------------------------------------------
// The ruling page
// ---------------------------------------------------------------------------

export interface ParsedRuling {
  board: YsknBoard;
  /** "107/2026", from the page's own heading. */
  rulingNumber?: string;
  /**
   * "1/2026" — the board's case number, which is not the ruling number and is
   * only stated in the rulings that carry the opening formula.
   */
  caseNumber?: string;
  /** "Gjaldár 2020", "Virðisaukaskattur 1990", "Staðgreiðsla 2021". */
  period?: string;
  /** The board's index terms — "Leiðrétting skattskila", "Sönnun". */
  terms: string[];
  /** The board's own list of the statutes it applied, one entry per act. */
  statutes: string[];
  /** The útdráttur, where the board writes one. */
  summary?: string;
  /** The ruling itself. */
  body: string;
  /** The day it was decided, where the ruling states it. */
  date?: Date;
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, " "));
}

/**
 * The entities this site actually emits. Its pages are ASCII-escaped in the
 * chrome (`&#218;rskur&#240;ir`) and use the named ones in the text, so both
 * forms have to come back as characters before anything is matched against
 * them — a summary that still says `&ldquo;` is a summary with rubbish in it.
 */
export function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&ldquo;/g, "“")
    .replace(/&rdquo;/g, "”")
    .replace(/&bdquo;/g, "„")
    .replace(/&lsquo;/g, "‘")
    .replace(/&rsquo;/g, "’")
    .replace(/&ndash;/g, "–")
    .replace(/&mdash;/g, "—")
    .replace(/&hellip;/g, "…")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** The contents of the first element carrying this class. */
function block(html: string, className: string): string | undefined {
  const open = new RegExp(`<(\\w+)[^>]*class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>`, "i");
  const m = open.exec(html);
  if (!m) return undefined;
  const tag = m[1].toLowerCase();
  let depth = 1;
  let i = m.index + m[0].length;
  const start = i;
  const scan = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
  scan.lastIndex = i;
  for (let hit = scan.exec(html); hit; hit = scan.exec(html)) {
    depth += hit[1] ? -1 : 1;
    if (depth === 0) return html.slice(start, hit.index);
    i = scan.lastIndex;
  }
  return html.slice(start);
}

/**
 * The ruling's text, one line per block element.
 *
 * The body is a run of `<p>` inside `div.resultcontainer` — no nesting to
 * speak of and no loose text nodes, unlike the uua.is pages — so closing every
 * block tag with a newline and stripping the rest is enough, and it keeps the
 * paragraph breaks that make the ruling readable.
 */
export function blockText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(?:p|div|li|ul|ol|tr|table|h[1-6]|blockquote|section|article)\s*>/gi, "\n")
      .replace(/<[^>]*>/g, "")
  )
    .replace(/[ ​  ]/g, " ")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

const MONTHS: Record<string, number> = {
  janúar: 0, febrúar: 1, mars: 2, apríl: 3, maí: 4, júní: 5,
  júlí: 6, ágúst: 7, september: 8, október: 9, nóvember: 10, desember: 11,
};

/**
 * "Ár 2026, miðvikudaginn 8. júlí, er tekið fyrir mál nr. 1/2026" — the
 * board's opening formula, and the only place a ruling states the day it was
 * decided. Anchored through "er tekið fyrir" rather than matching a bare date,
 * because the same sentence goes on to give the date of the appeal and the
 * next one the date of the decision under appeal.
 *
 * The month is closed with a lookahead: JavaScript's `\b` is ASCII-only and
 * does not fire after "júlí", "júní" or "maí", which would silently cost every
 * ruling handed down in one of those three months its date.
 *
 * The weekday slot is optional and may not contain a digit, so it can never
 * swallow the day.
 */
const OPENING_RE = new RegExp(
  `Ári?ð?\\s+(\\d{4})\\s*,?\\s*(?:[^\\s\\d,]+\\s+)?(\\d{1,2})\\.?\\s*(${Object.keys(MONTHS).join("|")})(?!\\p{L})` +
    `[^.]{0,60}?er\\s+tekið\\s+fyrir(?:\\s+mál\\s+nr\\.?\\s*([\\d/\\s.,og-]{3,40}?)\\s*[;:.])?`,
  "iu"
);

/** How much of the ruling to look at. The formula is its first sentence. */
const OPENING_CHARS = 600;

export interface Opening {
  date?: Date;
  /** Every case the ruling decides, as the board writes them. */
  caseNumbers: string[];
}

export function parseOpening(body: string): Opening {
  const m = OPENING_RE.exec(body.slice(0, OPENING_CHARS));
  if (!m) return { caseNumbers: [] };

  const month = MONTHS[m[3].toLowerCase()];
  const date =
    month === undefined ? undefined : new Date(Date.UTC(Number(m[1]), month, Number(m[2])));

  const caseNumbers = m[4]
    ? [...m[4].matchAll(/(\d{1,5})\s*\/\s*(\d{4})/g)].map((c) => `${c[1]}/${c[2]}`)
    : [];

  return {
    date: date && !Number.isNaN(date.getTime()) ? date : undefined,
    caseNumbers,
  };
}

/**
 * The board's index terms, as the ríkisskattanefnd era writes them: one bold
 * line of terms joined by dashes, "Dánarbú — Lögaðili — Skattskylda dánarbús".
 */
export function splitTermLine(text: string): string[] {
  return squish(text)
    .split(/\s+[-‐-―]\s+/)
    .map((term) => term.replace(/[.;]+$/, "").trim())
    .filter(Boolean);
}

/** Longest a single index term runs. The longest in the archive is 54. */
const MAX_TERM_CHARS = 80;

/**
 * Whether a bold paragraph with no term list above it is a term list itself.
 *
 * Structure decides this wherever it can — a `<ul>` of terms above the bold
 * paragraph means the paragraph is the útdráttur — and this is the fallback
 * for the era that has no list. The two are told apart by shape, not by
 * length: a ríkisskattanefnd term line runs to 700 characters when the board
 * indexes a ruling under twenty headings, so length says nothing. What does
 * say something is that terms are short noun phrases joined by dashes and end
 * without punctuation, while a summary is prose in sentences that ends in a
 * full stop.
 *
 * When the shape is not clearly a term list the text is kept as a summary,
 * which is the safe way round: a summary shown as a summary is right even if
 * it happened to be terse, whereas prose scattered through `subjectTags`
 * pollutes every tag filter in the app.
 */
export function looksLikeTermList(text: string): boolean {
  const value = squish(text);
  if (!value) return false;
  if (/[.!?]\s+\p{Lu}/u.test(value)) return false;
  if (/[.!?]$/.test(value)) return false;
  const terms = splitTermLine(value);
  return terms.length > 0 && terms.every((term) => term.length <= MAX_TERM_CHARS);
}

/**
 * One ruling page, or undefined if it holds no ruling — a 200 that is really
 * an error page, which is what an unknown `?nr=` gets.
 */
export function parseRuling(html: string): ParsedRuling | undefined {
  const container = block(html, "resultcontainer");
  if (container === undefined) return undefined;

  const heading = squish(stripTags(block(html, "resulttitle") ?? ""));
  const board: YsknBoard = RIKISSKATTANEFND_TITLE_RE.test(heading)
    ? "rikisskattanefnd"
    : "yfirskattanefnd";

  const listed = [...(block(html, "atridicontainer") ?? "").matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)]
    .map((m) => squish(stripTags(m[1])))
    .filter(Boolean);

  const bold = squish(stripTags(block(html, "resultparagraphBold") ?? ""));
  const boldIsTerms = listed.length === 0 && looksLikeTermList(bold);

  const body = blockText(container);
  const opening = parseOpening(body);

  return {
    board,
    rulingNumber: parseRulingNumber(squish(stripTags(block(html, "resultparagraphUrskurdurNr") ?? ""))),
    caseNumber: opening.caseNumbers[0],
    period: squish(stripTags(block(html, "resultparagraphGjaldar") ?? "")) || undefined,
    terms: listed.length ? listed : boldIsTerms ? splitTermLine(bold) : [],
    statutes: parseStatutes(block(html, "tilvisuncontainer") ?? ""),
    summary: !boldIsTerms && bold ? bold : undefined,
    body,
    date: opening.date,
  };
}

/**
 * The board's table of the statutes a ruling applied — "Lög nr. 90/2003, 7.
 * gr. A-liður 1. tölul., 96. gr." — one entry per act, each on its own line
 * inside a single `<p>` and closed with a non-breaking space.
 *
 * Worth keeping as its own section of the record rather than folding into the
 * text: it is the board's own statement of what the ruling turns on, in the
 * "lög nr. N/YYYY" form the citation job reads, and it names acts that the
 * body sometimes only refers to by short name after the first mention.
 */
export function parseStatutes(html: string): string[] {
  return blockText(html)
    .split("\n")
    .map(squish)
    // The trailing full stop stays: it is the one in "11. gr.", not a
    // sentence's, and the citation job matches on the abbreviated form.
    .filter((line) => line.length > 2);
}

/**
 * The stored text: the board and the case above the ruling itself.
 *
 * The same shape the other Icelandic adapters compose, so a result card reads
 * the same whichever source it came from. Every heading here is one
 * src/lib/judgment-text.ts already knows, so the reader renders them as
 * headings rather than as stray one-word paragraphs.
 */
export function composeRecord(ruling: ParsedRuling): string {
  const lines: string[] = [boardName(ruling.board)];
  if (ruling.rulingNumber) lines.push(`Úrskurður nr. ${ruling.rulingNumber}`);
  if (ruling.caseNumber) lines.push(`Mál nr. ${ruling.caseNumber}`);
  if (ruling.period) lines.push(ruling.period);

  if (ruling.terms.length) {
    lines.push("", "Lykilorð", ruling.terms.join(". ") + ".");
  }
  if (ruling.statutes.length) {
    lines.push("", "Skrá um lög", ruling.statutes.join("\n"));
  }
  if (ruling.summary) {
    lines.push("", "Útdráttur", ruling.summary);
  }
  lines.push("", "Úrskurður", ruling.body);
  return lines.join("\n");
}

/**
 * What the card calls the ruling.
 *
 * These rulings are anonymised — the parties are A, B and X ehf. — so there is
 * no case name to use, and the board's own way of naming one is its index
 * terms: that is literally what the ríkisskattanefnd era prints as the
 * ruling's heading line. So the terms are the title, joined the way the board
 * joins them, and the ruling number falls back into it when there are none.
 */
export function rulingTitle(ruling: ParsedRuling): string {
  const title: string[] = [];
  for (const term of ruling.terms) {
    // Ríkisskattanefnd indexes a ruling under as many as thirty terms — the
    // whole list is what `subjectTags` is for, and every one of them stays
    // there. A card heading is a heading, so it takes as many as read as one.
    if (title.length && [...title, term].join(" — ").length > MAX_TITLE_CHARS) break;
    title.push(term);
  }
  if (title.length) return title.join(" — ");

  const number = ruling.rulingNumber ? ` nr. ${ruling.rulingNumber}` : "";
  return `Úrskurður ${
    ruling.board === "rikisskattanefnd" ? "ríkisskattanefndar" : "yfirskattanefndar"
  }${number}`;
}

/** How long a title built out of index terms may run. */
const MAX_TITLE_CHARS = 90;
