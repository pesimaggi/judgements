/**
 * Alias accumulation across runs.
 *
 * `Act.aliases` is how the act type-ahead finds an act by the name people
 * actually use for it — "vaxtalög" for lög nr. 38/2001, whose official title
 * ("Lög um vexti og verðtryggingu") contains no such word. The alias is not a
 * convenience there; it is the only route to the act by its usual name.
 *
 * The counts feeding it come from one run, and a run is a partial view of the
 * corpus by design. So the merge rule has to be safe under partial evidence,
 * which is what these hold down.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { aliasesForAct } from "@/ingestion/citations";

const counts = (o: Record<string, number>) => new Map(Object.entries(o));

describe("aliasesForAct", () => {
  test("keeps names used often enough, most-used first", () => {
    assert.deepEqual(
      aliasesForAct(counts({ vaxtalaga: 40, vaxtalög: 90 }), []),
      ["vaxtalög", "vaxtalaga"]
    );
  });

  test("drops a name seen once — as likely a typo as a real short name", () => {
    assert.deepEqual(aliasesForAct(counts({ vaxtalög: 9, vxtalög: 1 }), []), ["vaxtalög"]);
  });

  /**
   * The regression this function was extracted for.
   *
   * A small run — an incremental pass, or a targeted re-scan after a parser
   * fix — sees an act mentioned once or twice. Replacing the stored list with
   * that evidence dropped "vaxtalög" entirely, and with it the only way to
   * find lög nr. 38/2001 by the name everyone cites it as. Nothing errored;
   * the act simply stopped being findable.
   */
  test("a thin run cannot drop an alias earned across the corpus", () => {
    const merged = aliasesForAct(counts({ vaxtalög: 1 }), ["vaxtalög", "vaxtalaga"]);
    assert.ok(merged.includes("vaxtalög"), "the established alias must survive");
    assert.ok(merged.includes("vaxtalaga"));
  });

  test("a run that sees nothing at all leaves the stored list intact", () => {
    assert.deepEqual(aliasesForAct(counts({}), ["vaxtalög"]), ["vaxtalög"]);
  });

  test("a newly observed name is added alongside the stored ones", () => {
    const merged = aliasesForAct(counts({ vaxtalaganna: 5 }), ["vaxtalög"]);
    assert.ok(merged.includes("vaxtalaganna"), "new evidence still gets in");
    assert.ok(merged.includes("vaxtalög"), "without displacing what was there");
  });

  test("does not duplicate a name already stored", () => {
    assert.deepEqual(aliasesForAct(counts({ vaxtalög: 5 }), ["vaxtalög"]), ["vaxtalög"]);
  });

  test("caps the list, newly-evidenced names first", () => {
    const merged = aliasesForAct(
      counts({ a: 9, b: 8, c: 7 }),
      ["x", "y", "z", "w", "v", "u"],
      { max: 6 }
    );
    assert.equal(merged.length, 6);
    assert.deepEqual(merged.slice(0, 3), ["a", "b", "c"]);
  });

  describe("rebuild", () => {
    /**
     * The escape hatch: after a sweep that really did scan everything, the
     * stored list is replaced so a genuinely obsolete alias can finally go.
     * Only correct when the run saw the whole corpus, which is why it is an
     * explicit env flag and not the default.
     */
    test("replaces the stored list outright", () => {
      assert.deepEqual(
        aliasesForAct(counts({ vaxtalög: 40 }), ["gamallnafn"], { rebuild: true }),
        ["vaxtalög"]
      );
    });

    test("still applies the minimum-uses filter", () => {
      assert.deepEqual(aliasesForAct(counts({ vxtalög: 1 }), ["vaxtalög"], { rebuild: true }), []);
    });
  });

  test("is deterministic when two names are equally common", () => {
    // Otherwise the job writes a different order on every run and every act
    // looks changed.
    const run = () => aliasesForAct(counts({ blaga: 3, alaga: 3 }), []);
    assert.deepEqual(run(), run());
    assert.deepEqual(run(), ["alaga", "blaga"]);
  });
});
