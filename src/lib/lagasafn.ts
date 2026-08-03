/**
 * Parses a Lagasafn law page into the chapter / provision / paragraph
 * structure the act reader and the citation linker are built on.
 *
 * Lagasafn publishes the consolidated text as HTML with no schema, but it
 * carries stable anchors that make a clean parse possible:
 *
 *   <b>II. kafli A.</b> <b>Jarðir í sameign.]<sup>1)</sup></b>  ← chapter, no anchor
 *   <span id="G7A"></span>                                       ← article anchor
 *   <img src="/lagas/sk.jpg"> <b>[7. gr. a.</b> <em>Fyrirsvar …</em>
 *   <img src="/lagas/hk.jpg" id="G7AM1"> Ef eigendur jarðar …    ← paragraph anchor
 *   <sup>1)</sup>
 *   <i><small><sup>1)</sup><a href="…">L. 74/2022, 2. gr.</a></small></i>
 *
 * `G7A` means "7. gr. a", so sub-numbering is structural rather than only a
 * printed label, and `#G7AM1` is a real anchor on althingi.is — which is what
 * lets a provision deep-link to the exact article and paragraph in the
 * official text.
 *
 * Two things the markup does *not* give us, handled below:
 *  - chapters have no anchor, so membership is derived from document order;
 *  - provisions under "Ákvæði til bráðabirgða" have no `<span>` anchor and are
 *    labelled with roman numerals rather than "N. gr.", their paragraphs
 *    carrying `B{n}M{m}` ids instead of `G…`. Parsed as kind "temporary".
 *
 * Validated against 33 acts: every article anchor resolved to a labelled
 * provision, and every paragraph anchor to a paragraph. See
 * docs/phase-0-acts-provisions.md.
 */
import { load, type Cheerio, type CheerioAPI } from "cheerio";
import type { AnyNode } from "domhandler";

export interface ParsedParagraph {
  /** Lagasafn's paragraph anchor, e.g. "G7AM1". */
  anchor: string;
  number: number;
  text: string;
}

export type ProvisionKind = "article" | "temporary" | "annex";

export interface ParsedProvision {
  /**
   * Determined by which anchor Lagasafn gives the provision, not by the
   * heading above it — headings vary ("Ákvæði til bráðabirgða", "Bráðabirgða-
   * ákvæði", "Ákvæði um stundarsakir") while the anchors do not:
   *
   *   "article"   — `G…`, a numbered "N. gr." of the act itself.
   *   "temporary" — `B…`, ákvæði til bráðabirgða, labelled with roman numerals.
   *   "annex"     — no anchor at all. Annexed treaty text carries its own
   *                 "1. gr.", "2. gr." numbering (the convention inside lög nr.
   *                 62/1994, say) which is *not* the act's numbering. Kept for
   *                 display but deliberately given no articleNumber, so the
   *                 citation linker can never resolve "5. gr. laga nr. 62/1994"
   *                 to an annex article that merely happens to share a number.
   */
  kind: ProvisionKind;
  /** Lagasafn's anchor, e.g. "G7A" or "B0". */
  anchor: string;
  articleNumber: number | null;
  articleLetter: string | null;
  displayLabel: string;
  heading: string | null;
  /** Index into ParsedAct.chapters, or null when the act has no chapters. */
  chapterIndex: number | null;
  paragraphs: ParsedParagraph[];
  fullText: string;
  isRepealed: boolean;
  /** Amendment footnotes trailing the provision, e.g. "1) L. 74/2022, 2. gr.". */
  footnotes: string[];
}

export interface ParsedChapter {
  numeral: string | null;
  letter: string | null;
  label: string;
  title: string | null;
}

export interface ParsedAct {
  actNumber: number | null;
  year: number | null;
  title: string;
  /** Lagasafn codex version the page was served from, e.g. "157b". */
  codexVersion: string | null;
  chapters: ParsedChapter[];
  provisions: ParsedProvision[];
}

const ROMAN = "IVXLCDM";

/**
 * Unicode-normalizes and collapses whitespace. NFC matters because Lagasafn's
 * Icelandic characters are not consistently composed — "ð" arriving as d +
 * combining stroke would not equal a composed "ð" in a search index or a
 * uniqueness check.
 */
export function normalizeLawText(s: string): string {
  return s
    .normalize("NFC")
    .replace(/[   ]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

/** Lagasafn brackets passages inserted by amendment; the brackets are editorial. */
function stripAmendmentBrackets(s: string): string {
  return s.replace(/[[\]]/g, "");
}

/** "G7A" → 7 / "a"; "G12" → 12 / null. */
function parseArticleAnchor(id: string): { number: number; letter: string | null } | null {
  const m = /^G(\d+)([A-Z]*)$/.exec(id);
  if (!m) return null;
  return { number: Number(m[1]), letter: m[2] ? m[2].toLowerCase() : null };
}

export function parseLagasafnHtml(html: string): ParsedAct {
  const $ = load(html);

  // The law body is the `.article.box.login` block. The page also carries an
  // earlier `.article.box` holding the version picker, which must not be
  // parsed as law text.
  const body = $("div.article.box.login .boxbody").first();
  const container = body.length ? body : $("body");

  /**
   * Text of an element with Lagasafn's footnote reference markers removed.
   *
   * Those markers are rendered as `<sup>1)</sup>` inside the very element
   * that carries the text, so a plain .text() glues them on: the act "Lög um
   * Kristnisjóð o.fl." comes out as "Lög um Kristnisjóð o.fl.1)". They are
   * pointers to the amendment footnote, not part of the name, and they were
   * reaching titles, headings and therefore the act lookup.
   */
  const cleanText = ($el: Cheerio<AnyNode>): string => {
    const copy = $el.clone();
    copy.find("sup").remove();
    return normalizeLawText(stripAmendmentBrackets(copy.text()));
  };

  const title = cleanText(container.find("h2").first());

  // The act's own number sits in the centered line under the title:
  //   <p style="text-align:center"><strong>2004 nr. 81 9. júní</strong></p>
  // Not simply the first <p>, which is Lagasafn's "Íslensk lög …" banner.
  let actNumber: number | null = null;
  let year: number | null = null;
  container.find("p strong, p b").each((_, el) => {
    if (actNumber !== null) return;
    const m = /^\s*(\d{4})\s+nr\.\s*(\d+)\b/.exec($(el).text());
    if (m) {
      year = Number(m[1]);
      actNumber = Number(m[2]);
    }
  });

  const codexVersion = /Útgáfa\s+(\w+)\./.exec(container.text())?.[1] ?? null;

  const chapters: ParsedChapter[] = [];
  const provisions: ParsedProvision[] = [];

  let chapterIndex: number | null = null;
  /** Set when a chapter heading has been seen but its title has not. */
  let chapterAwaitingTitle = false;

  let current: ParsedProvision | null = null;
  let pendingAnchor: string | null = null;
  let paragraphAnchor: string | null = null;
  let paragraphBuffer: string[] = [];

  const flushParagraph = () => {
    if (current && paragraphAnchor) {
      const text = normalizeLawText(paragraphBuffer.join(""));
      if (text) {
        current.paragraphs.push({
          anchor: paragraphAnchor,
          number: current.paragraphs.length + 1,
          text,
        });
      }
    }
    paragraphAnchor = null;
    paragraphBuffer = [];
  };

  const flushProvision = () => {
    flushParagraph();
    if (current) provisions.push(current);
    current = null;
  };

  const startProvision = () => {
    flushProvision();
    const anchorInfo = pendingAnchor ? parseArticleAnchor(pendingAnchor) : null;
    current = {
      // Provisional: an unanchored provision may still turn out to be
      // temporary once its first paragraph reveals a "B…" id. Settled in
      // finalizeKinds() below.
      kind: anchorInfo ? "article" : "annex",
      // Temporary provisions have no anchor of their own; it is recovered
      // from the first paragraph id ("B0M1" → "B0") in walk().
      anchor: pendingAnchor ?? "",
      articleNumber: anchorInfo?.number ?? null,
      articleLetter: anchorInfo?.letter ?? null,
      displayLabel: "",
      heading: null,
      chapterIndex,
      paragraphs: [],
      fullText: "",
      isRepealed: false,
      footnotes: [],
    };
    pendingAnchor = null;
  };

  const walk = (node: Cheerio<AnyNode>) => {
    for (const el of node.contents().toArray()) {
      if (el.type === "text") {
        if (paragraphAnchor) paragraphBuffer.push(el.data);
        continue;
      }
      if (el.type !== "tag") continue;

      const $el = $(el as AnyNode);
      const tag = el.tagName;
      const id = el.attribs?.id;

      // Article anchor — always immediately precedes the article's marker image.
      if (tag === "span" && id && /^G\d+[A-Z]*$/.test(id)) {
        pendingAnchor = id;
        continue;
      }

      if (tag === "img") {
        const src = el.attribs?.src ?? "";
        // sk.jpg marks the start of a provision, in both the numbered and the
        // temporary sections.
        if (src.includes("sk.jpg")) {
          startProvision();
          continue;
        }
        // hk.jpg marks a paragraph, and carries its anchor.
        if (src.includes("hk.jpg") && id && /M\d+$/.test(id)) {
          flushParagraph();
          paragraphAnchor = id;
          // Recover a temporary provision's anchor from its first paragraph.
          if (current && !current.anchor) {
            current.anchor = id.replace(/M\d+$/, "");
          }
          continue;
        }
        continue;
      }

      // Amendment footnote line — must not bleed into the paragraph text.
      if (tag === "i" && $el.find("small sup").length > 0) {
        if (current) current.footnotes.push(normalizeLawText($el.text()));
        continue;
      }

      // Footnote reference markers are display-only.
      if (tag === "sup") continue;

      if (tag === "b") {
        // Take the text without any nested <sup>, so a chapter title does not
        // come out as "Jarðir í sameign.1)".
        const text = cleanText($el);

        const chapterMatch = new RegExp(
          `^([${ROMAN}]+)\\.?\\s*kafli\\.?\\s*([A-Z]?)\\.?$`,
          "i"
        ).exec(text);
        if (chapterMatch) {
          flushProvision();
          chapters.push({
            numeral: chapterMatch[1],
            letter: chapterMatch[2] || null,
            label: text,
            title: null,
          });
          chapterIndex = chapters.length - 1;
          chapterAwaitingTitle = true;
          continue;
        }

        // Wording varies between acts; all three forms open the same section.
        if (/^(Ákvæði til bráðabirgða|Bráðabirgðaákvæði|Ákvæði um stundarsakir)/i.test(text)) {
          flushProvision();
          chapters.push({ numeral: null, letter: null, label: text.replace(/\.$/, ""), title: null });
          chapterIndex = chapters.length - 1;
          chapterAwaitingTitle = false;
          continue;
        }

        // The chapter's title is the <b> immediately following its number.
        if (chapterAwaitingTitle && !current) {
          chapters[chapters.length - 1].title = text.replace(/\.$/, "") || null;
          chapterAwaitingTitle = false;
          continue;
        }

        // The provision's label: "1. gr.", "[7. gr. a.", or a roman numeral
        // ("I.", "I.–V.") in the temporary section. Kept exactly as printed —
        // the trailing period belongs to the abbreviation ("130. gr."), so
        // trimming it would render every provision label wrong.
        if (current && !current.displayLabel && text) {
          current.displayLabel = text.trim();
          continue;
        }

        if (paragraphAnchor) paragraphBuffer.push($el.text());
        continue;
      }

      if (tag === "em") {
        const text = cleanText($el);
        // A provision's own heading sits between its label and its first
        // paragraph; italics anywhere else is body text.
        if (current && current.heading === null && !paragraphAnchor && current.paragraphs.length === 0) {
          current.heading = text.replace(/\.$/, "") || null;
          continue;
        }
        if (paragraphAnchor) paragraphBuffer.push($el.text());
        continue;
      }

      if (tag === "br" || tag === "hr") {
        if (paragraphAnchor) paragraphBuffer.push("\n");
        continue;
      }

      if (tag === "script" || tag === "style" || tag === "form" || tag === "select") continue;

      walk($el);
    }
  };

  walk(container);
  flushProvision();

  // Settle kinds from the anchors that actually materialized, and give the
  // anchorless ones a synthetic key so they stay addressable and unique.
  let annexOrdinal = 0;
  for (const p of provisions) {
    if (/^B\d/.test(p.anchor)) {
      p.kind = "temporary";
      p.articleNumber = null;
      p.articleLetter = null;
    } else if (!p.anchor) {
      p.kind = "annex";
      p.articleNumber = null;
      p.articleLetter = null;
      p.anchor = `X${annexOrdinal++}`;
    }
  }

  for (const p of provisions) {
    p.fullText = p.paragraphs.map((x) => x.text).join("\n\n");
    // A provision whose whole body is Lagasafn's "…" placeholder has been
    // repealed; its text is gone but its number stays, so judgments citing it
    // still resolve.
    p.isRepealed = p.fullText.replace(/[\s….]/g, "").length === 0;
    if (!p.displayLabel) {
      p.displayLabel =
        p.articleNumber !== null
          ? `${p.articleNumber}. gr.${p.articleLetter ? ` ${p.articleLetter}.` : ""}`
          : p.anchor;
    }
  }

  // A stray provision marker with neither a label nor any text is layout
  // debris, not a provision.
  const kept = provisions.filter((p) => p.displayLabel || p.fullText);

  return { actNumber, year, title, codexVersion, chapters, provisions: kept };
}

/** The canonical permalink for an act's current version. */
export function actUrl(actNumber: number, year: number): string {
  return `https://www.althingi.is/lagas/nuna/${year}${String(actNumber).padStart(3, "0")}.html`;
}

/** The route this app serves an act at, e.g. "/log/91-1991". */
export function actPath(actNumber: number, year: number): string {
  return `/log/${actNumber}-${year}`;
}

/** Parses the "91-1991" form used by /log/{actNumber}-{year}. */
export function parseActSlug(slug: string): { actNumber: number; year: number } | null {
  const m = /^(\d{1,3})-(\d{4})$/.exec(slug);
  if (!m) return null;
  return { actNumber: Number(m[1]), year: Number(m[2]) };
}
