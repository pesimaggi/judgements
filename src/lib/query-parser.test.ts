import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseQuery } from "@/lib/query-parser";

describe("case-number detection", () => {
  for (const [q, expected] of [
    ["22/2023", "22/2023"],
    ["E-2/24", "E-2/24"],
    ["12595/2024", "12595/2024"],
  ] as const) {
    test(`${q} is a lookup`, () => {
      const p = parseQuery(q);
      assert.deepEqual(p.caseNumbers, [expected]);
      assert.equal(p.isCaseNumberLookup, true);
    });
  }

  test("a case number with other words is not a bare lookup", () => {
    const p = parseQuery("mál 22/2023");
    assert.deepEqual(p.caseNumbers, ["22/2023"]);
    assert.equal(p.isCaseNumberLookup, false, "there is a word to search for as well");
  });

  test("two case numbers are not a lookup either", () => {
    assert.equal(parseQuery("22/2023 415/2018").isCaseNumberLookup, false);
  });

  test("ordinary words carry no case number", () => {
    assert.deepEqual(parseQuery("stjórnsýsla").caseNumbers, []);
  });
});

describe("boolean syntax → websearch_to_tsquery", () => {
  test("NOT becomes the negation websearch understands", () => {
    assert.equal(parseQuery("uppsögn NOT sjómenn").websearch, "uppsögn -sjómenn");
  });

  test("AND is implicit and is dropped", () => {
    assert.equal(parseQuery("uppsögn AND sjómenn").websearch, "uppsögn sjómenn");
  });

  test("lowercase or is upcased; websearch only understands the uppercase form", () => {
    assert.equal(parseQuery("uppsögn or sjómenn").websearch, "uppsögn OR sjómenn");
  });

  test("quoted phrases pass through untouched", () => {
    assert.equal(
      parseQuery('"sönnun um orsakatengsl"').websearch,
      '"sönnun um orsakatengsl"'
    );
  });
});

describe("Icelandic input", () => {
  test("the letters survive parsing", () => {
    // The whole corpus is in Icelandic; a character class that drops þ/ð/æ/ö
    // silently empties the query rather than failing loudly.
    const p = parseQuery("þjóðlenda æðarvarp ölgerð");
    assert.equal(p.websearch, "þjóðlenda æðarvarp ölgerð");
  });

  test("raw is trimmed", () => {
    assert.equal(parseQuery("  stjórnsýsla  ").raw, "stjórnsýsla");
  });
});
