/**
 * Reading the well's event stream on the browser side.
 *
 * `EventSource` is the obvious tool and cannot be used: it only issues GET
 * requests, and a question with its conversation history is a POST body. So
 * the stream comes back through `fetch` and is framed here.
 *
 * Kept as a parser that takes strings rather than a function that takes a
 * Response, because the part worth testing is the framing — an event split
 * across two network chunks, a comment line, a partial frame at the end — and
 * none of that needs a socket to test. See sse.test.ts.
 */
import type { AskEvent } from "./types";

/**
 * Frames `data:` lines into events.
 *
 * Server-Sent Events are separated by a blank line, so nothing is emitted
 * until a complete frame has arrived. Anything else — the `: open` comment the
 * route sends to flush the headers, an `event:` or `id:` field — is ignored
 * rather than treated as an error: the format allows them and this client has
 * no use for them.
 */
export class SseParser {
  private buffer = "";

  push(chunk: string): AskEvent[] {
    this.buffer += chunk;
    const events: AskEvent[] = [];

    for (;;) {
      const at = this.buffer.indexOf("\n\n");
      if (at === -1) break;
      const frame = this.buffer.slice(0, at);
      this.buffer = this.buffer.slice(at + 2);

      for (const line of frame.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        try {
          events.push(JSON.parse(payload) as AskEvent);
        } catch {
          // A malformed frame is dropped rather than thrown. The stream is
          // still live and the events after it are still worth having; failing
          // the whole answer over one unparseable frame would be worse.
        }
      }
    }
    return events;
  }
}

/**
 * Reads a streamed response to completion, calling `onEvent` for each event.
 *
 * Returns when the server closes the stream. A body that is missing entirely —
 * which is what a proxy that buffered the response looks like — is reported
 * rather than silently producing an answer that never arrives.
 */
export async function readAskEvents(
  response: Response,
  onEvent: (event: AskEvent) => void
): Promise<void> {
  if (!response.body) throw new Error("The well's answer arrived without a stream.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser();

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    // `stream: true` so a multi-byte character split across two chunks — which
    // Icelandic text makes likely — is decoded once it is whole rather than as
    // two replacement characters.
    for (const event of parser.push(decoder.decode(value, { stream: true }))) {
      onEvent(event);
    }
  }
}
