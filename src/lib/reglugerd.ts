/**
 * Parses an Icelandic regulation (reglugerð) into the chapter / provision /
 * paragraph structure the act reader and the citation linker already use for
 * lög and for EU acts.
 *
 * Regulations come from reglugerd.is, and they arrive in two shapes, which is
 * the single most important thing to know about this corpus:
 *
 *   Structured — semantic markup, and the same markup whether it comes from
 *     the API's `text` field or from a page on the site:
 *
 *       <h2 class="chapter__title">I. KAFLI <em class="chapter__name">…</em></h2>
 *       <h3 class="article__title">1. gr. <em class="article__name">…</em></h3>
 *       <p>body…</p>
 *
 *   Word soup — what the older half of the register was converted from, with
 *     no classes and no anchors. An article is a centred paragraph reading
 *     "4. gr.", its heading the centred italic paragraph above it:
 *
 *       <p align="center"><em><span>Mörk þjóðgarðsins.</span></em></p>
 *       <p align="center"><span>4. gr.</span></p>
 *       <p><span>body…</span></p>
 *
 * Both parse into articles here, but they are not equally trustworthy, and
 * `structure` says which was used. A structured parse rests on markup the
 * publisher wrote; a heuristic one rests on a paragraph being centred, which
 * is a typesetting choice and not a promise. Anything that would hang a
 * citation link off an article boundary should look at `structure` first —
 * see the adapter, which records it on the act.
 *
 * Measured on 2026-09-15: of 48 regulations sampled across the register, 12
 * came back from the API with text and 36 as a stub to be fetched from the
 * site. Both generations appear on the site, so the split is not simply
 * old/new and cannot be decided by year — it has to be decided by looking,
 * which is what detectStructure() does.
 */
import { load, type CheerioAPI } from "cheerio";

export type RegulationStructure = "structured" | "heuristic";

export interface ParsedRegulationChapter {
  /** Roman numeral as printed, e.g. "I". Null for an unnumbered section. */
  numeral: string | null;
  /** The heading as printed, e.g. "I. KAFLI". */
  label: string;
  title: string | null;
}

export interface ParsedRegulationParagraph {
  number: number;
  text: string;
}

export interface ParsedRegulationProvision {
  /**
   * Synthesised, because reglugerd.is publishes no anchors of any kind.
   * Derived from the article number ("A12", "A12A") rather than from position,
   * so that it survives an amendment inserting text above it —
   * `CaseProvisionLink` cascades from `Provision`, and a positional key would
   * throw every link on the regulation away on the next consolidation.
   *
   * Unnumbered material gets "X{i}", which is positional and says so.
   */
  anchor: string;
  articleNumber: number | null;
  articleLetter: string | null;
  /** As printed: "12. gr.", "12. gr. a". */
  displayLabel: string;
  heading: string | null;
  /** Index into ParsedRegulation.chapters, or null. */
  chapterIndex: number | null;
  paragraphs: ParsedRegulationParagraph[];
  fullText: string;
}

export interface ParsedRegulation {
  title: string;
  structure: RegulationStructure;
  chapters: ParsedRegulationChapter[];
  provisions: ParsedRegulationProvision[];
}

/** Unicode-normalises and collapses whitespace, as the Lagasafn parser does. */
export function normalizeRegulationText(s: string): string {
  return s
    .normalize("NFC")
    .replace(/[   ]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

/**
 * "0300/2020" and "0300-2020" — the two ways reglugerd.is writes a
 * regulation's number, in its JSON and in its URLs respectively.
 */
export function parseRegulationName(name: string): { number: number; year: number } | null {
  const m = /^(\d{1,4})[/-](\d{4})$/.exec(name.trim());
  if (!m) return null;
  const number = Number(m[1]);
  const year = Number(m[2]);
  if (!number || !year) return null;
  return { number, year };
}

/** The reglugerd.is form: 300/2020 → "0300-2020". */
export function regulationSlug(number: number, year: number): string {
  return `${String(number).padStart(4, "0")}-${year}`;
}

/** The canonical permalink on reglugerd.is. */
export function regulationUrl(number: number, year: number): string {
  return `https://www.reglugerd.is/reglugerdir/allar/nr/${regulationSlug(number, year)}`;
}

/**
 * Whether a body carries the publisher's own structure, or has to be read out
 * of centred paragraphs. One class name decides it: the structured generation
 * always labels its articles, and the soup never does.
 */
export function detectStructure(html: string): RegulationStructure {
  return /class="[^"]*article__title/.test(html) ? "structured" : "heuristic";
}

/**
 * An article label, in either numbering convention regulations use.
 *
 * Most number their articles as lög do — "12. gr.", "12. gr. a". The large
 * technical ones number them against the chapter instead: byggingarreglugerð
 * nr. 112/2012 runs "1.1.1. gr." through "17.1.1. gr." across 439 articles.
 *
 * `key` is what the anchor is built from and covers both. `number` is only
 * ever filled for the flat form, because `Provision.articleNumber` is an
 * integer and a dotted article has no honest integer: 1.2.1 is not article 1,
 * and storing it as 1 would let a citation to "1. gr." of the regulation
 * resolve to it. The Lagasafn parser refuses in the same way and for the same
 * reason — see its annex handling.
 */
export function parseArticleLabel(
  text: string
): { key: string; number: number | null; letter: string | null } | null {
  const flat = /^(\d{1,3})\.\s*gr\.?\s*([a-záðéíóúýþæö])?\.?$/i.exec(text.trim());
  if (flat) {
    const letter = flat[2] ? flat[2].toLowerCase() : null;
    return {
      key: `${flat[1]}${letter ? letter.toUpperCase() : ""}`,
      number: Number(flat[1]),
      letter,
    };
  }
  const dotted = /^(\d{1,3}(?:\.\d{1,3}){1,3})\.\s*gr\.?\s*([a-záðéíóúýþæö])?\.?$/i.exec(
    text.trim()
  );
  if (dotted) {
    const letter = dotted[2] ? dotted[2].toLowerCase() : null;
    return {
      key: `${dotted[1].replace(/\./g, "_")}${letter ? letter.toUpperCase() : ""}`,
      number: null,
      letter,
    };
  }
  return null;
}

/** "I. KAFLI", "II. kafli", "1. HLUTI" — a division, not an article. */
function parseChapterLabel(text: string): { numeral: string; label: string } | null {
  const m = /^([IVXLCDM]+|\d{1,2})\.\s*(KAFLI|kafli|HLUTI|hluti)\.?$/.exec(text.trim());
  if (!m) return null;
  return { numeral: m[1], label: text.trim() };
}

/** Elements whose text is the regulation's body rather than its structure. */
const BODY_TEXT = new Set(["p", "li", "td"]);

function anchorFor(a: { key: string }): string {
  return `A${a.key}`;
}

function finish(
  provisions: ParsedRegulationProvision[]
): ParsedRegulationProvision[] {
  let unnumbered = 0;
  const seen = new Set<string>();
  const kept: ParsedRegulationProvision[] = [];
  for (const p of provisions) {
    p.fullText = p.paragraphs.map((x) => x.text).join("\n\n");
    if (!p.anchor) p.anchor = `X${unnumbered++}`;
    // A regulation that repeats an article number — the soup generation does
    // it where an amendment was pasted in — would otherwise violate the
    // (actId, anchor) unique key and fail the whole save. Suffixing keeps both
    // and keeps the first one's anchor stable, which is the one citations
    // would resolve to.
    if (seen.has(p.anchor)) {
      let n = 2;
      while (seen.has(`${p.anchor}-${n}`)) n++;
      p.anchor = `${p.anchor}-${n}`;
    }
    seen.add(p.anchor);
    if (p.displayLabel || p.fullText) kept.push(p);
  }
  return kept;
}

/**
 * The structured generation: headings carry their own classes, so the parse is
 * a walk over siblings with no guessing.
 */
function parseStructured($: CheerioAPI): {
  chapters: ParsedRegulationChapter[];
  provisions: ParsedRegulationProvision[];
} {
  const chapters: ParsedRegulationChapter[] = [];
  const provisions: ParsedRegulationProvision[] = [];
  let chapterIndex: number | null = null;
  let current: ParsedRegulationProvision | null = null;

  const push = () => {
    if (current) provisions.push(current);
    current = null;
  };

  // Body text is not only in <p>. Byggingarreglugerð's definitions article is
  // an <ol> of 726 <li>, and 26 of its articles carry tables; selecting <p>
  // alone dropped that article's entire text while still reporting a
  // successful parse. `li` and `td` are block-level enough to stand as
  // paragraphs, and BODY_TEXT below is what stops one from being counted
  // twice when they nest.
  $("h1, h2, h3, h4, h5, p, li, td").each((_, el) => {
    const $el = $(el);
    const cls = $el.attr("class") ?? "";

    // A section ("1. HLUTI") and a chapter ("1.1. KAFLI") are both divisions;
    // byggingarreglugerð nests the second inside the first. Flattened into one
    // list, because Chapter has no parent and an article belongs to whichever
    // division most recently opened — which is the one printed nearest above
    // it, and the one a reader would name.
    if (/\b(chapter__title|section__title)\b/.test(cls)) {
      push();
      const name = $el.find("em").first().text();
      const label = normalizeRegulationText($el.clone().find("em").remove().end().text());
      chapters.push({
        numeral: parseChapterLabel(label)?.numeral ?? null,
        label: label || normalizeRegulationText($el.text()),
        title: normalizeRegulationText(name).replace(/\.$/, "") || null,
      });
      chapterIndex = chapters.length - 1;
      return;
    }

    if (/\barticle__title\b/.test(cls)) {
      push();
      const name = $el.find("em").first().text();
      const label = normalizeRegulationText($el.clone().find("em").remove().end().text());
      const parsed = parseArticleLabel(label);
      current = {
        anchor: parsed ? anchorFor(parsed) : "",
        articleNumber: parsed?.number ?? null,
        articleLetter: parsed?.letter ?? null,
        displayLabel: label,
        heading: normalizeRegulationText(name).replace(/\.$/, "") || null,
        chapterIndex,
        paragraphs: [],
        fullText: "",
      };
      return;
    }

    if (!BODY_TEXT.has(el.tagName)) return;
    // A <p> inside an <li>, or an <li> inside an <li>, would otherwise be
    // stored once on its own and again as part of its parent.
    if ($el.parents("p, li, td").length > 0) return;
    const text = normalizeRegulationText($el.text());
    if (!text || !current) return;
    current.paragraphs.push({ number: current.paragraphs.length + 1, text });
  });

  push();
  return { chapters, provisions };
}

/**
 * The Word-soup generation. An article is a centred paragraph whose whole text
 * is "4. gr."; its heading is the centred italic paragraph immediately above.
 *
 * Centring is the only signal there is, and it is why `structure` exists: a
 * regulation that centres a paragraph of body text will read as an article
 * boundary here, and nothing downstream should treat these boundaries as
 * published fact.
 */
function parseHeuristic($: CheerioAPI): {
  chapters: ParsedRegulationChapter[];
  provisions: ParsedRegulationProvision[];
} {
  const chapters: ParsedRegulationChapter[] = [];
  const provisions: ParsedRegulationProvision[] = [];
  let chapterIndex: number | null = null;
  let current: ParsedRegulationProvision | null = null;
  /** The last centred italic line, held in case the next line is an article. */
  let pendingHeading: string | null = null;

  const push = () => {
    if (current) provisions.push(current);
    current = null;
  };

  $("p").each((_, el) => {
    const $el = $(el);
    const text = normalizeRegulationText($el.text());
    if (!text) return;
    const centred =
      ($el.attr("align") ?? "").toLowerCase() === "center" ||
      /text-align:\s*center/i.test($el.attr("style") ?? "");

    if (centred) {
      const chapter = parseChapterLabel(text);
      if (chapter) {
        push();
        chapters.push({ numeral: chapter.numeral, label: chapter.label, title: null });
        chapterIndex = chapters.length - 1;
        pendingHeading = null;
        return;
      }

      const article = parseArticleLabel(text);
      if (article) {
        push();
        current = {
          anchor: anchorFor(article),
          articleNumber: article.number,
          articleLetter: article.letter,
          displayLabel: text,
          heading: pendingHeading,
          chapterIndex,
          paragraphs: [],
          fullText: "",
        };
        pendingHeading = null;
        return;
      }

      // A centred line that is neither: the heading for whatever comes next,
      // or — where a chapter has just opened and has no title yet — its title.
      if (chapterIndex !== null && chapters[chapterIndex].title === null && !current) {
        chapters[chapterIndex].title = text.replace(/\.$/, "");
        return;
      }
      pendingHeading = text.replace(/\.$/, "");
      return;
    }

    pendingHeading = null;
    if (!current) return;
    current.paragraphs.push({ number: current.paragraphs.length + 1, text });
  });

  push();
  return { chapters, provisions };
}

/**
 * Parses a regulation body — the API's `text` field, or the body extracted
 * from a page on reglugerd.is — into chapters and articles.
 *
 * `title` is not in the body in either generation; it comes from the register
 * entry, so the caller passes it in.
 */
export function parseRegulationBody(html: string, title: string): ParsedRegulation {
  const structure = detectStructure(html);
  const $ = load(html);
  const { chapters, provisions } =
    structure === "structured" ? parseStructured($) : parseHeuristic($);
  return {
    title: normalizeRegulationText(title),
    structure,
    chapters,
    provisions: finish(provisions),
  };
}

/**
 * Pulls the regulation's body out of a full page on reglugerd.is.
 *
 * Two containers, one per generation: `.Section1` is what Word left behind,
 * and the structured pages put the text straight into the article body after
 * the `.rinfo` metadata block. Everything before the first article heading —
 * the site's navigation, the "Reglugerð á PDF formi" link list, the
 * "Breytingareglugerðir" box — is dropped, because it is about the regulation
 * rather than part of it.
 */
export function extractRegulationBody(pageHtml: string): string | null {
  const $ = load(pageHtml);
  const soup = $("div.Section1").first();
  if (soup.length) return $.html(soup) ?? null;

  const main = $("div.article, main, #content").first();
  const scope = main.length ? main : $("body");
  // Keep only from the first article heading onwards.
  const first = scope.find(".article__title, .chapter__title, .section__title").first();
  if (!first.length) return null;
  const parts = [$.html(first) ?? ""];
  first.nextAll().each((_, el) => {
    parts.push($.html($(el)) ?? "");
  });
  return parts.join("\n");
}
