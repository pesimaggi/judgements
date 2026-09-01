/**
 * The stjornarradid URL builders.
 *
 * The board names on that site carry characters that break if they are
 * hand-escaped — a U+066B Arabic decimal separator and a non-breaking space
 * among them — so the `Committee=` value goes through URLSearchParams. A
 * board whose filter value is mangled returns an empty listing, which is
 * indistinguishable from "nothing new" and so fails silently forever.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  ADR_BOARDS,
  boardListUrl,
  committeeListUrl,
  decisionUrl,
  adrBoardByKey,
  FELAGSDOMUR_COMMITTEE,
  STJORNARRADID_BASE,
} from "@/lib/adr-boards";

describe("board registry", () => {
  test("keys are unique and URL-safe", () => {
    const keys = ADR_BOARDS.map((b) => b.key);
    assert.equal(new Set(keys).size, keys.length, "duplicate board key");
    for (const k of keys) assert.match(k, /^[a-z0-9-]+$/, k);
  });

  test("every board is completely specified", () => {
    for (const b of ADR_BOARDS) {
      assert.ok(b.name, `${b.key}: no name`);
      assert.ok(b.committee, `${b.key}: no Committee= value to filter on`);
      assert.ok(b.ministry, `${b.key}: no ministry`);
      assert.ok(Number.isFinite(b.approxCases), `${b.key}: ${b.approxCases}`);
    }
  });

  test("adrBoardByKey resolves every board", () => {
    for (const b of ADR_BOARDS) assert.equal(adrBoardByKey(b.key)?.key, b.key);
    assert.equal(adrBoardByKey("engin-slík-nefnd"), undefined);
  });

  test("the list is ordered largest archive first", () => {
    const counts = ADR_BOARDS.map((b) => b.approxCases);
    assert.deepEqual(counts, [...counts].sort((a, b) => b - a));
  });
});

describe("committeeListUrl", () => {
  test("carries the filter and the page index", () => {
    const url = new URL(committeeListUrl("Úrskurðarnefnd velferðarmála", { page: 3 }));
    assert.equal(url.searchParams.get("Committee"), "Úrskurðarnefnd velferðarmála");
    assert.equal(url.searchParams.get("PageIndex"), "3");
    assert.equal(url.searchParams.get("SortByDate"), "True");
  });

  test("defaults to the first page", () => {
    const url = new URL(committeeListUrl("Kærunefnd útlendingamála"));
    assert.equal(url.searchParams.get("PageIndex"), "0");
  });

  /**
   * The reason the value goes through URLSearchParams rather than being
   * interpolated: these characters survive a round-trip only if they are
   * percent-encoded properly.
   */
  test("exotic characters in a board name survive the round-trip", () => {
    for (const committee of [
      "Nefnd٫með undarlegu tákni",
      "Nefnd með óbrjótanlegu bili",
      "Úrskurðarnefnd um viðskipti við fjármálafyrirtæki",
    ]) {
      const url = new URL(committeeListUrl(committee));
      assert.equal(url.searchParams.get("Committee"), committee, committee);
    }
  });

  test("every real board's filter value round-trips", () => {
    for (const b of ADR_BOARDS) {
      const url = new URL(boardListUrl(b));
      assert.equal(url.searchParams.get("Committee"), b.committee, b.key);
    }
  });

  test("an overridden base does not produce a doubled slash", () => {
    assert.ok(!committeeListUrl("X", { base: "https://example.test/" }).includes("test//"));
  });

  test("Félagsdómur's archive is addressed by committee, not as a board", () => {
    // Half of it lives on this site although the court is not an AdrBoard.
    const url = new URL(committeeListUrl(FELAGSDOMUR_COMMITTEE));
    assert.equal(url.searchParams.get("Committee"), "Félagsdómur");
  });
});

describe("decisionUrl", () => {
  test("is newsid alone — cname and cid are decoration", () => {
    // Leaving them off keeps the stored officialUrl stable if a board is
    // renamed, and officialUrl is half the document's identity.
    const url = new URL(decisionUrl("12345"));
    assert.equal(url.searchParams.get("newsid"), "12345");
    assert.equal(url.searchParams.get("cname"), null);
    assert.equal(url.origin, new URL(STJORNARRADID_BASE).origin);
  });

  test("an overridden base does not produce a doubled slash", () => {
    assert.ok(!decisionUrl("1", "https://example.test/").includes("test//"));
  });
});
