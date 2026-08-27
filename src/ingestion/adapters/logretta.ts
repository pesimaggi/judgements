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
 * Tímarit Lögréttu adapter — timaritlogrettu.is.
 *
 * VERIFIED against the live site and its API:
 *
 *  - The site is a client-rendered Next.js static export: its HTML carries a
 *    loading spinner and nothing else, so scraping the article page yields no
 *    article. What it renders from is a public Prismic repository, and that
 *    is what this adapter reads instead:
 *      https://logretta.cdn.prismic.io/api/v2                → the master ref
 *      /api/v2/documents/search?ref=…&q=[[at(document.type,"greinar")]]
 *    Two document types matter: `greinar` (196 articles at the time of
 *    writing) and `timarit` (34 volumes). Both come back as structured data —
 *    title, author, abstract, keywords, page count, volume link — so nothing
 *    has to be recovered from markup.
 *
 *  - Article pages are addressed by the pair of Prismic ids:
 *      /timarit/{volumeId}/{articleId}
 *    The article's own slug is not a route, so the volume link on each article
 *    is what makes its `officialUrl` reachable.
 *
 * WHAT IS STORED, and the robots.txt question:
 *
 *  Full article text lives in two places. 36 articles carry it in the API's
 *  own `html` rich-text field, and that text is stored. For the rest the
 *  article body exists only as a PDF on `logretta.cdn.prismic.io`, whose
 *  robots.txt is `Disallow: *.pdf` for every user agent.
 *
 *  So by default a PDF-only article is stored as its *record* — title, author,
 *  abstract (útdráttur), keywords (efnisorð), volume and page count, with the
 *  PDF kept as a link. That is a real, searchable bibliography of the journal
 *  without fetching a path its host asks crawlers to stay out of; 78 of the
 *  196 articles carry an abstract or a full body this way.
 *
 *  LOGRETTA_FETCH_PDFS=1 additionally downloads each article PDF and appends
 *  its text, giving full-text search over the whole journal. It is off by
 *  default deliberately — turn it on only with the journal's agreement, or on
 *  your own considered reading of that robots.txt. Same decision, and the same
 *  reasoning, as EFTA_FETCH_DOCUMENTS; see README.
 */

const SITE = (process.env.LOGRETTA_SITE ?? "https://www.timaritlogrettu.is").replace(/\/$/, "");
const API = (process.env.LOGRETTA_API ?? "https://logretta.cdn.prismic.io/api/v2").replace(/\/$/, "");

/** Prismic caps `pageSize` at 100 and answers 400 above it. */
const PAGE_SIZE = 100;

/** Below this a record is too thin to be worth a row of its own. */
const MIN_RECORD_CHARS = 120;

/** A `html` field this short is a leftover placeholder, not an article body. */
const MIN_BODY_CHARS = 200;

/**
 * Three entries in the article list are not articles: they are whole volumes,
 * filed alongside the articles so the complete issue can be downloaded as one
 * PDF. Their title is the volume label, their author list is every author in
 * the issue, and each of their articles is already indexed separately — so
 * they are left out rather than stored as a document with no subject.
 */
const VOLUME_TITLE_RE = /^(?:ÁRG\.|\d{4}\s*[-–]\s*Árgangur\b)/i;

/**
 * What stands under "Meginmál" when the article's text is not in the API.
 * Said plainly rather than left as a mysteriously short document: the record
 * is the article's bibliographic entry, not its text.
 *
 * Both forms open with the same words, and BODY_MISSING_RE matching a stored
 * record is how a later run tells "this record never had a body" from "this
 * record's body came out of a PDF" — see the run loop.
 */
const bodyMissingNote = (hasPdf: boolean) =>
  hasPdf
    ? "Meginmál greinarinnar er birt sem PDF-skjal á vef tímaritsins."
    : "Meginmál greinarinnar liggur ekki fyrir í vefþjónustu tímaritsins.";
const BODY_MISSING_RE = /^Meginmál greinarinnar (?:er birt sem PDF-skjal|liggur ekki fyrir)/m;

/** Prismic rich text: only `text` is needed, but the block type sets the shape. */
interface RichBlock {
  type: string;
  text?: string;
}

interface PrismicDoc {
  id: string;
  first_publication_date?: string;
  data: Record<string, unknown>;
}

/** One volume (árgangur), as `timarit` documents describe themselves. */
interface Volume {
  label: string;
  date?: Date;
  year?: number;
}

function squish(text: string): string {
  return text.replace(/ /g, " ").replace(/\s+/g, " ").trim();
}

/** Paragraph-per-line text of a rich-text field, blank blocks dropped. */
function richText(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return (value as RichBlock[])
    .map((b) => squish(b.text ?? ""))
    .filter(Boolean)
    .join("\n");
}

/** The same field as a single line — for titles and author lines. */
function richLine(value: unknown): string {
  return squish(richText(value).replace(/\n/g, " "));
}

async function fetchJson(ctx: IngestContext, url: string): Promise<any> {
  return JSON.parse(await ctx.fetchText(url));
}

function searchUrl(ref: string, type: string, page: number): string {
  const params = new URLSearchParams({
    ref,
    q: `[[at(document.type,"${type}")]]`,
    pageSize: String(PAGE_SIZE),
    page: String(page),
  });
  return `${API}/documents/search?${params}`;
}

/** Every document of one type, following Prismic's paging to the end. */
async function fetchAll(ctx: IngestContext, ref: string, type: string): Promise<PrismicDoc[]> {
  const docs: PrismicDoc[] = [];
  for (let page = 1; ; page++) {
    const body = await fetchJson(ctx, searchUrl(ref, type, page));
    docs.push(...(body.results ?? []));
    if (page >= (body.total_pages ?? 1)) break;
  }
  return docs;
}

/**
 * The volume's year, from the label the journal writes it under
 * ("2019 - Árgangur 15", "ÁRG. 8, NR 3 (2011)"). Preferred over the volume's
 * `dagsetning`, which is an editing date rather than a publication date and
 * disagrees with the label often enough not to be trusted for the year.
 */
function yearFromLabel(...labels: string[]): number | undefined {
  for (const label of labels) {
    const m = /(19|20)\d{2}/.exec(label);
    if (m) return Number(m[0]);
  }
  return undefined;
}

function parseVolumes(docs: PrismicDoc[]): Map<string, Volume> {
  const volumes = new Map<string, Volume>();
  for (const doc of docs) {
    const label = richLine(doc.data.argangur) || richLine(doc.data.titill);
    const raw = typeof doc.data.dagsetning === "string" ? doc.data.dagsetning : null;
    const date = raw ? new Date(`${raw}T00:00:00Z`) : undefined;
    volumes.set(doc.id, {
      label,
      date: date && !Number.isNaN(date.getTime()) ? date : undefined,
      year: yearFromLabel(label, richLine(doc.data.titill)),
    });
  }
  return volumes;
}

/**
 * "Sérstakt hæfi dómara, hæfisreglur, vanhæfi." — the author's own keywords,
 * written as one line separated by commas or semicolons.
 */
function parseKeywords(value: unknown): string[] {
  return richLine(value)
    .split(/[;,]/)
    .map((k) => k.replace(/\.\s*$/, "").trim())
    .filter((k) => k.length > 1 && k.length <= 80);
}

interface Article {
  id: string;
  volumeId?: string;
  title: string;
  author: string;
  abstract: string;
  keywords: string[];
  body: string;
  references: string;
  pages?: number;
  pdfUrl?: string;
  isEditorial: boolean;
  publishedAt?: Date;
}

function parseArticle(doc: PrismicDoc): Article | null {
  const title = richLine(doc.data.titill);
  if (!title) return null;

  const link = doc.data.timarit as { id?: string } | undefined;
  const pdf = doc.data.pdf_skra as { url?: string } | undefined;
  const published = doc.first_publication_date ? new Date(doc.first_publication_date) : undefined;
  const body = richText(doc.data.html);

  return {
    id: doc.id,
    volumeId: link?.id,
    title,
    author: richLine(doc.data.hofundur),
    abstract: richText(doc.data.urdrattur),
    keywords: parseKeywords(doc.data.efnisord),
    body: body.length >= MIN_BODY_CHARS ? body : "",
    references: richText(doc.data.tilvisanir),
    pages: typeof doc.data.bladsidutal === "number" ? doc.data.bladsidutal : undefined,
    pdfUrl: pdf?.url,
    isEditorial: doc.data.ritstjornargrein === true,
    publishedAt: published && !Number.isNaN(published.getTime()) ? published : undefined,
  };
}

/**
 * The record as it is stored and searched.
 *
 * The abstract goes under "Útdráttur" — the heading Hæstiréttur uses and the
 * one the shared summary extractor looks for — so it reaches result cards
 * unchanged. Every other section gets a heading of its own, which is what
 * stops one running into the next.
 */
function composeRecord(article: Article, volume: Volume | undefined, pdfText: string): string {
  const lines: string[] = [article.title];

  if (article.author) lines.push("", "Höfundur", article.author);

  const imprint = [
    "Tímarit Lögréttu",
    volume?.label,
    article.pages ? `${article.pages} bls.` : "",
    article.isEditorial ? "ritstjórnargrein" : "",
  ].filter(Boolean);
  lines.push("", "Heimild", imprint.join(" · "));

  if (article.keywords.length) lines.push("", "Efnisorð", article.keywords.join(", "));
  if (article.abstract) lines.push("", "Útdráttur", article.abstract);

  const body = pdfText || article.body;
  lines.push("", "Meginmál", body || bodyMissingNote(Boolean(article.pdfUrl)));

  if (article.references) lines.push("", "Heimildaskrá", article.references);

  return lines.join("\n");
}

async function fetchPdfText(url: string): Promise<string> {
  const { body } = await politeFetchBytes(url);
  const { text } = await pdfParse(body);
  return normalizeJudgmentText(text);
}

/**
 * Reports what the API serves, without saving anything — the quick check to
 * run when the journal moves off Prismic and this adapter starts finding
 * nothing.
 */
async function probe(ctx: IngestContext, ref: string): Promise<void> {
  const volumes = parseVolumes(await fetchAll(ctx, ref, "timarit"));
  const docs = await fetchAll(ctx, ref, "greinar");
  ctx.log(`  ${volumes.size} volumes, ${docs.length} articles`);

  const articles = docs
    .map(parseArticle)
    .filter((a): a is Article => a !== null && !VOLUME_TITLE_RE.test(a.title));
  const withText = articles.filter((a) => a.body || a.abstract).length;
  ctx.log(
    `  ${articles.length} of those entries are articles; ${withText} carry an abstract or a body ` +
      `in the API, the rest are PDF-only`
  );

  for (const article of articles.slice(0, 3)) {
    const volume = article.volumeId ? volumes.get(article.volumeId) : undefined;
    ctx.log(`  ${article.title.slice(0, 60)} — ${article.author || "no author"}`);
    ctx.log(`    ${volume?.label ?? "no volume"}; record would be ${composeRecord(article, volume, "").length} chars`);
  }
}

export const logrettaAdapter: IngestionAdapter = {
  key: "logretta",
  name: "Tímarit Lögréttu (timaritlogrettu.is)",
  sourceKeys: ["logretta"],

  async run(ctx: IngestContext): Promise<IngestStats> {
    const stats: IngestStats = { indexed: 0, skipped: 0, errors: 0 };

    let ref: string;
    try {
      const api = await fetchJson(ctx, API);
      ref = api.refs?.find((r: { isMasterRef?: boolean }) => r.isMasterRef)?.ref ?? api.refs?.[0]?.ref;
      if (!ref) throw new Error("no master ref in the API response");
    } catch (e) {
      stats.errors++;
      stats.errorSample = String(e);
      ctx.log(`Could not read ${API}: ${String(e).slice(0, 200)}`);
      return stats;
    }

    if (process.env.INGEST_PROBE === "1") {
      await probe(ctx, ref);
      return stats;
    }

    const fetchPdfs = process.env.LOGRETTA_FETCH_PDFS === "1";
    const maxArticles = Number(process.env.INGEST_MAX_CASES ?? 1000);

    let volumes: Map<string, Volume>;
    let docs: PrismicDoc[];
    try {
      volumes = parseVolumes(await fetchAll(ctx, ref, "timarit"));
      docs = await fetchAll(ctx, ref, "greinar");
    } catch (e) {
      stats.errors++;
      stats.errorSample = String(e);
      ctx.log(`Could not list the journal: ${String(e).slice(0, 200)}`);
      return stats;
    }

    if (docs.length === 0) {
      ctx.log("The API listed no articles — the `greinar` custom type has been renamed or emptied.");
      return stats;
    }

    const articles = docs
      .map(parseArticle)
      .filter((a): a is Article => a !== null && !VOLUME_TITLE_RE.test(a.title));
    stats.skipped += docs.length - articles.length;
    ctx.log(
      `${docs.length} entries listed, ${articles.length} of them articles, across ${volumes.size} ` +
        `volumes; PDFs ${fetchPdfs ? "WILL" : "will not"} be fetched ` +
        `(LOGRETTA_FETCH_PDFS=${fetchPdfs ? "1" : "unset"})`
    );

    // The API's own count of the journal, so the progress bar has an exact
    // denominator rather than an estimate.
    await prisma.source.updateMany({
      where: { key: "logretta" },
      data: { totalAvailable: articles.length },
    });

    // Which stored records already carry a body. Everything else about an
    // article arrives in the listing above at no per-article cost, so the only
    // fetch worth skipping is the PDF — and it is worth skipping, because it
    // is the one rate-limited request in the run.
    //
    // It is also the only thing this adapter cannot rebuild from the API. A
    // record whose body came out of a PDF must therefore be left alone rather
    // than recomposed: recomposing it would quietly replace the article with
    // the "published as a PDF" note, so a second run would undo the first.
    // INGEST_FULL=1 ignores this and rebuilds every record.
    const storedWithBody = new Set<string>();
    if (process.env.INGEST_FULL !== "1") {
      const rows = await prisma.document.findMany({
        where: { source: "logretta" },
        select: { officialUrl: true, fullText: true },
      });
      for (const row of rows) {
        if (!BODY_MISSING_RE.test(row.fullText)) storedWithBody.add(row.officialUrl);
      }
    }

    let pdfsFetched = 0;
    let visited = 0;
    for (const article of articles) {
      if (visited >= maxArticles) {
        ctx.log(`Stopping at INGEST_MAX_CASES=${maxArticles}; re-run to continue.`);
        break;
      }
      visited++;

      try {
        if (!article.volumeId) {
          // Without the volume there is no reachable URL for the article, and
          // an unreachable officialUrl would break the one link that matters.
          stats.skipped++;
          ctx.log(`  "${article.title.slice(0, 60)}": no volume link — skipped, its page has no address`);
          continue;
        }

        const volume = volumes.get(article.volumeId);
        const url = `${SITE}/timarit/${article.volumeId}/${article.id}`;

        // The API has no body for this article but the stored record has one,
        // so that body was extracted from the PDF by an earlier run. Leave it.
        if (!article.body && storedWithBody.has(url)) {
          stats.skipped++;
          continue;
        }

        let pdfText = "";
        if (fetchPdfs && article.pdfUrl && !article.body) {
          try {
            pdfText = await fetchPdfText(article.pdfUrl);
            pdfsFetched++;
            if (!pdfText) ctx.log(`  "${article.title.slice(0, 60)}": PDF produced no extractable text`);
          } catch (e) {
            ctx.log(`  "${article.title.slice(0, 60)}": could not read the PDF (${String(e).slice(0, 100)})`);
          }
        }

        const fullText = composeRecord(article, volume, pdfText);
        if (fullText.length < MIN_RECORD_CHARS) {
          stats.skipped++;
          ctx.log(`  "${article.title.slice(0, 60)}": record of only ${fullText.length} chars — skipped`);
          continue;
        }

        const result = await ctx.save({
          source: "logretta",
          court: "Tímarit Lögréttu",
          title: article.title,
          date: volume?.date ?? article.publishedAt,
          year: volume?.year ?? volume?.date?.getUTCFullYear() ?? article.publishedAt?.getUTCFullYear(),
          language: "is",
          // The field the document page labels "Höfundur" for a journal.
          parties: article.author || undefined,
          subjectTags: article.keywords,
          officialUrl: url,
          pdfUrl: article.pdfUrl,
          fullText,
        });
        if (result === "indexed") stats.indexed++;
        else stats.skipped++;
      } catch (e) {
        stats.errors++;
        stats.errorSample = stats.errorSample ?? String(e);
        ctx.log(`  ${article.id}: ${String(e).slice(0, 150)}`);
      }
    }

    if (fetchPdfs) ctx.log(`${pdfsFetched} article PDFs fetched.`);
    return stats;
  },
};
