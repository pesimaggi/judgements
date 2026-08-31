import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildCitation } from "@/lib/citation";
import { extractHighlightTerms, escapeRegExp } from "@/lib/highlight";

describe("buildCitation", () => {
  const base = {
    court: "Hæstiréttur Íslands",
    caseNumber: "22/2023",
    caseName: "A gegn B",
    title: "Dómur",
    date: "2023-05-04T00:00:00Z",
    officialUrl: "https://www.haestirettur.is/domur/22-2023",
  };

  test("reads as a citation a lawyer would paste", () => {
    assert.equal(
      buildCitation(base),
      "Hæstiréttur Íslands 4. maí 2023, mál nr. 22/2023, A gegn B — https://www.haestirettur.is/domur/22-2023"
    );
  });

  test("the date is written the Icelandic way", () => {
    assert.ok(buildCitation(base).includes("4. maí 2023"));
  });

  test("falls back to the title when there is no case name", () => {
    assert.ok(buildCitation({ ...base, caseName: null }).includes("Dómur"));
  });

  test("omits the parts a document does not have", () => {
    const sparse = buildCitation({
      court: null,
      caseNumber: null,
      caseName: null,
      title: "Álit umboðsmanns",
      date: null,
      officialUrl: "https://x.test/1",
    });
    assert.equal(sparse, "Álit umboðsmanns — https://x.test/1");
    assert.ok(!sparse.includes("mál nr."), "no empty 'mál nr.'");
    assert.ok(!sparse.includes(", ,"), "no gap left by a missing part");
  });

  test("always ends in the official source link", () => {
    assert.ok(buildCitation(base).endsWith(base.officialUrl));
  });
});

describe("extractHighlightTerms", () => {
  test("keeps a quoted phrase whole", () => {
    assert.deepEqual(extractHighlightTerms('"sönnun um orsakatengsl"'), [
      "sönnun um orsakatengsl",
    ]);
  });

  test("takes phrases and loose words together", () => {
    assert.deepEqual(extractHighlightTerms('uppsögn "sönnun um orsakatengsl" sjómenn'), [
      "sönnun um orsakatengsl",
      "uppsögn",
      "sjómenn",
    ]);
  });

  test("drops the boolean keywords — they are syntax, not terms to mark", () => {
    assert.deepEqual(extractHighlightTerms("uppsögn NOT sjómenn"), ["uppsögn", "sjómenn"]);
    assert.deepEqual(extractHighlightTerms("uppsögn AND sjómenn"), ["uppsögn", "sjómenn"]);
  });

  test("strips the negation marker from a term", () => {
    assert.deepEqual(extractHighlightTerms("uppsögn -sjómenn"), ["uppsögn", "sjómenn"]);
  });

  test("de-duplicates", () => {
    assert.deepEqual(extractHighlightTerms("uppsögn uppsögn"), ["uppsögn"]);
  });

  test("ignores single characters, which would mark half the page", () => {
    assert.deepEqual(extractHighlightTerms("a uppsögn"), ["uppsögn"]);
  });

  test("empty query yields no terms", () => {
    assert.deepEqual(extractHighlightTerms(""), []);
  });
});

describe("escapeRegExp", () => {
  test("neutralises the characters a query may legitimately contain", () => {
    // A case number is "E-2/24"; a query may hold parentheses or a dot. Any
    // of them unescaped turns a highlight into a wrong match or a throw.
    const term = "1. mgr. (a) [x] E-2/24 +?*";
    assert.doesNotThrow(() => new RegExp(escapeRegExp(term)));
    assert.match(term, new RegExp(escapeRegExp(term)));
  });
});
