/**
 * The rule that decides whether an act heads the search results.
 *
 * The cases here are the ones that matter in use: a citation typed the way a
 * lawyer writes it must find the act, and a keyword search about a subject
 * must *not* be headed by whatever act title happens to share letters with it.
 * The second half is the point — the forgiving lookup behind the type-ahead is
 * right for a list someone picks from and wrong for an answer.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { actMatchQuality, rankActMatches, isStrongActMatch } from "@/lib/act-match";

const vaxtalog = {
  title: "Lög um vexti og verðtryggingu",
  citation: "lög nr. 38/2001",
  actNumber: 38,
  year: 2001,
  aliases: ["vaxtalög", "vaxtalaga"],
};

const gdpr = {
  title: "on the protection of natural persons with regard to the processing of personal data",
  citation: "Regulation (EU) 2016/679",
  actNumber: 679,
  year: 2016,
  aliases: ["gdpr", "personal data", "personal data protection"],
  celex: "32016R0679",
  naturalNumber: 679,
};

const ecb = {
  title: "laying down the rules on procurement",
  citation: "Decision (EU) 2016/245",
  // CELEX 32016D0002 is cited "2016/245": the two numbers differ.
  actNumber: 2,
  year: 2016,
  aliases: [],
  celex: "32016D0002",
  naturalNumber: 245,
};

describe("by number", () => {
  test("the Icelandic form, number first", () => {
    assert.equal(actMatchQuality("38/2001", vaxtalog), "number");
    assert.equal(actMatchQuality("lög nr. 38/2001", vaxtalog), "number");
  });

  test("the modern EU form, year first", () => {
    assert.equal(actMatchQuality("2016/679", gdpr), "number");
    assert.equal(actMatchQuality("Regulation (EU) 2016/679", gdpr), "number");
  });

  test("the number an act is cited by, not the one in its CELEX", () => {
    // Searching "2016/245" must find the decision cited that way, even though
    // its CELEX sequence number is 2.
    assert.equal(actMatchQuality("2016/245", ecb), "number");
    assert.equal(actMatchQuality("32016D0002", ecb), "number");
  });

  test("a number that belongs to another act is not a match", () => {
    assert.equal(actMatchQuality("91/1991", vaxtalog), "weak");
    assert.equal(actMatchQuality("2016/680", gdpr), "weak");
  });
});

describe("by short name", () => {
  test("finds the act cited by a name its title does not contain", () => {
    // The whole reason Act.aliases exists: 38/2001 is universally "vaxtalög"
    // and the word appears nowhere in "Lög um vexti og verðtryggingu".
    assert.equal(actMatchQuality("vaxtalög", vaxtalog), "alias");
    assert.equal(actMatchQuality("gdpr", gdpr), "alias");
  });

  test("finds it inside a longer query", () => {
    assert.equal(actMatchQuality("gdpr reglugerðin", gdpr), "alias");
  });

  test("ignores an alias too short to be a name", () => {
    assert.equal(actMatchQuality("ee", { ...vaxtalog, aliases: ["ee"] }), "weak");
  });
});

describe("by title", () => {
  test("matches when the query's words are in the title", () => {
    assert.equal(actMatchQuality("lög um vexti", vaxtalog), "title");
    assert.equal(actMatchQuality("vexti og verðtryggingu", vaxtalog), "title");
  });

  test("does not match on an overlap of a word or two", () => {
    // This is the case the whole module exists for. "gæsluvarðhald" is a
    // subject someone searches for, and the answer is judgments, not an act
    // whose title shares a few letters with it.
    assert.equal(actMatchQuality("gæsluvarðhald", vaxtalog), "weak");
    assert.equal(actMatchQuality("sönnun um orsakatengsl", vaxtalog), "weak");
  });

  test("does not match on a scrap of a word", () => {
    assert.equal(actMatchQuality("um", vaxtalog), "weak");
    assert.equal(actMatchQuality("ve", vaxtalog), "weak");
  });
});

describe("ranking a set of hits", () => {
  test("drops the weak ones and puts the strongest first", () => {
    const hits = rankActMatches("vaxtalög", [gdpr, vaxtalog]);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].act.citation, "lög nr. 38/2001");
    assert.equal(hits[0].quality, "alias");
  });

  test("a number beats a title match", () => {
    const other = {
      title: "Lög um breytingu á lögum nr. 38/2001",
      citation: "lög nr. 14/2010",
      actNumber: 14,
      year: 2010,
      aliases: [],
    };
    // Both mention 38/2001 — one *is* it, the other only names it.
    const hits = rankActMatches("38/2001", [other, vaxtalog]);
    assert.deepEqual(
      hits.map((h) => h.quality),
      ["number", "title"]
    );
    assert.equal(hits[0].act.citation, "lög nr. 38/2001");
  });

  test("returns nothing for a subject search", () => {
    assert.deepEqual(rankActMatches("gæsluvarðhald", [vaxtalog, gdpr]), []);
  });

  test("isStrongActMatch is the gate the ranking applies", () => {
    assert.equal(isStrongActMatch("number"), true);
    assert.equal(isStrongActMatch("title"), true);
    assert.equal(isStrongActMatch("weak"), false);
  });
});
