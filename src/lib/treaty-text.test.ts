/**
 * The text parser, against the one treaty this app holds as a PDF.
 *
 * What it has to survive is a re-typeset document, which is why the fixture is
 * the PDF rather than its extracted text: every assertion here passes through
 * pdfText() first, so a change in how EFTA lays the page out fails the suite
 * instead of quietly costing articles.
 */
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseTreatyText } from "@/lib/treaty-text";
import { pdfText } from "@/ingestion/pdf-text";
import type { ParsedEuAct } from "@/lib/eur-lex";

const FIXTURE = join(
  process.cwd(),
  "src/lib/__fixtures__/efta/sca-consolidated.pdf.gz"
);

describe("the Surveillance and Court Agreement, out of EFTA's PDF", () => {
  let act: ParsedEuAct;

  before(async () => {
    act = parseTreatyText(await pdfText(gunzipSync(readFileSync(FIXTURE))));
  });

  test("finds all 53 articles and nothing besides", () => {
    // An exact count, for the reason the treaty counts in eur-lex.test.ts are
    // exact: an agreement of this kind is amended every few years, and a changed
    // count is a signal rather than noise. Article 44a exists because the 2020
    // amendment added it, which is also why the lettered form has to parse.
    assert.equal(act.provisions.length, 53);
    assert.equal(act.provisions[0].displayLabel, "Article 1");
    assert.equal(act.provisions.at(-1)?.displayLabel, "Article 53");
    const keys = act.provisions.map((p) => `${p.articleNumber}|${p.articleLetter ?? ""}`);
    assert.equal(new Set(keys).size, keys.length, "an article was read twice");
    assert.deepEqual(
      act.provisions.filter((p) => p.articleLetter).map((p) => p.displayLabel),
      ["Article 44a"]
    );
  });

  test("no article comes back empty", () => {
    assert.deepEqual(
      act.provisions.filter((p) => p.fullText.trim().length === 0).map((p) => p.displayLabel),
      []
    );
  });

  test("starts after the recitals, which cite other agreements' articles", () => {
    // The preamble runs to twenty recitals and names Protocols 1 to 4, the EEA
    // Agreement and the EEC Treaty. Reading articles out of it is what the
    // adoption formula boundary prevents — the same boundary the legacy EUR-Lex
    // walk uses, and the same formula, because the SCA and the EEA Agreement were
    // drawn up at Porto on the same day.
    assert.equal(
      act.provisions.some((p) => /^WHEREAS|^HAVING REGARD/i.test(p.fullText)),
      false
    );
    assert.match(act.provisions[0].fullText, /For the purposes of this Agreement/);
  });

  test("keeps no page furniture", () => {
    // "SURVEILLANCE AND COURT AGREEMENT p. 4" and "Main text" appear twelve times
    // each, mid-sentence as far as the extracted text is concerned.
    for (const p of act.provisions) {
      assert.ok(!/Main text/.test(p.fullText), `${p.displayLabel}: ${p.fullText.slice(0, 80)}`);
      assert.ok(!/p\.\s*\d+\s*$/m.test(p.fullText), p.displayLabel);
    }
  });

  test("rejoins paragraphs broken across lines and pages", () => {
    // Article 31 is the infringement procedure, and its first paragraph runs over
    // four printed lines. If the wrap were taken for a paragraph break, the
    // article would read as four sentences with no grammar between them.
    const article31 = act.provisions.find((p) => p.articleNumber === 31)!;
    assert.match(
      article31.fullText,
      /deliver a reasoned opinion on the matter after giving the State concerned the opportunity/
    );
  });

  test("numbers the paragraphs the agreement numbers", () => {
    const article53 = act.provisions.find((p) => p.articleNumber === 53)!;
    assert.equal(article53.paragraphs.length, 3);
    assert.match(article53.paragraphs[0].text, /^1\. This Agreement/);
    assert.match(article53.paragraphs[1].text, /^2\. This Agreement shall be deposited/);
  });

  test("lifts the amendment footnotes out of the text and keeps them", () => {
    // They arrive inline, interrupting the sentence they annotate, as "(" then the
    // number then ")  Paragraph replaced by…". Left in place they would read as
    // part of the article; dropped, the reader loses the only record of which
    // instrument last changed it.
    // A floor rather than the exact number, because this is the one count an
    // amendment moves without changing anything structural: each amending
    // instrument adds a note to whatever article it touched.
    const withNotes = act.provisions.filter((p) => (p.footnotes ?? []).length > 0);
    assert.ok(withNotes.length >= 5, `only ${withNotes.length} articles carry footnotes`);
    assert.ok(
      withNotes.some((p) => (p.footnotes ?? []).some((note) => /Adjusting (Protocol|Agreement)/.test(note)))
    );
    // And no marker is left behind in any article's text.
    for (const p of act.provisions) {
      assert.ok(!/\(\s*\d+\s*\)\s*Paragraph replaced/.test(p.fullText), p.displayLabel);
    }
  });

  test("reads the parts, including the titles printed below them", () => {
    // "PART II" and "THE EFTA SURVEILLANCE AUTHORITY" are separate blocks, the
    // second wrapped over three lines of capitals. Before that was handled the
    // title was not merely missing from the division — it was dropped from the
    // document, because a block before the first article of a part belongs to no
    // provision.
    assert.equal(act.chapters.length, 5);
    assert.deepEqual(
      act.chapters.map((c) => c.label),
      ["PART I", "PART II", "PART III", "PART IV", "PART V"]
    );
    assert.equal(act.chapters[1].title, "THE EFTA SURVEILLANCE AUTHORITY");
    assert.equal(act.chapters[3].title, "THE EFTA COURT");
    for (const p of act.provisions) {
      if (p.chapterIndex === null) continue;
      assert.ok(act.chapters[p.chapterIndex], `${p.displayLabel} points at no part`);
    }
  });

  test("the EFTA Court's jurisdiction is where it should be", () => {
    // Article 34 SCA — the advisory-opinion procedure, and the provision an
    // Icelandic court uses to ask the EFTA Court anything at all. Read for its
    // content, so the test says what the parse is for.
    const article34 = act.provisions.find((p) => p.articleNumber === 34)!;
    assert.match(article34.fullText, /jurisdiction to give advisory opinions/);
  });
});
