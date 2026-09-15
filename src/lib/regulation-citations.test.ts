/**
 * Regulation citations in judgment text, and the four tests that keep EU
 * regulations out of the Icelandic register.
 *
 * Every string asserted here was taken from a judgment in the live archive.
 * The measurement behind the rules is in the module header of
 * src/lib/legal-citations.ts: 2,802 regulation citations across 167 judgments,
 * sampled 2026-09-15.
 *
 * The bias, as everywhere in this file's neighbourhood, is against the false
 * link. A missed regulation citation is a judgment that does not appear under
 * an article; a false one puts a judgment about EU pharmaceutical law under an
 * Icelandic regulation on something else entirely, and the reader has no way
 * to tell.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { extractRegulationCitations } from "@/lib/legal-citations";

/** "830/2011 29/2" — number, year, and the article and paragraph if named. */
function summarise(text: string): string[] {
  return extractRegulationCitations(text).map((c) => {
    const article =
      c.articleNumber === null
        ? ""
        : ` ${c.articleNumber}${c.articleLetter ?? ""}${c.paragraphNumber ? `/${c.paragraphNumber}` : ""}`;
    return `${c.regulationNumber}/${c.year}${article}`;
  });
}

describe("the forms judgments use", () => {
  test("a bare regulation reference", () => {
    assert.deepEqual(
      summarise("Taldi hann að ökuréttarsvipting yrði ekki byggð á reglugerð nr. 280/1998."),
      ["280/1998"]
    );
  });

  test("declined and compounded stems", () => {
    // "reglugerðar", "reglugerðum", "byggingarreglugerð" — and the misspelling
    // "byggingareglugerðum", which judgments write often enough to matter.
    assert.deepEqual(summarise("í samræmi við ákvæði viðauka I reglugerðar nr. 280/1998"), ["280/1998"]);
    assert.deepEqual(summarise("byggðust á reglugerðum nr. 233/2011"), ["233/2011"]);
    assert.deepEqual(summarise("núgildandi byggingarreglugerð nr. 112/2012"), ["112/2012"]);
    assert.deepEqual(summarise("er byggt á byggingareglugerðum nr. 441/1998"), ["441/1998"]);
    assert.deepEqual(summarise("Með reglugerð nr. 233/2011 og breytingareglugerð nr. 341/2011"), [
      "233/2011",
      "341/2011",
    ]);
  });

  test("an article, with its paragraph", () => {
    assert.deepEqual(summarise("sbr. 2. mgr. 29. gr. reglugerðar nr. 830/2011"), ["830/2011 29/2"]);
    assert.deepEqual(summarise("Í 13. gr. reglugerðar nr. 1009/2015 segir"), ["1009/2015 13"]);
    assert.deepEqual(summarise("sbr. 1. mgr. 7. gr. reglugerðar 1009/2015"), ["1009/2015 7/1"]);
  });

  test("the number written without nr., and with a stray space", () => {
    // "reglugerð 374/2017" and "reglugerð nr. 283/ 2009" both occur.
    assert.deepEqual(summarise("þegar reglugerð 374/2017 tók gildi"), ["374/2017"]);
    assert.deepEqual(summarise("Með heimild í reglugerð nr. 283/ 2009"), ["283/2009"]);
  });

  test("the regulation's name between the stem and the number", () => {
    assert.deepEqual(summarise("samkvæmt reglugerð um Jöfnunarsjóð sveitarfélaga nr. 960/2010"), [
      "960/2010",
    ]);
  });

  test("an article belonging to an act is not attached to a regulation", () => {
    // "3. gr." here belongs to the act; the regulation that follows names no
    // article of its own.
    assert.deepEqual(summarise("sbr. 3. gr. laga nr. 7/1998 og reglugerð nr. 100/2000"), ["100/2000"]);
  });

  test("a second stem does not widen the citation span", () => {
    // "Samhliða framangreindri reglugerð var sett reglugerð nr. 1016/2005"
    // matched from the first word, so the stored span covered text belonging
    // to neither citation.
    const [c] = extractRegulationCitations(
      "Samhliða framangreindri reglugerð var sett reglugerð nr. 1016/2005 um vaxtaáhættu."
    );
    assert.equal(c.regulationNumber, 1016);
    assert.equal(c.text, "reglugerð nr. 1016/2005");
  });
});

describe("EU regulations, which must never resolve to the Icelandic register", () => {
  test("a marker beside the citation", () => {
    for (const marked of [
      "reglugerð Evrópuþingsins og ráðsins (EB) nr. 1901/2006",
      "reglugerð framkvæmdastjórnarinnar (ESB) nr. 1165/2016",
      "reglugerð ráðsins (EBE) nr. 1768/1992",
      "reglugerð Evrópusambandsins nr. 2024/2642",
    ]) {
      assert.deepEqual(summarise(marked), [], marked);
    }
  });

  test("a two-digit year, which Icelandic citations never write", () => {
    assert.deepEqual(summarise("Reglugerð 1768/92 kom í stað eldri reglna."), []);
  });

  test("year first, the modern EU order", () => {
    assert.deepEqual(summarise("reglugerð nr. 2016/679 um persónuvernd"), []);
  });

  test("marked once, then cited bare forty times", () => {
    // The rule that matters. A judgment introduces the instrument with its
    // marker and then drops it; a per-citation test sees only the bare form.
    const judgment =
      "Um þetta gildir reglugerð Evrópuþingsins og ráðsins (EB) nr. 1901/2006. " +
      "Stefnda hélt því fram að reglugerð 1901/2006 ætti ekki við. " +
      "Hvorki reglugerð nr. 1901/2006 né eldri reglur breyta því.";
    assert.deepEqual(summarise(judgment), []);
  });

  test("the marked and unmarked spellings of one instrument are the same instrument", () => {
    // "1768/92" where it carries its marker, "1768/1992" a page later where it
    // does not. Keying the suppression on the text as written left the second
    // form linking — and it is the one form that passes every other test.
    const judgment =
      "Dómurinn vísaði til reglugerðar ráðsins (EBE) nr. 1768/92 um vottorð. " +
      "Þá byggir stefnandi á því að ákvæði reglugerðar nr. 1768/1992 sé túlkað til samræmis.";
    assert.deepEqual(summarise(judgment), []);
  });

  test("suppression is keyed to the instrument, not to the document", () => {
    // A judgment may discuss an EU regulation and cite an Icelandic one. Only
    // the EU one is declined; vetoing on "this document mentions the EU" would
    // have suppressed 1,634 citations in the sample, most of them Icelandic.
    const judgment =
      "Reglugerð Evrópuþingsins og ráðsins (EB) nr. 1901/2006 gildir um lyf. " +
      "Hér á landi gildir hins vegar reglugerð nr. 1009/2015 um einelti á vinnustöðum.";
    assert.deepEqual(summarise(judgment), ["1009/2015"]);
  });
});

describe("what is not a citation at all", () => {
  test("a year outside living memory is a typo, not an instrument", () => {
    // "Skv. reglugerð nr. 1160/1014" — a real judgment, meaning 1160/2014.
    assert.deepEqual(summarise("Skv. reglugerð nr. 1160/1014, með breytingu"), []);
  });

  test("an act is not a regulation", () => {
    assert.deepEqual(summarise("sbr. 130. gr. laga nr. 91/1991"), []);
  });

  test("a case number is not a regulation", () => {
    assert.deepEqual(summarise("í máli nr. 415/2018"), []);
  });
});

describe("offsets and stored text", () => {
  const text = "Um þetta er fjallað í 2. mgr. 29. gr. reglugerðar nr. 830/2011 sem tók gildi 2011.";
  const [c] = extractRegulationCitations(text);

  test("the offset indexes the caller's own text", () => {
    assert.equal(text.slice(c.index, c.index + c.length), "2. mgr. 29. gr. reglugerðar nr. 830/2011");
  });

  test("the stored citation is the citation, collapsed to one line", () => {
    assert.equal(c.text, "2. mgr. 29. gr. reglugerðar nr. 830/2011");
  });

  test("a citation broken across a line break still reads as one line", () => {
    const [wrapped] = extractRegulationCitations("sbr. 29. gr.\n   reglugerðar nr. 830/2011");
    assert.equal(wrapped.text, "29. gr. reglugerðar nr. 830/2011");
  });
});
