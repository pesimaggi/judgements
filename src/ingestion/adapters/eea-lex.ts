import { load, type CheerioAPI } from "cheerio";
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
 * EEA-Lex — the decisions of the EEA Joint Committee that are in force, and
 * the EU acts they brought into the EEA Agreement.
 *
 * efta.int/eea-lex is EFTA's register of EU acts and their standing under the
 * EEA Agreement. Every act that has been taken into the Agreement has a
 * factsheet naming the **Joint Committee Decision (JCD)** that incorporated
 * it, the Annex or Protocol it landed in, the dates it moved through, and the
 * JCD's own text in each language.
 *
 * TWO SOURCES, ONE ADAPTER, because they are two different documents:
 *
 *   `eea-joint-committee` — the **decisions**. One record per JCD, carrying
 *     the decision's own text: "DECISION OF THE EEA JOINT COMMITTEE No 25/2010
 *     of 12 March 2010 amending Annex II … to the EEA Agreement". This is the
 *     legal instrument, and it is what someone looking for a decision of the
 *     Joint Committee is looking for.
 *
 *   `eea-lex` — the **acts**. One record per incorporated EU act, from its
 *     EEA-Lex factsheet: the act's title in English, Icelandic, Norwegian and
 *     German, which decision took it in, the Annex it landed in, and the dates
 *     it moved through. This is the register of what EU law is in force in the
 *     EEA, and the Icelandic titles in it are searchable nowhere else here.
 *
 * The decisions are derived from the acts rather than from a listing of their
 * own: every factsheet names its JCD and links that decision's English text,
 * so grouping the stored factsheets by decision yields both the set of
 * decisions **and** the in-force filter, with no second walk of the site. A
 * decision appears once the first act it incorporated has been ingested, and
 * is retired once the last one falls out of force.
 *
 * ONLY WHAT IS IN FORCE. The register's Case Status facet separates
 * "Incorporated into the EEA Agreement and in force" (9,164 acts) from
 * "Incorporated into the EEA Agreement but no longer in force" (5,421) and
 * from the four pre-incorporation stages. This adapter walks the first of
 * those and nothing else — `case_status:14`, the same filter the site's own
 * URL carries — so a search here never turns up an act that has been
 * superseded or repealed.
 *
 * That filter is not only a starting point but a standing one: an act that
 * falls out of force leaves the listing, and RETIREMENT below removes the
 * stored record to match. Without that step "in force" would mean "was in
 * force when we first saw it", which is worse than not filtering at all.
 *
 * VERIFIED against the live site (August 2026):
 *
 *  - robots.txt disallows /core/, /profiles/, /admin/, /search/ and the user
 *    and comment paths. Neither /eea-lex nor /sites/default/files/ is covered.
 *
 *  - **The listing pages deterministically.** `items_per_page=60` and
 *    `sort_bef_combine=decision_ASC` (oldest Joint Committee Decision first)
 *    give 153 stable pages: 152 full ones and a last page of 44, which is
 *    exactly the 9,164 the facet announces. Sorting is pinned rather than
 *    left at the site's default because a relevance-ordered walk can shuffle
 *    between requests, and a page-by-page walk of a shuffling list silently
 *    both misses and repeats rows.
 *
 *  - **The facet's own count is the denominator.** The active Case Status
 *    facet prints "(9164)" beside its label, so the progress bar is measured
 *    against EFTA's own number rather than against an estimate.
 *
 *  - **The factsheet is server-rendered** with stable Drupal field classes,
 *    checked against factsheets from 1992 and 2009:
 *      h1                                → "Factsheet - 31992D0216"
 *      .field--name-field-english-title  → the EU act's English title
 *      .field--name-field-case-status    → a timeline whose .active item is
 *                                          the act's current status
 *      .celex-grid-item                  → label/value pairs: legal status,
 *                                          Area (EEA Annex or Protocol), the
 *                                          JCD number, "In force in the EEA"
 *      .lex-document                     → the act and the JCD per language
 *      .lex-history-item                 → a dated step, and the documents
 *                                          published at that step
 *    The grid is read generically — every .celex-grid-item, whatever its
 *    label — so a field EFTA adds later is stored rather than dropped.
 *
 * NOT EVERY ACT IN FORCE CAME IN BY A DECISION. The oldest entries in this
 * register were in the Agreement when it was signed: their JCD field holds
 * "Part of the EEA Agreement at the time of signing in 1992." instead of a
 * number, and their history is dated 01.01.1994, the day the Agreement
 * entered into force. They are in force and they belong here, so they are
 * stored — but with no case number and with EFTA's own words as their title,
 * rather than being dressed up as a decision the Joint Committee never took.
 *
 * WHY THE JCD PDFs ARE NOT FETCHED. Each factsheet links the JCD's text as a
 * PDF, and it is tempting to append it for true full-text search. Two measured
 * facts say otherwise. A single JCD incorporates many acts at once, so its
 * text is shared across hundreds of factsheets — JCD 7/1994 alone covers a
 * long stretch of this register. And that PDF is 213 pages, 457,000
 * characters: appending it per factsheet would store the same half-megabyte
 * over and over, for no gain a reader could use. The record therefore carries
 * the JCD's identity, its dates and a link to its text in each language, and
 * points `officialUrl` at the factsheet — the page from which the reader can
 * open any of them.
 *
 * BOUNDED AND RESUMABLE. 9,164 factsheets at the polite fetch rate is far more
 * than one run, so `INGEST_MAX_CASES` bounds the detail fetches. No cursor is
 * needed: every run walks the whole listing, diffs it against what is stored
 * and spends its budget on the oldest thing missing. A quiet run costs the 153
 * listing fetches and no detail fetches at all. `INGEST_MODE=retry` works the
 * gap ledger and fetches no listing.
 */

const BASE = (process.env.EEALEX_BASE ?? "https://www.efta.int").replace(/\/$/, "");

/**
 * The register, filtered to acts in force. `case_status:14` is EFTA's own id
 * for "Incorporated into the EEA Agreement and in force" — the value in the
 * URL the site produces when that facet is ticked.
 */
const IN_FORCE_FACET = process.env.EEALEX_FACET ?? "case_status:14";

/** Rows per listing page. 60 is the largest the site's own selector offers. */
const PAGE_SIZE = Number(process.env.EEALEX_PAGE_SIZE ?? 60);

/** The label the active facet carries, and the text the count sits beside. */
const IN_FORCE_LABEL = "Incorporated into the EEA Agreement and in force";

/** The decisions themselves — one record per Joint Committee Decision. */
export const DECISIONS_SOURCE_KEY = "eea-joint-committee";
export const DECISIONS_NAME = "Sameiginlega EES-nefndin (EEA Joint Committee)";

/** The register of EU acts in force in the EEA — one record per factsheet. */
export const ACTS_SOURCE_KEY = "eea-lex";
export const ACTS_NAME = "EEA-Lex";

/** Below this a composed record is treated as a parse failure, not a record. */
const MIN_RECORD_CHARS = 120;

/**
 * Below this a decision PDF is recorded as a gap rather than stored. The
 * shortest real JCD measured runs to about 1,700 characters; 600 leaves room
 * for one shorter than any seen without accepting an empty extraction.
 */
const MIN_DECISION_CHARS = 600;

/**
 * The retirement guard. A run may retire up to MAX_RETIRE_SHARE of what is
 * stored, or MAX_RETIRE_FLOOR records, whichever is more; beyond that it
 * retires nothing and says so.
 *
 * Withdrawals are a trickle — a handful of acts fall out of force at a time —
 * so a run that wants to delete a large *and* disproportionate share of the
 * source has almost certainly read a listing that changed shape rather than a
 * wave of withdrawals, and deleting thousands of records on the strength of a
 * parse that has started returning less is not a recoverable mistake. The
 * floor is what keeps the share from being absurd on a small store: two
 * withdrawals out of five records is 40%, and is still just two withdrawals.
 */
const MAX_RETIRE_SHARE = 0.2;
const MAX_RETIRE_FLOOR = 50;

function listingUrl(page: number): string {
  const params = new URLSearchParams({
    "f[0]": IN_FORCE_FACET,
    items_per_page: String(PAGE_SIZE),
    sort_bef_combine: "decision_ASC",
    page: String(page),
  });
  return `${BASE}/eea-lex?${params.toString()}`;
}

function squish(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function absolute(href: string): string {
  try {
    return new URL(href, `${BASE}/`).toString();
  } catch {
    return "";
  }
}

/**
 * The count the site prints beside the ticked facet — "(9164)" next to
 * "Incorporated into the EEA Agreement and in force". EFTA's own number for
 * the size of this register, and so the honest denominator for the progress
 * bar. Returns undefined rather than a guess if the facet block has moved.
 */
export function inForceTotal(html: string): number | undefined {
  const $ = load(html);
  let total: number | undefined;
  $(".facet-item").each((_, el) => {
    const item = $(el);
    if (squish(item.find(".facet-item__value").first().text()) !== IN_FORCE_LABEL) return;
    const count = /(\d[\d\s,]*)/.exec(squish(item.find(".facet-item__count").first().text()))?.[1];
    if (count) total = Number(count.replace(/[\s,]/g, ""));
  });
  return total;
}

/** Every factsheet linked from one listing page, in the page's own order. */
export function parseListing(html: string): string[] {
  const $ = load(html);
  const urls: string[] = [];
  const seen = new Set<string>();
  $("a.quicklink[href*='/eea-lex/']").each((_, el) => {
    const url = absolute(($(el).attr("href") ?? "").split("#")[0]);
    if (!url || seen.has(url)) return;
    seen.add(url);
    urls.push(url);
  });
  return urls;
}

/** One published text: the EU act, or the JCD, in one language. */
interface LexDocument {
  /** "EU", "IS", "NO", "LI" — from the flag beside the entry. */
  language: string;
  /** The act's title in that language. */
  description: string;
  /** "Joint Committee Decision in Icelandic: EEA Suppl. No 17, 28.6.1994, p. 1" */
  links: { label: string; url: string }[];
}

/** One dated step in the act's passage into the Agreement. */
interface HistoryStep {
  /** As printed, DD.MM.YYYY. */
  date: string;
  label: string;
  /** The texts published at this step, when it published any. */
  links: { label: string; url: string }[];
}

export interface Factsheet {
  /** "31992D0216" — the EU act's CELEX number, and the factsheet's identity. */
  celex: string;
  /** The EU act's English title. */
  englishTitle: string;
  /** The status highlighted on the page's timeline. */
  caseStatus: string;
  /** Every label/value pair in the detail grid, in the page's own order. */
  details: { label: string; values: string[] }[];
  documents: LexDocument[];
  history: HistoryStep[];
}

const FLAGS: Record<string, string> = {
  "flag-eu": "EU",
  "flag-is": "IS",
  "flag-no": "NO",
  "flag-li": "LI",
};

/** Parses a factsheet page. Returns null if the page is not one. */
export function parseFactsheet($: CheerioAPI, url: string): Factsheet | null {
  const heading = squish($("h1").first().text());
  // \S+ rather than a character class: a CELEX number can carry a
  // parenthesised sequence suffix — "31985Y0604(01)" and "31985Y0604(02)" are
  // two different acts, and a class that stopped at the bracket would file
  // both under the same number.
  const celex = (/Factsheet\s*-\s*(\S+)/.exec(heading)?.[1] ?? slugCelex(url)).toUpperCase();
  if (!celex) return null;

  const englishTitle = squish($(".field--name-field-english-title .field-item").first().text());
  const caseStatus = squish(
    $(".field--name-field-case-status .timeline-item.active .timeline-text").first().text()
  );

  // Read generically rather than by field name: the grid carries the JCD
  // number, the Annex or Protocol area and the in-force flag today, and a
  // field EFTA adds tomorrow lands in the record instead of being dropped.
  const details: { label: string; values: string[] }[] = [];
  $(".celex-grid-item").each((_, el) => {
    const item = $(el);
    const label = squish(item.find(".field-label").first().text()).replace(/:$/, "");
    const values = item
      .find(".field-item")
      .map((_i, v) => squish($(v).text()))
      .get()
      .filter(Boolean);
    if (label && values.length) details.push({ label, values });
  });

  const documents: LexDocument[] = [];
  $(".lex-document").each((_, el) => {
    const doc = $(el);
    const flag = Object.keys(FLAGS).find((c) => doc.find(`.${c}`).length > 0);
    documents.push({
      language: flag ? FLAGS[flag] : "",
      description: squish(doc.find(".lex-document-description").first().text()),
      links: doc
        .find(".lex-document-button a[href]")
        .map((_i, a) => ({ label: squish($(a).text()), url: absolute($(a).attr("href") ?? "") }))
        .get()
        .filter((l) => l.url),
    });
  });

  const history: HistoryStep[] = [];
  $(".lex-history-item").each((_, el) => {
    const step = $(el);
    const date = squish(step.find(".metadata__date").first().text());
    const label = squish(step.find(".metadata__label").first().text());
    const links = step
      .find(".lex-document-button a[href]")
      .map((_i, a) => ({ label: squish($(a).text()), url: absolute($(a).attr("href") ?? "") }))
      .get()
      .filter((l) => l.url);
    if (date || label) history.push({ date, label, links });
  });

  return { celex, englishTitle, caseStatus, details, documents, history };
}

/** "…/eea-lex/31992d0216" → "31992d0216". The fallback identity. */
function slugCelex(url: string): string {
  return /\/eea-lex\/([^/?#]+)/.exec(url)?.[1] ?? "";
}

/** The first value of a detail row, matched on its label case-insensitively. */
function detail(sheet: Factsheet, label: string): string | undefined {
  return sheet.details.find((d) => d.label.toLowerCase() === label.toLowerCase())?.values[0];
}

function detailValues(sheet: Factsheet, label: string): string[] {
  return sheet.details.find((d) => d.label.toLowerCase() === label.toLowerCase())?.values ?? [];
}

/**
 * "007/1994" as the site writes it → "7/1994" as the decision is cited. The
 * leading zeros are a sort key on EFTA's side, not part of the number: the
 * decision itself is headed "DECISION OF THE EEA JOINT COMMITTEE No 7/94".
 *
 * Undefined where the field holds words rather than a number. The acts that
 * were already in the Agreement when it was signed are in this register and
 * in force, but no Joint Committee Decision brought them in — the Agreement
 * did — and EFTA writes "Part of the EEA Agreement at the time of signing in
 * 1992." in the field instead. Passing that sentence through as a case number
 * would put it in the citation badge on every card.
 */
export function jcdNumber(sheet: Factsheet): string | undefined {
  const raw = detail(sheet, "Joint committee decision (JCD)");
  if (!raw) return undefined;
  const m = /^0*(\d+)\s*\/\s*(\d{2,4})$/.exec(raw.trim());
  return m ? `${m[1]}/${m[2]}` : undefined;
}

/**
 * How the act got into the Agreement, in one line: the Joint Committee's
 * decision where there was one, EFTA's own words where there was not.
 */
export function incorporationLabel(sheet: Factsheet): string {
  const jcd = jcdNumber(sheet);
  if (jcd) return `EEA Joint Committee Decision No ${jcd}`;
  const raw = detail(sheet, "Joint committee decision (JCD)");
  return raw ? raw.replace(/\.$/, "") : "Incorporated into the EEA Agreement";
}

/** DD.MM.YYYY, the only date format the history uses. */
export function parseHistoryDate(value: string): Date | undefined {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(value.trim());
  if (!m) return undefined;
  const date = new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * The date of the decision, best first.
 *
 * The Joint Committee's own adoption date is the date of the decision and so
 * the one to file the record under; the entry-into-force date and the EU
 * adoption date stand in when a factsheet's history is thinner than usual.
 *
 * "Commitee" is EFTA's spelling on the page, not a typo here — the label is
 * matched loosely enough to survive their correcting it.
 */
const DATE_LABELS = [
  /adoption of joint commit+ee decision/i,
  /confirmed entry into force date/i,
  /entry into force/i,
  /adoption date in the eu/i,
];

export function decisionDate(sheet: Factsheet): Date | undefined {
  for (const label of DATE_LABELS) {
    for (const step of sheet.history) {
      if (!label.test(step.label)) continue;
      const date = parseHistoryDate(step.date);
      if (date) return date;
    }
  }
  return undefined;
}

/**
 * The year a record belongs to when it has no usable date: from the JCD's own
 * number ("7/94" → 1994, "25/2010" → 2010), and failing that from the CELEX
 * number, whose second through fifth digits are the act's year.
 */
export function fallbackYear(sheet: Factsheet): number | undefined {
  const jcd = jcdNumber(sheet);
  const fromJcd = jcd ? decisionYear(jcd) : undefined;
  if (fromJcd) return fromJcd;
  const fromCelex = /^\d(\d{4})/.exec(sheet.celex)?.[1];
  return fromCelex ? Number(fromCelex) : undefined;
}

/**
 * The year in a decision's number: "7/94" → 1994, "25/2010" → 2010. The
 * Agreement entered into force in 1994, so a two-digit year of 90 or more is
 * last century.
 */
export function decisionYear(number: string): number | undefined {
  const raw = /\/(\d{2,4})$/.exec(number)?.[1];
  if (!raw) return undefined;
  const n = Number(raw);
  if (raw.length === 4) return n;
  return n >= 90 ? 1900 + n : 2000 + n;
}

/** Every link on the page, from both the document list and the history. */
function allLinks(sheet: Factsheet): { label: string; url: string }[] {
  return [
    ...sheet.documents.flatMap((d) => d.links),
    ...sheet.history.flatMap((h) => h.links),
  ];
}

/**
 * The JCD's own text in English, which is what `pdfUrl` points at. The same
 * link appears in the document list and again against the adoption step in the
 * history; whichever a given factsheet carries, this finds it.
 */
function englishJcdLink(sheet: Factsheet): string | undefined {
  return allLinks(sheet).find((l) => /joint committee decision in english/i.test(l.label))?.url;
}

/** EUR-Lex's copy of the EU act, stored for later even though nothing reads it yet. */
function eurLexLink(sheet: Factsheet): string | undefined {
  const links = allLinks(sheet).filter((l) => /eur-?lex\.europa\.eu/i.test(l.url));
  return links.find((l) => /\/EN\//.test(l.url))?.url ?? links[0]?.url;
}

/**
 * The factsheet as stored text.
 *
 * Written to read as a record rather than as a dump of fields: headings carry
 * a colon and field lines are bulleted, which is what keeps the shared
 * judgment parser from reflowing a heading into the paragraph beneath it. The
 * heading names — "Case details", "Documents" — are the ones the EFTA Court
 * records already use, so both EEA sources read alike on the page.
 */
const BULLET = "–";

export function composeRecord(sheet: Factsheet): string {
  const lines: string[] = [sheet.celex, incorporationLabel(sheet)];
  if (sheet.englishTitle) lines.push("", sheet.englishTitle);

  const details: string[] = [];
  if (sheet.caseStatus) details.push(`${BULLET} Case status: ${sheet.caseStatus}`);
  for (const row of sheet.details) details.push(`${BULLET} ${row.label}: ${row.values.join("; ")}`);
  if (details.length) lines.push("", "Case details:", ...details);

  const documents = sheet.documents.filter((d) => d.description || d.links.length);
  if (documents.length) {
    lines.push("", "Documents:");
    for (const doc of documents) {
      if (doc.description) lines.push(`${BULLET} ${doc.language ? `[${doc.language}] ` : ""}${doc.description}`);
      for (const link of doc.links) lines.push(`   ${link.label}`);
    }
  }

  if (sheet.history.length) {
    lines.push("", "History:");
    for (const step of sheet.history) {
      lines.push(`${BULLET} ${[step.date, step.label].filter(Boolean).join(" — ")}`);
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// The decisions.
//
// A JCD has no page of its own on efta.int — it is published as a PDF, one per
// language, under /sites/default/files/…/adopted-joint-committee-decisions/.
// So the English PDF is the decision's `officialUrl`, exactly as the ruling
// PDF is for Óbyggðanefnd and for the Surveillance Authority's documents.
//
// Which decisions exist, and which are in force, is read off the acts already
// stored: each factsheet carries its JCD number in `caseNumber` and that
// decision's English PDF in `pdfUrl`. Grouping them is one query and no
// fetches, and it inherits the in-force filter from the acts pass for free.
// ---------------------------------------------------------------------------

/** A decision to fetch, assembled from the acts that name it. */
export interface DecisionSeed {
  /** "7/1994" — the number as EEA-Lex writes it, normalised. */
  number: string;
  /** The decision's English text: its publication, and its identity here. */
  url: string;
  /** The JCD adoption date off the factsheets, if the PDF does not say. */
  date?: Date;
  /** Annexes and Protocols the acts it incorporated landed in. */
  areas: string[];
}

/**
 * "7/1994" → 1994007, so decisions sort oldest first and in number order
 * within a year. A number that will not parse sorts last rather than throwing.
 */
function decisionRank(number: string): number {
  const m = /^(\d+)\/(\d{2,4})$/.exec(number);
  const year = m ? decisionYear(number) : undefined;
  if (!m || year === undefined) return Number.MAX_SAFE_INTEGER;
  return year * 1000 + Math.min(Number(m[1]), 999);
}

/** Every decision named by an act we have stored, oldest first. */
export async function decisionSeeds(): Promise<DecisionSeed[]> {
  const acts = await prisma.document.findMany({
    where: { source: ACTS_SOURCE_KEY, caseNumber: { not: null }, pdfUrl: { not: null } },
    select: { caseNumber: true, pdfUrl: true, date: true, subjectTags: true },
  });

  const byNumber = new Map<string, DecisionSeed>();
  for (const act of acts) {
    const number = act.caseNumber as string;
    const seed = byNumber.get(number);
    if (!seed) {
      byNumber.set(number, {
        number,
        url: act.pdfUrl as string,
        date: act.date ?? undefined,
        areas: [...act.subjectTags],
      });
      continue;
    }
    // Several acts name the same decision. Keep the first URL and date seen
    // and union the areas: one decision commonly amends more than one Annex.
    if (!seed.date && act.date) seed.date = act.date;
    for (const area of act.subjectTags) if (!seed.areas.includes(area)) seed.areas.push(area);
  }

  return [...byNumber.values()].sort((a, b) => decisionRank(a.number) - decisionRank(b.number));
}

const MONTHS =
  "January|February|March|April|May|June|July|August|September|October|November|December";

/**
 * The decision's own heading, which every JCD from 1994 to 2026 opens with:
 *
 *   DECISION OF THE EEA JOINT COMMITTEE No 25/2010 of 12 March 2010
 *   amending Annex II (Technical regulations, standards, testing and
 *   certification) to the EEA Agreement
 *
 * It gives the decision's date and its subject in the Committee's own words,
 * which beats both the factsheet's dates and anything we could compose. The
 * subject runs to the recitals, so it is closed on "THE EEA JOINT COMMITTEE,"
 * — the address that opens every one of them.
 *
 * The space after "COMMITTEE" is optional because the extraction loses it on
 * some years ("EEA JOINT COMMITTEENo 1/2026"), and the year is matched at two
 * digits as well as four because the early decisions are headed "No 7/94".
 */
const DECISION_HEADING_RE = new RegExp(
  `DECISION\\s+OF\\s+THE\\s+EEA\\s+JOINT\\s+COMMITTEE\\s*No\\s*(\\d{1,3})\\s*/\\s*(\\d{2,4})\\s*` +
    `of\\s+(\\d{1,2})\\s+(${MONTHS})\\s+(\\d{4})\\s*([\\s\\S]{0,400}?)(?=THE\\s+EEA\\s+JOINT\\s+COMMITTEE\\s*,)`,
  "i"
);

/** How much of a decision to look for its heading in. It is the first thing. */
const HEADING_SCAN_CHARS = 6000;

export interface DecisionHeading {
  /** "12 March 2010", as a date. */
  date?: Date;
  /** "amending Annex II (Technical regulations, …) to the EEA Agreement" */
  subject: string;
}

export function parseDecisionHeading(text: string): DecisionHeading | null {
  const m = DECISION_HEADING_RE.exec(text.slice(0, HEADING_SCAN_CHARS));
  if (!m) return null;
  const month = MONTHS.split("|").findIndex((name) => name.toLowerCase() === m[4].toLowerCase());
  const date = month < 0 ? undefined : new Date(Date.UTC(Number(m[5]), month, Number(m[3])));
  return {
    date: date && !Number.isNaN(date.getTime()) ? date : undefined,
    // The newer decisions carry the Official Journal's own reference in
    // brackets after the subject — "[2026/933]" — which is a filing number,
    // not part of what the decision is about.
    subject: squish(m[6]).replace(/\s*\[\d{4}\/\d+\]\s*$/, ""),
  };
}

/**
 * The decision as stored text: the Committee's own heading, the Annexes the
 * acts it carried landed in, and then the decision itself.
 *
 * The list of acts the decision carried is deliberately *not* part of this
 * record. It would grow as the acts backfill advances, and every growth would
 * change the text and so cost another fetch of a PDF whose content had not
 * changed at all. The linkage is not lost by leaving it out: each act's own
 * record names its decision, so "which decision brought in Directive
 * 2009/9/EC" is a search away.
 *
 * The Annexes are in for the same reason in reverse — they are what a reader
 * browses by, and they change far less often than the act list. A decision is
 * composed once, when its PDF is first fetched, so an Annex learned from an
 * act ingested later is not folded in. That is the price of never re-fetching
 * a decision whose text has not changed, and it is worth paying: the decision
 * names its own Annex in the heading above, which is the copy that matters.
 */
export function composeDecision(seed: DecisionSeed, heading: DecisionHeading | null, body: string): string {
  const lines: string[] = [`Decision of the EEA Joint Committee No ${seed.number}`];
  if (heading?.subject) lines.push(heading.subject);

  const details: string[] = [`${BULLET} Decision number: ${seed.number}`];
  if (seed.areas.length) details.push(`${BULLET} Area (EEA Agreement): ${seed.areas.join("; ")}`);
  lines.push("", "Case details:", ...details);

  lines.push("", "Decision:", body);
  return lines.join("\n");
}

async function recordTotal(key: string, total: number): Promise<void> {
  try {
    await prisma.source.updateMany({ where: { key }, data: { totalAvailable: total } });
  } catch {
    // Bookkeeping only — never fail a run over it.
  }
}

export const eeaLexAdapter: IngestionAdapter = {
  key: "eea-lex",
  name: "EEA Joint Committee decisions and the acts they incorporated (efta.int/eea-lex)",
  sourceKeys: [DECISIONS_SOURCE_KEY, ACTS_SOURCE_KEY],

  async run(ctx: IngestContext): Promise<IngestStats> {
    const stats: IngestStats = { indexed: 0, skipped: 0, errors: 0 };
    const mode = process.env.INGEST_MODE || "recent";
    const maxFetches = Number(process.env.INGEST_MAX_CASES ?? 300);
    const maxPages = Number(process.env.EEALEX_MAX_PAGES ?? 400);

    let fetches = 0;

    const ingestOne = async (url: string): Promise<void> => {
      fetches++;
      const identity = {
        adapter: "eea-lex",
        source: ACTS_SOURCE_KEY,
        officialUrl: url,
        court: ACTS_NAME,
        caseNumber: null as string | null,
        title: null as string | null,
        date: null,
      };

      let sheet: Factsheet | null;
      try {
        sheet = parseFactsheet(load(await ctx.fetchText(url)), url);
      } catch (e) {
        stats.errors++;
        stats.errorSample = stats.errorSample ?? String(e);
        ctx.log(`  ${url}: ${String(e).slice(0, 140)}`);
        await ctx.recordGap({
          ...identity,
          reason: /HTTP \d+|fetch failed|ETIMEDOUT|ECONNRESET/i.test(String(e)) ? "fetch-failed" : "error",
          detail: String(e).slice(0, 300),
        });
        return;
      }

      const fullText = sheet ? composeRecord(sheet) : "";
      if (!sheet || fullText.length < MIN_RECORD_CHARS) {
        stats.skipped++;
        await ctx.recordGap({
          ...identity,
          reason: "no-text",
          detail: sheet
            ? `the factsheet composed only ${fullText.length} chars (minimum ${MIN_RECORD_CHARS})`
            : "no CELEX number on the page — not a factsheet, or the selectors have moved",
        });
        return;
      }

      try {
        const date = decisionDate(sheet);
        const title = `${incorporationLabel(sheet)} (${sheet.celex})`;
        const result = await ctx.save({
          source: ACTS_SOURCE_KEY,
          court: ACTS_NAME,
          caseNumber: jcdNumber(sheet),
          // The act's own English title is what a reader recognises the
          // decision by, so it heads the card; the decision's number and the
          // CELEX sit under it as the title.
          caseName: sheet.englishTitle || undefined,
          title,
          date,
          year: date?.getUTCFullYear() ?? fallbackYear(sheet),
          language: "en",
          // The Annex or Protocol the act was placed in — EFTA's own
          // classification of what the decision is about.
          subjectTags: [
            ...detailValues(sheet, "Area (EEA Agreement)"),
            ...detailValues(sheet, "Area (EEA Protocol)"),
          ],
          officialUrl: url,
          pdfUrl: englishJcdLink(sheet),
          htmlUrl: eurLexLink(sheet),
          fullText,
        });
        if (result === "indexed") stats.indexed++;
        else stats.skipped++;
      } catch (e) {
        stats.errors++;
        stats.errorSample = stats.errorSample ?? String(e);
        ctx.log(`  ${url}: ${String(e).slice(0, 140)}`);
        await ctx.recordGap({ ...identity, reason: "error", detail: String(e).slice(0, 300) });
      }
    };

    const ingestDecision = async (seed: DecisionSeed): Promise<void> => {
      fetches++;
      const identity = {
        adapter: "eea-lex",
        source: DECISIONS_SOURCE_KEY,
        officialUrl: seed.url,
        court: DECISIONS_NAME,
        caseNumber: seed.number,
        title: `Decision of the EEA Joint Committee No ${seed.number}`,
        date: seed.date ?? null,
      };

      let body: string;
      try {
        const { body: bytes } = await politeFetchBytes(seed.url);
        body = normalizeJudgmentText((await pdfParse(bytes)).text);
      } catch (e) {
        stats.errors++;
        stats.errorSample = stats.errorSample ?? String(e);
        ctx.log(`  JCD ${seed.number}: ${String(e).slice(0, 140)}`);
        await ctx.recordGap({ ...identity, reason: "fetch-failed", detail: String(e).slice(0, 300) });
        return;
      }

      if (body.length < MIN_DECISION_CHARS) {
        stats.skipped++;
        await ctx.recordGap({
          ...identity,
          reason: "no-text",
          detail: body.length
            ? `the decision PDF extracted only ${body.length} chars`
            : "the decision PDF extracted no text at all",
        });
        return;
      }

      try {
        const heading = parseDecisionHeading(body);
        // The decision's own date beats the factsheets': it is the date
        // printed on the instrument, where theirs is EEA-Lex's record of it.
        const date = heading?.date ?? seed.date;
        const result = await ctx.save({
          source: DECISIONS_SOURCE_KEY,
          court: DECISIONS_NAME,
          caseNumber: seed.number,
          // The Committee's own statement of what the decision does heads the
          // card; the decision's number sits under it.
          caseName: heading?.subject || undefined,
          title: `Decision of the EEA Joint Committee No ${seed.number}`,
          date,
          year: date?.getUTCFullYear() ?? decisionYear(seed.number),
          language: "en",
          subjectTags: seed.areas,
          officialUrl: seed.url,
          pdfUrl: seed.url,
          fullText: composeDecision(seed, heading, body),
        });
        if (result === "indexed") stats.indexed++;
        else stats.skipped++;
      } catch (e) {
        stats.errors++;
        stats.errorSample = stats.errorSample ?? String(e);
        ctx.log(`  JCD ${seed.number}: ${String(e).slice(0, 140)}`);
        await ctx.recordGap({ ...identity, reason: "error", detail: String(e).slice(0, 300) });
      }
    };

    // -----------------------------------------------------------------------
    // Retry sweep: the gap ledger and nothing else, no listing walk in front.
    // Both sources share the ledger, and a gap says which it belongs to.
    // -----------------------------------------------------------------------
    if (mode === "retry") {
      const open = await ctx.openGaps([ACTS_SOURCE_KEY, DECISIONS_SOURCE_KEY]);
      ctx.log(`Retry sweep: ${open.length} outstanding record(s); up to ${maxFetches} fetches.`);
      const seeds = new Map((await decisionSeeds()).map((seed) => [seed.url, seed]));
      for (const gap of open) {
        if (fetches >= maxFetches) {
          ctx.log(`Reached INGEST_MAX_CASES=${maxFetches}; re-run to continue.`);
          break;
        }
        if (gap.source === DECISIONS_SOURCE_KEY) {
          // A decision is only re-attemptable while an act still names it; if
          // none does, the gap is stale and the row below clears it.
          const seed = seeds.get(gap.officialUrl);
          if (seed) await ingestDecision(seed);
          else await ctx.retire(DECISIONS_SOURCE_KEY, [gap.officialUrl]);
        } else {
          await ingestOne(gap.officialUrl);
        }
      }
      ctx.log(`Retry sweep done: ${stats.indexed} recovered, ${stats.skipped} still unread.`);
      return stats;
    }

    // -----------------------------------------------------------------------
    // Decisions pass: no walk of the site at all. The acts already stored say
    // which decisions exist and which are in force, and each one names the
    // English PDF that is the decision itself.
    // -----------------------------------------------------------------------
    if (mode === "decisions") {
      // Records written before the decisions and the acts were told apart:
      // factsheets stored under the decisions key. They are duplicates of the
      // acts source now and are not decisions, so they go.
      const misfiled = (
        await prisma.document.findMany({
          where: { source: DECISIONS_SOURCE_KEY, officialUrl: { contains: "/eea-lex/" } },
          select: { officialUrl: true },
        })
      ).map((d) => d.officialUrl);
      if (misfiled.length) {
        const removed = await ctx.retire(DECISIONS_SOURCE_KEY, misfiled);
        ctx.log(`Retired ${removed} factsheet(s) filed under the decisions source before the split.`);
      }

      const seeds = await decisionSeeds();
      if (seeds.length === 0) {
        ctx.log(`No acts stored yet, so no decisions to fetch — run the acts pass first.`);
        return stats;
      }
      await recordTotal(DECISIONS_SOURCE_KEY, seeds.length);

      const stored = new Set(
        (
          await prisma.document.findMany({
            where: { source: DECISIONS_SOURCE_KEY },
            select: { officialUrl: true },
          })
        ).map((d) => d.officialUrl)
      );
      const missing = seeds.filter((seed) => !stored.has(seed.url));
      stats.skipped += seeds.length - missing.length;
      ctx.log(
        `${seeds.length} decision(s) named by the acts in force; ${stored.size} stored, ` +
          `${missing.length} missing. Up to ${maxFetches} fetches this run.`
      );

      // Oldest decision first, as everywhere else here, so a bounded run
      // always lands on ground no previous run has covered.
      for (const seed of missing) {
        if (fetches >= maxFetches) {
          ctx.log(`Reached INGEST_MAX_CASES=${maxFetches}; ${missing.length - fetches} left for next run.`);
          break;
        }
        await ingestDecision(seed);
      }

      // A decision no act in force names any more has nothing left in force
      // to have done, so it leaves with them. The guard is the acts pass's.
      const named = new Set(seeds.map((seed) => seed.url));
      const orphaned = [...stored].filter((url) => !named.has(url));
      const allowedHere = Math.max(MAX_RETIRE_FLOOR, Math.floor(stored.size * MAX_RETIRE_SHARE));
      if (orphaned.length > allowedHere) {
        ctx.log(
          `${orphaned.length} of ${stored.size} stored decision(s) are named by no act in force — ` +
            `more than the ${allowedHere} this run may retire. Nothing retired; check the acts source first.`
        );
      } else if (orphaned.length) {
        const removed = await ctx.retire(DECISIONS_SOURCE_KEY, orphaned);
        ctx.log(`Retired ${removed} decision(s) whose acts are no longer in force.`);
      }

      const open = await ctx.openGaps([DECISIONS_SOURCE_KEY]);
      if (open.length) {
        ctx.log(`${open.length} decision(s) outstanding — run INGEST_MODE=retry to re-attempt them.`);
        for (const g of open.slice(0, 25)) ctx.log(`  [${g.reason}, ${g.attempts}x] ${g.caseNumber ?? ""} ${g.officialUrl}`);
      }
      ctx.log(`${fetches} decision(s) fetched.`);
      return stats;
    }

    // -----------------------------------------------------------------------
    // Walk the filtered listing in full. It is 153 pages, and walking all of
    // them is what makes both halves of this adapter's job possible: knowing
    // what is missing, and knowing what has fallen out of force.
    // -----------------------------------------------------------------------
    const inForce: string[] = [];
    const seen = new Set<string>();
    let announced: number | undefined;
    let walkedToTheEnd = false;

    for (let page = 0; page < maxPages; page++) {
      let html: string;
      try {
        html = await ctx.fetchText(listingUrl(page));
      } catch (e) {
        // A listing page that will not load costs us the rest of the walk, but
        // not the run: what has already been read is still worth ingesting.
        // walkedToTheEnd stays false, so nothing is retired on a partial view.
        if (page === 0) throw e;
        stats.errors++;
        stats.errorSample = stats.errorSample ?? String(e);
        ctx.log(`Listing page ${page} failed (${String(e).slice(0, 120)}) — walking no further this run.`);
        break;
      }
      if (page === 0) {
        announced = inForceTotal(html);
        ctx.log(
          announced === undefined
            ? `The Case Status facet no longer prints a count — the listing's total is unknown this run.`
            : `EFTA lists ${announced} act(s) incorporated and in force.`
        );
      }
      const urls = parseListing(html);
      if (urls.length === 0) {
        walkedToTheEnd = true;
        break;
      }
      for (const url of urls) {
        if (seen.has(url)) continue;
        seen.add(url);
        inForce.push(url);
      }
    }

    if (inForce.length === 0) {
      throw new Error(
        `No factsheets on ${listingUrl(0)} — the listing could not be read, and an empty ` +
          `list here is indistinguishable from "nothing is in force".`
      );
    }
    if (!walkedToTheEnd) {
      ctx.log(`Stopped at EEALEX_MAX_PAGES=${maxPages}; the listing walk is incomplete.`);
    }
    await recordTotal(ACTS_SOURCE_KEY, announced ?? inForce.length);

    const stored = new Set(
      (
        await prisma.document.findMany({
          where: { source: ACTS_SOURCE_KEY },
          select: { officialUrl: true },
        })
      ).map((d) => d.officialUrl)
    );
    const missing = inForce.filter((url) => !stored.has(url));
    stats.skipped += inForce.length - missing.length;
    ctx.log(
      `Listing carries ${inForce.length} factsheet(s); ${stored.size} stored, ${missing.length} missing. ` +
        `Up to ${maxFetches} fetches this run.`
    );

    // Oldest decision first — the listing is sorted that way, so a bounded run
    // always lands on ground no previous run has covered.
    for (const url of missing) {
      if (fetches >= maxFetches) {
        ctx.log(`Reached INGEST_MAX_CASES=${maxFetches}; ${missing.length - fetches} left for next run.`);
        break;
      }
      await ingestOne(url);
    }

    // -----------------------------------------------------------------------
    // RETIREMENT. An act that is no longer in force leaves this listing, and a
    // record that stays behind would quietly turn "in force" into "was in
    // force when we first saw it". Only a complete walk may retire anything —
    // a truncated one cannot tell a withdrawal from a page it never read.
    // -----------------------------------------------------------------------
    if (walkedToTheEnd && announced !== undefined && inForce.length >= announced) {
      const withdrawn = [...stored].filter((url) => !seen.has(url));
      const allowed = Math.max(MAX_RETIRE_FLOOR, Math.floor(stored.size * MAX_RETIRE_SHARE));
      if (withdrawn.length > allowed) {
        ctx.log(
          `${withdrawn.length} of ${stored.size} stored factsheet(s) are absent from the listing — ` +
            `more than the ${allowed} this run may retire, which reads as a changed listing rather ` +
            `than a wave of withdrawals. Nothing retired; check the site before the next run.`
        );
      } else if (withdrawn.length) {
        const removed = await ctx.retire(ACTS_SOURCE_KEY, withdrawn);
        ctx.log(`Retired ${removed} factsheet(s) no longer in force.`);
      }
    } else if (walkedToTheEnd && announced !== undefined) {
      ctx.log(
        `Walked to the end but read ${inForce.length} of the ${announced} announced — nothing retired.`
      );
    }

    const open = await ctx.openGaps([ACTS_SOURCE_KEY]);
    if (open.length) {
      ctx.log(`${open.length} factsheet(s) outstanding — run INGEST_MODE=retry to re-attempt them.`);
      for (const g of open.slice(0, 25)) ctx.log(`  [${g.reason}, ${g.attempts}x] ${g.officialUrl}`);
    }
    ctx.log(`${fetches} factsheet(s) fetched.`);
    return stats;
  },
};
