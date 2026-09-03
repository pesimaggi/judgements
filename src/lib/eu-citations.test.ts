/**
 * Reading EU act references out of a decision of the EEA Joint Committee.
 *
 * The passages here are written the way the Official Journal writes them —
 * the CELEX-like reference followed by the citation, the older decisions with
 * only the citation — because that is the shape the extractor has to survive.
 * What it must never do is invent a reference: a decision that names one act
 * must not mark a second act as incorporated, since that would tell a reader
 * an act binds Iceland when it does not.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { extractEuActRefs, refLookupKeys, decisionNumberFromTitle } from "@/lib/eu-citations";

describe("the Official Journal's reference form", () => {
  test("reads the spaced CELEX an annex point opens with", () => {
    const refs = extractEuActRefs(
      "The following shall be inserted after point 5e of Annex XI: '5f. 32016 R 0679: Regulation " +
        "(EU) 2016/679 of the European Parliament and of the Council of 27 April 2016 (OJ L 119, p. 1).'"
    );
    const gdpr = refs.find((r) => r.celex === "32016R0679");
    assert.ok(gdpr, "the CELEX reference was not read");
    assert.equal(gdpr.letter, "R");
    assert.equal(gdpr.year, 2016);
    assert.equal(gdpr.number, 679);
  });

  test("reads it unspaced too", () => {
    const refs = extractEuActRefs("point 1a (31989 L 0665: Council Directive 89/665/EEC)");
    assert.ok(refs.some((r) => r.celex === "31989L0665"));
  });

  test("ignores the Committee's own decisions, which are sector 2", () => {
    // A JCD amending an earlier JCD must not read as incorporating an act.
    // "22018D1022" is Decision No 154/2018 as EUR-Lex numbers it.
    const refs = extractEuActRefs("as amended by 22018 D 1022 and by Decision No 154/2018");
    assert.equal(
      refs.some((r) => r.celex?.startsWith("2")),
      false
    );
  });
});

describe("the citation form", () => {
  test("reads a modern citation, year first", () => {
    const refs = extractEuActRefs("Regulation (EU) 2016/679 of the European Parliament");
    assert.deepEqual(refs, [{ letter: "R", year: 2016, number: 679, celex: null }]);
  });

  test("reads the old regulation form, number first", () => {
    const refs = extractEuActRefs("Council Regulation (EC) No 1/2003 on the implementation");
    assert.deepEqual(refs, [{ letter: "R", year: 2003, number: 1, celex: null }]);
  });

  test("reads a directive, which puts its treaty family at the end", () => {
    const refs = extractEuActRefs("Directive 2000/31/EC on certain legal aspects");
    assert.deepEqual(refs, [{ letter: "L", year: 2000, number: 31, celex: null }]);
  });

  test("expands the two-digit year the older directives are cited with", () => {
    // "Directive 95/46/EC" is the Data Protection Directive of 1995, and it is
    // named in the very decision that incorporated the GDPR.
    assert.deepEqual(extractEuActRefs("Directive 95/46/EC of the European Parliament"), [
      { letter: "L", year: 1995, number: 46, celex: null },
    ]);
    assert.deepEqual(extractEuActRefs("Council Directive 89/665/EEC on review procedures"), [
      { letter: "L", year: 1989, number: 665, celex: null },
    ]);
  });

  test("reads a citation that names the adopting body", () => {
    const refs = extractEuActRefs("Commission Implementing Regulation (EU) 2015/2447 laying down");
    assert.deepEqual(refs, [{ letter: "R", year: 2015, number: 2447, celex: null }]);
  });

  test("does not read an article reference as an act", () => {
    const refs = extractEuActRefs("in accordance with Article 98(1) of the Agreement");
    assert.deepEqual(refs, []);
  });
});

describe("the whole decision", () => {
  const decision = `DECISION OF THE EEA JOINT COMMITTEE No 154/2018 of 6 July 2018 amending
    Annex XI (Electronic communication, audiovisual services and information society) to the EEA
    Agreement. The following point shall be inserted after point 5e of Annex XI:
    '5f. 32016 R 0679: Regulation (EU) 2016/679 of the European Parliament and of the Council of
    27 April 2016 on the protection of natural persons (OJ L 119, 4.5.2016, p. 1).'
    Point 5e (Directive 95/46/EC of the European Parliament and of the Council) shall be deleted.`;

  test("finds every act it names, once each", () => {
    const refs = extractEuActRefs(decision);
    // The GDPR appears twice, as a CELEX and as a citation; it is one act.
    assert.equal(refs.filter((r) => r.year === 2016 && r.number === 679).length, 1);
    assert.ok(refs.some((r) => r.letter === "L" && r.year === 1995 && r.number === 46));
  });

  test("prefers the CELEX as the lookup key, and keeps the citation as a fallback", () => {
    const [withCelex] = extractEuActRefs("32016 R 0679: Regulation (EU) 2016/679");
    assert.deepEqual(refLookupKeys(withCelex), ["32016R0679", "R:2016:679"]);
    const [citationOnly] = extractEuActRefs("Directive 2000/31/EC");
    assert.deepEqual(refLookupKeys(citationOnly), ["L:2000:31"]);
  });

  test("reads the decision's own number off its title", () => {
    assert.equal(
      decisionNumberFromTitle("Decision of the EEA Joint Committee No 154/2018"),
      "154/2018"
    );
    assert.equal(decisionNumberFromTitle("Decision of the EEA Joint Committee No 7/94"), "7/94");
    assert.equal(decisionNumberFromTitle("A decision with no number"), null);
  });
});
