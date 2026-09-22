import assert from "node:assert/strict";
import { test } from "node:test";
import { THINKING_KEEP, appendThinking } from "./thinking";

/**
 * The bug these exist for was silent: the panel rendered, it just rendered
 * three characters at a time. Nothing threw, nothing was empty, and the only
 * way to notice was to look at it. That is the kind of failure this repo
 * writes tests for.
 */

test("a growing block replaces itself rather than stacking up", () => {
  let held: string[] = [];
  for (const snapshot of ["Spurningin", "Spurningin snýr", "Spurningin snýr að tveimur"]) {
    held = appendThinking(held, snapshot);
  }
  // One block, whole. The failure this catches is three entries, of which the
  // panel would show the last — "Spurningin snýr að tveimur" is right, but the
  // same shape with deltas would leave " að tveimur" alone on screen.
  assert.deepEqual(held, ["Spurningin snýr að tveimur"]);
});

test("a block that does not continue the last one starts a new entry", () => {
  const held = appendThinking(appendThinking([], "Fyrsta umhugsun."), "Önnur umhugsun.");
  assert.deepEqual(held, ["Fyrsta umhugsun.", "Önnur umhugsun."]);
});

test("the research loop's whole blocks and the answer stage's snapshots fold the same way", () => {
  // One round reported whole, then a streamed block arriving in three updates.
  let held = appendThinking([], "Heil umhugsun úr rannsóknarlotu.");
  for (const snapshot of ["Ég", "Ég íhugaði", "Ég íhugaði að byrja á 95. gr."]) {
    held = appendThinking(held, snapshot);
  }
  assert.deepEqual(held, ["Heil umhugsun úr rannsóknarlotu.", "Ég íhugaði að byrja á 95. gr."]);
});

test("a repeated or late update changes nothing, and does not re-render", () => {
  const held = appendThinking([], "Sama umhugsun.");
  assert.equal(appendThinking(held, "Sama umhugsun."), held);
  // A shorter prefix arriving after the longer text is stale, not a new block.
  assert.equal(appendThinking(held, "Sama"), held);
  assert.equal(appendThinking(held, ""), held);
});

test("only the last few blocks are kept", () => {
  let held: string[] = [];
  for (let i = 0; i < THINKING_KEEP + 6; i++) held = appendThinking(held, `Umhugsun ${i}.`);
  assert.equal(held.length, THINKING_KEEP);
  assert.equal(held[held.length - 1], `Umhugsun ${THINKING_KEEP + 5}.`);
});
