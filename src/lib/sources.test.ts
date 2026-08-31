/**
 * Invariants of the source registry.
 *
 * These are configuration, not logic, which is exactly why they are worth
 * asserting: a duplicated key or a source that is live with no adapter costs
 * nothing at build time and produces a checkbox that returns nothing, or two
 * sources writing over each other's documents, at run time.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  ALL_SOURCES,
  SOURCES,
  SOURCE_KEYS,
  SCHOLARSHIP_SOURCE_KEYS,
  sourceByKey,
  groupedSources,
  isScholarship,
} from "@/lib/sources";
import { ADR_BOARDS, ADR_BOARD_KEYS, FELAGSDOMUR_KEY } from "@/lib/adr-boards";

describe("registry integrity", () => {
  test("source keys are unique", () => {
    // A collision means two sources share a Document.source value, and the
    // @@unique([source, officialUrl]) constraint starts merging them.
    const keys = ALL_SOURCES.map((s) => s.key);
    const duplicates = keys.filter((k, i) => keys.indexOf(k) !== i);
    assert.deepEqual(duplicates, [], `duplicate source keys: ${duplicates.join(", ")}`);
  });

  test("every source is completely specified", () => {
    for (const s of ALL_SOURCES) {
      assert.ok(s.key, "missing key");
      assert.ok(s.name, `${s.key}: missing name`);
      assert.ok(s.group, `${s.key}: missing group`);
      assert.ok(s.adapterKey, `${s.key}: no adapter would ever fill it`);
      assert.match(s.officialBaseUrl, /^https?:\/\//, `${s.key}: ${s.officialBaseUrl}`);
      assert.match(s.language, /^[a-z]{2}$/, `${s.key}: ${s.language}`);
      assert.ok(["decision", "scholarship"].includes(s.kind), `${s.key}: ${s.kind}`);
      assert.ok(["live", "pilot"].includes(s.status), `${s.key}: ${s.status}`);
    }
  });

  test("keys are URL- and query-safe", () => {
    // They travel in `?sources=` and are stored in a database column.
    for (const s of ALL_SOURCES) {
      assert.match(s.key, /^[a-z0-9-]+$/, `${s.key} needs escaping somewhere`);
    }
  });

  test("SOURCES is exactly the live subset", () => {
    assert.deepEqual(
      SOURCES.map((s) => s.key),
      ALL_SOURCES.filter((s) => s.status === "live").map((s) => s.key)
    );
    assert.ok(SOURCES.length > 0);
  });

  test("SOURCE_KEYS covers pilots too — the API accepts them, the UI hides them", () => {
    for (const s of ALL_SOURCES) assert.ok(SOURCE_KEYS.has(s.key), s.key);
  });

  test("sourceByKey finds every source and nothing else", () => {
    for (const s of ALL_SOURCES) assert.equal(sourceByKey(s.key)?.key, s.key);
    assert.equal(sourceByKey("engin-slík-heimild"), undefined);
  });
});

describe("kind", () => {
  /**
   * The distinction is not cosmetic: it decides what the citation job scans,
   * and therefore what the act reader is allowed to count as an "úrlausn".
   * A journal article filed as a decision would be counted as one.
   */
  test("scholarship keys and isScholarship agree", () => {
    for (const key of SCHOLARSHIP_SOURCE_KEYS) assert.equal(isScholarship(key), true);
    for (const s of ALL_SOURCES.filter((s) => s.kind === "decision")) {
      assert.equal(isScholarship(s.key), false, s.key);
    }
  });

  test("the journals are the scholarship, and they are grouped as such", () => {
    assert.ok(SCHOLARSHIP_SOURCE_KEYS.length >= 2, "Lögrétta and Úlfljótur");
    for (const key of SCHOLARSHIP_SOURCE_KEYS) {
      assert.equal(sourceByKey(key)?.kind, "scholarship");
    }
  });

  test("an unknown key is not scholarship", () => {
    assert.equal(isScholarship("engin-slík-heimild"), false);
  });
});

describe("the ADR boards", () => {
  test("every board is a source", () => {
    // The adapter saves under the board key and the UI offers the same
    // string. A board missing here is ingested and unreachable.
    for (const board of ADR_BOARDS) {
      const source = sourceByKey(board.key);
      assert.ok(source, `board ${board.key} has no source entry`);
      assert.equal(source.kind, "decision");
    }
  });

  test("Félagsdómur is a court, not one of the boards", () => {
    // It publishes on the same site and half its archive is reached the same
    // way, but the felagsdomur adapter owns it end to end. If it were also in
    // ADR_BOARDS the stjornarradid adapter would ingest the same cases under
    // a second key.
    assert.ok(!ADR_BOARD_KEYS.has(FELAGSDOMUR_KEY), "Félagsdómur must not be an ADR board");
    const source = sourceByKey(FELAGSDOMUR_KEY);
    assert.ok(source, "but it is still a source");
    assert.notEqual(source.group, sourceByKey(ADR_BOARDS[0].key)?.group);
  });

  test("board committee filter values are unique", () => {
    const committees = ADR_BOARDS.map((b) => b.committee);
    assert.equal(new Set(committees).size, committees.length);
  });
});

describe("groupedSources", () => {
  const groups = groupedSources(SOURCES);

  test("loses nothing and duplicates nothing", () => {
    const flat = groups.flatMap((g) => g.sources.map((s) => s.key));
    assert.equal(flat.length, SOURCES.length);
    assert.equal(new Set(flat).size, flat.length);
  });

  test("every group is named and non-empty", () => {
    for (const g of groups) {
      assert.ok(g.group, "unnamed group");
      assert.ok(g.sources.length > 0, `${g.group} is empty`);
    }
  });

  test("the courts come before the forty boards", () => {
    // A group of forty must not bury the courts above it — the panel folds
    // it down for the same reason.
    const names = groups.map((g) => g.group);
    const courts = names.findIndex((n) => /courts|dómstól/i.test(n));
    const boards = names.findIndex((n) => /úrskurðarnefnd/i.test(n));
    assert.ok(courts !== -1 && boards !== -1, names.join(" | "));
    assert.ok(courts < boards, "courts should be listed first");
  });
});
