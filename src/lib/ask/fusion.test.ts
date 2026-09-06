/**
 * Result fusion.
 *
 * The property that matters is determinism: the same lists in the same order
 * must produce the same ranking, every time and on every machine, because the
 * evaluation harness compares orderings and a ranking that drifts makes every
 * comparison meaningless. The rest is arithmetic, and the arithmetic is worth
 * pinning because a weight applied to the wrong list is invisible.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { fuse, dedupeBy, maxPossibleScore, RRF_K } from "@/lib/ask/fusion";

interface Hit {
  id: string;
  label?: string;
}

const list = (label: string, weight: number, ids: string[]) => ({
  label,
  weight,
  items: ids.map((id) => ({ id })),
});

describe("fuse", () => {
  test("a document found by two searches beats one found by a better single search", () => {
    const fused = fuse<Hit>(
      [list("phrase", 1, ["a", "b"]), list("concept", 1, ["b", "c"])],
      (h) => h.id
    );
    assert.equal(fused[0].item.id, "b", "second on both lists beats first on one");
  });

  test("weights count: a heavier list's first place outranks a lighter one's", () => {
    const fused = fuse<Hit>([list("concept", 1, ["a"]), list("case", 2, ["b"])], (h) => h.id);
    assert.equal(fused[0].item.id, "b");
  });

  test("scores are the reciprocal-rank sum, so they can be checked by hand", () => {
    const fused = fuse<Hit>([list("x", 1, ["a", "b"])], (h) => h.id);
    assert.equal(fused[0].score, 1 / (RRF_K + 1));
    assert.equal(fused[1].score, 1 / (RRF_K + 2));
  });

  test("records which searches found each result, and where", () => {
    const fused = fuse<Hit>([list("phrase", 1, ["a"]), list("concept", 1, ["z", "a"])], (h) => h.id);
    const a = fused.find((f) => f.item.id === "a");
    assert.deepEqual(a?.matchedBy, [
      { label: "phrase", rank: 1 },
      { label: "concept", rank: 2 },
    ]);
  });

  test("deduplicates, keeping the copy from the first list that found it", () => {
    const fused = fuse<Hit>(
      [
        { label: "phrase", weight: 1, items: [{ id: "a", label: "from-phrase" }] },
        { label: "concept", weight: 1, items: [{ id: "a", label: "from-concept" }] },
      ],
      (h) => h.id
    );
    assert.equal(fused.length, 1);
    assert.equal(fused[0].item.label, "from-phrase", "the more specific search's copy wins");
  });

  test("ties break on the order the lists were given, not arbitrarily", () => {
    const first = fuse<Hit>([list("x", 1, ["a"]), list("y", 1, ["b"])], (h) => h.id);
    const again = fuse<Hit>([list("x", 1, ["a"]), list("y", 1, ["b"])], (h) => h.id);
    assert.deepEqual(
      first.map((f) => f.item.id),
      ["a", "b"]
    );
    assert.deepEqual(
      first.map((f) => f.item.id),
      again.map((f) => f.item.id),
      "the same input must produce the same order"
    );
  });

  test("empty lists contribute nothing rather than breaking the fusion", () => {
    const fused = fuse<Hit>([list("x", 1, []), list("y", 1, ["a"])], (h) => h.id);
    assert.equal(fused.length, 1);
  });

  test("an item with no key is skipped rather than colliding on the empty string", () => {
    const fused = fuse<Hit>(
      [{ label: "x", weight: 1, items: [{ id: "" }, { id: "a" }] }],
      (h) => h.id
    );
    assert.deepEqual(
      fused.map((f) => f.item.id),
      ["a"]
    );
  });
});

describe("maxPossibleScore", () => {
  test("is what a document first on every list would score", () => {
    const lists = [list("x", 1, ["a"]), list("y", 2, ["a"])];
    const fused = fuse<Hit>(lists, (h) => h.id);
    assert.equal(fused[0].score, maxPossibleScore(lists));
  });

  test("never returns zero, so it is safe to divide by", () => {
    assert.equal(maxPossibleScore([]), 1);
  });
});

describe("dedupeBy", () => {
  test("keeps the first of each key, in order", () => {
    const out = dedupeBy([{ id: "a" }, { id: "b" }, { id: "a" }], (h: Hit) => h.id);
    assert.deepEqual(
      out.map((h) => h.id),
      ["a", "b"]
    );
  });
});
