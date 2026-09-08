import { test } from "node:test";
import assert from "node:assert/strict";
import { SseParser } from "./sse";

const line = (text: string) => `data: ${JSON.stringify({ type: "line", text })}\n\n`;

test("a complete frame yields one event", () => {
  const p = new SseParser();
  assert.deepEqual(p.push(line("Ákvæðið gildir [1].")), [
    { type: "line", text: "Ákvæðið gildir [1]." },
  ]);
});

test("an event split across chunks is held until it is whole", () => {
  const p = new SseParser();
  const frame = line("Ákvæðið gildir [1].");
  const cut = Math.floor(frame.length / 2);
  assert.deepEqual(p.push(frame.slice(0, cut)), []);
  assert.deepEqual(p.push(frame.slice(cut)), [{ type: "line", text: "Ákvæðið gildir [1]." }]);
});

test("several events in one chunk all come out, in order", () => {
  const p = new SseParser();
  const events = p.push(line("a") + line("b") + line("c"));
  assert.deepEqual(
    events.map((e) => (e.type === "line" ? e.text : e.type)),
    ["a", "b", "c"]
  );
});

test("the route's opening comment is ignored, not treated as an event", () => {
  const p = new SseParser();
  assert.deepEqual(p.push(": open\n\n"), []);
  assert.deepEqual(p.push(line("a")), [{ type: "line", text: "a" }]);
});

test("a malformed frame is dropped and the stream keeps going", () => {
  const p = new SseParser();
  const events = p.push("data: {not json\n\n" + line("still here"));
  assert.deepEqual(events, [{ type: "line", text: "still here" }]);
});

test("a trailing partial frame is never emitted", () => {
  const p = new SseParser();
  assert.deepEqual(p.push('data: {"type":"line","text":"half'), []);
});

test("blank lines inside the answer survive the round trip", () => {
  // The paragraph breaks. An empty `line` event is meaningful and must not be
  // mistaken for an empty data field and skipped.
  const p = new SseParser();
  assert.deepEqual(p.push(line("")), [{ type: "line", text: "" }]);
});
