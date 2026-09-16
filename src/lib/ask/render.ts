/**
 * The answer, parsed into the handful of shapes the well renders.
 *
 * Deliberately not a Markdown parser. The model is told to use exactly four
 * things — "## " headings, "- " bullets, "**bold**" and, on the deep tier,
 * pipe tables — and this reads exactly those four, plus the citation markers,
 * which are the part that actually matters: "[3]" has to become a link to
 * source 3, not the four characters the model typed.
 *
 * A parser that accepts only what was asked for also fails safely. Anything
 * else the model writes comes out as the plain text it is, rather than as
 * half-rendered markup.
 */

export type InlineSpan =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "citation"; n: number };

export type AnswerBlock =
  | { kind: "heading"; spans: InlineSpan[] }
  | { kind: "paragraph"; spans: InlineSpan[] }
  | { kind: "list"; items: InlineSpan[][] }
  /**
   * A Markdown table, which the deep tier may use where one reads better than
   * prose — a set of cases against what each decides, a rule against its
   * exceptions. `header` is null for a table written without one.
   */
  | { kind: "table"; header: InlineSpan[][] | null; rows: InlineSpan[][][] };

/**
 * Citations as the model is told to write them, "[3]", and as it sometimes
 * writes them anyway: "[3, 7]" and "[3; 7]" both become two citations rather
 * than a stray bracket in the middle of a sentence.
 */
const CITATION_RE = /\[(\d{1,2}(?:\s*[,;]\s*\d{1,2})*)\]/g;
const BOLD_RE = /\*\*(.+?)\*\*/g;

/** A table row: at least one pipe, and nothing but a row on the line. */
const TABLE_ROW = /^\|.*\|$/;
/** The "| --- | :--: |" line that separates a header from its rows. */
const TABLE_RULE = /^\|(?:\s*:?-{1,}:?\s*\|)+$/;

/** The cells of one row, with the outer pipes dropped. */
export function tableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

/**
 * Marks which of `sources` the answer text cites.
 *
 * The same job `markCited` in lib/ask/answer.ts does on the server, needed
 * again on the client because an answer now arrives a line at a time: the
 * `sources` event precedes the prose, so every source starts out uncited and a
 * source the answer is about to cite would otherwise sit under "came up in the
 * search but is not cited" and jump to "cited" when the last event landed.
 *
 * It lives here rather than being imported from lib/ask/citations.ts so that
 * the marker's shape is read from the same constant this module renders — the
 * two must agree, and they already have to agree here.
 */
export function markCitedIn<T extends { n: number; cited: boolean }>(
  answer: string,
  sources: T[]
): T[] {
  const cited = new Set<number>();
  for (const match of answer.matchAll(CITATION_RE)) {
    for (const part of match[1].split(/[,;]/)) {
      const n = Number(part.trim());
      if (Number.isFinite(n)) cited.add(n);
    }
  }
  return sources.map((s) => (s.cited === cited.has(s.n) ? s : { ...s, cited: cited.has(s.n) }));
}

export function parseInline(text: string): InlineSpan[] {
  const spans: InlineSpan[] = [];
  let cursor = 0;

  for (const match of text.matchAll(CITATION_RE)) {
    const at = match.index ?? 0;
    // The space before "[3]" is dropped: the marker is rendered as a chip with
    // its own leading margin, and keeping the typed space too leaves a visible
    // gap before the full stop that follows it.
    if (at > cursor) pushText(spans, text.slice(cursor, at).replace(/\s+$/, ""));
    for (const part of match[1].split(/[,;]/)) {
      const n = Number(part.trim());
      if (Number.isFinite(n)) spans.push({ kind: "citation", n });
    }
    cursor = at + match[0].length;
  }
  if (cursor < text.length) pushText(spans, text.slice(cursor));

  return spans;
}

/** Splits a run of plain text on bold markers before adding it. */
function pushText(spans: InlineSpan[], text: string): void {
  let cursor = 0;
  for (const match of text.matchAll(BOLD_RE)) {
    const at = match.index ?? 0;
    if (at > cursor) spans.push({ kind: "text", text: text.slice(cursor, at) });
    spans.push({ kind: "bold", text: match[1] });
    cursor = at + match[0].length;
  }
  if (cursor < text.length) spans.push({ kind: "text", text: text.slice(cursor) });
}

export function parseAnswer(answer: string): AnswerBlock[] {
  const blocks: AnswerBlock[] = [];
  let list: InlineSpan[][] | null = null;
  /** Raw table rows, still text, until the run of them ends. */
  let table: string[] | null = null;

  const closeList = () => {
    if (list && list.length) blocks.push({ kind: "list", items: list });
    list = null;
  };
  /**
   * Ends a run of table rows.
   *
   * A run of one row is not a table — it is a line that happens to start and
   * end with a pipe — so it comes out as the paragraph it reads as. Anything
   * longer is a table whether or not it carried a separator rule.
   */
  const closeTable = () => {
    if (!table) return;
    const lines = table;
    table = null;
    if (lines.length < 2) {
      for (const line of lines) blocks.push({ kind: "paragraph", spans: parseInline(line) });
      return;
    }
    const ruled = TABLE_RULE.test(lines[1]);
    const header = ruled ? tableCells(lines[0]).map(parseInline) : null;
    const body = (ruled ? lines.slice(2) : lines)
      .filter((l) => !TABLE_RULE.test(l))
      .map((l) => tableCells(l).map(parseInline));
    if (body.length === 0 && !header) return;
    blocks.push({ kind: "table", header, rows: body });
  };

  for (const rawLine of answer.split("\n")) {
    const line = rawLine.trim();

    if (line === "") {
      closeList();
      closeTable();
      continue;
    }
    if (TABLE_ROW.test(line)) {
      closeList();
      table ??= [];
      table.push(line);
      continue;
    }
    closeTable();
    if (line.startsWith("## ")) {
      closeList();
      blocks.push({ kind: "heading", spans: parseInline(line.slice(3).trim()) });
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      list ??= [];
      list.push(parseInline(line.replace(/^[-*]\s+/, "")));
      continue;
    }

    closeList();
    // Consecutive non-blank lines are one paragraph, the way a soft-wrapped
    // paragraph arrives — joined rather than broken into a line each.
    const previous = blocks[blocks.length - 1];
    if (previous?.kind === "paragraph") {
      previous.spans.push({ kind: "text", text: " " }, ...parseInline(line));
    } else {
      blocks.push({ kind: "paragraph", spans: parseInline(line) });
    }
  }
  closeList();
  closeTable();

  return blocks;
}
