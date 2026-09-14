import { load, type CheerioAPI } from "cheerio";
import { pdfText } from "../pdf-text";
import { prisma } from "@/lib/db";
import { normalizeJudgmentText } from "@/lib/judgment-text";
import { politeFetchBytes, type IngestionAdapter, type IngestContext, type IngestStats } from "../adapter";

/**
 * EFTA Court adapter — eftacourt.int.
 *
 * VERIFIED against the live site (an earlier version of this file was written
 * blind, against a site that was unreachable at the time; everything below has
 * since been checked against real responses):
 *
 *  - List: `cases-sitemap.xml`, which enumerates every case page the Court
 *    publishes (461 at the time of writing). Used in preference to the
 *    `/wp-json/wp/v2/cases` REST collection, which pages 2-at-a-time over 231
 *    pages and exposes none of the case metadata — only the title and link.
 *    Case *slugs* are not a reliable identifier: the same site uses
 *    `/cases/e-03-15/`, `/cases/case-e-13-19/`, `/cases/e-0920/` and
 *    `/cases/e-2224/`. The case number is therefore always read off the page.
 *
 *  - Detail: the case page is server-rendered WordPress with a stable,
 *    class-based structure, checked across cases from 1994 to 2026:
 *      h2.p-cases-title-first   → case number, already in citation form ("E-9/13")
 *                                 but not always a lone one — see
 *                                 parseCaseHeading for the five shapes this
 *                                 heading takes, all read off the live site
 *      h2.p-cases-title-second  → the parties ("ESA v The Kingdom of Norway")
 *      p.p-case-details-meta    → one label/value pair each, the label being
 *                                 the nested span.c-case-meta-type
 *      a.o-cases-dl-btn         → one per published document, carrying its own
 *                                 title, date and *language* code
 *      .o-cont-content-grid-content → the Court's own "About this case" note
 *
 * WHAT WE STORE, and why:
 *
 *  The Court publishes each decision as a PDF per language, and its robots.txt
 *  disallows `/download/` and `/wp-content/uploads/` for every user agent —
 *  which is exactly where those PDFs live. So by default this adapter ingests
 *  the case *record* (metadata, subjects, the Court's own summary of the case,
 *  and the list of published documents as links) and does not fetch the PDFs.
 *  That yields a complete, searchable EFTA case register without crawling a
 *  path the Court has asked crawlers to stay out of.
 *
 *  Setting EFTA_FETCH_DOCUMENTS=1 additionally downloads the English decision
 *  PDF for each case and appends its text, giving true full-text search. It is
 *  off by default deliberately: turn it on only with the Court's agreement, or
 *  on your own considered reading of that robots.txt. The Court has given this
 *  deployment that agreement, which is why it is on in production. See README.
 *
 *  Whether a stored row got that text is recorded on the row itself, in
 *  Document.hasDecisionText, rather than guessed at afterwards from how long
 *  the text turned out to be. Two things depend on knowing it: the well, which
 *  must not offer a case register as a judgment (isRegisterOnly in
 *  src/lib/ask/evidence.ts), and this adapter's own skip, which would
 *  otherwise treat a row that never got its decision as finished for ever.
 *
 *  `officialUrl` is the case page — the page carrying every language version —
 *  so "Official source ↗" lands somewhere the reader can pick another
 *  language, exactly as it does for island.is.
 */

const BASE = (process.env.EFTA_BASE ?? "https://eftacourt.int").replace(/\/$/, "");
const SITEMAP = process.env.EFTA_CASES_SITEMAP ?? `${BASE}/cases-sitemap.xml`;

/**
 * One EFTA case number wherever it stands: E-9/13, E-16/11, E-1/94, and the
 * lowercase suffix the Court puts on a revision, E-6/94r.
 */
const CASE_NUMBER_RE = /E-\d{1,3}\/\d{2,4}[a-z]?/g;

/**
 * The words the Court writes around its case numbers in a heading. A heading
 * that holds nothing but case numbers and these is a case heading; anything
 * else means the page is not one, or the site has been redesigned under us.
 *
 * This list is the guard that used to be an anchored match on a single case
 * number — and that anchoring is what kept 30 of the 461 pages in the sitemap
 * out of the corpus for good. They are the Court's joined cases ("Joined Cases
 * E-15/15 and E-16/15"), its costs orders ("E-9/04 COSTS"), its
 * interpretations ("E-2/12 INT") and its revisions ("E-6/94r"), and the
 * ingestion ledger had been re-fetching each of them 137 times to fail on the
 * same regex. Worse than the wasted fetches: a case decided jointly publishes
 * no decision on its own page, so E-15/15, E-16/15 and E-3/13 sat in the
 * corpus as register entries whose judgment the corpus did not hold anywhere.
 */
const HEADING_JOINERS = new Set(["and", "case", "cases", "joined", "costs", "int", "rev"]);

/**
 * The Court numbers a second costs order in the same case "E-9/04 Costs II",
 * so a bare roman numeral is part of a heading too.
 */
const HEADING_ORDINAL_RE = /^[IVX]{1,4}$/i;

/**
 * The case-number heading, split into the number we file the case under and
 * the citation as the Court prints it.
 *
 * The lead number is what goes in `caseNumber`, because that is the column an
 * exact case-number search matches and a costs order in case E-9/04 is looked
 * up as E-9/04. The printed citation is what the record and the title show, so
 * that "and E-16/15" — and the COSTS or INT that makes this a different
 * decision from the judgment — is in front of the reader and in the index.
 *
 * The shapes this heading takes, every one read off the live site:
 *
 *   E-5/21                                    a case on its own
 *   Joined Cases E-3/13 and E-20/13           two cases decided together,
 *   JOINED CASES E-15/15 and E-16/15          in either case and with or
 *   E-9/07 and E-10/07                        without the leading words
 *   E-5/04, E-6/04, and E-7/04                three or more, comma-separated
 *   E-9/04 COSTS · E-9/04 Costs II            a costs order, and a second one
 *   E-2/12 INT                                an interpretation
 *   E-6/94r                                   a revision
 *
 * and one more, where the parties follow the numbers after an en dash:
 * "Joined Cases E-31/24 and E-32/24 – Toska ehf. … v EFTA Surveillance
 * Authority".
 */
function parseCaseHeading(heading: string): { caseNumber: string; citation: string } | null {
  // "Joined Cases E-31/24 and E-32/24 – Toska ehf. v ESA": from the dash on it
  // is the parties, which h2.p-cases-title-second carries in full anyway.
  const citation = squish(heading.split(/\s[\u2013\u2014-]\s/)[0]);
  const numbers = citation.match(CASE_NUMBER_RE);
  if (!numbers?.length) return null;

  const residue = citation.replace(CASE_NUMBER_RE, " ").split(/[\s,.]+/).filter(Boolean);
  const isJoiner = (word: string) =>
    HEADING_JOINERS.has(word.toLowerCase()) || HEADING_ORDINAL_RE.test(word);
  if (!residue.every(isJoiner)) return null;

  return { caseNumber: numbers[0], citation };
}

/**
 * Case "Type" codes used on the site. Both observed values are expanded;
 * anything else is passed through as-is rather than guessed at.
 */
const CASE_TYPES: Record<string, string> = {
  AO: "Advisory Opinion",
  DA: "Direct Action",
};

/**
 * Document kinds worth ingesting as the decision text, best first. Matched
 * against the document's title. Notifications, applications and press releases
 * are deliberately absent — they are not the Court's decision.
 */
const DECISION_KINDS = [
  /\bjudgment\b/i,
  /\badvisory opinion\b/i,
  /\border\b/i,
  /\breport for the hearing\b/i,
  /\bRH\b/,
];

/**
 * Headings are written with a trailing colon and field lines as list items so
 * that the shared judgment parser keeps the record's structure. It reflows
 * anything that looks line-wrapped, and without those cues it runs a heading
 * into the paragraph beneath it — which would, among other things, hide the
 * summary from the result card.
 */
const SUMMARY_HEADING = "Summary";
const BULLET = "–";

/** Below this, a composed case record is treated as a parse failure. */
const MIN_RECORD_CHARS = 120;

function absolute(href: string): string {
  try {
    return new URL(href, `${BASE}/`).toString();
  } catch {
    return "";
  }
}

function squish(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** DD/MM/YYYY as the site writes every date. Returns undefined for "". */
function parseSiteDate(value: string | undefined): Date | undefined {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((value ?? "").trim());
  if (!m) return undefined;
  const [, dd, mm, yyyy] = m;
  const date = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * The year encoded in a case number — "E-12/26" → 2026, "E-1/94" → 1994.
 * The Court opened in 1994, so a two-digit year of 90+ is last century.
 * Lets a pending case (no judgment date yet) still be filtered by year.
 */
function yearFromCaseNumber(caseNumber: string): number | undefined {
  const m = /\/(\d{2,4})[a-z]?$/.exec(caseNumber);
  if (!m) return undefined;
  const raw = Number(m[1]);
  if (m[1].length === 4) return raw;
  return raw >= 90 ? 1900 + raw : 2000 + raw;
}

/** Every case page URL listed in the cases sitemap, in document order. */
function caseUrlsFromSitemap(xml: string): { url: string; lastmod?: Date }[] {
  const out: { url: string; lastmod?: Date }[] = [];
  const seen = new Set<string>();
  const entry = /<url>([\s\S]*?)<\/url>/g;
  let m: RegExpExecArray | null;

  while ((m = entry.exec(xml)) !== null) {
    const block = m[1];
    // The Court's sitemap wraps every value in CDATA; tolerate both forms.
    const loc = /<loc>\s*(?:<!\[CDATA\[)?\s*([^\]<\s]+)/.exec(block)?.[1];
    if (!loc || !/\/cases\//.test(loc) || seen.has(loc)) continue;
    seen.add(loc);
    const lastmodRaw = /<lastmod>\s*(?:<!\[CDATA\[)?\s*([^\]<\s]+)/.exec(block)?.[1];
    const lastmod = lastmodRaw && !Number.isNaN(Date.parse(lastmodRaw)) ? new Date(lastmodRaw) : undefined;
    out.push({ url: loc, lastmod });
  }
  return out;
}

interface CaseDocument {
  title: string;
  date: string;
  language: string;
  url: string;
}

interface CaseRecord {
  /** The number the case is filed under — the lead one for a joined case. */
  caseNumber: string;
  /** The heading as the Court prints it: "Joined Cases E-15/15 and E-16/15". */
  citation: string;
  parties: string;
  meta: Map<string, string>;
  documents: CaseDocument[];
  about: string[];
}

/** Parses a case page into its constituent parts. Returns null if it is not one. */
function parseCasePage($: CheerioAPI): CaseRecord | null {
  const heading = parseCaseHeading(squish($("h2.p-cases-title-first").first().text()));
  if (!heading) return null;

  const meta = new Map<string, string>();
  $("p.p-case-details-meta").each((_, el) => {
    const row = $(el);
    const label = squish(row.find("span.c-case-meta-type").first().text()).replace(/:$/, "");
    if (!label) return;
    const value = row.clone();
    value.find("span.c-case-meta-type").remove();
    const text = squish(value.text());
    if (text) meta.set(label, text);
  });

  const documents: CaseDocument[] = [];
  $("a.o-cases-dl-btn").each((_, el) => {
    const link = $(el);
    const url = absolute(link.attr("href") ?? "");
    if (!url) return;
    // The file label has the date nested inside it; drop the nested spans so
    // the two do not run together into "9 13 Judgment 15/11/2013".
    const file = link.find(".o-cases-dl-file").clone();
    file.find("span").remove();
    documents.push({
      title: squish(file.text()),
      date: squish(link.find(".o-cases-dl-date").text()),
      language: squish(link.find(".o-cases-dl-lang").text()).toUpperCase(),
      url,
    });
  });

  const about = $(".o-cont-content-grid-content")
    .find("p")
    .map((_, el) => squish($(el).text()))
    .get()
    .filter(Boolean);

  return { ...heading, parties: squish($("h2.p-cases-title-second").first().text()), meta, documents, about };
}

/**
 * The Court's decision in English, if it published one. Language is read from
 * the document's own language badge rather than guessed from the filename,
 * because every case carries the same decision in several languages.
 */
function englishDecision(documents: CaseDocument[]): CaseDocument | undefined {
  const english = documents.filter((d) => d.language === "EN");
  for (const kind of DECISION_KINDS) {
    const hit = english.find((d) => kind.test(d.title));
    if (hit) return hit;
  }
  return undefined;
}

/**
 * The case record as stored text. Written to read as a document rather than as
 * a dump of fields, because this is what search matches on and what the reader
 * sees on the document page.
 *
 * The "Summary" heading is load-bearing: extractSummary() keys off it to show
 * the Court's own note about the case on the result card, the same way
 * Icelandic judgments surface their "Útdráttur".
 */
function composeRecord(record: CaseRecord): string {
  const { citation, parties, meta, documents, about } = record;
  const lines: string[] = [citation];
  if (parties) lines.push(parties);

  if (about.length) {
    lines.push("", `${SUMMARY_HEADING}:`, ...about);
  }

  const details: string[] = [];
  for (const [label, value] of meta) {
    if (label === "Type") {
      const expanded = CASE_TYPES[value];
      details.push(`${BULLET} Type: ${expanded ? `${expanded} (${value})` : value}`);
    } else {
      details.push(`${BULLET} ${label}: ${value}`);
    }
  }
  if (details.length) lines.push("", "Case details:", ...details);

  if (documents.length) {
    lines.push("", "Documents:");
    for (const d of documents) {
      const suffix = [d.date, d.language].filter(Boolean).join(", ");
      lines.push(`${BULLET} ${suffix ? `${d.title} (${suffix})` : d.title}`);
    }
  }

  return lines.join("\n");
}

async function fetchPdfText(url: string): Promise<string> {
  const { body } = await politeFetchBytes(url);
  const text = await pdfText(body);
  return normalizeJudgmentText(text);
}

/**
 * Reports what the live site serves, without saving anything — the quick check
 * to run after the site is redesigned and this adapter starts finding nothing.
 */
async function probe(ctx: IngestContext): Promise<void> {
  ctx.log(`Probing ${SITEMAP}`);
  const cases = caseUrlsFromSitemap(await ctx.fetchText(SITEMAP));
  ctx.log(`  sitemap lists ${cases.length} case pages`);
  for (const c of cases.slice(0, 3)) {
    const record = parseCasePage(load(await ctx.fetchText(c.url)));
    if (!record) {
      ctx.log(`  ${c.url} — NOT parseable as a case page (selectors have moved)`);
      continue;
    }
    const decision = englishDecision(record.documents);
    ctx.log(`  ${record.caseNumber} — ${record.parties}`);
    ctx.log(`    meta: ${Array.from(record.meta.entries()).map(([k, v]) => `${k}=${v}`).join("; ")}`);
    ctx.log(`    ${record.documents.length} documents; English decision: ${decision?.title ?? "none"}`);
    ctx.log(`    record would be ${composeRecord(record).length} chars`);
  }
}

export const eftaCourtAdapter: IngestionAdapter = {
  key: "efta-court",
  name: "EFTA Court (eftacourt.int, English)",
  sourceKeys: ["eftacourt"],

  async run(ctx: IngestContext): Promise<IngestStats> {
    const stats: IngestStats = { indexed: 0, skipped: 0, errors: 0 };

    if (process.env.INGEST_PROBE === "1") {
      await probe(ctx);
      return stats;
    }

    const fetchDocuments = process.env.EFTA_FETCH_DOCUMENTS === "1";
    const maxCases = Number(process.env.INGEST_MAX_CASES ?? 1000);
    const force = process.env.INGEST_FULL === "1";

    let cases: { url: string; lastmod?: Date }[];
    try {
      cases = caseUrlsFromSitemap(await ctx.fetchText(SITEMAP));
    } catch (e) {
      stats.errors++;
      stats.errorSample = String(e);
      ctx.log(`Could not read ${SITEMAP}: ${String(e).slice(0, 200)}`);
      return stats;
    }

    if (cases.length === 0) {
      ctx.log(`${SITEMAP} listed no case pages — the sitemap's shape has changed.`);
      return stats;
    }
    ctx.log(
      `${cases.length} cases listed; decision PDFs ${fetchDocuments ? "WILL" : "will not"} be fetched ` +
        `(EFTA_FETCH_DOCUMENTS=${fetchDocuments ? "1" : "unset"})`
    );

    // The sitemap is the Court's own count of its register, so it is an exact
    // denominator for the progress bar rather than an estimate.
    await prisma.source.updateMany({
      where: { key: "eftacourt" },
      data: { totalAvailable: cases.length },
    });

    // One query rather than 461: a case page is only re-fetched when the
    // sitemap says it changed since we last stored it. Pending cases get a
    // new lastmod whenever their court diary moves, so they still refresh.
    //
    // Except that "unchanged" and "finished" are not the same thing. A case
    // decided in 2022 never changes again, so a row stored before this
    // adapter fetched decision PDFs would keep its register entry for ever:
    // switching EFTA_FETCH_DOCUMENTS on fixes nothing retroactively, because
    // the only cases it reaches are the ones that move afterwards. A row with
    // no recorded answer about its decision text is unfinished, and the skip
    // does not apply to it. Recording the answer is what makes that converge
    // — one sweep, not a sweep per run, which is all INGEST_FULL can offer.
    const stored = new Map<string, { seenAt: Date; incomplete: boolean }>();
    if (!force) {
      const rows = await prisma.document.findMany({
        where: { source: "eftacourt" },
        select: { officialUrl: true, updatedAt: true, hasDecisionText: true },
      });
      for (const row of rows) {
        stored.set(row.officialUrl, {
          seenAt: row.updatedAt,
          incomplete: fetchDocuments && row.hasDecisionText === null,
        });
      }
    }

    let visited = 0;
    for (const entry of cases) {
      if (visited >= maxCases) {
        ctx.log(`Stopping at INGEST_MAX_CASES=${maxCases}; re-run to continue.`);
        break;
      }

      const seen = stored.get(entry.url);
      if (seen && !seen.incomplete && entry.lastmod && entry.lastmod <= seen.seenAt) {
        stats.skipped++;
        continue;
      }
      visited++;

      try {
        const record = parseCasePage(load(await ctx.fetchText(entry.url)));
        if (!record) {
          stats.skipped++;
          ctx.log(`  ${entry.url}: no case number found — not a case page, skipped`);
          // The sitemap is the denominator for this source's progress bar, so
          // a URL it lists that we cannot parse is exactly the difference
          // between the bar and 100%. Record it rather than only logging it.
          await ctx.recordGap({
            adapter: eftaCourtAdapter.key,
            source: "eftacourt",
            officialUrl: entry.url,
            court: "EFTA Court",
            reason: "no-text",
            detail: "no case number found on the page — parseCasePage returned nothing",
          });
          continue;
        }

        let fullText = composeRecord(record);
        if (fullText.length < MIN_RECORD_CHARS) {
          stats.skipped++;
          ctx.log(`  ${record.caseNumber}: record of only ${fullText.length} chars — skipped as a likely parse failure`);
          await ctx.recordGap({
            adapter: eftaCourtAdapter.key,
            source: "eftacourt",
            officialUrl: entry.url,
            court: "EFTA Court",
            caseNumber: record.caseNumber,
            title: record.parties || null,
            reason: "no-text",
            detail: `record of only ${fullText.length} chars (minimum ${MIN_RECORD_CHARS})`,
          });
          continue;
        }

        const decision = englishDecision(record.documents);

        // What this run found out about the decision text, which is a
        // different question from how long the record turned out to be. Null
        // means unanswered: either we did not look, or we looked and the
        // attempt failed, and both must be asked again. A settled "no" —
        // nothing published in English, or a PDF that holds no text to
        // extract — is recorded as false so the case is not re-fetched every
        // three hours for an answer that will not change.
        let hasDecisionText: boolean | null = null;
        if (fetchDocuments) {
          if (!decision) {
            hasDecisionText = false;
          } else {
            try {
              const text = await fetchPdfText(decision.url);
              if (text.length > 0) {
                fullText += `\n\n${decision.title}\n${text}`;
                hasDecisionText = true;
              } else {
                // The Court's oldest orders are scans, and pdf-parse returns
                // newlines for them. Nothing short of OCR will change that.
                hasDecisionText = false;
                ctx.log(`  ${record.caseNumber}: "${decision.title}" produced no extractable text`);
              }
            } catch (e) {
              ctx.log(`  ${record.caseNumber}: could not read "${decision.title}" (${String(e).slice(0, 100)})`);
            }
          }
        }

        const judgmentDate = parseSiteDate(record.meta.get("Judgment date"));
        const subjects = (record.meta.get("Subjects") ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);

        const result = await ctx.save({
          source: "eftacourt",
          court: "EFTA Court",
          caseNumber: record.caseNumber,
          caseName: record.parties || undefined,
          title: record.parties ? `${record.citation} ${record.parties}` : record.citation,
          date: judgmentDate,
          // A pending case has no judgment date but still belongs to a year.
          year: judgmentDate?.getUTCFullYear() ?? yearFromCaseNumber(record.caseNumber),
          language: "en",
          parties: record.parties || undefined,
          subjectTags: subjects,
          officialUrl: entry.url,
          pdfUrl: decision?.url,
          fullText,
          hasDecisionText,
        });
        if (result === "indexed") stats.indexed++;
        else stats.skipped++;
      } catch (e) {
        stats.errors++;
        stats.errorSample = stats.errorSample ?? String(e);
        ctx.log(`  error on ${entry.url}: ${String(e).slice(0, 200)}`);
        await ctx.recordGap({
          adapter: eftaCourtAdapter.key,
          source: "eftacourt",
          officialUrl: entry.url,
          court: "EFTA Court",
          reason: /HTTP \d+|fetch failed|ETIMEDOUT|ECONNRESET/i.test(String(e))
            ? "fetch-failed"
            : "error",
          detail: String(e).slice(0, 300),
        });
      }
    }

    // A case still in the ledger is the entire difference between the
    // sitemap's count and ours, named rather than merely subtracted.
    const open = await ctx.openGaps(["eftacourt"]);
    if (open.length) {
      ctx.log(`${open.length} case(s) outstanding:`);
      for (const g of open.slice(0, 40)) ctx.log(`  [${g.reason}, ${g.attempts}x] ${g.caseNumber ?? "?"} ${g.officialUrl}`);
      if (open.length > 40) ctx.log(`  …and ${open.length - 40} more`);
    }

    return stats;
  },
};
