import { test } from "node:test";
import assert from "node:assert/strict";
import { LineValidator } from "./stream";
import { validateCitations } from "./citations";
import type { AskSource } from "./types";

function source(n: number): AskSource {
  return {
    n,
    kind: "provision",
    title: `${n}. gr. laga nr. 100/1952`,
    subtitle: "Lög um íslenskan ríkisborgararétt",
    path: `/log/100-1952#G${n}`,
    cited: false,
  };
}

const SOURCES = [source(1), source(2), source(3)];

/** Feeds an answer through the validator in chunks of `size` characters. */
function streamed(answer: string, size: number, sources = SOURCES): string {
  const v = new LineValidator(sources, "is");
  const out: string[] = [];
  for (let i = 0; i < answer.length; i += size) {
    out.push(...v.push(answer.slice(i, i + size)));
  }
  out.push(...v.flush());
  return out.join("\n");
}

const ANSWER = [
  "Umsækjandi skal uppfylla skilyrði um búsetu [1].",
  "",
  "## Ákvæðin",
  "",
  "- Útlendingastofnun er heimilt að veita ríkisborgararétt [2].",
  "- Umsækjandi á rétt á rökstuðningi [3].",
].join("\n");

test("a streamed answer validates to the same text as the whole one", () => {
  // The equivalence the whole design rests on. If this ever stops holding,
  // streaming is no longer safe and the answer must go back to being
  // validated in one pass at the end.
  const whole = validateCitations(ANSWER, SOURCES, "is").answer;
  for (const size of [1, 3, 7, 40, 5000]) {
    assert.equal(streamed(ANSWER, size), whole, `chunk size ${size}`);
  }
});

test("a citation to a source that does not exist never reaches the reader", () => {
  const answer = "Umsækjandi skal uppfylla skilyrði um búsetu [11].";
  const lines = streamed(answer, 4);
  // Deleted, not renumbered — the sentence must not end up pointing at [1].
  assert.ok(!lines.includes("[11]"), "the invalid marker survived");
  assert.ok(!lines.includes("[1]"), "the invalid marker was remapped to a real source");
  assert.equal(lines, validateCitations(answer, SOURCES, "is").answer);
});

test("a proposition with nothing behind it is qualified as it streams", () => {
  const answer = "Umsækjandi skal uppfylla skilyrði um búsetu í sjö ár.";
  const lines = streamed(answer, 6);
  assert.match(lines, /óstaðfest/);
  assert.equal(lines, validateCitations(answer, SOURCES, "is").answer);
});

test("blank lines survive, so paragraphs do not run together", () => {
  // validateCitations trims, so a blank line put through it would vanish and
  // the answer would arrive as one block.
  const v = new LineValidator(SOURCES, "is");
  assert.deepEqual(v.push("a [1].\n\n## B\n"), ["a [1].", "", "## B"]);
});

test("a chunk boundary inside a citation marker does not split it", () => {
  // The failure this guards: "[" arriving in one chunk and "1]" in the next,
  // each validated on its own. Neither half is a citation, so a valid marker
  // would be seen as an uncited claim, qualified, and left broken on screen.
  // Nothing is emitted until the line is whole.
  const v = new LineValidator(SOURCES, "is");
  assert.deepEqual(v.push("Umsækjandi skal uppfylla skilyrði um búsetu ["), []);
  assert.deepEqual(v.push("1].\n"), ["Umsækjandi skal uppfylla skilyrði um búsetu [1]."]);
});

test("an invalid citation split across chunks is still caught", () => {
  // Same boundary, invalid source: [11] is deleted, and the sentence it was
  // resting on is qualified — the reader sees neither the broken marker nor an
  // unqualified rule.
  const v = new LineValidator(SOURCES, "is");
  assert.deepEqual(v.push("Umsækjandi skal uppfylla skilyrði [1"), []);
  const [line] = v.push("1].\n");
  assert.ok(!line.includes("[11]") && !line.includes("[1]"));
  assert.match(line, /óstaðfest/);
});

test("flush emits a final line with no trailing newline, and only once", () => {
  const v = new LineValidator(SOURCES, "is");
  assert.deepEqual(v.push("Ákvæðið gildir [1]."), []);
  assert.deepEqual(v.flush(), ["Ákvæðið gildir [1]."]);
  assert.deepEqual(v.flush(), []);
});

test("no sources at all: every citation is invalid and every claim qualified", () => {
  const answer = "Umsækjandi skal uppfylla skilyrði um búsetu [1].";
  const lines = streamed(answer, 3, []);
  assert.ok(!lines.includes("[1]"));
  assert.match(lines, /óstaðfest/);
  assert.equal(lines, validateCitations(answer, [], "is").answer);
});
