import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { SOURCES } from "./sources";
import {
  SOURCE_TREE,
  allTreeKeys,
  groupKeys,
  activeFilterChips,
  defaultSourceKeys,
} from "./source-tree";

/**
 * The tree is a hand-kept copy of a list that is generated elsewhere, which is
 * the arrangement that always drifts. Every failure below is silent in the
 * browser: a source missing from the tree simply cannot be ticked, and a stale
 * key renders a checkbox for a source that does not exist.
 */
describe("SOURCE_TREE covers the live sources", () => {
  const live = new Set(SOURCES.map((s) => s.key));
  const tree = allTreeKeys();

  test("every key in the tree is a live source", () => {
    const unknown = tree.filter((k) => !live.has(k));
    assert.deepEqual(unknown, [], `not in SOURCES: ${unknown.join(", ")}`);
  });

  test("every live source appears in the tree", () => {
    const missing = [...live].filter((k) => !tree.includes(k));
    assert.deepEqual(missing, [], `missing from SOURCE_TREE: ${missing.join(", ")}`);
  });

  test("no source appears twice", () => {
    const seen = new Set<string>();
    const twice = tree.filter((k) => (seen.has(k) ? true : (seen.add(k), false)));
    assert.deepEqual(twice, [], `listed more than once: ${twice.join(", ")}`);
  });

  test("a pilot source is not offered", () => {
    // SOURCES is live-only, so this is really a guard on the tree being built
    // from it: a pilot key here would put a checkbox in front of a source the
    // search API rejects as unknown.
    const pilots = ["althingi-frumvorp"];
    for (const key of pilots) assert.ok(!tree.includes(key), `${key} is a pilot`);
  });
});

describe("defaultSourceKeys", () => {
  const live = new Set(SOURCES.map((s) => s.key));

  test("the page opens on the Icelandic courts", () => {
    const keys = defaultSourceKeys(live);
    assert.deepEqual(
      keys,
      groupKeys(SOURCE_TREE.find((g) => g.id === "domstolar")!),
      "the default is the courts group, in the tree's own order"
    );
  });

  test("every default key is a source the API offers", () => {
    // The default is what the first request is made with: a stale key here is
    // a search that 400s before anybody has touched a control.
    for (const key of defaultSourceKeys(live)) assert.ok(live.has(key), key);
  });

  test("a source the API does not offer is dropped rather than searched", () => {
    const partial = new Set(["haestirettur", "landsrettur"]);
    assert.deepEqual(defaultSourceKeys(partial), ["haestirettur", "landsrettur"]);
  });

  test("the default is never empty, which would be a page with no results", () => {
    assert.ok(defaultSourceKeys(live).length > 0);
  });
});

describe("activeFilterChips", () => {
  const all = allTreeKeys();
  const nameOf = (k: string) => `name:${k}`;

  test("nothing selected renders no chips — the search uses every source", () => {
    assert.deepEqual(activeFilterChips(new Set(), all, nameOf), []);
  });

  test("everything selected renders no chips", () => {
    assert.deepEqual(activeFilterChips(new Set(all), all, nameOf), []);
  });

  test("a whole category folds into one chip carrying all its keys", () => {
    const courts = SOURCE_TREE.find((g) => g.id === "domstolar")!;
    const chips = activeFilterChips(new Set(groupKeys(courts)), all, nameOf);

    assert.equal(chips.length, 1);
    assert.equal(chips[0].label, courts.name);
    assert.equal(chips[0].isGroup, true);
    assert.deepEqual([...chips[0].keys].sort(), [...groupKeys(courts)].sort());
  });

  test("a partly chosen category names its sources instead", () => {
    const courts = SOURCE_TREE.find((g) => g.id === "domstolar")!;
    const [first, second] = groupKeys(courts);
    const chips = activeFilterChips(new Set([first, second]), all, nameOf);

    assert.equal(chips.length, 2);
    assert.ok(chips.every((c) => !c.isGroup));
    assert.deepEqual(chips.map((c) => c.keys[0]).sort(), [first, second].sort());
    assert.deepEqual(chips.map((c) => c.label).sort(), [nameOf(first), nameOf(second)].sort());
  });

  test("a subgroup counts towards its parent category being whole", () => {
    // Stjórnsýsla og eftirlit is the only three-level group: ticking its one
    // direct member and all three subgroups must read as one category, not as
    // 45 individual chips.
    const admin = SOURCE_TREE.find((g) => g.id === "stjornsysla")!;
    const chips = activeFilterChips(new Set(groupKeys(admin)), all, nameOf);

    assert.equal(chips.length, 1);
    assert.equal(chips[0].label, admin.name);
  });

  test("a selected key outside the tree still gets a removable chip", () => {
    const chips = activeFilterChips(new Set(["not-in-tree"]), [...all, "not-in-tree"], nameOf);
    assert.deepEqual(chips, [{ label: "name:not-in-tree", keys: ["not-in-tree"], isGroup: false }]);
  });
});
