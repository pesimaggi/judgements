import { load, type CheerioAPI } from "cheerio";
import pdfParse from "pdf-parse";
import { normalizeJudgmentText } from "@/lib/judgment-text";
import type { IngestionAdapter, IngestContext, IngestStats } from "../adapter";

/**
 * EFTA Court adapter — eftacourt.int.
 *
 * STATUS: pilot. Unlike the Icelandic adapter, whose queries were
 * reconstructed from island.is's own live network traffic, nothing here has
 * been checked against the live site — eftacourt.int was not reachable from
 * the environment this was written in. So this adapter is written to *find
 * out* rather than to assume:
 *
 *  - `INGEST_PROBE=1` reports what the site actually serves at a ranked list
 *    of candidate entry points, which is what you need to finish this.
 *  - The parsing below is deliberately structure-agnostic. It keys off the
 *    EFTA case-number format (E-1/24, E-16/11) and off link/document
 *    conventions rather than CSS selectors, because a guessed selector fails
 *    silently while a guessed pattern fails loudly.
 *  - Every document is validated before it is saved (real case number, enough
 *    text). Anything that doesn't validate is logged with the reason and
 *    skipped, so a wrong guess produces a diagnostic, never a junk row.
 *
 * WHAT WE STORE, and why:
 *
 *  The Court's working language is English; judgments and advisory opinions
 *  are published in English and some are also issued in Icelandic and
 *  Norwegian. Per the product decision, only the English text is ingested.
 *  `officialUrl` points at the case page — the page that carries the language
 *  switcher — so "Official source ↗" takes the reader somewhere they can pick
 *  another language version, exactly as it does for island.is. The English
 *  document itself (usually a PDF) goes in `pdfUrl`.
 *
 * TO FINISH THIS:
 *   1. INGEST_PROBE=1 npm run ingest -- --adapter=efta-court
 *   2. Set EFTA_CASE_INDEX to whichever candidate the probe shows actually
 *      lists cases (or add the right one to CANDIDATE_INDEXES).
 *   3. Run with INGEST_MAX_CASES=3 and read the per-case log lines; they say
 *      exactly what could not be found for each rejected case.
 *   4. Flip eftacourt's status to "live" in src/lib/sources.ts.
 */

const BASE = (process.env.EFTA_BASE ?? "https://eftacourt.int").replace(/\/$/, "");

/**
 * Entry points to try, best guess first. The probe reports on all of them;
 * EFTA_CASE_INDEX overrides the list once you know which one is right.
 */
const CANDIDATE_INDEXES = [
  "/cases/",
  "/cases/case-register/",
  "/court-cases/",
  "/judgments/",
  "/wp-json/wp/v2/pages?per_page=5",
  "/sitemap.xml",
  "/sitemap_index.xml",
];

/** EFTA case numbers: E-1/24, E-16/11, sometimes E-1/2024. */
const CASE_NUMBER_RE = /\bE-\d{1,3}\/\d{2,4}\b/g;

/** A document is only saved if it has at least this much extracted text. */
const MIN_TEXT_CHARS = 800;

function absolute(href: string): string {
  try {
    return new URL(href, `${BASE}/`).toString();
  } catch {
    return "";
  }
}

/** Case numbers found anywhere in a string, de-duplicated in order. */
function caseNumbersIn(text: string): string[] {
  return Array.from(new Set(text.match(CASE_NUMBER_RE) ?? []));
}

/**
 * Every link on a page that looks like it points at an EFTA case — matched on
 * the case number appearing in the href or the link text, rather than on a
 * guessed CSS selector.
 */
function caseLinks($: CheerioAPI): { url: string; caseNumber: string; text: string }[] {
  const found = new Map<string, { url: string; caseNumber: string; text: string }>();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const text = $(el).text().replace(/\s+/g, " ").trim();
    const caseNumber = caseNumbersIn(`${href} ${text}`)[0];
    if (!caseNumber) return;
    const url = absolute(href);
    if (url && !found.has(url)) found.set(url, { url, caseNumber, text });
  });
  return Array.from(found.values());
}

/**
 * The English judgment document linked from a case page. EFTA publishes each
 * language version as a separate file, so the English one is picked by the
 * link's own wording rather than by taking the first document on the page.
 */
function englishDocumentLink($: CheerioAPI): string | null {
  const candidates: { url: string; score: number }[] = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    if (!/\.pdf(\?|$)/i.test(href)) return;
    const label = `${href} ${$(el).text()}`.toLowerCase();
    // Explicitly-labelled other languages are excluded outright — an
    // unlabelled document on an English page is far more likely to be English
    // than to be the Norwegian version.
    if (/\b(icelandic|íslenska|islenska|norwegian|norsk|_is\b|_no\b|-is\.|-no\.)/.test(label)) return;
    candidates.push({ url: absolute(href), score: /\b(english|_en\b|-en\.|\ben\b)/.test(label) ? 2 : 1 });
  });
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.url ?? null;
}

/** Readable text of a page, preferring the main content region if there is one. */
function pageText($: CheerioAPI): string {
  $("script, style, nav, header, footer, noscript").remove();
  const main = $("main, article, [role=main], .entry-content, #content").first();
  const target = main.length ? main : $("body");
  return normalizeJudgmentText(target.text());
}

async function fetchPdfText(ctx: IngestContext, url: string): Promise<string> {
  // politeFetchText returns a string; PDFs need the bytes, so this one fetch
  // goes direct. It stays inside the adapter's own rate limiting because it
  // only ever runs after a politeFetchText for the same case page.
  const res = await fetch(url, {
    headers: { "User-Agent": process.env.INGEST_USER_AGENT ?? "logbrunnur-mvp/0.1" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const { text } = await pdfParse(Buffer.from(await res.arrayBuffer()));
  return normalizeJudgmentText(text);
}

/**
 * Reports what the live site serves at each candidate entry point. Read the
 * output, then set EFTA_CASE_INDEX to whichever one lists cases.
 */
async function probe(ctx: IngestContext): Promise<void> {
  ctx.log(`Probing ${BASE} — ${CANDIDATE_INDEXES.length} candidate entry points`);
  for (const path of CANDIDATE_INDEXES) {
    const url = `${BASE}${path}`;
    try {
      const body = await ctx.fetchText(url);
      const numbers = caseNumbersIn(body);
      let links: ReturnType<typeof caseLinks> = [];
      if (/<html/i.test(body)) links = caseLinks(load(body));

      ctx.log(`  ${url}`);
      ctx.log(`    ${body.length} chars, ${numbers.length} distinct case numbers, ${links.length} case-looking links`);
      if (numbers.length) ctx.log(`    numbers: ${numbers.slice(0, 8).join(", ")}`);
      for (const l of links.slice(0, 5)) ctx.log(`    link: ${l.caseNumber} → ${l.url}`);
    } catch (e) {
      ctx.log(`  ${url} — ${String(e).slice(0, 120)}`);
    }
  }
  ctx.log("Set EFTA_CASE_INDEX to the path that listed cases, then run without INGEST_PROBE.");
}

export const eftaCourtAdapter: IngestionAdapter = {
  key: "efta-court",
  name: "EFTA Court (eftacourt.int, English text) — pilot",
  sourceKeys: ["eftacourt"],

  async run(ctx: IngestContext): Promise<IngestStats> {
    const stats: IngestStats = { indexed: 0, skipped: 0, errors: 0 };

    if (process.env.INGEST_PROBE === "1") {
      await probe(ctx);
      return stats;
    }

    const index = process.env.EFTA_CASE_INDEX;
    if (!index) {
      // Not an error: this adapter is registered but not yet configured, and a
      // scheduled run should say so rather than fail the deployment.
      ctx.log(
        "EFTA_CASE_INDEX is not set, so there is no confirmed case list to walk. " +
          "Run `INGEST_PROBE=1 npm run ingest -- --adapter=efta-court` first and set " +
          "EFTA_CASE_INDEX to the path it reports as listing cases."
      );
      return stats;
    }

    const maxCases = Number(process.env.INGEST_MAX_CASES ?? 25);
    const indexUrl = absolute(index);
    ctx.log(`Case index: ${indexUrl} (up to ${maxCases} cases this run)`);

    let links: ReturnType<typeof caseLinks>;
    try {
      links = caseLinks(load(await ctx.fetchText(indexUrl)));
    } catch (e) {
      stats.errors++;
      stats.errorSample = String(e);
      ctx.log(`Could not read the case index: ${String(e).slice(0, 200)}`);
      return stats;
    }

    if (links.length === 0) {
      ctx.log(
        `No links containing an EFTA case number (E-n/yy) were found at ${indexUrl}. ` +
          "Either it is not the case list, or the list is rendered client-side — " +
          "check whether the page loads its cases from a separate JSON endpoint."
      );
      return stats;
    }
    ctx.log(`Found ${links.length} case links`);

    for (const link of links.slice(0, maxCases)) {
      try {
        if (await ctx.isKnown("eftacourt", link.url)) { stats.skipped++; continue; }

        const $ = load(await ctx.fetchText(link.url));
        const pdfUrl = englishDocumentLink($);

        // Prefer the PDF: on this kind of site the case page is usually a
        // summary, with the judgment itself attached as a document.
        let fullText = "";
        if (pdfUrl) {
          try {
            fullText = await fetchPdfText(ctx, pdfUrl);
          } catch (e) {
            ctx.log(`  ${link.caseNumber}: PDF fetch failed (${String(e).slice(0, 100)}), falling back to the page`);
          }
        }
        if (fullText.length < MIN_TEXT_CHARS) {
          const inline = pageText($);
          if (inline.length > fullText.length) fullText = inline;
        }

        if (fullText.length < MIN_TEXT_CHARS) {
          stats.skipped++;
          ctx.log(
            `  ${link.caseNumber}: only ${fullText.length} chars of text ` +
              `(pdf=${pdfUrl ?? "none"}) — skipped rather than stored incomplete`
          );
          continue;
        }

        const title = $("h1").first().text().replace(/\s+/g, " ").trim() || link.text || link.caseNumber;
        const dateText = $("time[datetime]").first().attr("datetime");
        const date = dateText && !Number.isNaN(Date.parse(dateText)) ? new Date(dateText) : undefined;

        const result = await ctx.save({
          source: "eftacourt",
          court: "EFTA Court",
          caseNumber: link.caseNumber,
          caseName: title,
          title,
          date,
          language: "en",
          subjectTags: [],
          // The case page, not the PDF: it is where the reader can switch to
          // the Icelandic or Norwegian version of the same decision.
          officialUrl: link.url,
          pdfUrl: pdfUrl ?? undefined,
          fullText,
        });
        if (result === "indexed") stats.indexed++;
        else stats.skipped++;
      } catch (e) {
        stats.errors++;
        stats.errorSample = stats.errorSample ?? String(e);
        ctx.log(`  error on ${link.caseNumber}: ${String(e).slice(0, 200)}`);
      }
    }

    return stats;
  },
};
