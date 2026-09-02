/**
 * EUR-Lex: the identity of an EU act, and the parse of its published text
 * into the chapter / article / paragraph structure this app already uses for
 * Icelandic acts.
 *
 * WHY AN EU ACT IS AN `Act` ROW. A regulation has articles, an article has
 * numbered paragraphs, and both are cited the way a grein and a málsgrein are.
 * The act reader, the provision search and the citation links are all built on
 * that shape already, so an EU act is stored as an act with
 * `jurisdiction = "eu"` rather than in a parallel table. What differs is only
 * the identity: an Icelandic act is "nr. 38/2001", an EU act is a CELEX
 * number, and CELEX is what everything here keys on.
 *
 * WHERE THE TEXT COMES FROM. Not eur-lex.europa.eu, which is the reading room
 * and throttles a crawler with an empty `202 Accepted` rather than an error,
 * but Cellar — the Publications Office's own content API, which serves the
 * same document to a machine that asks for it by CELEX. See cellarTextUrl().
 *
 * THREE LAYOUTS, ONE PARSE. What Cellar returns is not one format:
 *
 *   "oj"           — acts published from about 2004: `<div class="eli-subdivision"
 *                    id="art_1">` holding `<p class="oj-ti-art">Article 1</p>`,
 *                    a heading in `.eli-title`, and one `<div id="001.002">`
 *                    per numbered paragraph.
 *   "consolidated" — the consolidated (in-force) version of an amended act.
 *                    Same `id="art_1"` skeleton, different class names
 *                    (`title-article-norm`, `norm`, `no-parag`).
 *   "legacy"       — acts published before that, which Cellar holds as plain
 *                    HTML with no structure at all: the article headings are
 *                    `<p>Article 3</p>` and nothing distinguishes them from
 *                    body text except that they are alone in their paragraph.
 *
 * The first two share the `id="art_N"` / `id="cpt_X"` skeleton, so they parse
 * as one. The legacy layout is parsed separately and deliberately
 * conservatively: it starts only after the adoption formula ("HAVE ADOPTED
 * THIS DIRECTIVE:"), because every recital above that line cites articles of
 * the Treaty and of other acts, and a looser rule turns those citations into
 * articles of this one.
 */
import { load, type CheerioAPI, type Cheerio } from "cheerio";
import type { AnyNode } from "domhandler";

/** The three families of binding act this app ingests, by CELEX letter. */
export const EU_DOC_TYPES = {
  R: "regulation",
  L: "directive",
  D: "decision",
} as const;

export type EuDocType = (typeof EU_DOC_TYPES)[keyof typeof EU_DOC_TYPES];

export interface ParsedCelex {
  /** "32016R0679" — as given, uppercased. */
  celex: string;
  /** 2016. */
  year: number;
  /** "R" | "L" | "D". */
  letter: keyof typeof EU_DOC_TYPES;
  docType: EuDocType;
  /** 679 — the CELEX sequence number, which is not always the cited number. */
  number: number;
  /** True for a consolidated version ("02016R0679-20160504"). */
  consolidated: boolean;
}

const CELEX_RE = /^([03])(\d{4})([RLD])(\d{4})(?:-(\d{8}))?$/;

/**
 * Reads a CELEX number, and only the plain ones.
 *
 * Sector 3 is secondary legislation ("32016R0679"); sector 0 is a
 * consolidated version of one ("02016R0679-20160504"). Everything else is
 * rejected on purpose — corrigenda ("32016R0679R(01)"), the annex-suffixed
 * forms, and the other sectors (case law, preparatory acts, national
 * transposition) are not acts of this library, and CELEX is only a reliable
 * identity while it stays this shape: sector, year, type letter and a
 * four-digit sequence, which together are unique.
 */
export function parseCelex(raw: string): ParsedCelex | null {
  const celex = raw.trim().toUpperCase();
  const m = CELEX_RE.exec(celex);
  if (!m) return null;
  const letter = m[3] as keyof typeof EU_DOC_TYPES;
  return {
    celex,
    year: Number(m[2]),
    letter,
    docType: EU_DOC_TYPES[letter],
    number: Number(m[4]),
    consolidated: m[1] === "0",
  };
}

/** The act's page on EUR-Lex — where a reader is sent for the official text. */
export function euLexUrl(celex: string): string {
  return `https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:${encodeURIComponent(celex)}`;
}

/**
 * The same document from Cellar, the content API behind EUR-Lex.
 *
 * Fetched with `Accept: application/xhtml+xml, text/html;q=0.9` (see
 * CELLAR_HEADERS): which of the two an act is held as depends on when it was
 * published, and asking for either lets Cellar answer with whichever it has
 * instead of 404-ing on the one it does not.
 */
export function cellarTextUrl(celex: string): string {
  return `https://publications.europa.eu/resource/celex/${encodeURIComponent(celex)}`;
}

/** Headers cellarTextUrl() must be fetched with. See above. */
export const CELLAR_HEADERS: Record<string, string> = {
  Accept: "application/xhtml+xml, text/html;q=0.9",
  "Accept-Language": "eng",
};

/** The route this app serves an EU act at, e.g. "/log/32016R0679". */
export function euActPath(celex: string): string {
  return `/log/${celex}`;
}

const MONTHS =
  "January|February|March|April|May|June|July|August|September|October|November|December";

/** Where an EU act's own title stops being its citation and starts being its subject. */
const TITLE_DATE_RE = new RegExp(`\\s+of\\s+\\d{1,2}\\s+(?:${MONTHS})\\s+\\d{4}`);

/**
 * The act as it is cited, taken off the front of its own title.
 *
 * Every EU act's official title opens with its citation and then dates it:
 *
 *   "Regulation (EU) 2016/679 of the European Parliament and of the Council
 *    of 27 April 2016 on the protection of natural persons …"
 *
 * so the citation is what precedes the date, minus the adopting institution
 * that trails it. That beats composing one from the numbers, because the
 * bracketed treaty family ("(EU)", "(EC)", "(EEC)", "(EU, Euratom)") and the
 * placement of the number changed twice in the corpus's lifetime — a
 * directive of 2000 is cited "Directive 2000/31/EC" and a regulation of 2003
 * "Regulation (EC) No 1/2003", and neither is derivable from the other.
 *
 * The composed form is the fallback for an act whose title does not carry a
 * date, and is deliberately plain.
 */
export function euCitation(title: string, celex: ParsedCelex, naturalNumber?: number | null): string {
  const m = TITLE_DATE_RE.exec(title);
  if (m && m.index > 0) {
    const head = title.slice(0, m.index).trim();
    // "Decision (EU) 2016/245 of the European Central Bank" → drop the
    // adopting body, which the title states again after the date.
    const cited = head.replace(/\s+of\s+the\s+.+$/, "").trim();
    if (cited) return cited;
  }
  const kind = celex.docType[0].toUpperCase() + celex.docType.slice(1);
  return `${kind} ${celex.year}/${naturalNumber ?? celex.number}`;
}

/**
 * The subject of an EU act, without the citation its title opens with.
 *
 * An official EU title is the citation, the date, the subject and often the
 * EEA relevance line, all in one sentence of 300 characters:
 *
 *   "Regulation (EU) 2016/679 of the European Parliament and of the Council of
 *    27 April 2016 on the protection of natural persons … (General Data
 *    Protection Regulation) (Text with EEA relevance)"
 *
 * The app shows the citation beside the title, so repeating it inside the
 * title costs a line of every row in the catalogue and says nothing. What is
 * left is the subject, which is what EUR-Lex's own indexes show and what a
 * reader is scanning for. The full official title stays in the database and
 * is what search matches on; this is a display form.
 */
export function euSubjectTitle(title: string): string {
  const withoutRelevance = title.replace(/\s*\(Text with EEA relevance\)\s*$/i, "").trim();
  const date = TITLE_DATE_RE.exec(withoutRelevance);
  if (!date) return withoutRelevance;
  const subject = withoutRelevance.slice(date.index + date[0].length).trim();
  // An act whose title is only its citation and date has no subject to show.
  return subject || withoutRelevance;
}

// ---------------------------------------------------------------------------
// The parse
// ---------------------------------------------------------------------------

export type EuLayout = "oj" | "consolidated" | "legacy";

export interface ParsedEuParagraph {
  /** Synthetic: EUR-Lex anchors articles but not their paragraphs. */
  anchor: string;
  number: number;
  text: string;
}

export interface ParsedEuProvision {
  /** "article" for a numbered article, "annex" for annexed material. */
  kind: "article" | "annex";
  /** EUR-Lex's own anchor for the subdivision, e.g. "art_1" or "anx_I". */
  anchor: string;
  articleNumber: number | null;
  /** "a" in "Article 7a", for articles inserted by amendment. */
  articleLetter: string | null;
  /** As printed: "Article 7a", "ANNEX I". */
  displayLabel: string;
  heading: string | null;
  /** Index into ParsedEuAct.chapters, or null outside any chapter. */
  chapterIndex: number | null;
  paragraphs: ParsedEuParagraph[];
  fullText: string;
}

export interface ParsedEuChapter {
  /** "CHAPTER I", "SECTION 2" — the heading as printed. */
  label: string;
  title: string | null;
}

export interface ParsedEuAct {
  /** The subject line off the document itself, where it states one. */
  title: string | null;
  chapters: ParsedEuChapter[];
  provisions: ParsedEuProvision[];
  /** True when the act itself prints "(Text with EEA relevance)". */
  eeaRelevanceStated: boolean;
  layout: EuLayout;
}

function squish(text: string): string {
  return text.replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
}

/** All whitespace to single spaces — what a run of inline text should read as. */
function collapse(text: string): string {
  return text.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Elements that start a line of their own.
 *
 * `.inline-element` is excluded because the consolidated layout uses a `div`
 * for the body of a paragraph whose number sits in the `span` before it — a
 * block element used inline, and taking it at its tag name splits "1." from
 * the sentence it numbers.
 */
const BLOCK_SELECTOR = "p, div, li, tr, table, blockquote";

/** A line that is nothing but a list marker: "(a)", "1.", "(1)", "—". */
const MARKER_ONLY = /^(\(?[0-9]{1,3}[a-z]?\)|\(?[a-z]{1,3}\)|[0-9]{1,3}\.|[—–-])$/i;

/**
 * The text of an element, one line per block it prints on.
 *
 * `.text()` alone runs every block together, and splitting on tag names alone
 * breaks a line wherever a layout uses a `div` inline. So blocks are walked,
 * inline runs are collapsed, and a line that turns out to be nothing but a
 * list marker is folded into the line it marks — which is how the
 * consolidated layout prints every paragraph number and how both layouts lay
 * out the lettered points inside an article.
 */
function textOf($: CheerioAPI, el: Cheerio<AnyNode>): string {
  const lines: string[] = [];
  let inline = "";
  const flushInline = () => {
    const text = collapse(inline);
    if (text) lines.push(text);
    inline = "";
  };

  const walk = (node: Cheerio<AnyNode>) => {
    node.contents().each((_, child) => {
      const $child = $(child);
      if (child.type === "text") {
        inline += $child.text();
        return;
      }
      if (child.type !== "tag") return;
      if ($child.is("br")) {
        flushInline();
        return;
      }
      if ($child.is(BLOCK_SELECTOR) && !$child.hasClass("inline-element")) {
        flushInline();
        const text = textOf($, $child);
        if (text) lines.push(...text.split("\n"));
        return;
      }
      walk($child);
    });
  };

  walk(el);
  flushInline();

  const merged: string[] = [];
  for (const line of lines) {
    const previous = merged[merged.length - 1];
    if (previous !== undefined && MARKER_ONLY.test(previous)) {
      merged[merged.length - 1] = `${previous} ${line}`;
    } else {
      merged.push(line);
    }
  }
  return merged.join("\n");
}

/** "Article 7a" → 7 + "a"; "Article 12" → 12. */
export function parseArticleLabel(label: string): {
  articleNumber: number | null;
  articleLetter: string | null;
} {
  const m = /^Article\s+(\d+)\s*([a-z])?/i.exec(label.trim());
  if (!m) return { articleNumber: null, articleLetter: null };
  return { articleNumber: Number(m[1]), articleLetter: m[2]?.toLowerCase() ?? null };
}

/**
 * Splits an article's body into its numbered paragraphs.
 *
 * EU articles number their paragraphs "1.", "2." and are cited by that number
 * ("Article 6(1)(a)"), the way an Icelandic provision is cited by its
 * málsgrein — so the split has to follow the act's own numbering rather than
 * the layout's block structure. Blocks that carry no number at all (a single
 * unnumbered article, or the lead-in above a list) become one paragraph each,
 * numbered in sequence, so nothing is lost and every paragraph has an index.
 */
function toParagraphs(anchor: string, blocks: string[]): ParsedEuParagraph[] {
  const paragraphs: ParsedEuParagraph[] = [];
  for (const raw of blocks) {
    const block = squish(raw);
    if (!block) continue;
    const numbered = /^(\d{1,3})\.\s+(?=\S)/.exec(block);
    const last = paragraphs[paragraphs.length - 1];
    if (numbered) {
      paragraphs.push({
        anchor: "",
        number: Number(numbered[1]),
        text: block,
      });
    } else if (last) {
      // Continuation of the paragraph above — a list item, a table, the
      // second half of a sentence split across blocks by the layout.
      last.text = `${last.text}\n${block}`;
    } else {
      paragraphs.push({ anchor: "", number: paragraphs.length + 1, text: block });
    }
  }
  return paragraphs.map((p, i) => ({ ...p, anchor: `${anchor}-p${i + 1}` }));
}

/**
 * The `id="art_N"` layouts: everything published in the Official Journal from
 * about 2004, and every consolidated version.
 */
function parseStructured($: CheerioAPI, layout: EuLayout): ParsedEuAct {
  const chapters: ParsedEuChapter[] = [];
  const provisions: ParsedEuProvision[] = [];

  /**
   * The divisions an act prints above its articles: chapters, and the
   * sections some chapters are divided into.
   *
   * A section carries its chapter's label as well as its own ("CHAPTER III —
   * SECTION 1"), because the reader groups provisions by the division they
   * sit in and would otherwise show the section's articles under a heading
   * that never says which chapter they belong to.
   */
  const divisionIndexFor = new Map<string, number>();
  const labelFor = new Map<string, string>();
  $("div[id^='cpt_'], div[id^='sct_']").each((_, el) => {
    const $el = $(el);
    const id = $el.attr("id") ?? "";
    // "cpt_III", and the sections inside it, which are named for their parent
    // ("cpt_III.sct_1"). ".tit_1" is the division's own title block, not a
    // division.
    if (!/^(cpt|sct)_/.test(id) || id.includes(".tit_")) return;
    const own = squish($el.children("p").first().text());
    if (!own) return;
    // The division's name sits in an `.eli-title` block in the OJ layout and
    // in a second title paragraph in the consolidated one.
    const title =
      squish($el.children("div.eli-title").first().text()) ||
      squish($el.children("p").eq(1).text()) ||
      null;
    const parentId = $el.parents("div[id^='cpt_'], div[id^='sct_']").first().attr("id") ?? "";
    const parentLabel = labelFor.get(parentId);
    const label = parentLabel ? `${parentLabel} — ${own}` : own;
    labelFor.set(id, label);
    divisionIndexFor.set(id, chapters.length);
    chapters.push({ label, title });
  });

  $("div[id^='art_']")
    .filter((_, el) => /^art_[^.]+$/.test($(el).attr("id") ?? ""))
    .each((_, el) => {
      const $el = $(el);
      const anchor = $el.attr("id") as string;

      // The label is the article's own title paragraph — the first `p` child,
      // whatever class the layout gives it.
      const $label = $el.children("p").first();
      const label = squish($label.text());
      if (!/^Article\b/i.test(label)) return;

      const $heading = $el.children("div.eli-title").first();
      const heading = squish($heading.text()) || null;

      const blocks: string[] = [];
      $el.children().each((_, child) => {
        const $child = $(child);
        if ($child.is($label) || $child.is($heading)) return;
        const text = textOf($, $child);
        if (text) blocks.push(text);
      });

      const { articleNumber, articleLetter } = parseArticleLabel(label);
      const divisionId = $el.parents("div[id^='cpt_'], div[id^='sct_']").first().attr("id") ?? "";
      const paragraphs = toParagraphs(anchor, blocks);
      provisions.push({
        kind: "article",
        anchor,
        articleNumber,
        articleLetter,
        displayLabel: label,
        heading,
        chapterIndex: divisionIndexFor.get(divisionId) ?? null,
        paragraphs,
        fullText: paragraphs.map((par) => par.text).join("\n\n"),
      });
    });

  // Annexes. They carry the lists, the technical specifications and the
  // tables an act's articles point at, so they are stored — one provision
  // each, with no article number, so the citation linker can never resolve
  // "Article 3" to an annex that happens to number its points.
  $("div[id^='anx_']")
    .filter((_, el) => /^anx_[^.]+$/.test($(el).attr("id") ?? ""))
    .each((_, el) => {
      const $el = $(el);
      const anchor = $el.attr("id") as string;
      const body = textOf($, $el);
      const lines = body.split("\n");
      const label =
        lines.find((line) => /^ANNEX\b/i.test(line) && line.length < 120) ??
        `ANNEX ${anchor.slice(4)}`;
      const paragraphs = toParagraphs(anchor, lines);
      provisions.push({
        kind: "annex",
        anchor,
        articleNumber: null,
        articleLetter: null,
        displayLabel: label,
        heading: null,
        chapterIndex: null,
        paragraphs,
        fullText: paragraphs.map((par) => par.text).join("\n\n"),
      });
    });

  return {
    title: parseTitle($),
    chapters,
    provisions,
    eeaRelevanceStated: /\(Text with EEA relevance\)/i.test($("body").text()),
    layout,
  };
}

/**
 * The document's own subject line.
 *
 * The catalogue already knows the act's official title from Cellar's
 * metadata, so this is only a cross-check and a fallback: the title paragraphs
 * of the act as printed, minus the citation and the date, which is what the
 * `.oj-doc-ti` / `.title-doc-*` runs hold.
 */
function parseTitle($: CheerioAPI): string | null {
  const parts = $("p.oj-doc-ti, p.title-doc-first, p.title-doc-last")
    .toArray()
    .map((p) => squish($(p).text()))
    .filter(Boolean);
  if (parts.length === 0) return null;
  const subject = parts
    .filter((p) => !/^\(Text with EEA relevance\)$/i.test(p))
    .filter((p) => !TITLE_DATE_RE.test(` ${p}`) || parts.length === 1);
  return subject.join(" ").trim() || null;
}

/** The formula that closes an act's recitals and opens its enacting terms. */
const ADOPTION_FORMULA =
  /(HAVE|HAS)\s+(ADOPTED|AGREED)[^.:]{0,80}[:.]|HAVE\s+DECIDED\s+AS\s+FOLLOWS[:.]/i;

/**
 * The pre-2004 layout, which has no structure to read — only paragraphs.
 *
 * An article heading is a paragraph whose entire content is "Article N", and
 * the parse starts after the adoption formula so that the Treaty articles
 * cited in the recitals above it cannot be mistaken for articles of this act.
 * An act whose text yields no article this way is reported with no provisions
 * rather than with wrong ones — the adapter records that and moves on.
 */
function parseLegacy($: CheerioAPI): ParsedEuAct {
  const paragraphs = $("p")
    .toArray()
    .map((p) => squish($(p).text()))
    .filter(Boolean);

  const start = paragraphs.findIndex((p) => ADOPTION_FORMULA.test(p));
  const body = start >= 0 ? paragraphs.slice(start + 1) : [];

  const provisions: ParsedEuProvision[] = [];
  const chapters: ParsedEuChapter[] = [];
  let current: { label: string; blocks: string[]; chapterIndex: number | null } | null = null;
  let chapterIndex: number | null = null;
  let annexOrdinal = 0;
  /**
   * The line under "Article 3", where the act prints one.
   *
   * The legacy layout marks an article's heading no differently from its
   * first sentence, so it is recognised by shape: a short line that does not
   * end a sentence and does not open a numbered paragraph. Getting this wrong
   * costs a heading, not a paragraph — the line stays in the article's text
   * either way.
   */
  const takeHeading = (blocks: string[]): string | null => {
    const first = blocks[0];
    if (!first || first.length > 80) return null;
    if (/[.:;,]$/.test(first)) return null;
    if (/^[0-9(]/.test(first)) return null;
    blocks.shift();
    return first;
  };

  const flush = () => {
    if (!current) return;
    const anchor = /^Article/i.test(current.label)
      ? `art_${current.label.replace(/^Article\s+/i, "").replace(/\s+/g, "").toLowerCase()}`
      : `anx_${annexOrdinal++}`;
    const { articleNumber, articleLetter } = parseArticleLabel(current.label);
    const isArticle = /^Article/i.test(current.label);
    const heading = isArticle ? takeHeading(current.blocks) : null;
    const paras = toParagraphs(anchor, current.blocks);
    provisions.push({
      kind: isArticle ? "article" : "annex",
      anchor,
      articleNumber,
      articleLetter,
      displayLabel: current.label,
      heading,
      chapterIndex: current.chapterIndex,
      paragraphs: paras,
      fullText: paras.map((p) => p.text).join("\n\n"),
    });
    current = null;
  };

  for (const text of body) {
    if (/^Article\s+\d+[a-z]?$/i.test(text)) {
      flush();
      current = { label: text, blocks: [], chapterIndex };
      continue;
    }
    if (/^ANNEX\b/i.test(text) && text.length < 60) {
      flush();
      current = { label: text, blocks: [], chapterIndex: null };
      continue;
    }
    if (/^(CHAPTER|SECTION|TITLE)\s+[IVXLC0-9]+$/i.test(text)) {
      flush();
      chapters.push({ label: text, title: null });
      chapterIndex = chapters.length - 1;
      continue;
    }
    // A chapter's own name is the line under its number.
    if (chapters.length && chapterIndex === chapters.length - 1 && !current && !chapters[chapterIndex].title) {
      chapters[chapterIndex].title = text;
      continue;
    }
    if (current) current.blocks.push(text);
  }
  flush();

  return {
    title: null,
    chapters,
    provisions,
    eeaRelevanceStated: /\(Text with EEA relevance\)/i.test(paragraphs.join(" ")),
    layout: "legacy",
  };
}

/**
 * Parses one act's published text, in whichever of the three layouts Cellar
 * returned it in.
 *
 * Never throws on a document it does not recognise: it returns no provisions,
 * which the adapter records against the act as a text it could not read. A
 * layout change upstream therefore shows up as a count that stops rising,
 * not as a run that dies.
 */
export function parseEuActHtml(html: string): ParsedEuAct {
  const $ = load(html);
  $("script, style, noscript").remove();

  if ($("div[id^='art_']").length > 0) {
    const layout: EuLayout = $("p.title-article-norm").length > 0 ? "consolidated" : "oj";
    return parseStructured($, layout);
  }
  return parseLegacy($);
}
