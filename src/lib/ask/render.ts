/**
 * The answer, parsed into the handful of shapes the well renders.
 *
 * Deliberately not a Markdown parser. The model is told to use exactly three
 * things — "## " headings, "- " bullets and "**bold**" — and this reads
 * exactly those three, plus the citation markers, which are the part that
 * actually matters: "[3]" has to become a link to source 3, not the four
 * characters the model typed.
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
  | { kind: "list"; items: InlineSpan[][] };

/**
 * Citations as the model is told to write them, "[3]", and as it sometimes
 * writes them anyway: "[3, 7]" and "[3; 7]" both become two citations rather
 * than a stray bracket in the middle of a sentence.
 */
const CITATION_RE = /\[(\d{1,2}(?:\s*[,;]\s*\d{1,2})*)\]/g;
const BOLD_RE = /\*\*(.+?)\*\*/g;

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

  const closeList = () => {
    if (list && list.length) blocks.push({ kind: "list", items: list });
    list = null;
  };

  for (const rawLine of answer.split("\n")) {
    const line = rawLine.trim();

    if (line === "") {
      closeList();
      continue;
    }
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

  return blocks;
}
