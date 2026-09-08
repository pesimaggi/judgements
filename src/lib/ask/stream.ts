/**
 * Streaming an answer without giving up the thing that makes it trustworthy.
 *
 * The well's central promise is that a citation to a source that does not
 * exist never reaches the reader: lib/ask/citations.ts deletes it, and the
 * sentence it was propping up is qualified. That check ran on the finished
 * answer, which is straightforward when the answer arrives all at once and
 * looks impossible when it arrives a token at a time — stream the raw text and
 * an invented "[11]" is on screen for a second before being taken away, which
 * is worse than useless in a legal tool. A reader who sees it once has seen it.
 *
 * It is not impossible, because `validateCitations` is *line-local*:
 *
 *   - deleting a citation to a source that does not exist needs only the set
 *     of valid source numbers, and retrieval has finished before the answer
 *     stage starts, so that set is known before the first token arrives;
 *   - qualifying a proposition with nothing behind it is decided per line —
 *     the citations in that line, the sentences in that line.
 *
 * So the text is buffered until a line is complete, that line is validated on
 * its own, and the validated line is what is sent. The reader never sees an
 * unchecked citation, and `validateCitations` over the whole answer at the end
 * produces the same text — which lib/ask/stream.test.ts asserts directly,
 * because that equivalence is the whole basis of doing it this way.
 */
import { validateCitations } from "./citations";
import type { AskSource } from "./types";

/**
 * Buffers streamed text and hands back whole, validated lines.
 *
 * A line rather than a sentence because a line is the unit
 * `validateCitations` reasons about: the answer is written as headings,
 * paragraphs and bullets, one per line (see lib/ask/render.ts), and the
 * qualifier it may add belongs to the line, not to the sentence.
 */
export class LineValidator {
  private buffer = "";

  constructor(
    private readonly sources: AskSource[],
    private readonly language: "is" | "en"
  ) {}

  /** Feeds in new text; returns the lines that are now complete and checked. */
  push(delta: string): string[] {
    this.buffer += delta;
    const lines: string[] = [];

    for (;;) {
      const at = this.buffer.indexOf("\n");
      if (at === -1) break;
      const line = this.buffer.slice(0, at);
      this.buffer = this.buffer.slice(at + 1);
      lines.push(this.validate(line));
    }
    return lines;
  }

  /** The last line, which has no newline after it. Call once, at the end. */
  flush(): string[] {
    if (this.buffer === "") return [];
    const line = this.buffer;
    this.buffer = "";
    return [this.validate(line)];
  }

  /**
   * One line, checked.
   *
   * A blank line is passed through untouched. It carries no citation and no
   * proposition, and `validateCitations` trims, so running it through would
   * turn the paragraph break into nothing and glue the answer together.
   */
  private validate(line: string): string {
    if (line.trim() === "") return line;
    return validateCitations(line, this.sources, this.language).answer;
  }
}
