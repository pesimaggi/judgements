/**
 * The priority list is data, and the failures a list of data has are silent
 * ones.
 *
 * A mistyped case number does not throw: it parses to a well-formed CELEX for
 * some other judgment, or to none at all, and either way the judgment the list
 * was written to fetch is simply never fetched. Nobody notices, because what
 * you see is a corpus that does not hold Stewart — which is what it looked like
 * before the list existed.
 *
 * The adapter's own guard against the first case is the name check against
 * EUR-Lex's title, which needs the endpoint. These are the checks that do not.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { caseCelexFromNumber, parseCaseCelex } from "@/lib/cjeu";
import { PRIORITY_CASES } from "./cjeu-priority";

describe("the CJEU priority list", () => {
  test("every case number resolves to a judgment CELEX", () => {
    for (const item of PRIORITY_CASES) {
      const celex = caseCelexFromNumber(item.caseNumber);
      assert.ok(celex, `${item.caseNumber} (${item.name}) is not a case number`);
      // And back again, so the case number the adapter logs is the one written
      // here rather than a near miss.
      assert.equal(parseCaseCelex(celex)?.caseNumber, item.caseNumber, item.name);
    }
  });

  test("no judgment is listed twice", () => {
    // Two entries for one judgment is harmless at runtime — the second finds it
    // stored — but it means one of them is a typo for a case that is now
    // missing, which is not harmless.
    const seen = new Map<string, string>();
    for (const item of PRIORITY_CASES) {
      const celex = caseCelexFromNumber(item.caseNumber) ?? item.caseNumber;
      const first = seen.get(celex);
      assert.equal(first, undefined, `${celex} listed as both "${first}" and "${item.name}"`);
      seen.set(celex, item.name);
    }
  });

  test("every entry carries a name the title check can use", () => {
    for (const item of PRIORITY_CASES) {
      // The guard is a substring match against EUR-Lex's title, so a name of
      // one or two characters would match almost anything and wave the wrong
      // judgment through. Anything that generic belongs in the note.
      assert.ok(item.name.trim().length >= 4, `${item.caseNumber} has no usable name`);
      assert.ok(item.note.trim().length > 0, `${item.caseNumber} says nothing about why it is here`);
    }
  });

  test("the judgments it names are the ones the corpus is short of", () => {
    // Not a style check. The list exists because the year sweep runs
    // newest-first and the canon is old; an entry from the years the sweep has
    // already reached is queue-jumping ahead of nothing. Loose on purpose —
    // the point is that the list does not silently drift into recent case law
    // the ordinary sweep already brings.
    const years = PRIORITY_CASES.map((item) => Number(caseCelexFromNumber(item.caseNumber)?.slice(1, 5)));
    const old = years.filter((year) => year <= 2018).length;
    assert.ok(
      old > PRIORITY_CASES.length / 2,
      `only ${old} of ${PRIORITY_CASES.length} entries predate 2019`
    );
  });
});
