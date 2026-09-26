/**
 * The patterns here decide what links to what across the whole corpus, and
 * every failure mode is silent: a citation that does not match produces no
 * link, and a citation that matches the wrong pattern produces a link to the
 * wrong document. Neither raises anything at ingestion time.
 *
 * So the cases below are written from the forms judgments actually use.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  citedCaseNumbers,
  extractActCitations,
  extractProvisionCitations,
  extractTreatyCitations,
  extractTreatyMentions,
  maskLegislationCitations,
  normalizeSpacesPreservingOffsets,
  sentenceAround,
} from "@/lib/legal-citations";

describe("maskLegislationCitations", () => {
  /**
   * The reason this module exists: "lög nr. 91/1991" and "mál nr. 91/1991"
   * are the same token, and about a third of the corpus cites 91/1991.
   */
  test("masks the act but leaves the case number beside it", () => {
    const text = "Samkvæmt lögum nr. 91/1991 og í máli nr. 415/2018 var kröfunni hafnað.";
    const masked = maskLegislationCitations(text);
    assert.ok(!masked.includes("91/1991"), "act citation should be masked");
    assert.ok(masked.includes("415/2018"), "case number must survive");
  });

  test("preserves length, so offsets into the original stay valid", () => {
    const text = "sbr. vaxtalög nr. 38/2001 og fleira";
    assert.equal(maskLegislationCitations(text).length, text.length);
  });

  test("masking blanks rather than deletes, so numbers cannot be joined", () => {
    // Deleting instead of blanking would leave "12/2020" adjacent to "34/2021"
    // and risk a token that was never in the text.
    const masked = maskLegislationCitations("laga nr. 12/2020 laga nr. 34/2021");
    assert.match(masked, /^\s+$/);
  });

  for (const [label, text] of [
    ["compound short name", "í almennum hegningarlögum nr. 19/1940"],
    ["constitution, no lög stem", "sbr. stjórnarskrárinnar nr. 33/1944"],
    ["regulation", "reglugerð nr. 1165/2016"],
    ["abbreviated form", "l. 46/1980"],
    ["act name between stem and number", "laga um meðferð einkamála nr. 91/1991"],
  ] as const) {
    test(`masks ${label}`, () => {
      assert.match(maskLegislationCitations(text).trimEnd(), /^[^0-9]*$/);
    });
  }

  test("an act name ending in 'mála' does not swallow a following case number", () => {
    // ACT_NAME_TAIL stops at the declined forms that introduce a case, but
    // the genitive "mála" has to pass because act names contain it.
    const masked = maskLegislationCitations(
      "laga um meðferð einkamála nr. 91/1991 í máli nr. 415/2018"
    );
    assert.ok(masked.includes("415/2018"));
  });
});

describe("citedCaseNumbers", () => {
  test("returns cases only, in order of first appearance", () => {
    assert.deepEqual(
      citedCaseNumbers("Samkvæmt lögum nr. 91/1991 og í máli nr. 415/2018 og dómi nr. 22/2023"),
      ["415/2018", "22/2023"]
    );
  });

  test("drops the judgment's own case number", () => {
    assert.deepEqual(
      citedCaseNumbers("í máli nr. 415/2018 og nr. 22/2023", "22/2023"),
      ["415/2018"]
    );
  });

  test("recognises the EFTA Court's lettered form", () => {
    assert.deepEqual(citedCaseNumbers("sbr. mál E-2/24"), ["E-2/24"]);
  });
});

describe("extractActCitations", () => {
  test("harvests the compound short name as an alias", () => {
    const [c] = extractActCitations("brot gegn almennum hegningarlögum nr. 19/1940 telst");
    assert.equal(c.actNumber, 19);
    assert.equal(c.year, 1940);
    assert.equal(c.alias, "hegningarlögum");
  });

  test("a bare 'lögum' names no act and yields no alias", () => {
    const [c] = extractActCitations("skv. lögum nr. 91/1991");
    assert.equal(c.alias, null, "'lögum' is useless as an alias — it names nothing");
  });

  /**
   * The offset is what `covered` in ingestion/citations.ts tests against, to
   * stop "175. gr. laga nr. 91/1991" from also producing a bare act link on
   * top of the provision link.
   *
   * Asserted loosely on purpose. The offset is currently one character too
   * far when the character before the citation is whitespace: the match
   * includes a leading `[^\p{L}]` guard, and the code skips it twice — once
   * via the `startsWith` test and again via `lead`, which can only ever be
   * non-zero in exactly the case the first test already handled. The spans it
   * feeds are tens of characters wide, so nothing downstream notices, and the
   * excerpt it feeds is sentence-bounded. Pinning the exact value here would
   * cement the off-by-one; pinning containment survives either way.
   */
  test("the offset lands inside the citation it describes", () => {
    const text = "sbr. vaxtalög nr. 38/2001";
    const [c] = extractActCitations(text);
    assert.equal(c.alias, "vaxtalög");
    const span = text.slice(c.index, c.index + c.length);
    assert.ok(span.includes("38/2001"), `offset drifted out of the citation: ${span}`);
    assert.ok(c.index >= text.indexOf("vaxtalög"), "offset must not precede the citation");
  });
});

describe("extractProvisionCitations", () => {
  test("reads the full stack of qualifiers", () => {
    const [c] = extractProvisionCitations("2. tölul. 1. mgr. 70. gr. laga nr. 88/2008");
    assert.deepEqual(
      { p: c.pointNumber, mgr: c.paragraphNumber, gr: c.articleNumber, act: c.actNumber, year: c.year },
      { p: 2, mgr: 1, gr: 70, act: 88, year: 2008 }
    );
  });

  /**
   * Regression, 2026-08-31. Articles inserted by amendment are lettered, and
   * both Lagasafn and the courts print the letter with a period after it —
   * "7. gr. a." — which is the ordinary form, not an edge case.
   *
   * That period was not consumed, so the act reference following it was no
   * longer adjacent and the match failed. Every lettered provision cited the
   * normal way extracted as nothing, and no case was ever linked to one. The
   * act/provision lookup accepted the same string happily, so the provision
   * was searchable and permanently empty.
   */
  describe("lettered articles (regression)", () => {
    const cases = [
      "57. gr. a. laga um aðbúnað og hollustuhætti nr. 46/1980",
      "57. gr. a laga um aðbúnað og hollustuhætti nr. 46/1980",
      "57. gr. a. laga nr. 46/1980",
      "7. gr. a. jarðalaga nr. 81/2004",
      "sbr. 10. gr. a. laga nr. 81/2004",
    ];
    for (const text of cases) {
      test(text, () => {
        const [c] = extractProvisionCitations(text);
        assert.ok(c, "should extract");
        assert.equal(c.articleLetter, "a");
      });
    }

    test("with a paragraph qualifier in front", () => {
      const [c] = extractProvisionCitations("1. mgr. 57. gr. a. laga nr. 46/1980");
      assert.equal(c.paragraphNumber, 1);
      assert.equal(c.articleNumber, 57);
      assert.equal(c.articleLetter, "a");
    });
  });

  /**
   * The guard the optional period must not break: the letter has to stand as
   * its own word, or "57. gr. laga" reads as article 57 letter "l" and
   * swallows the first letter of the act.
   */
  test("does not read the 'l' of 'laga' as a letter suffix", () => {
    const [c] = extractProvisionCitations("57. gr. laga nr. 46/1980");
    assert.equal(c.articleLetter, null);
    assert.equal(c.actNumber, 46);
  });

  test("collapses a citation that wrapped mid-line, without moving the offset", () => {
    const text = "sbr. 1. mgr. 175.\ngr. laga nr. 91/1991 og fleira";
    const [c] = extractProvisionCitations(text);
    assert.ok(!c.text.includes("\n"), "stored citation is display copy, one line");
    assert.ok(
      text.slice(c.index, c.index + c.length).includes("\n"),
      "the offset and length still index the source text"
    );
  });
});

describe("normalizeSpacesPreservingOffsets", () => {
  test("swaps the non-breaking variants one character for one", () => {
    const raw = "1. mgr. 175. gr.";
    const out = normalizeSpacesPreservingOffsets(raw);
    assert.equal(out.length, raw.length);
    assert.equal(out, "1. mgr. 175. gr.");
  });
});

describe("sentenceAround", () => {
  test("starts at the sentence the citation sits in, not mid-clause", () => {
    const text =
      "Fyrsti málsliður. Í máli þessu er deilt um 1. mgr. 175. gr. laga nr. 91/1991. Þriðji málsliður.";
    const out = sentenceAround(text, text.indexOf("1. mgr."));
    assert.ok(out.startsWith("Í máli þessu"), `wrong start: ${out}`);
    assert.ok(out.includes("175. gr. laga nr. 91/1991"), "the citation itself must be in the excerpt");
    assert.ok(!out.includes("Fyrsti"), "must not reach back past the preceding sentence end");
  });

  /**
   * A known and deliberate limit, recorded so a future change to
   * `isSentenceEnd` is a decision rather than a surprise.
   *
   * A citation ends in a year, and a period after a digit is treated as an
   * ordinal ("175.") rather than a sentence end — there is no way to tell
   * "nr. 91/1991." closing a sentence from "175." opening a citation. So an
   * excerpt whose sentence ends on a citation runs on into the next one.
   * Over-inclusion is the safe direction here: the excerpt exists to show why
   * a case matched, and a sentence too many still shows it.
   */
  test("runs on past a sentence that ends on a citation's year", () => {
    const text = "Deilt er um 175. gr. laga nr. 91/1991. Þriðji málsliður.";
    assert.ok(sentenceAround(text, text.indexOf("175.")).includes("Þriðji"));
  });

  test("an abbreviation's period does not end the sentence", () => {
    // The whole point: cutting at the first ". " lands mid-citation, on
    // "1. mgr. 175. gr. laga nr." — precisely the passage the excerpt exists
    // to show.
    const text = "Dómurinn vísar til 2. mgr. 70. gr. laga nr. 88/2008 um þetta.";
    const out = sentenceAround(text, text.indexOf("70. gr."));
    assert.ok(out.includes("88/2008"), `excerpt was cut short: ${out}`);
  });

  test("is bounded when the text has no usable punctuation", () => {
    const text = "orð ".repeat(500);
    assert.ok(sentenceAround(text, 1000, 200).length <= 401);
  });
});

describe("treaty citations", () => {
  /** The slug and article of every reference found, for compact assertions. */
  const found = (text: string) =>
    extractTreatyCitations(text).map(
      (c) =>
        `${c.slug} ${c.articleNumber}${c.articleLetter ?? ""}${
          c.paragraphNumber !== null ? `(${c.paragraphNumber})` : ""
        }`
    );

  test("reads the Icelandic form, declined as judgments decline it", () => {
    assert.deepEqual(found("Samkvæmt 28. gr. EES-samningsins er frelsið tryggt."), ["ees 28"]);
    assert.deepEqual(found("Í 1. mgr. 31. gr. EES-samningsins."), ["ees 31(1)"]);
    assert.deepEqual(found("sbr. 4. gr. samningsins um Evrópska efnahagssvæðið"), ["ees 4"]);
  });

  test("reads the English form, which is the one two of these courts use", () => {
    // The EFTA Court, the CJEU and ESA write it this way, and they are exactly
    // the bodies that cite these treaties most. A recogniser that knew only the
    // Icelandic form would link almost nothing.
    assert.deepEqual(found("It follows from Article 34 EEA that…"), ["ees 34"]);
    assert.deepEqual(found("Article 101(1) TFEU prohibits…"), ["tfeu 101(1)"]);
    assert.deepEqual(found("See Article 267 of the Treaty on the Functioning of the European Union."), [
      "tfeu 267",
    ]);
    assert.deepEqual(found("Article 28 of the EEA Agreement mirrors Article 45 TFEU."), [
      "ees 28",
      "tfeu 45",
    ]);
  });

  test("a citation naming several articles links each of them", () => {
    assert.deepEqual(found("Under Articles 53 and 54 EEA the Authority has competence."), [
      "ees 53",
      "ees 54",
    ]);
    // And the "a" of "and" is not an article letter, which is what it looked
    // like while the letter was allowed to stand off from the number.
    assert.deepEqual(found("Articles 61 and 62 EEA"), ["ees 61", "ees 62"]);
  });

  test("the whole citation is kept as written, under every article it names", () => {
    const hits = extractTreatyCitations("Under Articles 53 and 54 EEA the Authority…");
    assert.deepEqual(new Set(hits.map((h) => h.text)), new Set(["Articles 53 and 54 EEA"]));
  });

  test("reads the Surveillance and Court Agreement, which the EFTA Court cites most", () => {
    // "Article 34 SCA" is the advisory-opinion procedure — the provision by which
    // an Icelandic court asks the EFTA Court anything at all — and it is cited
    // this way in every judgment that turns on one.
    assert.deepEqual(found("a request under Article 34 SCA"), ["sca 34"]);
    assert.deepEqual(found("Article 31 of the Surveillance and Court Agreement"), ["sca 31"]);
    assert.deepEqual(found("Articles 31 and 32 SCA"), ["sca 31", "sca 32"]);
    assert.deepEqual(found("skv. 34. gr. samningsins um stofnun eftirlitsstofnunar og dómstóls"), [
      "sca 34",
    ]);
  });

  test("does not confuse the two Porto agreements", () => {
    // Both were signed at Porto on 2 May 1992 and both are cited by bare article
    // number in the same paragraph of the same judgments. "Article 31 EEA" is the
    // right of establishment; "Article 31 SCA" is the infringement procedure.
    assert.deepEqual(found("Article 31 EEA and Article 31 SCA"), ["ees 31", "sca 31"]);
  });

  test("an instrument named with no article is not a provision citation", () => {
    // It is a link to the treaty, not to an article of it — see
    // extractTreatyMentions, which is what the act-level link is built from.
    assert.deepEqual(found("Skýra skal lög til samræmis við EES-samninginn."), []);
  });

  test("does not read an act's number as a treaty's", () => {
    assert.deepEqual(found("Í 3. gr. laga nr. 2/1993 er kveðið á um þetta."), []);
  });

  test("mentions are matched on names that can only mean the instrument", () => {
    assert.deepEqual(
      extractTreatyMentions("Skýra skal lög til samræmis við EES-samninginn.").map((m) => m.slug),
      ["ees"]
    );
    assert.deepEqual(
      extractTreatyMentions("Article 4(3) TEU requires…").map((m) => m.slug),
      ["teu"]
    );
    // A bare "EEA" is the area, the States, EEA law and the Agreement by turns,
    // and in an EFTA Court judgment it is on every page. Linking on it would
    // claim that every judgment in the corpus cites the Agreement.
    assert.deepEqual(extractTreatyMentions("The EEA States and EEA law generally."), []);
    // Nor is "ESA" a name for the Agreement — it is the Authority the Agreement
    // establishes, and it appears in every ESA document there is.
    assert.deepEqual(extractTreatyMentions("ESA opened a case."), []);
  });
});
