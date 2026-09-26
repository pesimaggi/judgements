/**
 * The treaties adapter's two conversions, against the frozen documents.
 *
 * Both are the kind of failure this repo's tests exist for: silent. A fylgiskjal
 * slice that picks up the neighbouring annex gives the Agreement a second Article
 * 1; an anchor taken from the source rather than from the article number gives
 * the two texts different anchors, and the reader's language control starts
 * landing readers on the wrong article. Neither throws, and neither is visible
 * without looking.
 *
 * The network is not touched: the fetch is separated from the parse in the
 * adapter precisely so this can run offline, like everything else here.
 */
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseEftaTreatyPdf,
  parseEnglishTreaty,
  parseIcelandicTreaty,
} from "@/ingestion/adapters/treaties";
import { treatyBySlug } from "@/lib/treaties";
import type { ParsedEuAct } from "@/lib/eur-lex";

const FIXTURES = join(process.cwd(), "src/lib/__fixtures__");

function html(name: string): string {
  return gunzipSync(readFileSync(join(FIXTURES, name))).toString("utf8");
}

const ees = treatyBySlug("ees")!;
const teu = treatyBySlug("teu")!;
const tfeu = treatyBySlug("tfeu")!;
const sca = treatyBySlug("sca")!;

/**
 * Every text this app stores, so the invariants below are checked on all of them
 * rather than on whichever one a test happened to open.
 *
 * That is the lesson of the TFEU: the anchoring bug it hit existed from the
 * first commit, and the tests asserted uniqueness of *article* anchors on three
 * texts and paragraph-count alignment on one — while the constraint that
 * actually failed in production, (provisionId, anchor) on a paragraph, was
 * asserted for the Lagasafn side and nowhere here.
 */
function everyText(): { what: string; parsed: ParsedEuAct }[] {
  return [
    { what: "ees is", parsed: parseIcelandicTreaty(html("lagasafn/1993002.html.gz"), ees) },
    { what: "ees en", parsed: parseEnglishTreaty(html("eur-lex/21994A0103_01.html.gz"), ees) },
    { what: "teu en", parsed: parseEnglishTreaty(html("eur-lex/12016M_TXT.html.gz"), teu) },
    { what: "tfeu en", parsed: parseEnglishTreaty(html("eur-lex/12016E_TXT.html.gz"), tfeu) },
  ];
}

describe("the Icelandic text, out of the fylgiskjal it is printed in", () => {
  const parsed = parseIcelandicTreaty(html("lagasafn/1993002.html.gz"), ees);

  test("is the Agreement's 129 articles and nothing else", () => {
    assert.equal(parsed.provisions.length, 129);
    const numbers = parsed.provisions.map((p) => p.articleNumber);
    assert.deepEqual([numbers[0], numbers.at(-1)], [1, 129]);
    // Fylgiskjal II is bókun 1 and fylgiskjal V a protocol amending the
    // Agreement; both number their articles from 1. A prefix test on "Fylgiskjal
    // I" matches "Fylgiskjal II" as well, which would have given the Agreement a
    // second Article 1 — and whichever was written last would have won.
    assert.deepEqual(
      numbers.filter((n, i) => numbers.indexOf(n) !== i),
      []
    );
  });

  test("does not take the act's own articles with it", () => {
    // lög nr. 2/1993 has five of its own, and 2. gr. — the one that gives the
    // Agreement lagagildi — is emphatically not Article 2 of the Agreement.
    const article2 = parsed.provisions.find((p) => p.articleNumber === 2);
    assert.ok(!/lagagildi/.test(article2!.fullText), article2!.fullText.slice(0, 120));
    assert.match(article2!.fullText, /Í þessum samningi merkir/);
  });

  test("keeps the Agreement's own divisions, without the fylgiskjal in front", () => {
    // Inside the act they are labelled "Fylgiskjal I — II. hluti", because there
    // "1. kafli" would read as a chapter of the act. On the Agreement's own page
    // the fylgiskjal is not a division of anything — it *is* the instrument.
    assert.ok(parsed.chapters.length >= 20);
    assert.equal(parsed.chapters[0].label, "I. hluti");
    assert.match(parsed.chapters[0].title ?? "", /Markmið/);
    assert.equal(
      parsed.chapters.some((c) => /Fylgiskjal/.test(c.label)),
      false
    );
    for (const p of parsed.provisions) {
      if (p.chapterIndex === null) continue;
      assert.ok(parsed.chapters[p.chapterIndex], `${p.displayLabel} points at no division`);
    }
  });

  test("anchors every article and paragraph on the treaty's own numbering", () => {
    const article28 = parsed.provisions.find((p) => p.articleNumber === 28)!;
    assert.equal(article28.anchor, "A28");
    assert.equal(article28.displayLabel, "28. gr.");
    assert.deepEqual(
      article28.paragraphs.map((par) => par.anchor),
      ["A28M1", "A28M2", "A28M3", "A28M4", "A28M5"]
    );
    // Free movement of workers, in the text that has legal force in Iceland.
    assert.match(article28.fullText, /Frelsi launþega til flutninga/);
  });
});

describe("the English text, out of what Cellar serves", () => {
  const agreement = parseEnglishTreaty(html("eur-lex/21994A0103_01.html.gz"), ees);
  const treaty = parseEnglishTreaty(html("eur-lex/12016M_TXT.html.gz"), teu);

  test("keeps only the articles", () => {
    // The annexes and protocols are not held here — see the adapter's header —
    // and on the Agreement this is also what drops the ANNEX entries the legacy
    // walk finds among the material printed after Article 129.
    assert.equal(agreement.provisions.length, 129);
    assert.equal(
      agreement.provisions.every((p) => p.kind === "article"),
      true
    );
    assert.equal(treaty.provisions.length, 55);
  });

  test("uses the same anchors as the Icelandic text", () => {
    // One instrument, numbered once: this is what makes /log/ees#A28 work in
    // both languages, and the side-by-side view a lookup rather than a guess.
    const icelandic = parseIcelandicTreaty(html("lagasafn/1993002.html.gz"), ees);
    assert.deepEqual(
      agreement.provisions.map((p) => p.anchor),
      icelandic.provisions.map((p) => p.anchor)
    );
  });

  test("agrees with the Icelandic text article for article and paragraph for paragraph", () => {
    // Not a nicety: the reader shows them side by side, and a paragraph count
    // that disagrees means one of the two parses lost something. It is also the
    // check that would catch a source changing shape on either side.
    const icelandic = parseIcelandicTreaty(html("lagasafn/1993002.html.gz"), ees);
    const byAnchor = new Map(agreement.provisions.map((p) => [p.anchor, p]));
    const differing = icelandic.provisions.filter(
      (p) => byAnchor.get(p.anchor)?.paragraphs.length !== p.paragraphs.length
    );
    assert.deepEqual(
      differing.map((p) => `${p.displayLabel}: ${p.paragraphs.length} vs ${byAnchor.get(p.anchor)?.paragraphs.length}`),
      []
    );
  });

  test("names the instrument from the registry when the document does not", () => {
    assert.ok((agreement.title ?? "").length > 0);
    assert.equal(treaty.layout, "treaty");
  });
});

describe("an EFTA treaty, which arrives as a PDF", () => {
  let parsed: Awaited<ReturnType<typeof parsePdfFixture>>;

  before(async () => {
    parsed = await parsePdfFixture();
  });

  test("is re-anchored like the others, so nothing about it is special downstream", () => {
    // The point of putting the text parse behind the same shape: the writer, the
    // reader, the citation index and the anchors are the ones every treaty uses.
    assert.equal(parsed.provisions.length, 53);
    assert.equal(parsed.provisions[0].anchor, "A1");
    assert.equal(parsed.provisions.at(-1)?.anchor, "A53");
    const lettered = parsed.provisions.find((p) => p.articleLetter === "a");
    assert.equal(lettered?.anchor, "A44A");
    assert.deepEqual(
      parsed.provisions.find((p) => p.articleNumber === 53)?.paragraphs.map((x) => x.anchor),
      ["A53M1", "A53M2", "A53M3"]
    );
  });

  test("carries its amendment footnotes into the column Lagasafn's go in", () => {
    assert.ok(parsed.provisions.some((p) => (p.footnotes ?? []).length > 0));
  });
});

/** The SCA, through exactly the path the adapter takes once it has the bytes. */
function parsePdfFixture() {
  return parseEftaTreatyPdf(
    gunzipSync(readFileSync(join(FIXTURES, "efta/sca-consolidated.pdf.gz"))),
    sca
  );
}

describe("what every stored text has to satisfy", () => {
  test("no two paragraphs of one provision share an anchor", () => {
    // ProvisionParagraph is keyed (provisionId, anchor), so a collision is not a
    // cosmetic problem: createMany throws and the *whole treaty* fails to store.
    // The TFEU did exactly that in production — Articles 199, 314 and 355 open
    // with an unnumbered sentence and then number their paragraphs from 1, so the
    // lead-in and the paragraph printed "1." both carried the number 1.
    for (const { what, parsed } of everyText()) {
      for (const provision of parsed.provisions) {
        const anchors = provision.paragraphs.map((p) => p.anchor);
        assert.equal(
          new Set(anchors).size,
          anchors.length,
          `${what} ${provision.displayLabel}: repeated anchor in ${anchors.join(", ")}`
        );
      }
    }
  });

  test("an article that opens with an unnumbered lead-in keeps both blocks", () => {
    // The lead-in is text of the article and must not be dropped or merged away
    // in the course of making the anchors unique. Article 314 TFEU — the budget
    // procedure — is the clearest case: a sentence, then ten numbered paragraphs.
    const { parsed } = everyText().find((t) => t.what === "tfeu en")!;
    const article314 = parsed.provisions.find((p) => p.articleNumber === 314)!;
    assert.equal(article314.paragraphs.length, 11);
    assert.match(article314.paragraphs[0].text, /^The European Parliament and the Council/);
    assert.match(article314.paragraphs[1].text, /^1\./);
    // The printed numbers are kept as printed, which is what "1. mgr." cites.
    assert.deepEqual(
      article314.paragraphs.map((p) => p.number),
      [1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    );
  });

  test("no two provisions of one text share an anchor either", () => {
    for (const { what, parsed } of everyText()) {
      const anchors = parsed.provisions.map((p) => p.anchor);
      assert.equal(new Set(anchors).size, anchors.length, `${what}: repeated provision anchor`);
    }
  });

  test("every provision has an article number and some text", () => {
    for (const { what, parsed } of everyText()) {
      assert.ok(parsed.provisions.length > 0, what);
      for (const provision of parsed.provisions) {
        assert.notEqual(provision.articleNumber, null, `${what} ${provision.displayLabel}`);
        assert.ok(provision.fullText.trim().length > 0, `${what} ${provision.displayLabel} is empty`);
      }
    }
  });
});

describe("the TFEU, the treaty this corpus cites most", () => {
  const parsed = parseEnglishTreaty(html("eur-lex/12016E_TXT.html.gz"), tfeu);

  test("stops at the protocols, with all 358 articles", () => {
    assert.equal(parsed.provisions.length, 358);
    assert.equal(parsed.provisions[0].anchor, "A1");
    assert.equal(parsed.provisions.at(-1)?.anchor, "A358");
  });

  test("the articles everything cites are readable", () => {
    const byNumber = new Map(parsed.provisions.map((p) => [p.articleNumber, p]));
    assert.match(byNumber.get(34)!.fullText, /Quantitative restrictions on imports/i);
    assert.match(byNumber.get(45)!.fullText, /Freedom of movement for workers/i);
    assert.match(byNumber.get(101)!.fullText, /prevention, restriction or distortion of competition/i);
    assert.match(byNumber.get(267)!.fullText, /preliminary ruling/i);
  });
});
