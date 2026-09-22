/**
 * How a reader accumulates the `thinking` events the pipeline emits.
 *
 * Every such event carries one thinking block *from its start* — a complete
 * prefix, not the piece that just arrived. That contract exists because the
 * two paths that produce thinking produce it differently: the research loop
 * reports a whole block once a round finishes, while the answer stage streams
 * and reports the same block several times as it grows. A consumer handed raw
 * deltas cannot tell the difference between "more of what you have" and "a new
 * block", and the first version of this feature got it wrong in the direction
 * that still renders: it appended every event and showed the newest, which put
 * three or four characters on screen at a time.
 *
 * So the rule is one line, and it is here rather than inline in the component
 * because it is the shape of the event stream, not a detail of the panel.
 */

/** How many blocks a reader keeps. A long run produces many; nobody reads back. */
export const THINKING_KEEP = 12;

/**
 * Folds one `thinking` event into what the reader already has.
 *
 * Extends the last block when the new text continues it, and starts a new one
 * otherwise. Returns `prev` unchanged when there is nothing new to show, so a
 * caller holding this in component state does not re-render on a repeat.
 */
export function appendThinking(prev: readonly string[], text: string): string[] {
  if (!text) return prev as string[];
  const last = prev[prev.length - 1];
  if (last !== undefined) {
    if (text === last) return prev as string[];
    // A prefix of what we hold is a late or duplicated update; the longer text
    // is the better one, so keep it.
    if (last.startsWith(text)) return prev as string[];
    if (text.startsWith(last)) return [...prev.slice(0, -1), text];
  }
  return [...prev, text].slice(-THINKING_KEEP);
}
