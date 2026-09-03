/**
 * The EUR-Lex parser, against three real acts frozen from Cellar — one per
 * layout it has to read. See `src/lib/__fixtures__/README.md` for why the
 * fixtures are real responses and how to add another.
 *
 * As with the Lagasafn tests, the assertions are structural rather than
 * exact. The EU amends these acts; a test pinning `provisions.length === 99`
 * fails on the next amendment, which trains everyone to ignore it. What must
 * not change is the shape the parser recovers — articles found at all,
 * numbered paragraphs kept apart, chapters holding their articles — and that
 * breaks only when the markup does, which is what a fixture is for.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseEuActHtml,
  parseCelex,
  euCitation,
  euActPath,
  euSubjectTitle,
  cellarTextUrl,
  parseArticleLabel,
  type ParsedEuAct,
} from "@/lib/eur-lex";

const FIXTURES = join(process.cwd(), "src/lib/__fixtures__/eur-lex");

function fixture(name: string): ParsedEuAct {
  return parseEuActHtml(gunzipSync(readFileSync(join(FIXTURES, name))).toString("utf8"));
}

describe("CELEX numbers", () => {
  test("reads sector, year, type and sequence", () => {
    const celex = parseCelex("32016R0679");
    assert.equal(celex?.year, 2016);
    assert.equal(celex?.letter, "R");
    assert.equal(celex?.docType, "regulation");
    assert.equal(celex?.number, 679);
    assert.equal(celex?.consolidated, false);
  });

  test("recognises a consolidated version", () => {
    const celex = parseCelex("02016R0679-20160504");
    assert.equal(celex?.consolidated, true);
    assert.equal(celex?.number, 679);
  });

  test("rejects everything that is not a plain act", () => {
    // Corrigenda, other sectors and the suffixed forms are not acts of this
    // library, and their CELEX is not a unique identity of one.
    //
    // "22018D1022" is the real one to watch: sector 2, and it is Decision of
    // the EEA Joint Committee No 154/2018, which this app already holds as a
    // document ingested from efta.int. Accepting it here would store the same
    // decision twice, as a document and as an act. The catalogue sweep asks
    // Cellar for sector 3 only; this is the second guard on the same rule.
    for (const raw of ["32016R0679R(01)", "62016CJ0203", "22018D1022", "3201R0679", ""]) {
      assert.equal(parseCelex(raw), null, raw);
    }
  });

  test("addresses the act by CELEX, in the app and at Cellar", () => {
    assert.equal(euActPath("32016R0679"), "/log/32016R0679");
    assert.match(cellarTextUrl("32016R0679"), /publications\.europa\.eu\/resource\/celex\/32016R0679$/);
  });
});

describe("citations", () => {
  const cite = (title: string, celex: string, natural: number | null = null) =>
    euCitation(title, parseCelex(celex)!, natural);

  test("takes the citation off the front of the act's own title", () => {
    assert.equal(
      cite(
        "Regulation (EU) 2016/679 of the European Parliament and of the Council of 27 April 2016 on the protection of natural persons",
        "32016R0679"
      ),
      "Regulation (EU) 2016/679"
    );
  });

  test("keeps both numbering conventions as they are written", () => {
    // The number comes first in the old regulation form and the year first in
    // the directive and modern forms; composing either from the other is
    // wrong, which is why the title is read rather than the numbers.
    assert.equal(
      cite("Council Regulation (EC) No 1/2003 of 16 December 2002 on the implementation", "32003R0001"),
      "Council Regulation (EC) No 1/2003"
    );
    assert.equal(
      cite("Directive 2000/31/EC of the European Parliament and of the Council of 8 June 2000 on certain", "32000L0031"),
      "Directive 2000/31/EC"
    );
  });

  test("drops the adopting body that trails the number", () => {
    assert.equal(
      cite("Decision (EU) 2016/245 of the European Central Bank of 9 February 2016 laying down", "32016D0002", 245),
      "Decision (EU) 2016/245"
    );
  });

  test("falls back to the cited number, not the CELEX one, when the title has no date", () => {
    // CELEX 32016D0002 is cited "2016/245": composing from the CELEX sequence
    // number would print a citation no reader could look up.
    assert.equal(cite("Decision of the European Central Bank", "32016D0002", 245), "Decision 2016/245");
  });
});

describe("the display title", () => {
  test("drops the citation and the date the official title opens with", () => {
    assert.equal(
      euSubjectTitle(
        "Regulation (EU) 2016/679 of the European Parliament and of the Council of 27 April 2016 " +
          "on the protection of natural persons (General Data Protection Regulation) (Text with EEA relevance)"
      ),
      "on the protection of natural persons (General Data Protection Regulation)"
    );
  });

  test("keeps a title it cannot find a citation in", () => {
    assert.equal(euSubjectTitle("Rules of Procedure of the Court"), "Rules of Procedure of the Court");
  });

  test("never returns nothing", () => {
    // A title that is only its citation and date has no subject to show, and
    // an empty heading is worse than a repeated citation.
    const bare = "Decision (EU) 2016/245 of 9 February 2016";
    assert.equal(euSubjectTitle(bare), bare);
  });
});

describe("article labels", () => {
  test("reads the number and the letter of an inserted article", () => {
    assert.deepEqual(parseArticleLabel("Article 7"), { articleNumber: 7, articleLetter: null });
    assert.deepEqual(parseArticleLabel("Article 7a"), { articleNumber: 7, articleLetter: "a" });
  });
});

describe("the consolidated layout (GDPR, 02016R0679-20160504)", () => {
  const act = fixture("02016R0679-20160504.html.gz");

  test("is recognised as the consolidated layout", () => {
    assert.equal(act.layout, "consolidated");
  });

  test("finds the articles, with their headings", () => {
    const articles = act.provisions.filter((p) => p.kind === "article");
    assert.ok(articles.length > 90, `expected the GDPR's articles, got ${articles.length}`);
    const first = articles[0];
    assert.equal(first.displayLabel, "Article 1");
    assert.equal(first.articleNumber, 1);
    assert.equal(first.heading, "Subject-matter and objectives");
    assert.ok(first.fullText.includes("lays down rules"));
  });

  test("keeps the numbered paragraphs apart, with the number attached", () => {
    const article6 = act.provisions.find((p) => p.displayLabel === "Article 6");
    assert.ok(article6, "Article 6 is missing");
    assert.ok(article6.paragraphs.length >= 3);
    // The consolidated layout prints the paragraph number in a span of its
    // own; splitting it from the sentence it numbers is the bug this guards.
    assert.match(article6.paragraphs[0].text, /^1\. \S/);
    assert.deepEqual(
      article6.paragraphs.map((p) => p.number).slice(0, 3),
      [1, 2, 3]
    );
  });

  test("gives every paragraph an anchor unique within its article", () => {
    for (const provision of act.provisions) {
      const anchors = new Set(provision.paragraphs.map((p) => p.anchor));
      assert.equal(anchors.size, provision.paragraphs.length, provision.displayLabel);
    }
  });

  test("holds articles under the chapter — and the section — they sit in", () => {
    const article22 = act.provisions.find((p) => p.displayLabel === "Article 22");
    assert.ok(article22?.chapterIndex !== null && article22?.chapterIndex !== undefined);
    const division = act.chapters[article22.chapterIndex as number];
    // A section carries its chapter's label too, so the reader never shows a
    // run of articles under a heading that does not say which chapter it is.
    assert.match(division.label, /^CHAPTER III/);
    assert.match(division.label, /Section 4/i);
  });

  test("reads the act's own EEA relevance line", () => {
    assert.equal(act.eeaRelevanceStated, true);
  });

  test("leaves no provision without text", () => {
    const empty = act.provisions.filter((p) => p.fullText.trim() === "");
    assert.deepEqual(empty.map((p) => p.displayLabel), []);
  });
});

describe("the Official Journal layout (32016D0002)", () => {
  const act = fixture("32016D0002.html.gz");

  test("is recognised as the OJ layout", () => {
    assert.equal(act.layout, "oj");
  });

  test("finds articles and annexes, and tells them apart", () => {
    const articles = act.provisions.filter((p) => p.kind === "article");
    const annexes = act.provisions.filter((p) => p.kind === "annex");
    assert.ok(articles.length > 30);
    assert.ok(annexes.length >= 1);
    // An annex numbers its own points, which are not articles of the act:
    // giving them article numbers would let a citation resolve to one.
    for (const annex of annexes) {
      assert.equal(annex.articleNumber, null);
      assert.match(annex.displayLabel, /^ANNEX/i);
      assert.ok(annex.fullText.length > 0);
    }
  });

  test("keeps a lettered or numbered point on the line it belongs to", () => {
    const definitions = act.provisions.find((p) => p.heading === "Definitions");
    assert.ok(definitions, "the definitions article is missing");
    // "(1)" is printed in a block of its own; a naive parse leaves it as a
    // line that is nothing but a marker.
    assert.ok(!definitions.fullText.split("\n").some((line) => /^\(\d+\)$/.test(line.trim())));
  });

  test("does not claim EEA relevance the act does not state", () => {
    assert.equal(act.eeaRelevanceStated, false);
  });
});

describe("the legacy layout (32000L0031, the e-Commerce Directive)", () => {
  const act = fixture("32000L0031.html.gz");

  test("is recognised as the legacy layout", () => {
    assert.equal(act.layout, "legacy");
  });

  test("finds the articles of the act and not the ones its recitals cite", () => {
    const articles = act.provisions.filter((p) => p.kind === "article");
    assert.ok(articles.length >= 20 && articles.length <= 30, `got ${articles.length} articles`);
    // The recitals cite Articles 251, 95 and 46 of the Treaty. Reading those
    // as articles of this directive is exactly what the adoption-formula
    // boundary exists to prevent.
    assert.equal(articles.some((p) => (p.articleNumber ?? 0) > 30), false);
    assert.deepEqual(
      articles.slice(0, 3).map((p) => p.displayLabel),
      ["Article 1", "Article 2", "Article 3"]
    );
  });

  test("recovers the heading the layout does not mark", () => {
    const article12 = act.provisions.find((p) => p.displayLabel === "Article 12");
    assert.equal(article12?.heading, '"Mere conduit"');
    const article1 = act.provisions.find((p) => p.displayLabel === "Article 1");
    assert.equal(article1?.heading, "Objective and scope");
    // The heading is a heading, not the first line of the body.
    assert.ok(!article1?.fullText.startsWith("Objective and scope"));
  });

  test("keeps the chapters and the annex", () => {
    assert.ok(act.chapters.length >= 3);
    assert.equal(act.chapters[0].label, "CHAPTER I");
    assert.equal(act.chapters[0].title, "GENERAL PROVISIONS");
    assert.ok(act.provisions.some((p) => p.kind === "annex"));
  });
});

describe("a document in no layout at all", () => {
  test("comes back empty rather than throwing", () => {
    // What the adapter records as "no-articles": a run must survive a source
    // that changes shape, and say so, rather than dying on it.
    const act = parseEuActHtml("<html><body><p>Service unavailable</p></body></html>");
    assert.deepEqual(act.provisions, []);
    assert.equal(act.layout, "legacy");
  });
});
