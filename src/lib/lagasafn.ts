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
  /**
   * The footnotes Lagasafn prints under the provision, one entry per numbered
   * note, marker included: `["1) L. 159/2008, 1. gr.", "2) L. 8/2015, 9. gr."]`.
   *
   * They arrive as a single glued run of text — every note for a provision
   * sits in one `<i><small>` element — and are split here, because a caller
   * that wants "which act last amended this article" cannot get it out of a
   * blob holding four notes.
   *
   * Not only amendments, despite the name they are usually given. Lagasafn
   * also footnotes the regulations *set under* an article, as "Rgl. 492/2001,
   * sbr. rgl. 278/2010" under 15. gr. laga nr. 38/2001 — which is why this is
   * `footnotes` rather than `amendmentFootnotes`. Anything reading them has to
   * look at what the note says, not assume.
   */
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
  /**
   * "Ferill málsins á Alþingi" — the act's own page on the parliamentary
   * record, linked from the Lagasafn page itself. Null for the handful of acts
   * that predate the record (Kristinréttur Árna, and the older tilskipanir).
   */
  ferillUrl: string | null;
  /**
   * "Frumvarp til laga" — the bill the act was passed from. HTML for anything
   * recent, a scanned PDF under /altext/pdf/ for the older þing.
   *
   * This is the link that makes preparatory works tractable. Matching acts to
   * þingmál by number and title is a guess; this is an anchor tag Alþingi
   * publishes on the act's own page, and it costs nothing because we download
   * that page anyway.
   */
  billUrl: string | null;
  chapters: ParsedChapter[];
  provisions: ParsedProvision[];
}

const ROMAN = "IVXLCDM";

/**
 * Marks a paragraph anchor this parser invented, until the provision it belongs
 * to has an anchor to build the real one from. Never survives the parse — see
 * the hk.jpg branch in walk() and the settling loop at the end.
 */
const SYNTHETIC_PARAGRAPH = "?M";

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

/**
 * Splits Lagasafn's glued footnote run into one entry per numbered note.
 *
 * Every note under a provision arrives in a single element, so `.text()` gives
 * "1)L. 159/2008, 1. gr. 2)L. 8/2015, 9. gr." — two notes in one string, and
 * useless to anything that wants the last amending act. A marker is a number,
 * a close paren and then the note's own text, which always opens with an
 * abbreviation in capitals ("L.", "Rgl.", "Augl."); requiring that letter is
 * what stops a year inside a note from being read as the next marker.
 */
export function splitFootnotes(run: string): string[] {
  const flat = normalizeLawText(run).replace(/\s+/g, " ").trim();
  if (!flat) return [];
  const marker = /(\d{1,3})\)\s*/g;
  const starts: { index: number; number: string; bodyAt: number }[] = [];
  for (const m of flat.matchAll(marker)) {
    const bodyAt = m.index! + m[0].length;
    // A marker introduces a note; anything else is a stray paren inside one.
    if (!/^\p{Lu}/u.test(flat.slice(bodyAt))) continue;
    starts.push({ index: m.index!, number: m[1], bodyAt });
  }
  // No marker at all: Lagasafn prints the note bare on some older acts. Keep
  // the text rather than dropping it — it is still the footnote.
  if (starts.length === 0) return [flat];
  return starts
    .map((s, i) => {
      const end = i + 1 < starts.length ? starts[i + 1].index : flat.length;
      const body = flat.slice(s.bodyAt, end).trim();
      return body ? `${s.number}) ${body}` : "";
    })
    .filter(Boolean);
}

/**
 * The þing and the case number out of a "Ferill málsins á Alþingi" link —
 * `…/ferill/?ltg=115&mnr=71` is mál 71 of the 115th löggjafarþing.
 *
 * Those two numbers are how Alþingi's own XML web service is addressed, so
 * parsing them here is what lets a later travaux ingest start from the act
 * rather than from a search.
 */
export function parseFerillUrl(url: string): { parliament: number; caseNumber: number } | null {
  const ltg = /[?&](?:amp;)?ltg=(\d+)/.exec(url);
  const mnr = /[?&](?:amp;)?mnr=(\d+)/.exec(url);
  if (!ltg || !mnr) return null;
  return { parliament: Number(ltg[1]), caseNumber: Number(mnr[1]) };
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

  // The two Alþingi links Lagasafn prints between the act's number line and
  // its first chapter. Matched on the href rather than on the link text, which
  // varies with the kind of bill ("Frumvarp til laga", "Frumvarp til
  // stjórnarskipunarlaga"), and taking the first of each: an act page carries
  // one of either, and the amendment list below them links to Stjórnartíðindi,
  // not to /s/.
  let ferillUrl: string | null = null;
  let billUrl: string | null = null;
  container.find("a[href]").each((_, el) => {
    const href = el.attribs?.href ?? "";
    if (!ferillUrl && /\/ferill\/\?/.test(href)) ferillUrl = absoluteAlthingiUrl(href);
    // Þingskjöl are /altext/{þing}/s/{skjal}.html, or /altext/pdf/{þing}/s/
    // {skjal}.pdf for the older þing, which Alþingi publishes only as scans.
    if (!billUrl && /\/altext\/(?:pdf\/)?\d+\/s\/\d+\.(?:html|pdf)$/.test(href)) {
      billUrl = absoluteAlthingiUrl(href);
    }
  });

  const chapters: ParsedChapter[] = [];
  const provisions: ParsedProvision[] = [];

  let chapterIndex: number | null = null;
  /** Set when a chapter heading has been seen but its title has not. */
  let chapterAwaitingTitle = false;

  /**
   * The open annex divisions, outermost first: the fylgiskjal, the hluti, the
   * kafli.
   *
   * An annexed treaty divides itself, and it does not use the act's own words
   * for it: lög nr. 2/1993 prints "I. hluti." and "1. kafli." where an act
   * prints "II. kafli.". Those divisions are recorded like any other, but their
   * label carries the fylgiskjal they are in — "Fylgiskjal I — II. hluti" —
   * because "1. kafli" read as a chapter of lög nr. 2/1993 would be a claim
   * about the act that is not true. Empty outside an annex.
   */
  const annexPath: string[] = [];

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

  /** Opens an annex division at the given depth, closing anything deeper. */
  const startAnnexDivision = (label: string, depth: number) => {
    flushProvision();
    annexPath.length = depth;
    annexPath[depth] = label;
    chapters.push({
      numeral: null,
      letter: null,
      label: annexPath.filter(Boolean).join(" — "),
      title: null,
    });
    chapterIndex = chapters.length - 1;
    chapterAwaitingTitle = true;
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
        // hk.jpg marks a paragraph, and in the act's own body it carries the
        // anchor.
        if (src.includes("hk.jpg")) {
          flushParagraph();
          if (id && /M\d+$/.test(id)) {
            paragraphAnchor = id;
            // Recover a temporary provision's anchor from its first paragraph.
            if (current && !current.anchor) {
              current.anchor = id.replace(/M\d+$/, "");
            }
          } else if (current) {
            // Inside a fylgiskjal Lagasafn prints the same marker with no id at
            // all, and a paragraph with no anchor used to be dropped along with
            // everything in it. That silently emptied every annexed text in the
            // corpus: lög nr. 2/1993 stored the 129 articles of the EEA
            // Agreement as labels with no body, and — because an empty body is
            // how Lagasafn writes a repealed provision — the act reader showed
            // the whole Agreement as repealed. lög nr. 62/1994 did the same to
            // the ECHR. So the anchor is synthesised, and settled once the
            // provision's own anchor is known below.
            paragraphAnchor = `${SYNTHETIC_PARAGRAPH}${current.paragraphs.length + 1}`;
          }
          continue;
        }
        continue;
      }

      // Amendment footnote line — must not bleed into the paragraph text.
      if (tag === "i" && $el.find("small sup").length > 0) {
        if (current) current.footnotes.push(...splitFootnotes($el.text()));
        continue;
      }

      // Footnote reference markers are display-only.
      if (tag === "sup") continue;

      if (tag === "b") {
        // Take the text without any nested <sup>, so a chapter title does not
        // come out as "Jarðir í sameign.1)".
        const text = cleanText($el);

        // "Fylgiskjal I." — the start of annexed material, and everything from
        // here to the next one belongs to it rather than to the act.
        if (/^Fylgiskjal\b/i.test(text)) {
          startAnnexDivision(text.replace(/\.$/, ""), 0);
          continue;
        }

        // Inside a fylgiskjal only: the annexed text's own divisions. "hluti"
        // never appears in an act's own structure, and an arabic "1. kafli."
        // does not either — Lagasafn numbers an act's chapters in roman — so
        // neither rule can reach into the act body above.
        if (annexPath.length > 0) {
          const hluti = new RegExp(`^([${ROMAN}]+|\\d+)\\.?\\s*hluti\\.?$`, "i").exec(text);
          if (hluti) {
            startAnnexDivision(text.replace(/\.$/, ""), 1);
            continue;
          }
          const annexChapter = /^(\d+)\.?\s*kafli\.?$/i.exec(text);
          if (annexChapter) {
            startAnnexDivision(text.replace(/\.$/, ""), 2);
            continue;
          }
        }

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
    // Settle the anchors the annex walk had to invent, now that the provision
    // has one of its own: "?M2" on the provision that became X7 is "X7M2".
    if (p.paragraphs.some((par) => par.anchor.startsWith(SYNTHETIC_PARAGRAPH))) {
      p.paragraphs = p.paragraphs.map((par, i) =>
        par.anchor.startsWith(SYNTHETIC_PARAGRAPH)
          ? { ...par, anchor: `${p.anchor}M${i + 1}` }
          : par
      );
    }
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

  return { actNumber, year, title, codexVersion, ferillUrl, billUrl, chapters, provisions: kept };
}

/**
 * Lagasafn writes some links absolute and some site-relative on the same page.
 * Stored links have to be openable from this app, so they are resolved here
 * rather than left for every caller to guess at.
 */
function absoluteAlthingiUrl(href: string): string {
  return href.startsWith("http") ? href : `https://www.althingi.is${href.startsWith("/") ? "" : "/"}${href}`;
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
