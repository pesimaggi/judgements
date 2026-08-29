/**
 * Turning a judgment's stored text back into something readable.
 *
 * Two shapes arrive from ingestion, and neither reads well as-is:
 *
 *  - Older cases come from an embedded scanned PDF via pdf-parse, which emits
 *    one line per *visual* line of the page. Those need to be reflowed into
 *    paragraphs — and, for everything ingested before this module existed,
 *    every run of whitespace was collapsed to a single space, so the whole
 *    judgment is stored as one unbroken blob.
 *  - Newer cases come from a rich-text tree, one line per block node, with no
 *    blank line between blocks — rendered as pre-wrapped text that is a solid
 *    wall with no paragraph spacing and no visible structure.
 *
 * `normalizeJudgmentText` fixes the first at ingestion time. `parseJudgmentText`
 * runs at render time and copes with all of the above, including text already
 * stored in the old collapsed form (re-ingesting the whole archive to fix
 * formatting is not realistic).
 */

export type JudgmentBlock =
  | { kind: "heading"; text: string }
  | { kind: "list-item"; marker: string; text: string }
  | { kind: "quote"; text: string }
  | { kind: "paragraph"; text: string };

/** Any paragraph longer than this is assumed to have lost its breaks. */
const BLOB_THRESHOLD = 900;
/**
 * Above this, a paragraph is checked for structure it may have swallowed —
 * a heading or a numbered clause running into the text. Cheaper than
 * BLOB_THRESHOLD because recovering a heading never damages real prose,
 * whereas cutting a paragraph by length can.
 */
const STRUCTURE_THRESHOLD = 200;
/** When re-splitting a blob by sentence, aim for paragraphs around this size. */
const TARGET_PARAGRAPH = 600;

const UPPER = "A-ZÁÐÉÍÓÚÝÞÆÖ";
const LOWER = "a-záðéíóúýþæö";

/** Section headings seen in Icelandic judgments and rulings. */
const HEADING_WORDS = [
  "Dómsorð", "Úrskurðarorð", "Dómur", "Úrskurður", "Dómkröfur", "Aðfararorð",
  "Málsatvik", "Málsástæður", "Málsmeðferð", "Málavextir", "Niðurstaða",
  "Niðurstöður", "Forsendur", "Kröfur", "Kröfugerð", "Sératkvæði", "Reifun",
  "Útdráttur", "Ágrip", "Inngangur", "Refsing", "Sakarkostnaður",
  "Málskostnaður", "Áfrýjun", "Sönnunarfærsla", "Lagarök", "Ákæra",
  // The two kinds of document Umboðsmaður Alþingis issues. Each heads the
  // body of its record, which is what keeps the summary above it separate.
  "Álit", "Bréf",
  // "Lykilorð" — the index terms an úrskurðarnefnd writes above its ruling,
  // and the heading the stjornarradid adapter files them under. Without it
  // the terms run straight into the "Útdráttur" that follows them.
  "Lykilorð", "Úrskurðarorð", "Úrskurðarnefnd", "Ákvörðun",
  // English, for the EFTA Court records composed by its adapter — that source
  // publishes in English and has no Icelandic heading to key off.
  "Summary", "Case details", "Documents",
  // Journal articles. "Höfundur", "Heimild", "Efnisorð" and "Meginmál" head
  // the sections the journal adapters compose; "Abstract", "Efnisyfirlit" and
  // "Heimildaskrá" are the article's own, written by its author. Each one
  // matters as much for what it *ends* as for what it starts: without them an
  // abstract runs on into the body it precedes.
  "Höfundur", "Heimild", "Heimildaskrá", "Efnisorð", "Efnisyfirlit",
  "Meginmál", "Abstract",
];

/**
 * Optional tail on a heading: "Dómur Hæstaréttar", "Dómur Félagsdóms",
 * "Málsástæður og lagarök", "Kröfur aðila". Courts write these as one heading,
 * so they are matched as one rather than leaving "Hæstaréttar." stranded as a
 * paragraph. "Félagsdóms" is named rather than left to the `[LOWER]+dóms`
 * catch-all, which only matches a tail that is lowercase throughout.
 */
const HEADING_SUFFIX =
  `(?:\\s+(?:Hæstaréttar|Landsréttar|Héraðsdóms|héraðsdóms|Félagsdóms|[${LOWER}]+dóms))?` +
  `(?:\\s+(?:og|aðila|málsins)\\s+[${LOWER}]+)?`;

const HEADING_RE = new RegExp(
  `^(?:${HEADING_WORDS.join("|")})${HEADING_SUFFIX}\\s*[.:]?$`,
  "i"
);

/** A bare section marker on its own line: "I.", "IV", "3.", "2. kafli". */
const SECTION_MARKER_RE = new RegExp(`^(?:[IVXL]{1,6}|\\d{1,2})\\.?(?:\\s+kafli)?\\.?$`, "i");

/** A numbered/roman section marker followed by a short, unpunctuated title. */
const SECTION_HEADING_RE = new RegExp(`^(?:[IVXL]{1,6}|\\d{1,2})[.)]\\s+\\S.{0,80}$`);

/** List/enumeration markers: "1.", "12)", "a)", "–", "•". */
const LIST_MARKER_RE = new RegExp(`^(\\d{1,3}[.)]|[${LOWER}][.)]|[-–—•*])\\s+`);

/** Lines that are just a page number left behind by the PDF extractor. */
const PAGE_NUMBER_RE = /^(?:[-–—]?\s*\d{1,4}\s*[-–—]?|(?:bls|Bls)\.?\s*\d{1,4})$/;

/**
 * Words whose trailing period is an abbreviation, not the end of a sentence.
 * Icelandic legal prose is dense with these ("sbr. 2. mgr. 70. gr. laga nr.
 * 88/2008"), and splitting on them shreds a paragraph into fragments.
 */
const ABBREVIATIONS = new Set([
  "sbr", "nr", "gr", "mgr", "tl", "tölul", "málsl", "bls", "kt", "hrl", "hdl",
  "ehf", "hf", "ohf", "slf", "svf", "sf", "bs", "skv", "sl", "ca", "dr", "prof",
  "fl", "o.fl", "o.s.frv", "þ.e", "þ.e.a.s", "m.a", "t.d", "þ.á.m", "a.m.k",
  "u.þ.b", "e.t.v", "kr", "millj", "þús", "stk", "sr", "hrd", "lrd",
  "jan", "feb", "mar", "apr", "jún", "júl", "ágú", "sep", "sept", "okt", "nóv", "des",
]);

/**
 * Line width is measured at the 75th percentile rather than the median: a
 * judgment is full of short heading and section-marker lines, and those drag a
 * median well below the page's actual text width.
 */
function typicalLineWidth(lines: string[]): number {
  const lengths = lines.map((l) => l.trim().length).filter((n) => n > 0).sort((a, b) => a - b);
  if (lengths.length === 0) return 0;
  return lengths[Math.floor(lengths.length * 0.75)] ?? lengths[lengths.length - 1];
}

/** Strips characters that only ever get in the way: NBSP, soft hyphens, BOM. */
function cleanChars(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\u00AD\uFEFF]/g, "") // soft hyphen, byte-order mark
    .replace(/[\u00A0\u2007\u202F\u2009\u2002-\u2006]/g, " "); // exotic spaces
}

/**
 * Reflows pdf-parse's line-per-visual-line output into paragraphs.
 *
 * A line continues the current paragraph unless something says otherwise:
 * a blank line, an indent, a structural marker, or a previous line that both
 * ended a sentence and stopped noticeably short of the page's normal line
 * width (i.e. it was a paragraph's last line, not a wrapped one).
 */
export function normalizeJudgmentText(raw: string): string {
  const lines = cleanChars(raw).split("\n");

  const shortLine = (typicalLineWidth(lines) || 80) * 0.85;

  const paragraphs: string[] = [];
  let current = "";
  let previousWasShortEnd = false;

  const flush = () => {
    const text = current.replace(/\s+/g, " ").trim();
    if (text) paragraphs.push(text);
    current = "";
  };

  for (const rawLine of lines) {
    const indented = /^[ \t]{2,}\S/.test(rawLine);
    const line = rawLine.replace(/[ \t]+/g, " ").trim();

    if (!line) { flush(); previousWasShortEnd = false; continue; }
    if (PAGE_NUMBER_RE.test(line)) { flush(); previousWasShortEnd = false; continue; }

    const startsStructure =
      HEADING_RE.test(line) || SECTION_MARKER_RE.test(line) || LIST_MARKER_RE.test(line);

    if (current && (indented || startsStructure || previousWasShortEnd)) flush();

    // A hyphen at a line break is a word split across lines, not punctuation.
    if (current.endsWith("-") && new RegExp(`^[${LOWER}]`).test(line)) {
      current = current.slice(0, -1) + line;
    } else {
      current = current ? `${current} ${line}` : line;
    }

    // A line that is nothing but a heading ends there. Without this it starts
    // a paragraph and then swallows the text under it — "Lykilorð
    // Kjarasamningur. Viðbótarmenntun.", "Dómur Félagsdóms Mál þetta var
    // dómtekið 3. júní 2026." — which costs the heading twice over: it does
    // not render as one, and extractSummary reads to the *next* heading, so a
    // summary whose closing heading was swallowed runs on into the judgment.
    //
    // Deliberately not extended to SECTION_MARKER_RE. That also matches a bare
    // "1" or "12", and modern judgments carry their clause numbers on lines of
    // their own — cutting after those would strand every numbered clause's
    // text from its number.
    if (HEADING_RE.test(line)) { flush(); previousWasShortEnd = false; continue; }

    previousWasShortEnd =
      /[.:!?…”"»)]$/.test(line) && line.length < shortLine;
  }
  flush();

  return paragraphs.join("\n");
}

/**
 * Splits text into sentences, respecting Icelandic legal abbreviations so
 * "sbr. 2. mgr. 70. gr." stays in one piece.
 */
function splitSentences(text: string): string[] {
  // The optional trailing quote covers Icelandic's closing “ as well as the
  // usual suspects — "…standi til annars.“ Dómsorð:" has to split.
  const boundary = /([.!?…])(["”“»'’]?)\s+/g;
  const sentences: string[] = [];
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = boundary.exec(text)) !== null) {
    const end = m.index + m[0].length;
    const next = text.slice(end, end + 1);
    // A new sentence starts with a capital, an opening quote or a number.
    if (!new RegExp(`^[${UPPER}„"(\\d]`).test(next)) continue;

    const priorWord = text.slice(0, m.index).match(/([^\s(«„"]+)$/)?.[1] ?? "";
    if (ABBREVIATIONS.has(priorWord.toLowerCase())) continue;
    // "1." / "12." before a capitalised word is an ordinal ("2. Mgr."), not
    // a sentence end; a four-digit year genuinely can end one.
    if (/^\d{1,2}$/.test(priorWord)) continue;

    sentences.push(text.slice(last, end).trim());
    last = end;
  }
  const tail = text.slice(last).trim();
  if (tail) sentences.push(tail);
  return sentences.filter(Boolean);
}

/**
 * A heading swallowed by the paragraph that followed it, because the line
 * break between them is gone: "II. Niðurstaða Fallist er á…". Only the
 * heading itself is consumed; whether it really is one is decided by what
 * comes after (see `peelHeading`).
 */
// The word-end guard is a negative lookahead rather than \b: JavaScript's \b
// is ASCII-only, so it does not fire after "Dómsorð" or "Niðurstaða".
const INLINE_HEADING_RE = new RegExp(
  `^(?:(?:[IVXL]{1,6}|\\d{1,3})[.)]\\s+)?(?:${HEADING_WORDS.join("|")})(?![${UPPER}${LOWER}])${HEADING_SUFFIX}[.:]?(?=\\s)`,
  "i"
);

/**
 * Splits "Niðurstaða Fallist er á…" into its heading and the rest. The word
 * after the heading has to be capitalised: "Dómur héraðsdóms var staðfestur"
 * is a sentence that happens to start with a heading word, not a heading.
 */
function peelHeading(sentence: string): [heading: string, rest: string] | null {
  // Already a heading on its own ("Dómur Hæstaréttar.") — nothing to peel, and
  // peeling would strip it down to just "Dómur".
  if (HEADING_RE.test(sentence)) return null;

  const match = sentence.match(INLINE_HEADING_RE);
  if (!match) return null;
  const rest = sentence.slice(match[0].length);
  if (!new RegExp(`^\\s+[${UPPER}„"(\\d]`).test(rest)) return null;
  return [match[0].trim(), rest.trim()];
}

/**
 * Recovers paragraph breaks from a run-together blob — the shape every PDF
 * judgment ingested before `normalizeJudgmentText` existed is stored in.
 *
 * Structural breaks (headings, numbered clauses) are always recovered. Cutting
 * a long structureless run into readable paragraphs is a guess, so it is only
 * done for text long enough that the alternative is an unbroken page — see
 * `chunkLongRuns`.
 */
function splitBlob(text: string, chunkLongRuns: boolean): string[] {
  const pieces: string[] = [];
  let buffer = "";
  const flush = () => {
    if (buffer.trim()) pieces.push(buffer.trim());
    buffer = "";
  };

  for (const sentence of splitSentences(text)) {
    const heading = peelHeading(sentence);
    const startsStructure =
      heading !== null ||
      HEADING_RE.test(sentence) ||
      LIST_MARKER_RE.test(sentence) ||
      SECTION_MARKER_RE.test(sentence);

    // A new clause, section or heading ends the paragraph before it; failing
    // that, paragraphs are capped at a readable length.
    if (startsStructure || (chunkLongRuns && buffer.length >= TARGET_PARAGRAPH)) flush();

    if (heading) {
      pieces.push(heading[0]);
      buffer = heading[1];
    } else if (HEADING_RE.test(sentence) || SECTION_MARKER_RE.test(sentence)) {
      pieces.push(sentence); // a heading that is already a sentence of its own
    } else {
      buffer = buffer ? `${buffer} ${sentence}` : sentence;
    }
  }
  flush();
  return pieces;
}

function classify(text: string): JudgmentBlock {
  if (HEADING_RE.test(text) || SECTION_MARKER_RE.test(text)) {
    return { kind: "heading", text };
  }

  const listMatch = text.match(LIST_MARKER_RE);
  if (listMatch) {
    const body = text.slice(listMatch[0].length);
    // "3. Niðurstaða" is a section title; "3. Ákærði krafðist þess að…" is not.
    if (SECTION_HEADING_RE.test(text) && !/[.!?:;,]$/.test(text)) {
      return { kind: "heading", text };
    }
    return { kind: "list-item", marker: listMatch[1], text: body };
  }

  if (/^[„"«]/.test(text) && text.length > 160) return { kind: "quote", text };

  // A short line in ALL CAPS is a heading in every layout that uses them.
  if (text.length <= 90 && text === text.toUpperCase() && new RegExp(`[${UPPER}]`).test(text)) {
    return { kind: "heading", text };
  }

  return { kind: "paragraph", text };
}

/**
 * Rejoins words the PDF broke across a line ("úrskurð- aður"), which the old
 * whitespace-collapsing ingestion left stranded mid-sentence. Both halves have
 * to be substantial: "a- og b-liðar" and "gæsluvarðhalds- og farbannsmál" are
 * real Icelandic constructions, not broken words.
 */
function mendLineBreakHyphens(text: string): string {
  return text.replace(
    new RegExp(`([${LOWER}]{3,})-\\s+([${LOWER}]{3,})`, "g"),
    (whole, before, after) => (after === "eða" || after === "ekki" ? whole : `${before}${after}`)
  );
}

/**
 * True when the text is still broken at the page's line width rather than at
 * paragraph boundaries — i.e. raw pdf-parse output that never went through
 * `normalizeJudgmentText`. Rich-text documents have one long line per block
 * and blobs have one enormous line, so neither trips this.
 */
function looksLineWrapped(lines: string[]): boolean {
  const filled = lines.map((l) => l.trim()).filter(Boolean);
  if (filled.length < 5) return false;

  const width = typicalLineWidth(filled);
  if (width < 30 || width > 140) return false;

  // Only full-width lines are evidence either way — headings and one-line
  // section markers are short whatever the shape of the document. A line that
  // runs to the margin and still stops mid-sentence was wrapped, not written.
  const fullWidth = filled.filter((l) => l.length > width * 0.7);
  if (fullWidth.length < 4) return false;

  const midSentence = fullWidth.filter((l) => !/[.:!?…”“"»)\]]$/.test(l)).length;
  return midSentence / fullWidth.length >= 0.4;
}

/** Drops "- 2 -" style page markers stranded mid-text by the PDF extractor. */
function stripPageMarkers(text: string): string {
  return text.replace(/\s[-–—]\s?\d{1,4}\s?[-–—]\s/g, " ");
}

/** Parses a stored judgment into renderable blocks. */
export function parseJudgmentText(raw: string): JudgmentBlock[] {
  if (!raw?.trim()) return [];

  let text = mendLineBreakHyphens(cleanChars(raw));
  // Documents ingested before normalizeJudgmentText existed — and any that
  // slip through still wrapped — get reflowed here instead.
  if (looksLineWrapped(text.split("\n"))) text = normalizeJudgmentText(text);

  const blocks: JudgmentBlock[] = [];
  for (const line of text.split(/\n+/)) {
    const cleaned = line.replace(/[ \t]+/g, " ").trim();
    if (!cleaned || PAGE_NUMBER_RE.test(cleaned)) continue;

    const pieces =
      cleaned.length > STRUCTURE_THRESHOLD
        ? splitBlob(stripPageMarkers(cleaned), cleaned.length > BLOB_THRESHOLD)
        : [cleaned];
    for (const piece of pieces) blocks.push(classify(piece));
  }
  return blocks;
}

/**
 * The heading a judgment's summary sits under. Hæstiréttur calls it
 * "Útdráttur"; "Reifun" and "Ágrip" turn up as well. EFTA Court records use
 * "Summary", the heading their adapter composes the Court's own case note
 * under.
 */
const SUMMARY_HEADING_RE = new RegExp(`^(?:Útdráttur|Reifun|Ágrip|Summary)\\s*:?$`, "i");

/**
 * How much of the document to look at. The summary is always at the very top,
 * and parsing a whole judgment for every result card would be wasteful.
 */
export const SUMMARY_SCAN_CHARS = 12_000;

/**
 * Pulls out the judgment's own summary — the "Útdráttur" section courts write
 * at the head of the document — so a result card can offer it without opening
 * the full text. Returns null when the document has no such section, which is
 * common outside Hæstiréttur.
 *
 * `raw` may be a prefix of the document (see SUMMARY_SCAN_CHARS). If the
 * section runs past the end of that prefix, the trailing partial paragraph is
 * dropped rather than shown cut off mid-sentence.
 */
export function extractSummary(raw: string): string | null {
  if (!raw?.trim()) return null;

  const truncated = raw.length >= SUMMARY_SCAN_CHARS;
  const blocks = parseJudgmentText(raw.slice(0, SUMMARY_SCAN_CHARS));

  const start = blocks.findIndex((b) => b.kind === "heading" && SUMMARY_HEADING_RE.test(b.text));
  if (start === -1) return null;

  const body: string[] = [];
  let closed = false;
  for (const block of blocks.slice(start + 1)) {
    if (block.kind === "heading") { closed = true; break; }
    body.push("marker" in block ? `${block.marker} ${block.text}` : block.text);
  }
  // No following heading inside the window: the last paragraph may have been
  // cut by the prefix, so leave it out.
  if (!closed && truncated) body.pop();

  const summary = body.join("\n\n").trim();
  return summary.length >= 40 ? summary : null;
}
