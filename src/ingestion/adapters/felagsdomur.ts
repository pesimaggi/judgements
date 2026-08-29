import { load, type Cheerio } from "cheerio";
import type { AnyNode } from "domhandler";
import pdfParse from "pdf-parse";
import { prisma } from "@/lib/db";
import { normalizeJudgmentText } from "@/lib/judgment-text";
import {
  FELAGSDOMUR_COMMITTEE,
  FELAGSDOMUR_KEY,
  STJORNARRADID_BASE,
  committeeListUrl,
  decisionUrl,
} from "@/lib/adr-boards";
import {
  politeFetchBytes,
  type IngestionAdapter,
  type IngestContext,
  type IngestStats,
} from "../adapter";

/**
 * Félagsdómur — felagsdomur.is
 *
 * The labour court. It rules on collective agreements and on the legality of
 * industrial action under lög nr. 80/1938 og nr. 94/1986, and it is a court,
 * not one of the úrskurðarnefndir — which is why its source sits with the
 * other courts in src/lib/sources.ts rather than under "Úrskurðarnefndir og
 * ráðuneyti".
 *
 * It is also not in island.is's feed, so the icelandic-courts adapter never
 * saw it. It publishes for itself, on a Lisa CMS site of the same family as
 * landsrettur.is.
 *
 * ONE COURT, TWO SITES. The court's archive is split, and this adapter reads
 * both halves:
 *
 *   - case numbers from 2010 on (F-1/2010 … ), 200 of them, at felagsdomur.is;
 *   - case numbers up to 2009 (106 of them, the last handed down 1 November
 *     2010), on stjornarradid.is under `Committee=Félagsdómur`.
 *
 * The two sets are disjoint: the split is by case *number*, not by decision
 * date — which is why the older site still carries cases decided in 2010
 * (nr. 6/2009, 9/2009, 11/2009, 10/2009) — and stjornarradid.is says so itself
 * with a signpost entry reading "Dómar Félagsdóms frá 2010 og til dagsins í
 * dag eru á felagsdomur.is".
 *
 * They are one court and they are stored as one. That is the whole reason this
 * adapter reads the older half rather than leaving it to the stjornarradid
 * adapter, which used to: read as a board, the pre-2010 cases came out visibly
 * different from the rest of the same court — case numbers "10/2009" against
 * "F-2/2026", titles "Mál nr. 10/2009: Dómur frá 1. nóvember 2010" against the
 * parties, the parties themselves filed under a "Lykilorð" heading and indexed
 * as a subject tag (that site's abstract field holds the parties for this
 * court, not index terms), and the letter-spaced headings left uncollapsed.
 * Same court, two shapes, one checkbox. Now there is one shape:
 *
 *   caseNumber   F-prefixed on both halves. felagsdomur.is labels its cases
 *                "F-2/2026" and the older site does not, so the prefix is
 *                added there. The judgments themselves print the bare form in
 *                both eras ("í málinu nr. 10/2009", "Mál nr. 2/2026"), so that
 *                form stays findable in the full text either way.
 *   title,       the parties, on both halves. The older site publishes them in
 *   caseName     the listing's abstract field; the newer one in the card.
 *   subjectTags  the court's own index terms where it publishes them, which is
 *                from about 2015 on. Empty for the older half rather than
 *                filled with the parties.
 *
 * As a result the stjornarradid adapter must NOT list Félagsdómur among its
 * boards, and does not: it is deliberately absent from ADR_BOARDS. See
 * FELAGSDOMUR_KEY in src/lib/adr-boards.ts.
 *
 * VERIFIED against the live site (August 2026):
 *
 *  - robots.txt disallows `/extensions/`, `/lisa/` and `/Domar` for every
 *    user-agent. Nothing this adapter fetches is under any of them: the
 *    listing is `/domar-og-urskurdir/` and `/default.aspx`, the judgments are
 *    `/Cache/Verdicts/*.pdf`. (`/Domar` is a different, capitalised path — but
 *    the case-insensitive reading is the safer one to hold in mind if a URL
 *    here is ever changed.)
 *
 *  - The listing is the page's own "Birta fleiri færslur" endpoint:
 *    `/default.aspx?pageitemid=…&offset=N&count=M`, server-rendered HTML with
 *    no session and no __VIEWSTATE. `pageitemid` is a CMS GUID, so it is read
 *    off the button on /domar-og-urskurdir/ rather than hardcoded — a site
 *    re-deploy changes the GUID, and a hardcoded one fails silently by
 *    returning an empty list, which reads exactly like "nothing new".
 *
 *  - The server caps a page at ~22 items whatever `count` asks for, so the
 *    walk uses a page of 20 and stops when a page comes back empty.
 *
 *  - Each case's text is its PDF at `/Cache/Verdicts/<id>.pdf`, and that is
 *    what this adapter stores. The detail page does carry a text layer of its
 *    own in `#verdict-text`, but it is visibly lossy — whole words are missing
 *    from it ("viðræðum um g starfsmanna" for "…um kjör starfsmanna") — so it
 *    is only the fallback for a case whose PDF cannot be fetched.
 *
 * ONE PASS, EVERY RUN. The other adapters carry cursors, page budgets and a
 * separate backfill mode because their archives run to thousands of cases.
 * This one is 306. Walking both listings in full costs eleven fetches — ten
 * pages of twenty at felagsdomur.is, and one page of two hundred at
 * stjornarradid.is, which is the whole of the older half — and no case fetches
 * at all when nothing is new. Cheaper than a single board's incremental page,
 * so there is no incremental mode to get wrong and no cursor to strand.
 * `INGEST_MODE=retry` still works the gap ledger and nothing else.
 */

const BASE = (process.env.FELAGSDOMUR_BASE ?? "https://felagsdomur.is").replace(/\/$/, "");

/** Where the older half lives. Same override the stjornarradid adapter takes. */
const ARCHIVE_BASE = (process.env.STJORNARRADID_BASE ?? STJORNARRADID_BASE).replace(/\/$/, "");

/** The page whose "Birta fleiri færslur" button drives the listing. */
const LISTING_PATH = "/domar-og-urskurdir/";

/**
 * Items per listing request. The server caps a page at about 22 however large
 * a `count` it is given, so asking for more only makes the walk's arithmetic
 * wrong.
 */
const PAGE_SIZE = 20;

/** Refuses to walk forever if the site ever stops returning an empty page. */
const MAX_PAGES = 60;

/** Below this a case is recorded as a gap rather than stored as a judgment. */
const MIN_TEXT_CHARS = 400;

/**
 * The same mojibake guard the stjornarradid adapter uses. Icelandic legal
 * prose runs 9–12% accented characters; a PDF whose font has no usable
 * ToUnicode map extracts as confident-looking rubbish with almost none.
 */
const ICELANDIC_CHARS_RE = /[áðéíóúýþæöÁÐÉÍÓÚÝÞÆÖ]/g;
const MIN_ICELANDIC_RATIO = 0.02;

function looksLikeIcelandic(text: string): boolean {
  if (text.length < MIN_TEXT_CHARS) return false;
  return (text.match(ICELANDIC_CHARS_RE)?.length ?? 0) / text.length >= MIN_ICELANDIC_RATIO;
}

/** Month abbreviations as the listing's date block writes them. */
const MONTH_ABBR: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, maí: 4, jún: 5,
  júl: 6, ágú: 7, sep: 8, okt: 9, nóv: 10, des: 11,
};

function squish(text: string): string {
  return text.replace(/[ ​ ]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * A judgment's canonical page, built from its id alone.
 *
 * The listing writes two different hrefs for the same case — the first page
 * links `/domar-og-urskurdir/domur-urskurdur/?id=…` and the AJAX pages link
 * `/default.aspx?pageid=…&id=…` — and storing whichever came back would file
 * the same judgment under two officialUrls, which is the one column the
 * dedupe key is built on. So the id is extracted and the URL composed here,
 * the same way the stjornarradid adapter composes from `newsid`.
 */
export function judgmentUrl(id: string, base = BASE): string {
  return `${base.replace(/\/$/, "")}${LISTING_PATH}domur-urskurdur/?id=${id}`;
}

/**
 * "F-2/2026" — the court's own label for a case, from either site's wording.
 *
 * felagsdomur.is prints it that way already; the older site titles a case
 * "Mál nr. 10/2009: Dómur frá 1. nóvember 2010" and prints no prefix. Both
 * come through here so one court does not end up with two kinds of case
 * number. Returns undefined when the text carries no case number at all,
 * which is how the signpost entry in the older listing is recognised as not
 * being a case.
 */
const CASE_NUMBER_RE = /\bF?-?(\d{1,3})\/(\d{4})\b/;

export function caseNumberIn(text: string): string | undefined {
  const m = CASE_NUMBER_RE.exec(text);
  return m ? `F-${m[1]}/${m[2]}` : undefined;
}

/**
 * The judgment PDF, which the site caches under the case's own id.
 *
 * Derived rather than read off the detail page, because that saves a fetch per
 * case — the listing already carries everything else we need, so a case costs
 * exactly one request. `fetchJudgmentText` falls back to the detail page when
 * this 404s, so a case whose PDF is filed elsewhere is still stored.
 */
function pdfUrlFor(id: string, base = BASE): string {
  return `${base.replace(/\/$/, "")}/Cache/Verdicts/${id}.pdf`;
}

/**
 * Collapses a letter-spaced heading back into words.
 *
 * Félagsdómur sets its two main headings with a space between every letter:
 * "F É L A G S D Ó M U R" and "D ó m u r   F é l a g s d ó m s". pdf-parse
 * reproduces that faithfully, and left alone it survives into the stored text,
 * where it is unreadable, unsearchable (no token matches "Félagsdómur") and
 * not recognised as the heading it is.
 *
 * Words inside such a line are separated by a run of two or more spaces, which
 * is what makes the two levels recoverable. Deliberately narrow: every token
 * must be a single *letter*, so a line of initials, digits or dates is left
 * alone, and a line with any ordinary word in it is not touched at all.
 */
export function unspaceLetterSpacing(line: string): string {
  const trimmed = line.trim();
  if (trimmed.length > 120 || !trimmed.includes(" ")) return line;

  // "D Ó M S O R Ð:" — the punctuation rides on the last letter, so it is set
  // aside and put back rather than failing the all-single-letters test.
  const tail = /[.:,;]+$/.exec(trimmed)?.[0] ?? "";
  const body = tail ? trimmed.slice(0, -tail.length).trimEnd() : trimmed;

  const words = body.split(/ {2,}/);
  let letters = 0;
  for (const word of words) {
    const tokens = word.split(" ");
    if (!tokens.every((t) => t.length === 1 && /\p{L}/u.test(t))) return line;
    letters += tokens.length;
  }
  // Two letters apart is an initial or a typo, not letter-spacing.
  if (letters < 4) return line;
  return words.map((w) => w.replace(/ /g, "")).join(" ") + tail;
}

/** Every line of a PDF de-letter-spaced, before the text is reflowed. */
function unspaceHeadings(text: string): string {
  return text.split("\n").map(unspaceLetterSpacing).join("\n");
}

/**
 * "Leitin skilaði 200 niðurstöðum" is on the search pane, not here, so the
 * count of cases the court publishes is what the walk actually listed. That
 * is exact rather than approximate: the walk stops on an empty page, so it
 * has seen the whole listing by the time this is used.
 */
/**
 * Which of the court's two sites a case came from. It decides one thing only —
 * where the text is read from — because everything else about a stored case is
 * made the same on purpose. See "One court, two sites" in the header.
 */
type Origin = "felagsdomur" | "archive";

interface ListItem {
  origin: Origin;
  /** The site's own id for the case: a `?id=` GUID, or a `?newsid=` one. */
  id: string;
  url: string;
  /** "F-2/2026" — always F-prefixed, on both halves. */
  caseNumber?: string;
  /** The parties, as the listing writes them over two or three lines. */
  parties: string;
  date?: Date;
  /** The court's own index terms ("Kjarasamningur, Viðbótarmenntun"). */
  keywords: string[];
  /** The court's own útdráttur, where it has published one yet. */
  summary?: string;
}

/**
 * A placeholder where a summary will go. The court publishes the judgment
 * first and writes the útdráttur later, so most of the archive carries one of
 * these — sometimes with the CMS's own escaped markup still in it
 * ("p Útdráttur birtur síðar br/p"). Stored as a summary they would show on
 * the result card under a disclosure arrow promising the court's own words.
 */
const ABSTRACT_PLACEHOLDER_RE = /(?:Útdráttur|Úrskurður)\s+birtur/i;

/** Below this an "abstract" is a disposition line ("Frávísun frá Félagsdómi"),
 *  not the court's summary of the case. */
const MIN_SUMMARY_CHARS = 60;

function cleanAbstract(text: string): string | undefined {
  const cleaned = squish(text);
  if (cleaned.length < MIN_SUMMARY_CHARS) return undefined;
  if (ABSTRACT_PLACEHOLDER_RE.test(cleaned)) return undefined;
  return cleaned;
}

/**
 * The date under the case, from the listing's day/month/year block.
 *
 * This is the date of the judgment, not of its publication: Félagsdómur
 * publishes as it decides. It is the only date this adapter uses — see the
 * note below on why it does not go looking for a second one.
 */
function listingDate(link: Cheerio<AnyNode>): Date | undefined {
  const block = link.find(".media-date").first();
  if (!block.length) return undefined;
  const day = Number(squish(block.find(".day").first().text()));
  const year = Number(squish(block.find(".year").first().text()));
  // The month div wraps the year div, so its own text has to be taken without
  // the child's: "júl2026" otherwise.
  const monthText = squish(block.find(".month").first().clone().children().remove().end().text())
    .replace(/\.$/, "")
    .toLowerCase();
  const month = MONTH_ABBR[monthText];
  if (!day || !year || month === undefined) return undefined;
  const date = new Date(Date.UTC(year, month, day));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * There is deliberately no second opinion on the date.
 *
 * Félagsdómur publishes as it decides, and the listing's date block is the
 * date of the judgment: across a sample spanning the whole archive it agreed
 * with the date the judgment gives itself in every case, in both the modern
 * style ("Dómur miðvikudaginn 1. júlí 2026.") and the older one ("Ár 2010,
 * mánudaginn 21. mars, var í Félagsdómi …").
 *
 * So, unlike the stjornarradid adapter — whose boards publish weeks or months
 * after they rule, and where the ruling's own date is the only true one — this
 * adapter takes the listing's date and does not go looking. Reading a date out
 * of the opening here would be strictly worse: the older judgments put the
 * year and the day in different clauses, and the first "d. month yyyy" in the
 * opening is as likely to be the day the case was taken to judgment
 * ("Mál þetta var dómtekið 1. mars 2010") as the day it was decided.
 */

/** Cases on one listing page, in the order the site returned them. */
function parseListing(html: string): ListItem[] {
  const $ = load(html);
  const items: ListItem[] = [];

  $("a.sentence").each((_, el) => {
    const link = $(el);
    const id = /[?&]id=([0-9a-f-]{36})/i.exec(link.attr("href") ?? "")?.[1];
    if (!id) return;

    // The abstract lives in the modal beside the link, not inside it — and
    // `closest` would return the link itself, which also carries class
    // "sentence". The wrapper is the div of that name around both.
    const box = link.parents("div.sentence").first();
    const summary = cleanAbstract(box.find(".case-abstract").first().text());

    items.push({
      origin: "felagsdomur",
      id,
      url: judgmentUrl(id),
      caseNumber: caseNumberIn(squish(link.find("h2").first().text())),
      parties: squish(link.find("p.ellipsis").first().text()),
      date: listingDate(link),
      keywords: squish(link.find("p.keywords").first().text())
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean),
      summary,
    });
  });

  return items;
}

/**
 * The CMS GUID the listing's "more" endpoint is keyed by, read off the button
 * that uses it. Hardcoding it would fail silently after a site re-deploy —
 * an unknown pageitemid returns an empty list, which is indistinguishable
 * from "no new judgments".
 */
function parsePageItemId(html: string): string | undefined {
  return load(html)("button.moreVer").first().attr("data-pageitemid") || undefined;
}

function listingUrl(pageItemId: string, offset: number): string {
  return `${BASE}/default.aspx?pageitemid=${pageItemId}&offset=${offset}&count=${PAGE_SIZE}`;
}

// ---------------------------------------------------------------------------
// The older half, on stjornarradid.is.
// ---------------------------------------------------------------------------

/** "Sýni 1-107 af 107 niðurstöðum." — the archive's own count. */
const ARCHIVE_TOTAL_RE = /af\s+([\d.]+)\s+niðurstöðum/;

const MONTHS: Record<string, number> = {
  janúar: 0, febrúar: 1, mars: 2, apríl: 3, maí: 4, júní: 5,
  júlí: 6, ágúst: 7, september: 8, október: 9, nóvember: 10, desember: 11,
};
const LONG_DATE_RE = new RegExp(
  `(\\d{1,2})\\.\\s*(${Object.keys(MONTHS).join("|")})\\s*(\\d{4})`,
  "i"
);

function parseLongDate(text: string): Date | undefined {
  const m = LONG_DATE_RE.exec(text);
  if (!m) return undefined;
  const month = MONTHS[m[2].toLowerCase()];
  if (month === undefined) return undefined;
  const date = new Date(Date.UTC(Number(m[3]), month, Number(m[1])));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * One page of the archive listing. There is only ever one: the site returns
 * 200 results a page and the archive is 107 entries.
 *
 * The fields are not where they are on the court's own site, and one of them
 * is not what it is called. The listing's abstract field — index terms for
 * every other body on that site — holds the *parties* for this court, which is
 * exactly what the newer half puts on its cards, so it is read as parties and
 * the case is stored with no subject tags rather than with the parties as one.
 *
 * The date comes from the title ("Dómur frá 1. nóvember 2010") in preference
 * to the item's publication date: the two agree here, and the title's is the
 * court's own statement of when it ruled.
 */
function parseArchiveListing(html: string): { items: ListItem[]; total?: number } {
  const $ = load(html);
  const items: ListItem[] = [];

  $("li.news-item-list__items__item").each((_, el) => {
    const item = $(el);
    const link = item.find('a[href*="stakur-urskurdur"]').first();
    const newsId = /[?&]newsid=([0-9a-f-]+)/i.exec(link.attr("href") ?? "")?.[1];
    if (!newsId) return;
    const title = squish(link.attr("title") || link.text());

    // "Dómar Félagsdóms frá 2010 og til dagsins í dag eru á felagsdomur.is" —
    // a signpost, not a case, and it has no case number to give it away as
    // anything else. Skipped rather than fetched and then recorded as a gap:
    // it is not a case we are missing, it is the site telling us where the
    // rest of the court is, which we already know.
    const caseNumber = caseNumberIn(title);
    if (!caseNumber) return;

    items.push({
      origin: "archive",
      id: newsId,
      url: decisionUrl(newsId, ARCHIVE_BASE),
      caseNumber,
      parties: squish(item.find(".news-item-list__items_item__abstract").first().text()).replace(/\.$/, ""),
      date:
        parseLongDate(title) ??
        parseLongDate(squish(item.find(".news-startdate").first().text())),
      keywords: [],
    });
  });

  const total = ARCHIVE_TOTAL_RE.exec($("body").text())?.[1];
  return { items, total: total ? Number(total.replace(/\./g, "")) : undefined };
}

/**
 * An archived judgment's text, from the page's own rich text.
 *
 * These pages carry the ruling inline — there is no PDF to prefer, unlike the
 * newer half. One line per block node, which is the shape normalizeJudgmentText
 * and the reading view expect; the headings are letter-spaced here too
 * ("D Ó M U R:"), so they go through the same collapse.
 */
function parseArchiveText(html: string): string {
  const $ = load(html);
  const section = $("section.single-news__content").first();
  if (!section.length) return "";

  section.find("br").replaceWith("\n");
  const blocks = section
    .find("p, li, h2, h3, h4, h5, h6, blockquote")
    .filter((_, el) => $(el).parents("p, li, blockquote").length === 0);

  const lines: string[] = [];
  const push = (text: string) => {
    for (const line of text.split("\n")) {
      const cleaned = squish(line);
      if (cleaned) lines.push(unspaceLetterSpacing(cleaned));
    }
  };
  blocks.each((_, el) => push($(el).text()));
  // A few of the oldest rulings put their text straight in the container.
  if (lines.length === 0) push(section.text());

  return normalizeJudgmentText(lines.join("\n"));
}

/**
 * The judgment's text: its PDF, reflowed into paragraphs.
 *
 * Falls back to the detail page's own text layer only when the PDF cannot be
 * had. That layer drops words — see the header — so it is a last resort rather
 * than a second opinion, and the caller is told which one it got so the stored
 * record can point at the right thing.
 */
async function fetchJudgmentText(
  ctx: IngestContext,
  item: ListItem
): Promise<{ text: string; pdfUrl?: string } | null> {
  // The archived half publishes its rulings inline; there is no PDF for them.
  if (item.origin === "archive") {
    const text = parseArchiveText(await ctx.fetchText(item.url));
    return text.length >= MIN_TEXT_CHARS ? { text } : null;
  }

  const pdfUrl = pdfUrlFor(item.id);
  try {
    const { body } = await politeFetchBytes(pdfUrl);
    const { text } = await pdfParse(body);
    const reflowed = normalizeJudgmentText(unspaceHeadings(text));
    if (looksLikeIcelandic(reflowed)) return { text: reflowed, pdfUrl };
    ctx.log(
      `  ${item.caseNumber ?? item.id}: PDF extracted ${reflowed.length} chars with no ` +
        `Icelandic in them — falling back to the page's text layer`
    );
  } catch (e) {
    ctx.log(`  ${item.caseNumber ?? item.id}: PDF failed — ${String(e).slice(0, 120)}`);
  }

  const html = await ctx.fetchText(item.url);
  const fallback = normalizeJudgmentText(unspaceHeadings(load(html)("#verdict-text").first().text()));
  return fallback.length >= MIN_TEXT_CHARS ? { text: fallback } : null;
}

/** A "Lykilorð" or "Útdráttur" line the judgment already carries. */
const HAS_KEYWORDS_RE = /^Lykilorð\b/m;
const HAS_SUMMARY_RE = /^(?:Útdráttur|Reifun|Ágrip)\b/m;

/**
 * The stored record: the court and the case above the judgment itself.
 *
 * The court's index terms and its útdráttur are prepended only when the
 * judgment does not already carry them. Judgments from about 2020 on print
 * both at the head of the PDF, and adding ours unconditionally would store
 * every one of them twice; the older ones print neither, and the listing's
 * copy is then the only one there is.
 */
function composeRecord(item: ListItem, body: string): string {
  const lines: string[] = ["Félagsdómur"];
  if (item.caseNumber) lines.push(`Mál nr. ${item.caseNumber}`);
  if (item.parties) lines.push(item.parties);
  if (item.keywords.length && !HAS_KEYWORDS_RE.test(body)) {
    lines.push("", "Lykilorð", item.keywords.join(". ") + ".");
  }
  if (item.summary && !HAS_SUMMARY_RE.test(body)) {
    lines.push("", "Útdráttur", item.summary);
  }
  lines.push("", "Dómur", body);
  return lines.join("\n");
}

/**
 * How many cases this court has, across both of its sites.
 *
 * Both numbers come out of the run's own walks, so there is nothing to
 * coordinate and no second opinion to go stale: whatever the two listings
 * offered this run is what the progress bar is measured against.
 */
async function recordTotal(ctx: IngestContext, total: number): Promise<void> {
  try {
    await prisma.source.updateMany({
      where: { key: FELAGSDOMUR_KEY },
      data: { totalAvailable: total },
    });
  } catch {
    // Bookkeeping only — never fail a run over it.
  }
}

export const felagsdomurAdapter: IngestionAdapter = {
  key: "felagsdomur",
  name: "Félagsdómur (felagsdomur.is)",
  sourceKeys: [FELAGSDOMUR_KEY],

  async run(ctx: IngestContext): Promise<IngestStats> {
    const stats: IngestStats = { indexed: 0, skipped: 0, errors: 0 };
    const mode = process.env.INGEST_MODE || "recent";
    const maxFetches = Number(process.env.INGEST_MAX_CASES ?? 300);

    let fetches = 0;

    const ingestOne = async (item: ListItem): Promise<void> => {
      fetches++;
      const identity = {
        adapter: "felagsdomur",
        source: FELAGSDOMUR_KEY,
        officialUrl: item.url,
        court: "Félagsdómur",
        caseNumber: item.caseNumber ?? null,
        title: item.parties || (item.caseNumber ?? item.url),
        date: item.date ?? null,
      };

      let fetched: { text: string; pdfUrl?: string } | null;
      try {
        fetched = await fetchJudgmentText(ctx, item);
      } catch (e) {
        stats.errors++;
        stats.errorSample = stats.errorSample ?? String(e);
        ctx.log(`  ${item.caseNumber ?? item.id}: ${String(e).slice(0, 150)}`);
        await ctx.recordGap({ ...identity, reason: "fetch-failed", detail: String(e).slice(0, 300) });
        return;
      }

      if (!fetched || fetched.text.length < MIN_TEXT_CHARS) {
        stats.skipped++;
        await ctx.recordGap({
          ...identity,
          reason: "no-text",
          detail:
            item.origin === "archive"
              ? "the page carried no section.single-news__content to read"
              : `neither ${pdfUrlFor(item.id)} nor the page's text layer yielded a judgment`,
        });
        return;
      }

      try {
        const date = item.date;
        const title = item.parties || `Félagsdómur ${item.caseNumber ?? ""}`.trim();
        const result = await ctx.save({
          source: FELAGSDOMUR_KEY,
          court: "Félagsdómur",
          caseNumber: item.caseNumber,
          caseName: title,
          title,
          date,
          year: date?.getUTCFullYear(),
          language: "is",
          parties: item.parties || undefined,
          subjectTags: item.keywords,
          officialUrl: item.url,
          pdfUrl: fetched.pdfUrl,
          fullText: composeRecord(item, fetched.text),
        });
        if (result === "indexed") stats.indexed++;
        else stats.skipped++;
      } catch (e) {
        stats.errors++;
        stats.errorSample = stats.errorSample ?? String(e);
        ctx.log(`  ${item.caseNumber ?? item.id}: ${String(e).slice(0, 150)}`);
        await ctx.recordGap({ ...identity, reason: "error", detail: String(e).slice(0, 300) });
      }
    };

    // -----------------------------------------------------------------------
    // Retry sweep: the gap ledger and nothing else. One request per case we
    // know exists but could not store, with no listing walk in front of it.
    // -----------------------------------------------------------------------
    if (mode === "retry") {
      const open = await ctx.openGaps([FELAGSDOMUR_KEY]);
      ctx.log(`Retry sweep: ${open.length} outstanding case(s); up to ${maxFetches} fetches.`);
      for (const gap of open) {
        if (fetches >= maxFetches) {
          ctx.log(`Reached INGEST_MAX_CASES=${maxFetches}; re-run to continue.`);
          break;
        }
        // The two halves' URLs carry different id parameters, and that is
        // what says which site a stranded case came from.
        const archived = /[?&]newsid=([0-9a-f-]+)/i.exec(gap.officialUrl)?.[1];
        const id = archived ?? /[?&]id=([0-9a-f-]{36})/i.exec(gap.officialUrl)?.[1];
        if (!id) continue;
        await ingestOne({
          origin: archived ? "archive" : "felagsdomur",
          id,
          url: gap.officialUrl,
          caseNumber: gap.caseNumber ?? undefined,
          parties: "",
          keywords: [],
        });
      }
      ctx.log(`Retry sweep done: ${stats.indexed} recovered, ${stats.skipped} still without text.`);
      return stats;
    }

    // -----------------------------------------------------------------------
    // The listing walks. Always both listings in full — see the header.
    // -----------------------------------------------------------------------
    const known = new Set(
      (
        await prisma.document.findMany({
          where: { source: FELAGSDOMUR_KEY },
          select: { officialUrl: true },
        })
      ).map((d) => d.officialUrl)
    );
    ctx.log(`${known.size} case(s) already stored.`);

    const seen = new Set<string>();
    let budgetSpent = false;

    /** Store whatever of a listing page we do not already hold. */
    const takeItems = async (items: ListItem[]): Promise<void> => {
      for (const item of items) {
        // The listing's pages overlap by an item now and then; a case seen
        // twice in one walk must not be counted twice in the total.
        if (seen.has(item.url)) continue;
        seen.add(item.url);

        if (known.has(item.url)) {
          stats.skipped++;
          continue;
        }
        if (fetches >= maxFetches) {
          if (!budgetSpent) {
            ctx.log(`Reached INGEST_MAX_CASES=${maxFetches}; the rest picks up next run.`);
            budgetSpent = true;
          }
          continue;
        }
        await ingestOne(item);
      }
    };

    // --- the court's own site: case numbers from 2010 on --------------------
    const first = await ctx.fetchText(`${BASE}${LISTING_PATH}`);
    const pageItemId = parsePageItemId(first);
    if (!pageItemId) {
      throw new Error(
        `No button.moreVer[data-pageitemid] on ${BASE}${LISTING_PATH} — the listing's ` +
          `endpoint could not be resolved, and walking it with a stale GUID would ` +
          `return an empty list that reads as "nothing new".`
      );
    }

    // Whether each walk reached the end. Only when both did is `seen` the
    // court's whole published archive and safe to record as a total.
    let liveComplete = false;
    let liveCount = 0;

    for (let page = 0; page < MAX_PAGES; page++) {
      let items: ListItem[];
      try {
        items = parseListing(await ctx.fetchText(listingUrl(pageItemId, page * PAGE_SIZE)));
      } catch (e) {
        stats.errors++;
        stats.errorSample = stats.errorSample ?? String(e);
        ctx.log(`felagsdomur.is listing page ${page} failed — ${String(e).slice(0, 150)}`);
        break;
      }
      if (items.length === 0) {
        liveComplete = true;
        break;
      }
      await takeItems(items);
      liveCount = seen.size;
    }
    ctx.log(
      `felagsdomur.is: ${liveCount} case(s) listed${liveComplete ? "" : " (walk did not reach the end)"}.`
    );

    // --- the archive: case numbers up to 2009 -------------------------------
    // One page of 200 covers all 107 of it, so there is no walk to bound.
    let archiveComplete = false;
    let archiveTotal: number | undefined;
    try {
      const listing = parseArchiveListing(
        await ctx.fetchText(committeeListUrl(FELAGSDOMUR_COMMITTEE, { base: ARCHIVE_BASE }))
      );
      await takeItems(listing.items);
      archiveComplete = true;
      // The site's count includes the signpost entry parseArchiveListing drops,
      // so the cases it listed is the honest figure, not what the site says.
      archiveTotal = listing.items.length;
      ctx.log(
        `stjornarradid.is: ${listing.items.length} case(s) listed` +
          (listing.total !== undefined && listing.total !== listing.items.length
            ? ` (the site says ${listing.total}, counting its "see felagsdomur.is" signpost)`
            : "")
      );
    } catch (e) {
      stats.errors++;
      stats.errorSample = stats.errorSample ?? String(e);
      ctx.log(`stjornarradid.is archive listing failed — ${String(e).slice(0, 150)}`);
    }

    ctx.log(`${seen.size} case(s) published in total, ${fetches} fetched this run.`);
    if (liveComplete && archiveComplete) {
      await recordTotal(ctx, seen.size);
      ctx.log(`Félagsdómur publishes ${liveCount} case(s) from 2010 and ${archiveTotal} before it.`);
    } else {
      ctx.log(`One of the two listings was not walked to the end — total left unchanged.`);
    }

    const open = await ctx.openGaps([FELAGSDOMUR_KEY]);
    if (open.length) {
      ctx.log(`${open.length} case(s) outstanding — run INGEST_MODE=retry to re-attempt them.`);
      for (const g of open.slice(0, 25)) {
        ctx.log(`  [${g.reason}, ${g.attempts}x] ${g.caseNumber ?? ""} ${g.officialUrl}`);
      }
    }
    return stats;
  },
};
