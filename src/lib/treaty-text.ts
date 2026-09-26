/**
 * A treaty published as text rather than as markup — which, for EFTA's own
 * agreements, is the only way it is published at all.
 *
 * The EU publishes its treaties through Cellar, with a layout to read (see
 * `parseTreaty` in eur-lex.ts). EFTA publishes the consolidated Surveillance and
 * Court Agreement as a thirteen-page PDF on efta.int and nothing else. It is a
 * real digital PDF rather than a scan, so `pdfText()` gets the words out; what
 * arrives is one line per *visual* line of the page, and this module turns that
 * back into articles and paragraphs.
 *
 * FOUR THINGS THE PAGE DOES THAT THE TEXT DOES NOT SAY.
 *
 * *Lines are not paragraphs.* A paragraph arrives as five or six lines broken
 * where the column ended. They are rejoined on the only signal available: a line
 * that does not finish a sentence continues into the next one. Getting this wrong
 * does not lose text, it mis-splits it, which is why the rule is that and nothing
 * cleverer.
 *
 * *Every page carries furniture.* "SURVEILLANCE AND COURT AGREEMENT p. 4" and
 * "Main text" appear twelve times each, mid-sentence as far as the text is
 * concerned. Dropped before anything else, so a paragraph broken across a page
 * boundary rejoins cleanly.
 *
 * *Footnotes arrive inline, in three lines.* A marker in the body is "(", then
 * the number, then ")". A definition at the foot of the page is "(", the number,
 * then ")  Words 'Protocols 1 to 4 and 6 and 7' replaced by…". Both interrupt the
 * text they belong to. The markers are dropped and the definitions are kept as
 * the provision's footnotes, which is where Lagasafn's amendment notes go too —
 * and for the same reason: they are the thread from an article back to the
 * instrument that last changed it.
 *
 * *The enacting terms have a beginning.* Above it are the title, the list of
 * amending instruments and a preamble of twenty recitals, several of which cite
 * articles of other agreements. The parse starts after the adoption formula, as
 * the legacy EUR-Lex walk does, and for the same reason.
 */
import type { ParsedEuAct, ParsedEuChapter, ParsedEuProvision } from "./eur-lex";

/** "Article 12", alone on its line. */
const ARTICLE_HEADING = /^Article\s+(\d+)\s*([a-z])?$/i;

/** "PART I", "PART II" — the only division the SCA uses. */
const DIVISION_HEADING = /^(PART|TITLE|CHAPTER|SECTION)\s+([IVXLC]+|\d+)\s*(.*)$/i;

/**
 * The formula that opens the enacting terms.
 *
 * The same one the EEA Agreement uses, because the two were drawn up together at
 * Porto on the same day: "HAVE DECIDED to conclude the following Agreement:".
 */
const ADOPTION_FORMULA = /^HAVE\s+(DECIDED|AGREED)\b/i;

/**
 * Running heads and folios. Matched on the shape rather than on the document's
 * own title, so a re-typeset PDF does not smuggle its page furniture into the
 * text of an article.
 */
const PAGE_FURNITURE = [
  /^[A-Z][A-Z\s'’-]{6,}\s+p\.\s*\d+$/, // "SURVEILLANCE AND COURT AGREEMENT p. 4"
  /^Main text$/i,
  /^\d+$/, // a bare folio
];

/** A line that ends mid-sentence, and therefore continues into the next. */
function continuesOnward(line: string): boolean {
  return !/[.:;!?]["'’)\]]?$/.test(line);
}

interface Block {
  text: string;
  /** Footnote definitions that interrupted this block, in the order printed. */
  footnotes: string[];
}

/**
 * Rejoins wrapped lines into blocks, dropping furniture and lifting footnotes
 * out of the text they interrupt.
 *
 * A block ends when a line finishes a sentence, or when the next line opens
 * something structural — an article heading, a division, or a numbered or
 * lettered paragraph. Without that last condition a numbered paragraph whose
 * lead-in ended mid-sentence would swallow the number that follows it.
 */
function toBlocks(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let current: Block | null = null;
  /** Footnotes seen since the last block was pushed. */
  let pending: string[] = [];

  const flush = () => {
    if (current) {
      current.footnotes.push(...pending);
      blocks.push(current);
    } else if (pending.length > 0 && blocks.length > 0) {
      // A footnote printed after the last block of a page belongs to it.
      blocks[blocks.length - 1].footnotes.push(...pending);
    }
    current = null;
    pending = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (PAGE_FURNITURE.some((pattern) => pattern.test(line))) continue;

    // The footnote triple: "(", the number, then ")" or ")  the note itself".
    if (line === "(" && /^\d{1,3}$/.test(lines[i + 1] ?? "") && (lines[i + 2] ?? "").startsWith(")")) {
      const rest = lines[i + 2].slice(1).trim();
      i += 2;
      if (!rest) continue; // a marker in the body, and nothing more
      // A definition, which itself wraps over the following lines.
      const note: string[] = [rest];
      while (continuesOnward(note[note.length - 1]) && i + 1 < lines.length) {
        const next = lines[i + 1];
        if (
          ARTICLE_HEADING.test(next) ||
          DIVISION_HEADING.test(next) ||
          PAGE_FURNITURE.some((pattern) => pattern.test(next)) ||
          next === "("
        ) {
          break;
        }
        note.push(next);
        i += 1;
      }
      pending.push(note.join(" "));
      continue;
    }

    if (ARTICLE_HEADING.test(line) || DIVISION_HEADING.test(line)) {
      flush();
      blocks.push({ text: line, footnotes: [] });
      continue;
    }

    if (!current) {
      current = { text: line, footnotes: [] };
    } else {
      current.text = `${current.text} ${line}`;
    }

    const next = lines[i + 1];
    const opensSomething =
      next !== undefined &&
      (ARTICLE_HEADING.test(next) ||
        DIVISION_HEADING.test(next) ||
        /^\d{1,3}\.\s/.test(next) ||
        /^\([a-z]\)\s/.test(next));
    if (!continuesOnward(line) || opensSomething) flush();
  }
  flush();
  return blocks;
}

/**
 * One treaty, out of the text of its PDF.
 *
 * Returns the same shape the EUR-Lex parsers return, because it feeds the same
 * writer and the same reader: `ParsedEuAct` is this repo's act-structure type,
 * and its name is where it was first needed rather than a claim about where the
 * document came from.
 */
export function parseTreatyText(raw: string): ParsedEuAct {
  const lines = raw
    .split("\n")
    .map((line) => line.replace(/ /g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const start = lines.findIndex((line) => ADOPTION_FORMULA.test(line));
  const body = start >= 0 ? lines.slice(start + 1) : [];

  const chapters: ParsedEuChapter[] = [];
  const provisions: ParsedEuProvision[] = [];
  let chapterIndex: number | null = null;
  /**
   * Set when a division heading has been read and its name has not.
   *
   * The SCA prints "PART II" and "THE EFTA SURVEILLANCE AUTHORITY" as separate
   * blocks, the second wrapped over three lines of capitals. Without this the
   * name is not merely missing from the division — it is dropped from the
   * document, because a block read before the first article of a part belongs to
   * no provision.
   */
  let divisionAwaitingTitle = false;
  let current: ParsedEuProvision | null = null;
  /** Blocks of the article being read, before they are split into paragraphs. */
  let blocks: string[] = [];
  /** The footnotes its text carried, as printed. */
  let footnotes: string[] = [];

  const flush = () => {
    const provision = current;
    if (!provision) return;
    // Numbered paragraphs the way every other act here is split: the act's own
    // numbering, not the layout's line breaks. See toParagraphs in eur-lex.ts —
    // this is the same rule, written out because that one is private to its
    // module and takes blocks that have already been reflowed.
    const paragraphs: { anchor: string; number: number; text: string }[] = [];
    for (const block of blocks) {
      const numbered = /^(\d{1,3})\.\s+(?=\S)/.exec(block);
      const last = paragraphs[paragraphs.length - 1];
      if (numbered) {
        paragraphs.push({ anchor: "", number: Number(numbered[1]), text: block });
      } else if (last) {
        last.text = `${last.text}\n${block}`;
      } else {
        paragraphs.push({ anchor: "", number: paragraphs.length + 1, text: block });
      }
    }
    provision.paragraphs = paragraphs.map((paragraph, i) => ({
      ...paragraph,
      anchor: `${provision.anchor}-p${i + 1}`,
    }));
    provision.fullText = provision.paragraphs.map((paragraph) => paragraph.text).join("\n\n");
    provision.footnotes = footnotes;
    provisions.push(provision);
    current = null;
    blocks = [];
    footnotes = [];
  };

  for (const block of toBlocks(body)) {
    const division = DIVISION_HEADING.exec(block.text);
    if (division && !ARTICLE_HEADING.test(block.text)) {
      flush();
      chapters.push({
        label: `${division[1].toUpperCase()} ${division[2].toUpperCase()}`,
        title: division[3].trim() || null,
      });
      chapterIndex = chapters.length - 1;
      divisionAwaitingTitle = chapters[chapterIndex].title === null;
      continue;
    }

    const article = ARTICLE_HEADING.exec(block.text);
    if (article) {
      flush();
      divisionAwaitingTitle = false;
      const number = Number(article[1]);
      const letter = article[2]?.toLowerCase() ?? null;
      current = {
        kind: "article",
        anchor: `art_${number}${letter ?? ""}`,
        articleNumber: number,
        articleLetter: letter,
        displayLabel: block.text.replace(/\s+/g, " "),
        heading: null,
        chapterIndex,
        paragraphs: [],
        fullText: "",
        footnotes: [],
      };
      continue;
    }

    // The division's name, in the block after its number.
    if (divisionAwaitingTitle && chapterIndex !== null) {
      chapters[chapterIndex].title = block.text;
      divisionAwaitingTitle = false;
      continue;
    }

    if (!current) continue; // between the formula and the first article
    blocks.push(block.text);
    // Kept as printed, in the column Lagasafn's footnotes go in: which
    // instrument last changed this article, and when it entered into force.
    footnotes.push(...block.footnotes);
  }
  flush();

  return {
    title: null,
    chapters,
    provisions,
    eeaRelevanceStated: false,
    layout: "treaty",
  };
}
