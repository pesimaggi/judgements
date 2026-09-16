/**
 * Parses an Alþingi þingskjal — a parliamentary document — into the record and
 * the commentary this app stores.
 *
 * The one that matters is the *frumvarp*: a bill, carrying the act's text as
 * proposed and, after it, the greinargerð — the explanatory memorandum, whose
 * closing section comments on the bill article by article. That per-article
 * commentary is what Icelandic courts quote when they construe a provision,
 * and it is the reason this corpus is worth holding at all.
 *
 * ── The shape of the page ──────────────────────────────────────────────────
 *
 *   Ferill 783. máls · 130. löggjafarþing 2003–2004.
 *   Þskj. 1194 — 783. mál.
 *   Frumvarp til jarðalaga.
 *   (Lagt fyrir Alþingi á 130. löggjafarþingi 2003–2004.)
 *
 *   I. KAFLI … 1. gr. … [the bill's own articles]
 *
 *   Athugasemdir við lagafrumvarp þetta.
 *   [the general memorandum]
 *
 *   Athugasemdir við einstakar greinar frumvarpsins.
 *   Um 1. gr.
 *   [commentary on article 1]
 *   Um 2. gr.
 *   …
 *
 * Alþingi publishes this as WordPerfect converted to HTML, and the conversion
 * shows: the divisions carry no classes and no anchors, only centring and
 * italics, with the original's style names left behind in comments. So the
 * headings are recognised by their text, which for these two — "Athugasemdir
 * við lagafrumvarp þetta" and "Athugasemdir við einstakar greinar
 * frumvarpsins" — is stable across the corpus in a way markup never was.
 *
 * ── Not every þingskjal has text ───────────────────────────────────────────
 *
 * Some are published only as a PDF, with the HTML page carrying the header and
 * the document list and nothing else — the fjárlagafrumvarp is one. `hasText`
 * says which, so the adapter can record the document without pretending to
 * hold it. See the 153/0001 fixture.
 */
import { load } from "cheerio";

export type ThingskjalKind =
  | "frumvarp"
  | "nefndarálit"
  | "breytingartillaga"
  | "þingsályktunartillaga"
  | "annað";

/** One of the other documents of the same case, listed at the head of a page. */
export interface RelatedDocument {
  /** The þingskjal number. */
  documentNumber: number;
  /** As the page describes it: "nefndarálit, meiri hluti landbúnaðarnefndar". */
  description: string;
}

/** The commentary on one article of the bill. */
export interface ArticleCommentary {
  /** As printed: "Um 1. gr.", "Um 7. gr. a", "Um ákvæði til bráðabirgða". */
  heading: string;
  /**
   * The article number, where the heading names a single numbered one. Null
   * for "Um ákvæði til bráðabirgða" and for the ranges a memorandum sometimes
   * uses ("Um 12.–14. gr."), which name no one article and must not be
   * attached to one.
   */
  articleNumber: number | null;
  articleLetter: string | null;
  text: string;
}

export interface ParsedThingskjal {
  /** The þingskjal number — 1194 in "Þskj. 1194". */
  documentNumber: number | null;
  /** The case (mál) it belongs to — 783 in "783. mál". */
  caseNumber: number | null;
  /** The parliament — 130 in "130. löggjafarþing". */
  parliament: number | null;
  /** "Frumvarp til jarðalaga." */
  title: string;
  kind: ThingskjalKind;
  /** The whole document as readable prose. Empty when the page is a stub. */
  fullText: string;
  /** False when the page carries only a header and a document list. */
  hasText: boolean;
  /** "Athugasemdir við lagafrumvarp þetta" — the general memorandum. */
  generalCommentary: string;
  /** "Athugasemdir við einstakar greinar frumvarpsins", split by article. */
  articleCommentary: ArticleCommentary[];
  /** The other documents of the same case, from the list at the top. */
  relatedDocuments: RelatedDocument[];
}

/**
 * The space characters Alþingi's WordPerfect conversion is full of, written as
 * escapes: typed literally they make this file read as binary to git and grep,
 * hiding it from diffs and code search.
 */
const NBSP_RE = /[\u00a0\u2007\u202f]/g;

/**
 * The site's own breadcrumb, which opens the navigation that follows the
 * document on a page whose text is published only as a PDF. Cutting here is
 * what stops several thousand characters of menu being counted as the
 * document's text — and read as evidence that the document has any.
 */
const NAVIGATION_START = "Þú ert hér:";

function stripNavigation(text: string): string {
  const i = text.indexOf(NAVIGATION_START);
  return i > 0 ? text.slice(0, i).trim() : text;
}

/** Collapses whitespace and composes Icelandic letters, as the other parsers do. */
export function normalizeThingskjalText(s: string): string {
  return s
    .normalize("NFC")
    .replace(NBSP_RE, " ")
    .replace(/[ 	]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

/**
 * The heading that opens the article-by-article commentary.
 *
 * Both spellings occur — "frumvarpsins" and "þessa" — and a þingsályktun says
 * "tillögunnar". Matched loosely on the stable half.
 */
const ARTICLE_COMMENTARY_HEADING = /Athugasemdir\s+við\s+einstak\w+\s+greinar/iu;

/** The heading that opens the general memorandum. */
const GENERAL_COMMENTARY_HEADING =
  /Athugasemdir\s+við\s+(?:lagafrumvarp|frumvarp|þingsályktunartillögu)\s+þet\w+/iu;

/**
 * A commentary heading, in the four shapes a memorandum actually writes.
 *
 * Enumerated rather than caught by a catch-all, which is what this started as
 * and what made "Um þetta ákvæði gildir sérregla." — a sentence of the
 * commentary — open a new article and orphan the one above it. Anything
 * opening with "Um" that is not one of these is prose.
 */
const ARTICLE_COMMENTARY_RE = new RegExp(
  "^Um\\s+(?:" +
    // "Um 1. gr.", "Um 7. gr. a"
    "(\\d{1,3})\\.\\s*gr\\.\\s*([a-záðéíóúýþæö])?\\.?" +
    "|" +
    // "Um 5. og 6. gr.", "Um 12.–14. gr.", "Um 3., 4. og 5. gr." — a range or
    // a list, naming no one article and given no article number below.
    "\\d{1,3}\\.[\\d\\s.,–-]*(?:og\\s+)?\\d{0,3}\\.?\\s*gr\\.\\s*[a-záðéíóúýþæö]?\\.?" +
    "|" +
    // "Um ákvæði til bráðabirgða", "… bráðabirgða III"
    "ákvæði\\s+til\\s+bráðabirgða[\\s\\wIVXL.]*" +
    "|" +
    // "Um I. kafla"
    "[IVXL]+\\.\\s*kafla\\p{L}*" +
    ")\\s*\\.?$",
  "iu"
);

/**
 * The header line, in both forms Alþingi has used: "Þskj. 1194 — 783. mál."
 * on the older pages and "Þingskjal 1 — 1. mál." on the newer ones.
 */
const HEADER_RE = /Þ(?:skj\.|ingskjal)\s*(\d{1,5})\s*[—–-]\s*(\d{1,4})\.\s*mál/u;
const PARLIAMENT_RE = /(\d{1,3})\.\s*löggjafarþing/u;

/** What the document is, from the way the page and its title describe it. */
export function classifyThingskjal(title: string, pageText: string): ThingskjalKind {
  const haystack = `${title}\n${pageText.slice(0, 1200)}`;
  if (/nefndarálit|nál\.\s*með/iu.test(haystack)) return "nefndarálit";
  if (/breytingartillaga/iu.test(haystack)) return "breytingartillaga";
  if (/[Tt]illaga til þingsályktunar|þingsályktunartillaga/u.test(haystack)) {
    return "þingsályktunartillaga";
  }
  if (/frumvarp/iu.test(haystack)) return "frumvarp";
  return "annað";
}

/**
 * The other documents of the case, from the picker at the head of the page.
 *
 * Worth taking because it is the only route to them that this app has: the
 * ferill page that would otherwise list them is one of the pages Alþingi's
 * front end does not serve to us. A bill therefore leads to its own
 * nefndarálit without a second source.
 */
function parseRelatedDocuments(text: string): RelatedDocument[] {
  const out: RelatedDocument[] = [];
  const seen = new Set<number>();
  // "1753 nefndarálit, meiri hluti landbúnaðarnefndar, Drífa Hjartardóttir"
  // Not anchored to a line start: the picker's entries arrive on one line as
  // often as on several, and anchoring found only the first of seven.
  //
  // The description stops at the next entry rather than running a fixed
  // length, which swallowed the three entries after it — the page's own
  // separator between them is nothing but a space.
  const KIND =
    "(?:stjórnarfrumvarp|frumvarp eftir|frumvarp|nefndarálit|nál\\.|breytingartillaga|lög í heild|þingsályktun)";
  const re = new RegExp(
    `\\b(\\d{1,5})\\s+(${KIND}[^\\n]{0,90}?)(?=\\s+\\d{1,5}\\s+${KIND}|\\n|$)`,
    "giu"
  );
  for (const m of text.matchAll(re)) {
    const n = Number(m[1]);
    if (seen.has(n)) continue;
    seen.add(n);
    out.push({ documentNumber: n, description: normalizeThingskjalText(m[2]) });
  }
  return out;
}

/**
 * Splits the article-by-article section into one entry per article.
 *
 * A heading is a short line of its own opening with "Um" — the conversion
 * centres them, but centring is carried in three different attributes across
 * the corpus, so the text is the more reliable signal and the length bound is
 * what keeps a sentence beginning "Um þetta gildir…" from being read as one.
 */
export function splitArticleCommentary(section: string): ArticleCommentary[] {
  const lines = section.split("\n");
  const out: ArticleCommentary[] = [];
  let current: ArticleCommentary | null = null;
  const body: string[] = [];

  const flush = () => {
    if (current) {
      current.text = normalizeThingskjalText(body.join("\n"));
      if (current.text) out.push(current);
    }
    body.length = 0;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.length <= 70 ? ARTICLE_COMMENTARY_RE.exec(line) : null;
    if (m) {
      flush();
      current = {
        heading: line.replace(/\.$/, ""),
        articleNumber: m[1] ? Number(m[1]) : null,
        articleLetter: m[2] ? m[2].toLowerCase() : null,
        text: "",
      };
      continue;
    }
    if (current) body.push(line);
  }
  flush();
  return out;
}

/**
 * Reads a þingskjal page into its record, its text and its commentary.
 *
 * The page's own navigation — the document picker, the "Aðrar útgáfur"
 * links, the site menu — is dropped: it is about the document rather than part
 * of it, and it is where the related-document list is taken from first.
 */
export function parseThingskjal(html: string): ParsedThingskjal {
  const $ = load(html);
  $("script, style, nav, header, footer, .sidebar, #wayback").remove();

  // Tried in order, not as one selector: a combined selector returns matches
  // in document order, and the page's first `.boxbody` is the 392-character
  // document picker sitting above the 137,000-character document. Taking
  // `.first()` of the union therefore parsed the navigation and reported a
  // stub.
  const pageLength = $("body").text().length;
  const selector =
    ["div.article", "div.pgmain", "main", "#content"].find((candidate) => {
      const found = $(candidate).first();
      return found.length > 0 && found.text().length > pageLength / 4;
    }) ?? "body";
  const scope = $(selector).first();
  const raw = stripNavigation(normalizeThingskjalText(scope.text()));

  // Related documents come from the whole page rather than from `scope`: the
  // picker that lists them sits above the document, so scoping to the document
  // is exactly what loses them.
  const pageText = normalizeThingskjalText($("body").text());

  const header = HEADER_RE.exec(raw);
  const parliament = PARLIAMENT_RE.exec(raw);

  // The title is the line after the header: "Frumvarp til jarðalaga."
  let title = "";
  if (header) {
    const after = raw.slice(header.index + header[0].length);
    // The first line after the header is sometimes the document's kind rather
    // than its name — "Stjórnarfrumvarp." above "Frumvarp til fjárlaga fyrir
    // árið 2023." — so lines that say only what sort of document this is are
    // skipped. Naming a bill after its category would put "Stjórnarfrumvarp"
    // on a hundred different rows.
    const KIND_ONLY = /^(?:stjórnarfrumvarp|nefndarálit|breytingartillaga|þingsályktunartillaga)\.?$/iu;
    title = normalizeThingskjalText(
      after
        .split("\n")
        .map((l) => l.trim().replace(/^\.\s*/, ""))
        .find((l) => l && !KIND_ONLY.test(l)) ?? ""
    );
  }
  if (!title) {
    title = normalizeThingskjalText(
      raw.split("\n").find((l) => /^(Frumvarp|Tillaga|Nefndarálit|Breytingartillaga)/iu.test(l.trim())) ?? ""
    );
  }

  // Everything from the header onwards is the document; what precedes it is
  // the picker and the site's own furniture.
  const documentText = header ? raw.slice(header.index) : raw;

  const generalMatch = GENERAL_COMMENTARY_HEADING.exec(documentText);
  const articleMatch = ARTICLE_COMMENTARY_HEADING.exec(documentText);

  const generalCommentary = generalMatch
    ? normalizeThingskjalText(
        documentText.slice(
          generalMatch.index + generalMatch[0].length,
          articleMatch ? articleMatch.index : undefined
        )
      )
    : "";
  const articleCommentary = articleMatch
    ? splitArticleCommentary(documentText.slice(articleMatch.index + articleMatch[0].length))
    : [];

  // A page with a header, a document list and little else is published only as
  // a PDF. The bound is generous: the shortest real frumvarp in the corpus
  // still runs to several thousand characters of articles and memorandum.
  const hasText = documentText.length > 2500;

  return {
    documentNumber: header ? Number(header[1]) : null,
    caseNumber: header ? Number(header[2]) : null,
    parliament: parliament ? Number(parliament[1]) : null,
    title: title.replace(/\.$/, ""),
    kind: classifyThingskjal(title, raw),
    fullText: hasText ? documentText : "",
    hasText,
    generalCommentary,
    articleCommentary,
    relatedDocuments: parseRelatedDocuments(pageText),
  };
}

/** The canonical URL for a þingskjal: /altext/{þing}/s/{skjal}.html. */
export function thingskjalUrl(parliament: number, documentNumber: number): string {
  return `https://www.althingi.is/altext/${parliament}/s/${String(documentNumber).padStart(4, "0")}.html`;
}

/** Reads the þing and skjal numbers back out of such a URL. */
export function parseThingskjalUrl(
  url: string
): { parliament: number; documentNumber: number; format: "html" | "pdf" } | null {
  const m = /\/altext\/(?:(pdf)\/)?(\d{1,3})\/s\/(\d{1,5})\.(?:html|pdf)/.exec(url);
  if (!m) return null;
  return {
    parliament: Number(m[2]),
    documentNumber: Number(m[3]),
    format: m[1] ? "pdf" : "html",
  };
}
