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
  // Parentheses have to be percent-encoded, and encodeURIComponent leaves them
  // alone: Cellar answers 404 for ".../celex/21994D0330(01)" and 200 for the
  // same number encoded. Only the suffixed CELEX numbers carry them — which is
  // every decision of the EEA Joint Committee published before about 2005, so
  // this is the difference between reading a decade of them and none.
  const encoded = encodeURIComponent(celex).replace(/\(/g, "%28").replace(/\)/g, "%29");
  return `https://publications.europa.eu/resource/celex/${encoded}`;
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
    // The Official Journal files the decisions of that era under a number
    // printed *before* the instrument: "2000/111/EC: Commission Decision".
    // Left as written it reads backwards and sorts under the year; the
    // citation is "Commission Decision 2000/111/EC".
    const filed = /^(\d{4}\/\d{1,4}\/[A-Z]+(?:,\s*[A-Z]+)*)\s*:\s*(.+)$/.exec(cited);
    if (filed) return `${filed[2].trim()} ${filed[1]}`;
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

/**
 * The readable text of a document Cellar served, for the sources stored as
 * documents rather than parsed into articles.
 *
 * Deliberately not the act parser below: a judgment and a decision of the
 * Joint Committee are prose, and what is wanted is the prose — the same shape
 * the PDF path produces for the sources that have one, so that both compose
 * into the same record.
 */
export function celexTextFromHtml(html: string): string {
  const $ = load(html);
  $("script, style, noscript").remove();
  return $("body").text();
}

// ---------------------------------------------------------------------------
// The parse
// ---------------------------------------------------------------------------

export type EuLayout = "oj" | "consolidated" | "legacy" | "treaty";

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
  /**
   * Notes the source prints under the provision, as printed.
   *
   * Empty for everything EUR-Lex serves: an EU act's amendments are recorded in
   * its consolidation, not in footnotes. EFTA's consolidated treaties do use
   * them, and they hold what a reader of an amended article most wants — which
   * instrument last changed it and when — so they go in the same column
   * Lagasafn's footnotes go in. See src/lib/treaty-text.ts.
   */
  footnotes?: string[];
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

/**
 * The formula that closes an act's recitals and opens its enacting terms.
 *
 * The last alternative is a treaty's, and it is why the EEA Agreement parsed to
 * nothing before it was added: an act says "HAVE ADOPTED THIS DIRECTIVE:",
 * while the Agreement says "HAVE DECIDED to conclude the following Agreement:".
 * The recitals above that line are 40 paragraphs of RECOGNISING and WHEREAS,
 * several of which cite articles of the EEC Treaty, so starting the parse in
 * the wrong place does not produce slightly wrong articles — it produces the
 * Treaty of Rome's.
 */
const ADOPTION_FORMULA =
  /(HAVE|HAS)\s+(ADOPTED|AGREED)[^.:]{0,80}[:.]|HAVE\s+DECIDED\s+AS\s+FOLLOWS[:.]|HAVE\s+DECIDED\s+TO\s+CONCLUDE[^.:]{0,80}[:.]/i;

/**
 * The formula that closes the enacting terms, where the adoption formula opened
 * them: the testimonium, the place and date of signature, and — in a treaty —
 * whatever the Official Journal printed next.
 *
 * Without it the legacy walk runs to the end of the document and everything it
 * finds belongs to the last article. On an act that is the signature block, a
 * few lines. On the EEA Agreement it was 95,000 characters: Article 129 came
 * out holding the testimonium in all thirteen authentic languages, the Final
 * Act, the joint declarations and the list of annexes — 83 paragraphs, where
 * the article has three.
 *
 * A treaty prints the testimonium once per authentic language and the languages
 * are ordered by their own names, so which one comes first depends on the
 * document. Only the first matters, so all of them are listed; the Icelandic
 * and Greek lines are matched loosely because the Journal's 1994 HTML is
 * mis-encoded and they do not arrive as their own letters.
 */
const CLOSING_FORMULA = new RegExp(
  [
    "Done at\\b",
    "FINAL ACT$",
    "In witness whereof\\b",
    "En fe de lo cual\\b",
    "Til bekr\\S*ftelse heraf\\b",
    "Zu Urkund dessen\\b",
    "En foi de quoi\\b",
    "In fede di che\\b",
    "Ten blijke waarvan\\b",
    "Som bevitnelse\\b",
    "Em f\\S* do que\\b",
    "Till be\\S*ftelse h\\S*rav\\b",
    "T\\S*m\\S*n vakuudeksi\\b",
    "\\S*essu til sta\\S*festingar\\b",
  ]
    .map((alternative) => `^${alternative}`)
    .join("|"),
  "i"
);

/**
 * The division headings a legacy paragraph carries, or null if it carries none.
 *
 * There is no markup here to tell a heading from a sentence, so the shape has to.
 * Three things are true of every real heading and of almost no sentence: it
 * begins with PART, TITLE, CHAPTER or SECTION followed by a numeral, it does not
 * end in punctuation — a sentence does — and the name after the numeral begins
 * with a capital. "Chapter 4 shall apply mutatis mutandis" fails the third and
 * "…as provided for in Chapter 2." fails the first two.
 *
 * Getting it wrong is not cosmetic: the caller flushes the article it is reading
 * when a heading appears, so a false positive loses the rest of that article's
 * text. Hence rules that are dull rather than clever.
 *
 * It returns a list because the Official Journal prints a run of divisions as one
 * paragraph — "PART III FREE MOVEMENT OF PERSONS, SERVICES AND CAPITAL CHAPTER 1
 * WORKERS AND SELF-EMPLOYED PERSONS" is one line in the EEA Agreement, and there
 * are five more like it. Under a one-heading-per-line rule those lines were too
 * long to be a heading and too heading-shaped to be text, so they ended up
 * inside Articles 27, 52, 65, 88 and 104.
 */
function legacyDivisions(text: string): ParsedEuChapter[] | null {
  const keyword = /(PART|TITLE|CHAPTER|SECTION)\s+([IVXLC]+|\d+)(?![\p{L}\d])/giu;
  if (text.length >= 200 || /[.;:,]$/.test(text)) return null;

  const marks = [...text.matchAll(keyword)];
  // It has to *open* with a division, not merely mention one.
  if (marks.length === 0 || marks[0].index !== 0) return null;

  const divisions: ParsedEuChapter[] = [];
  for (const [i, mark] of marks.entries()) {
    const from = mark.index + mark[0].length;
    const to = i + 1 < marks.length ? marks[i + 1].index : text.length;
    const title = text.slice(from, to).trim();
    if (title && !/^[A-Z(]/.test(title)) return null;
    divisions.push({
      label: `${mark[1].toUpperCase()} ${mark[2].toUpperCase()}`,
      title: title || null,
    });
  }
  return divisions;
}

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

  /**
   * Past the closing formula, where only annexes can still follow.
   *
   * Not a `break`, because an act prints its annexes *after* it is signed —
   * stopping outright dropped the e-Commerce Directive's annex, which is the
   * list of contracts Article 9 does not apply to. So the formula ends the
   * articles and nothing else: an ANNEX heading still opens a provision, and
   * everything between the two (the signatures, "For the Commission — The
   * President", a treaty's declarations) belongs to no provision and is
   * dropped, which is what it was before this loop ever saw it.
   */
  let closed = false;

  for (const text of body) {
    if (!closed && CLOSING_FORMULA.test(text)) {
      flush();
      closed = true;
      continue;
    }
    if (/^Article\s+\d+[a-z]?$/i.test(text)) {
      if (closed) continue;
      flush();
      current = { label: text, blocks: [], chapterIndex };
      continue;
    }
    // An annex heading, which the Journal prints in capitals. Matched
    // case-sensitively and with the sentence test, because "Annex XV contains
    // specific provisions on State aid." is not a heading — it is the whole body
    // of Article 63 of the EEA Agreement, and under the looser rule it opened an
    // annex and left the article empty. Articles 63, 72 and 77 of the Agreement
    // all read that way, and all three came out blank.
    if (/^ANNEX\b/.test(text) && text.length < 60 && !/[.:;,]$/.test(text)) {
      flush();
      current = { label: text, blocks: [], chapterIndex: null };
      continue;
    }
    if (closed && !current) continue;
    const divisions = legacyDivisions(text);
    if (divisions) {
      flush();
      // The innermost of a run is the one the articles below it belong to.
      chapters.push(...divisions);
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

// ---------------------------------------------------------------------------
// The treaties
// ---------------------------------------------------------------------------

/**
 * Where a treaty's own text stops and the protocols begin.
 *
 * `12016M/TXT` and `12016E/TXT` are not the TEU and the TFEU: each is the
 * treaty *followed by all 37 protocols and their annexes*, which between them
 * hold several hundred more articles numbered from 1. Parsed whole, the TFEU
 * comes out with over a thousand articles instead of 358, and "Article 3" means
 * four different things.
 *
 * The protocols open with a `doc-ti` heading reading exactly "PROTOCOLS", and
 * cutting the document there gives 55 articles for the TEU and 358 for the
 * TFEU — both exactly right. So the cut is the whole of the parse's
 * correctness, and if EUR-Lex ever renames that heading the article count
 * quadruples rather than falling to zero: see the treaty tests, which assert no
 * provision comes from a protocol.
 */
const PROTOCOLS_HEADING = /^PROTOCOLS$/i;

/**
 * Discards everything after the PROTOCOLS heading, and the heading itself.
 *
 * Everything that follows a node in document order is either a later sibling of
 * that node or a later sibling of one of its ancestors, so walking up and
 * dropping `nextAll()` at each level is the whole cut.
 */
function cutAtProtocols($: CheerioAPI): void {
  const marker = $("p.doc-ti")
    .toArray()
    .find((el) => PROTOCOLS_HEADING.test(squish($(el).text())));
  if (!marker) return;
  let node = $(marker);
  while (node.length > 0 && !node.is("body") && !node.is("html")) {
    node.nextAll().remove();
    node = node.parent();
  }
  $(marker).remove();
}

/**
 * The nesting of a treaty's divisions, which the markup does not state.
 *
 * The OJ layout puts an act's articles *inside* a `div id="cpt_III"`, so
 * membership can be read off the tree. A treaty prints PART ONE, TITLE I,
 * CHAPTER 1 and SECTION 1 as flat sibling paragraphs and leaves the reader to
 * infer the hierarchy from the words — so this table is the hierarchy, and a
 * division is nested under whichever open divisions outrank it.
 */
const TREATY_DIVISION_LEVELS: [RegExp, number][] = [
  [/^PART\b/i, 1],
  [/^TITLE\b/i, 2],
  [/^CHAPTER\b/i, 3],
  [/^SECTION\b/i, 4],
];

function treatyDivisionLevel(label: string, openLevels: number): number {
  for (const [pattern, level] of TREATY_DIVISION_LEVELS) {
    if (pattern.test(label)) return level;
  }
  // An unrecognised heading replaces the deepest open division rather than
  // nesting under it: guessing that it is deeper would put every article after
  // it under a division that does not contain them.
  return Math.max(1, openLevels);
}

/**
 * The founding treaties: the TEU, the TFEU, and anything else Cellar serves in
 * the same markup.
 *
 * Close enough to the `oj` layout to be confusing, and different in the three
 * ways that matter:
 *
 *   - an article's container is `div id="001"`, not `div id="art_1"`;
 *   - its number is in `p.ti-art`, where the OJ layout writes `p.oj-ti-art`;
 *   - divisions are flat sibling paragraphs rather than nesting the articles
 *     they contain (see TREATY_DIVISION_LEVELS).
 *
 * `p.sti-art`, the line under the article number, is kept as the provision's
 * heading, though a treaty rarely uses it as one: what it almost always holds
 * is the pre-Lisbon numbering, "(ex Article 86 TEC)". That is worth storing
 * rather than dropping — a 2005 judgment cites Article 86 TEC and a reader
 * looking it up needs to land on Article 106 TFEU — and the search index is
 * what turns it into that lookup.
 */
function parseTreaty($: CheerioAPI): ParsedEuAct {
  cutAtProtocols($);

  // The OJ's footnote calls, which are rendered inline and would otherwise
  // read as part of the sentence they hang off: "…between men and women.(2)".
  // Only the call is removed; the note's own text is a paragraph of its own and
  // is left where it is.
  $("span.note-tag").each((_, el) => {
    const $call = $(el).closest("a");
    ($call.length > 0 ? $call : $(el)).remove();
  });

  const chapters: ParsedEuChapter[] = [];
  const provisions: ParsedEuProvision[] = [];

  /** The open division at each level, deepest last. See treatyDivisionLevel. */
  const openLabels: (string | undefined)[] = [];
  let chapterIndex: number | null = null;

  $("p.ti-section-1, p.ti-section-2, div[id]").each((_, el) => {
    const $el = $(el);

    if ($el.is("p.ti-section-1")) {
      const own = squish($el.text());
      if (!own) return;
      const level = treatyDivisionLevel(own, openLabels.length);
      openLabels.length = level - 1;
      openLabels[level - 1] = own;
      chapters.push({
        label: openLabels.filter(Boolean).join(" — "),
        title: null,
      });
      chapterIndex = chapters.length - 1;
      return;
    }

    // The division's name, in bold under its number. It belongs to the division
    // opened immediately above it and to nothing else, so a second one is the
    // body text of something and is left alone.
    if ($el.is("p.ti-section-2")) {
      const title = squish($el.text());
      const division = chapterIndex !== null ? chapters[chapterIndex] : null;
      if (division && division.title === null && title) division.title = title;
      return;
    }

    // An article. Its container's id is the article's ordinal, zero-padded and
    // useless as an anchor ("001"), so the anchor is built from the number the
    // article actually carries.
    const id = $el.attr("id") ?? "";
    if (!/^\d+$/.test(id)) return;
    const $label = $el.children("p.ti-art").first();
    const label = squish($label.text());
    if (!/^Article\b/i.test(label)) return;

    const $heading = $el.children("p.sti-art").first();
    const heading = squish($heading.text()) || null;

    const blocks: string[] = [];
    $el.children().each((_, child) => {
      const $child = $(child);
      if ($child.is($label) || $child.is($heading)) return;
      const text = textOf($, $child);
      if (text) blocks.push(text);
    });

    const { articleNumber, articleLetter } = parseArticleLabel(label);
    const anchor =
      articleNumber !== null ? `art_${articleNumber}${articleLetter ?? ""}` : `art_${id}`;
    const paragraphs = toParagraphs(anchor, blocks);
    provisions.push({
      kind: "article",
      anchor,
      articleNumber,
      articleLetter,
      displayLabel: label,
      heading,
      chapterIndex,
      paragraphs,
      fullText: paragraphs.map((par) => par.text).join("\n\n"),
    });
  });

  return {
    // The document's own title is the consolidation's ("CONSOLIDATED VERSION OF
    // THE TREATY ON EUROPEAN UNION"), which is a fact about the text rather
    // than the name of the instrument. The registry in src/lib/treaties.ts
    // holds the name; this is the cross-check that the right document arrived.
    title: squish($("p.doc-ti").first().text()) || parseTitle($),
    chapters,
    provisions,
    eeaRelevanceStated: false,
    layout: "treaty",
  };
}

/**
 * Parses one act's published text, in whichever of the four layouts Cellar
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
  // A treaty, recognised by the one thing only a treaty has here: an article
  // container whose id is its ordinal. Deliberately narrow — a document with
  // `ti-art` paragraphs and no such container is something else, and is better
  // served by the legacy walk than by a treaty parse that would find nothing
  // in it.
  const treatyArticles = $("div[id]").filter(
    (_, el) => /^\d+$/.test($(el).attr("id") ?? "") && $(el).children("p.ti-art").length > 0
  );
  if (treatyArticles.length > 0) return parseTreaty($);
  return parseLegacy($);
}
