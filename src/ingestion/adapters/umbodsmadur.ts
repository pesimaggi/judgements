import { load, type CheerioAPI } from "cheerio";
import { prisma } from "@/lib/db";
import type { IngestionAdapter, IngestContext, IngestStats } from "../adapter";

/**
 * Umboðsmaður Alþingis adapter — umbodsmadur.is (álit og bréf).
 *
 * VERIFIED against the live site:
 *
 *  - There is no usable list endpoint. The site's own search (/alit-og-bref/
 *    leitarvel) is an ASP.NET WebForms page driven by __VIEWSTATE postbacks,
 *    which is both fragile to drive and pointless here, because case pages are
 *    addressed by a plain sequential integer:
 *      /alit-og-bref/mal/nr/{id}/skoda/mal/
 *    Walking that id space is the list. Ids run from 1 to roughly 11,455 at
 *    the time of writing, with gaps that answer 404 — those are skipped.
 *
 *  - One fetch per case is enough. `/skoda/reifun` shows only the summary;
 *    `/skoda/mal/` carries the summary *and* the full opinion, in two
 *    siblings inside section.case:
 *      h3            → the subject line ("Aðgangur að gögnum. Vinnuskjal.")
 *      h4            → "(Mál nr. 267/2025)"
 *      div.reifun    → the office's own summary, ending with the closing
 *                      sentence that carries the date the case was concluded
 *      div.alit      → the full opinion or letter
 *    The page's h1 is the kind of document, "Álit" or "Bréf".
 *
 * The summary is stored under an "Útdráttur" heading — the same heading
 * Hæstiréttur uses — so it surfaces on result cards through the existing
 * summary extraction with no special-casing. The body follows under its own
 * "Álit"/"Bréf" heading, which is what stops the summary running into it.
 *
 * Ingestion walks newest first (highest id down), so a run that is cut short
 * has still fetched the most recent material. Ids already stored are skipped
 * without an HTTP request, which is what lets the same walk serve both the
 * historical backfill and the weekly pickup of new cases.
 */

const BASE = (process.env.UMBODSMADUR_BASE ?? "https://umbodsmadur.is").replace(/\/$/, "");
const caseUrl = (id: number) => `${BASE}/alit-og-bref/mal/nr/${id}/skoda/mal/`;

/** "(Mál nr. 267/2025)" — the office's own case number. */
const CASE_NUMBER_RE = /Mál\s+nr\.\s*([\d]+\/\d{4})/i;

/** Icelandic long-form dates, as the closing sentence writes them. */
const MONTHS: Record<string, number> = {
  janúar: 0, febrúar: 1, mars: 2, apríl: 3, maí: 4, júní: 5,
  júlí: 6, ágúst: 7, september: 8, október: 9, nóvember: 10, desember: 11,
};
const DATE_RE = new RegExp(`(\\d{1,2})\\.\\s*(${Object.keys(MONTHS).join("|")})\\s*(\\d{4})`, "i");

/** Below this a page is treated as a gap or a stub rather than a case. */
const MIN_TEXT_CHARS = 200;

/**
 * How far above the newest id linked from the front page to keep probing.
 * The front page lists the most recent cases, so this only has to cover
 * anything published between that list being built and this run.
 */
const ID_LOOKAHEAD = Number(process.env.UMBODSMADUR_ID_LOOKAHEAD ?? 25);

function squish(text: string): string {
  return text.replace(/ /g, " ").replace(/\s+/g, " ").trim();
}

/** Paragraph-per-line text of a container, blank lines dropped. */
function blockText($: CheerioAPI, selector: string): string {
  const node = $(selector).first();
  if (!node.length) return "";
  const parts = node
    .find("p, li")
    .map((_, el) => squish($(el).text()))
    .get()
    .filter(Boolean);
  // Some older cases put the text straight in the div with <br> separators
  // rather than in <p> elements.
  if (parts.length === 0) return squish(node.text());
  return parts.join("\n");
}

function parseIcelandicDate(text: string): Date | undefined {
  const m = DATE_RE.exec(text);
  if (!m) return undefined;
  const month = MONTHS[m[2].toLowerCase()];
  if (month === undefined) return undefined;
  const date = new Date(Date.UTC(Number(m[3]), month, Number(m[1])));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** The year in "267/2025". */
function yearFromCaseNumber(caseNumber: string): number | undefined {
  const m = /\/(\d{4})$/.exec(caseNumber);
  return m ? Number(m[1]) : undefined;
}

interface CaseRecord {
  kind: string;
  caseNumber: string;
  subjects: string[];
  summary: string;
  body: string;
}

function parseCasePage($: CheerioAPI): CaseRecord | null {
  const section = $("section.case").first();
  if (!section.length) return null;

  const caseNumber = CASE_NUMBER_RE.exec(squish(section.find("h4").first().text()))?.[1];
  if (!caseNumber) return null;

  // "Atvinnuréttindi. Valdframsal. Valdþurrð." — the office's own index terms,
  // written as one sentence-cased line and separated by full stops.
  const subjects = squish(section.find("h3").first().text())
    .split(".")
    .map((s) => s.trim())
    .filter((s) => s.length > 1);

  return {
    kind: squish($(".page-header h1").first().text()) || "Álit",
    caseNumber,
    subjects,
    summary: blockText($, "section.case div.reifun"),
    body: blockText($, "section.case div.alit"),
  };
}

function composeRecord(record: CaseRecord): string {
  const lines: string[] = [`Mál nr. ${record.caseNumber}`];
  if (record.subjects.length) lines.push(record.subjects.join(". ") + ".");
  // "Útdráttur" is what Hæstiréttur calls its summary, and what the shared
  // extractor looks for — reusing it means the result card works unchanged.
  if (record.summary) lines.push("", "Útdráttur", record.summary);
  if (record.body) lines.push("", record.kind, record.body);
  return lines.join("\n");
}

/**
 * The highest case id the site currently publishes, taken from the ids linked
 * on the front page plus a small margin. Falls back to the highest id already
 * stored, so a run still works if the front page changes shape.
 */
async function newestId(ctx: IngestContext, storedMax: number): Promise<number> {
  try {
    const html = await ctx.fetchText(`${BASE}/`);
    const ids = Array.from(html.matchAll(/\/alit-og-bref\/mal\/nr\/(\d+)\//g)).map((m) => Number(m[1]));
    const found = ids.length ? Math.max(...ids) : 0;
    if (found > 0) return found + ID_LOOKAHEAD;
    ctx.log("No case links found on the front page; falling back to the highest stored id.");
  } catch (e) {
    ctx.log(`Could not read the front page (${String(e).slice(0, 120)}); using the highest stored id.`);
  }
  return storedMax + ID_LOOKAHEAD;
}

export const umbodsmadurAdapter: IngestionAdapter = {
  key: "umbodsmadur",
  name: "Umboðsmaður Alþingis (álit og bréf)",
  sourceKeys: ["umbodsmadur"],

  async run(ctx: IngestContext): Promise<IngestStats> {
    const stats: IngestStats = { indexed: 0, skipped: 0, errors: 0 };
    const maxFetches = Number(process.env.INGEST_MAX_CASES ?? 500);

    // One query rather than one per id: which ids we already hold. Walking a
    // known id costs nothing this way, so the same descending walk both
    // backfills history and picks up whatever is new at the top.
    // INGEST_FULL=1 ignores what is stored and re-fetches everything.
    const known = new Set(
      process.env.INGEST_FULL === "1"
        ? []
        : (
            await prisma.document.findMany({
              where: { source: "umbodsmadur" },
              select: { officialUrl: true },
            })
          ).map((d) => d.officialUrl)
    );

    const storedMax = Array.from(known)
      .map((u) => Number(/\/nr\/(\d+)\//.exec(u)?.[1] ?? 0))
      .reduce((a, b) => Math.max(a, b), 0);

    const startId = Number(process.env.UMBODSMADUR_START_ID ?? (await newestId(ctx, storedMax)));
    const stopId = Number(process.env.UMBODSMADUR_STOP_ID ?? 1);
    ctx.log(
      `Walking ids ${startId} → ${stopId}, newest first. ` +
        `${known.size} already stored; up to ${maxFetches} fetches this run.`
    );

    let fetches = 0;
    let consecutiveMisses = 0;

    for (let id = startId; id >= stopId; id--) {
      if (fetches >= maxFetches) {
        ctx.log(`Reached INGEST_MAX_CASES=${maxFetches} at id ${id}; re-run to continue.`);
        break;
      }

      const url = caseUrl(id);
      if (known.has(url)) {
        stats.skipped++;
        continue;
      }

      fetches++;
      let html: string;
      try {
        html = await ctx.fetchText(url);
      } catch (e) {
        // A 404 is a gap in the id space, which is normal and not an error.
        if (/HTTP 404/.test(String(e))) {
          stats.skipped++;
          consecutiveMisses++;
          continue;
        }
        stats.errors++;
        stats.errorSample = stats.errorSample ?? String(e);
        ctx.log(`  id ${id}: ${String(e).slice(0, 150)}`);
        continue;
      }

      try {
        const record = parseCasePage(load(html));
        if (!record) {
          // The site answers 200 with its "Síða ekki til" template for some
          // missing ids, so an unparseable page is a gap too, not a failure.
          stats.skipped++;
          consecutiveMisses++;
          continue;
        }
        consecutiveMisses = 0;

        const fullText = composeRecord(record);
        if (fullText.length < MIN_TEXT_CHARS) {
          stats.skipped++;
          ctx.log(`  ${record.caseNumber}: only ${fullText.length} chars — skipped rather than stored empty`);
          continue;
        }

        const date = parseIcelandicDate(record.summary) ?? parseIcelandicDate(record.body);
        const title = `Mál nr. ${record.caseNumber}${record.subjects.length ? ` — ${record.subjects.join(". ")}` : ""}`;

        const result = await ctx.save({
          source: "umbodsmadur",
          court: "Umboðsmaður Alþingis",
          caseNumber: record.caseNumber,
          caseName: record.subjects.join(". ") || undefined,
          title,
          date,
          year: date?.getUTCFullYear() ?? yearFromCaseNumber(record.caseNumber),
          language: "is",
          subjectTags: record.subjects,
          officialUrl: url,
          fullText,
        });
        if (result === "indexed") stats.indexed++;
        else stats.skipped++;
      } catch (e) {
        stats.errors++;
        stats.errorSample = stats.errorSample ?? String(e);
        ctx.log(`  id ${id}: ${String(e).slice(0, 150)}`);
      }
    }

    ctx.log(`${fetches} pages fetched; ${consecutiveMisses} trailing misses.`);
    return stats;
  },
};
