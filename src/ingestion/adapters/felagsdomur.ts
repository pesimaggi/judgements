import { load, type Cheerio } from "cheerio";
import type { AnyNode } from "domhandler";
import pdfParse from "pdf-parse";
import { prisma } from "@/lib/db";
import { normalizeJudgmentText } from "@/lib/judgment-text";
import { ADR_BOARDS, FELAGSDOMUR_KEY, boardListUrl } from "@/lib/adr-boards";
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
 * ONE SOURCE, TWO SITES. The court's archive is split, and this adapter reads
 * only the live half:
 *
 *   - case numbers from 2010 on (F-1/2010 … ), 200 of them, at felagsdomur.is
 *     — this adapter;
 *   - case numbers up to 2009 (107 of them, the last handed down 1 November
 *     2010), on stjornarradid.is under `Committee=Félagsdómur` — the
 *     stjornarradid adapter, which still lists Félagsdómur as one of its
 *     boards for exactly that reason.
 *
 * The two sets are disjoint: the split is by case *number*, not by decision
 * date, and stjornarradid.is says so itself with a placeholder entry reading
 * "Dómar Félagsdóms frá 2010 og til dagsins í dag eru á felagsdomur.is". So
 * both feed the one `felagsdomur` source and the reader gets one checkbox for
 * one court. See FELAGSDOMUR_KEY in src/lib/adr-boards.ts.
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
 * This one is 200. Walking the whole listing costs ten list fetches and no
 * detail fetches at all when nothing is new — cheaper than a single board's
 * incremental page at stjornarradid — so there is no incremental mode to get
 * wrong and no cursor to strand. `INGEST_MODE=retry` still works the gap
 * ledger and nothing else.
 */

const BASE = (process.env.FELAGSDOMUR_BASE ?? "https://felagsdomur.is").replace(/\/$/, "");

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
interface ListItem {
  id: string;
  url: string;
  /** "F-2/2026", as the court labels it. */
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
      id,
      url: judgmentUrl(id),
      caseNumber: squish(link.find("h2").first().text()) || undefined,
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
 * Neither half is the whole archive, so neither adapter may claim the source's
 * total on its own — see FELAGSDOMUR_KEY. This adapter walks its own listing
 * to the end on every run, so it knows its own half exactly, and it reads the
 * other half's count off the one line stjornarradid.is prints on the board's
 * listing ("Sýni 1-107 af 107 niðurstöðum"). One extra request per run.
 *
 * If that request fails the total is left as it was rather than written short:
 * a progress bar reading 307/200 is worse than one that is a run out of date.
 */
const STJORNARRADID_TOTAL_RE = /af\s+([\d.]+)\s+niðurstöðum/;

async function recordTotal(ctx: IngestContext, ownCount: number): Promise<void> {
  const board = ADR_BOARDS.find((b) => b.key === FELAGSDOMUR_KEY);
  if (!board) return;

  let archived: number;
  try {
    const html = await ctx.fetchText(boardListUrl(board));
    const matched = STJORNARRADID_TOTAL_RE.exec(html)?.[1];
    if (!matched) {
      ctx.log(`Could not read the pre-2010 count from stjornarradid.is — total left unchanged.`);
      return;
    }
    archived = Number(matched.replace(/\./g, ""));
  } catch (e) {
    ctx.log(`Pre-2010 count unavailable (${String(e).slice(0, 100)}) — total left unchanged.`);
    return;
  }

  try {
    await prisma.source.updateMany({
      where: { key: FELAGSDOMUR_KEY },
      data: { totalAvailable: ownCount + archived },
    });
    ctx.log(`Félagsdómur publishes ${ownCount} case(s) from 2010 and ${archived} before it.`);
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
          detail: `neither ${pdfUrlFor(item.id)} nor the page's text layer yielded a judgment`,
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
        const id = /[?&]id=([0-9a-f-]{36})/i.exec(gap.officialUrl)?.[1];
        if (!id) continue;
        await ingestOne({
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
    // The listing walk. Always the whole listing — see the header.
    // -----------------------------------------------------------------------
    const first = await ctx.fetchText(`${BASE}${LISTING_PATH}`);
    const pageItemId = parsePageItemId(first);
    if (!pageItemId) {
      throw new Error(
        `No button.moreVer[data-pageitemid] on ${BASE}${LISTING_PATH} — the listing's ` +
          `endpoint could not be resolved, and walking it with a stale GUID would ` +
          `return an empty list that reads as "nothing new".`
      );
    }

    const known = new Set(
      (
        await prisma.document.findMany({
          where: { source: FELAGSDOMUR_KEY },
          select: { officialUrl: true },
        })
      ).map((d) => d.officialUrl)
    );
    ctx.log(`${known.size} case(s) already stored from felagsdomur.is.`);

    const seen = new Set<string>();
    let budgetSpent = false;
    // Whether the walk reached the end of the listing. Only then is `seen` the
    // court's whole published archive and safe to record as a total.
    let walkComplete = false;

    for (let page = 0; page < MAX_PAGES; page++) {
      let items: ListItem[];
      try {
        items = parseListing(await ctx.fetchText(listingUrl(pageItemId, page * PAGE_SIZE)));
      } catch (e) {
        stats.errors++;
        stats.errorSample = stats.errorSample ?? String(e);
        ctx.log(`Listing page ${page} failed — ${String(e).slice(0, 150)}`);
        break;
      }
      if (items.length === 0) {
        walkComplete = true;
        break;
      }

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
    }

    ctx.log(
      `Listing walked${walkComplete ? "" : " (incompletely)"}: ${seen.size} case(s) ` +
        `published, ${fetches} fetched this run.`
    );
    // Only when the walk reached the end of the listing. A run cut short by a
    // failed page would otherwise record a total short of the archive, and the
    // progress bar would read complete while cases were missing. A case that
    // failed to *store* is a different thing and does not affect the count.
    if (walkComplete) await recordTotal(ctx, seen.size);
    else ctx.log(`Listing walk did not reach the end — total left unchanged.`);

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
