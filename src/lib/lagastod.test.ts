/**
 * The lagastoð extractor, against the clauses Icelandic regulations actually
 * write.
 *
 * Every sentence asserted here was taken verbatim from a regulation in the
 * register — the file names are in the comments — because the forms are the
 * point. Measured over 84 regulations on 2026-09-15, this finds a stated basis
 * in 83 of them.
 *
 * The bias is deliberate and stated in the module header: a missed lagastoð is
 * a regulation showing no enabling act, while a false one asserts that an act
 * authorises something it does not. So the precision cases below — the
 * cross-references and the tariff clause that must *not* match — are the ones
 * to keep passing.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extractLagastod, articlesInRun } from "@/lib/lagastod";
import { parseRegulationBody } from "@/lib/reglugerd";
import { parseRegulationRecord } from "@/ingestion/adapters/reglugerd";

/** The numbers a clause yields, as "60/2007 [7,15a,15b,20]". */
function summarise(text: string): string[] {
  return extractLagastod(text).map(
    (c) => `${c.actNumber}/${c.year} [${c.articles.map((a) => a.number + (a.letter ?? "")).join(",")}]`
  );
}

describe("the forms a lagastoð clause takes", () => {
  test("the enumerated list that the general extractor cannot read", () => {
    // reglugerð nr. 300/2020. Only "20. gr." is adjacent to the act, so
    // extractProvisionCitations finds one article of four.
    assert.deepEqual(
      summarise(
        "Reglugerð þessi, sem sett er samkvæmt 7., 15. gr. a, 15. gr. b og 20. gr. " +
          "laga nr. 60/2007 um Vatnajökulsþjóðgarð, öðlast þegar gildi."
      ),
      ["60/2007 [7,15a,15b,20]"]
    );
  });

  test("a single article, with the act's name before its number", () => {
    // reglugerð nr. 44/2019.
    assert.deepEqual(
      summarise(
        "Reglugerð þessi er sett með heimild í 122. gr. laga um opinber innkaup nr. 120/2016 og öðlast þegar gildi."
      ),
      ["120/2016 [122]"]
    );
  });

  test("and with the name after it", () => {
    // reglugerð nr. 274/2006.
    assert.deepEqual(
      summarise(
        "Reglugerð þessi er sett með stoð í 4. mgr. 4. gr. laga nr. 87/2004, um olíugjald og kílómetragjald."
      ),
      ["87/2004 [4]"]
    );
  });

  test("the act alone, which is a complete basis and not a failed parse", () => {
    // reglugerð nr. 269/2006.
    assert.deepEqual(
      summarise(
        "Reglugerð þessi er sett með heimild í lögum nr. 100/1992 um vog, mál og faggildingu og öðlast þegar gildi."
      ),
      ["100/1992 []"]
    );
  });

  test("two acts in one sentence, each keeping its own article", () => {
    // reglugerð nr. 275/2006. Article 4 belongs to the harbours act and
    // article 17 to the maritime security act; giving both to whichever came
    // last would be two wrong statements rather than one.
    assert.deepEqual(
      summarise(
        "Reglugerð þessi, sem sett er samkvæmt 4. gr. hafnalaga nr. 61/2003 og 17. gr. " +
          "laga nr. 41/2003 um siglingavernd, staðfestist hér með."
      ),
      ["61/2003 [4]", "41/2003 [17]"]
    );
  });

  test("the pre-1990 form, where an act is named by number and date", () => {
    // reglugerð nr. 347/2007. Nine of the twelve clauses missed in the first
    // measurement were this form; the year of the date is the act's year.
    assert.deepEqual(
      summarise(
        "Reglugerð þessi sem sett er samkvæmt heimild í 80. gr. laga nr. 49 17. maí 2005 " +
          "um fullnustu refsinga öðlast þegar gildi."
      ),
      ["49/2005 [80]"]
    );
    // reglugerð nr. 590/2005 — the same form with "frá" and two articles.
    assert.deepEqual(
      summarise(
        "Reglugerð þessi, sem sett er samkvæmt 2. mgr. 22. gr. og 2. mgr. 44. gr. " +
          "laga um miðlun vátrygginga, nr. 32 frá 11. maí 2005, öðlast þegar gildi."
      ),
      ["32/2005 [22,44]"]
    );
  });

  test("a municipal byelaw, which is confirmed rather than set", () => {
    // reglugerð nr. 309/1985. The subject runs to sixty characters before the
    // verb arrives, and the verb is "staðfestist".
    assert.deepEqual(
      summarise(
        "Reglugerð þessi, sem samin er og samþykkt af hreppsnefnd Tálknafjarðarhrepps, " +
          "staðfestist hér með samkvæmt vatnalögum nr. 15 20. júní 1923 til að öðlast gildi þegar í stað."
      ),
      ["15/1923 []"]
    );
  });

  test("a lettered article does not end the sentence before its act", () => {
    // reglugerð nr. 499/2024. "59. gr. a." is a period followed by a space
    // after a single letter; reading it as a sentence end cut the clause off
    // from the act it names, losing the citation entirely.
    assert.deepEqual(
      summarise(
        "Reglugerð þessi er sett með heimild í 59. gr. a. kosningalaga nr. 112/2021 og tekur þegar gildi."
      ),
      ["112/2021 [59a]"]
    );
  });

  test("ten articles with letters, as the labour-safety regulations write them", () => {
    // reglugerð nr. 920/2006.
    assert.deepEqual(
      summarise(
        "Reglugerð þessi er sett samkvæmt heimild í 7., 17., 38., 39., 40. og 65. gr., " +
          "65. gr. a, 66. gr., 66. gr. a og 67. gr. laga nr. 46/1980 um aðbúnað, hollustuhætti og öryggi á vinnustöðum."
      ),
      ["46/1980 [7,17,38,39,40,65,65a,66,66a,67]"]
    );
  });
});

describe("what must not be read as a lagastoð", () => {
  test("an ordinary cross-reference inside the regulation's body", () => {
    // reglugerð nr. 50/2019. Says "settar" and cites an act; it is a
    // requirement being described, not this regulation's basis.
    assert.deepEqual(
      summarise(
        "Eftirlitið skal, þegar það metur að hvaða marki endurbótaáætlunin fullnægir kröfunum " +
          "sem settar eru fram í 2. tölul. 1. mgr. 82. gr. b laga um fjármálafyrirtæki, nr. 161/2002, taka eftirfarandi til athugunar."
      ),
      []
    );
  });

  test("a basis stated for something other than this regulation", () => {
    // reglugerð nr. 297/2006. A tariff is set under an act; the regulation is
    // not. The subject is what tells them apart.
    assert.deepEqual(
      summarise(
        "Gjaldskrár fyrir dreifiveitu rafmagns skal sett samkvæmt 17. gr. raforkulaga nr. 65/2003."
      ),
      []
    );
  });

  test("a bare sbr. citation", () => {
    // reglugerð nr. 294/2007.
    assert.deepEqual(
      summarise(
        "Ríkisskattstjóri veitir heimild til slíkra frávika, sbr. 47. gr. laga nr. 90/2003, um tekjuskatt."
      ),
      []
    );
  });
});

describe("articlesInRun", () => {
  test("an enumeration shares the trailing gr.", () => {
    assert.deepEqual(
      articlesInRun("samkvæmt 7., 15. gr. a, 15. gr. b og 20. gr. ").map((a) => a.number + (a.letter ?? "")),
      ["7", "15a", "15b", "20"]
    );
  });

  test("an enumerated paragraph qualifier contributes no article", () => {
    // reglugerð nr. 872/2006: "3. og 4. mgr. 99. gr." is article 99 and
    // nothing else. Blanking only the qualifier adjacent to "mgr." left a
    // phantom article 3 hanging off the act.
    assert.deepEqual(
      articlesInRun("með heimild í 3. og 4. mgr. 99. gr. og 3. og 4. mgr. 104. gr. ").map((a) => a.number),
      [99, 104]
    );
    // reglugerð nr. 1025/2008.
    assert.deepEqual(
      articlesInRun("er með stoð í 12. og 13. mgr. 32. gr. ").map((a) => a.number),
      [32]
    );
  });

  test("stacked qualifiers are all stripped", () => {
    // reglugerð nr. 294/2007: "3. málsl. 9. mgr. 3. gr. og 7. gr.".
    assert.deepEqual(
      articlesInRun("með stoð í 3. málsl. 9. mgr. 3. gr. og 7. gr. ").map((a) => a.number),
      [3, 7]
    );
  });

  test("a run with no gr. yields nothing, whatever numbers it holds", () => {
    // Without this the year in "frá 11. maí 2005" would read as article 11.
    assert.deepEqual(articlesInRun("með heimild í lögum "), []);
    assert.deepEqual(articlesInRun("sem sett var árið 2005 "), []);
  });

  test("a temporary provision is named by roman numeral and yields no article", () => {
    // reglugerð nr. 376/2022. "mgr." must not be read as containing "gr.".
    assert.deepEqual(
      articlesInRun("með heimild í 7. mgr. ákvæðis til bráðabirgða nr. XLV við "),
      []
    );
  });
});

describe("against the frozen regulation fixtures", () => {
  const FIXTURES = join(process.cwd(), "src/lib/__fixtures__/reglugerd");
  const record = parseRegulationRecord(
    JSON.parse(gunzipSync(readFileSync(join(FIXTURES, "api-0300-2020.json.gz"))).toString("utf8"))
  )!;
  const parsed = parseRegulationBody(record.text!, record.title);
  const text = parsed.provisions.map((p) => p.fullText).join("\n\n");

  test("finds the basis in the regulation as it is actually stored", () => {
    // The end-to-end shape: the text the adapter scans is the provisions it
    // saved, joined the way the reader shows them.
    const found = extractLagastod(text);
    assert.equal(found.length, 1);
    assert.equal(found[0].actNumber, 60);
    assert.equal(found[0].year, 2007);
    assert.deepEqual(
      found[0].articles.map((a) => a.number + (a.letter ?? "")),
      ["7", "15a", "15b", "20"]
    );
  });

  test("the stored citation pairs the right articles with the right act", () => {
    const [found] = extractLagastod(text);
    assert.match(found.citationText, /^7\., 15\. gr\. a, 15\. gr\. b, 20\. gr\. laga nr\. 60\/2007/);
  });

  test("the excerpt is the sentence, not a fragment of it", () => {
    const [found] = extractLagastod(text);
    assert.match(found.excerpt, /Reglugerð þessi/);
    assert.match(found.excerpt, /60\/2007/);
  });
});
