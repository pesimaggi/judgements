/**
 * Rendering judgments readable. Each case here reproduces a shape that
 * actually arrived from a source, because the failure mode is always the same
 * — the text is still *there*, it just reads as a wall, or a heading is lost
 * into the paragraph after it, and nothing errors.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  unspaceLetterSpacing,
  normalizeJudgmentText,
  parseJudgmentText,
  extractSummary,
} from "@/lib/judgment-text";

describe("unspaceLetterSpacing", () => {
  /**
   * Félagsdómur, and the older half of it in particular, prints its headings
   * letter-spaced. Left alone, "D Ó M U R" is eleven one-letter words: it
   * matches no heading pattern, is not searchable, and reads as noise.
   */
  for (const [spaced, expected] of [
    ["D Ó M S O R Ð:", "DÓMSORÐ:"],
    ["D Ó M U R", "DÓMUR"],
    ["Ú R S K U R Ð A R O R Ð :", "ÚRSKURÐARORÐ:"],
  ] as const) {
    test(`collapses ${JSON.stringify(spaced)}`, () => {
      assert.equal(unspaceLetterSpacing(spaced), expected);
    });
  }

  /**
   * The narrowness is the point — this runs over every line of every
   * document, so a false positive silently mangles ordinary text.
   */
  for (const line of [
    "Helgi I. Jónsson", // an initial in a judge's name
    "a) b) c)", // an enumeration
    "A B", // two letters is an initial or a typo, not letter-spacing
    "Málið dæma hæstaréttardómararnir Helgi og Ólafur", // ordinary prose
  ]) {
    test(`leaves ${JSON.stringify(line)} alone`, () => {
      assert.equal(unspaceLetterSpacing(line), line);
    });
  }

  test("keeps the punctuation that rides on the last letter", () => {
    assert.ok(unspaceLetterSpacing("D Ó M U R:").endsWith(":"));
  });
});

describe("parseJudgmentText", () => {
  const doc = [
    "Hæstiréttur Íslands",
    "",
    "Útdráttur",
    "",
    "A höfðaði mál gegn B og krafðist skaðabóta vegna tjóns sem hann taldi B bera ábyrgð á.",
    "",
    "Dómur Hæstaréttar",
    "",
    "Málið dæma hæstaréttardómararnir Helgi og Ólafur.",
  ].join("\n");

  test("recognises the court's own section headings", () => {
    const kinds = parseJudgmentText(doc).filter((b) => b.kind === "heading");
    assert.deepEqual(
      kinds.map((b) => ("text" in b ? b.text : "")),
      ["Útdráttur", "Dómur Hæstaréttar"]
    );
  });

  test("a heading's court suffix stays attached to it", () => {
    // Split, "Hæstaréttar." is stranded as its own paragraph.
    const blocks = parseJudgmentText("Dómur Hæstaréttar\n\nMálið dæma dómararnir.");
    assert.equal(blocks[0].kind, "heading");
    assert.equal("text" in blocks[0] ? blocks[0].text : "", "Dómur Hæstaréttar");
  });

  test("empty input yields no blocks", () => {
    assert.deepEqual(parseJudgmentText("   "), []);
  });

  test("page numbers left by the PDF extractor are dropped", () => {
    const blocks = parseJudgmentText("Fyrsta efnisgrein hér.\n\n- 4 -\n\nÖnnur efnisgrein hér.");
    assert.ok(!blocks.some((b) => "text" in b && /^-?\s*4\s*-?$/.test(b.text)));
    assert.equal(blocks.length, 2);
  });

  test("list markers are kept as list items, with the marker separated", () => {
    const blocks = parseJudgmentText("1. Fyrsti liður málsins.\n2. Annar liður málsins.");
    assert.ok(blocks.every((b) => b.kind === "list-item"), JSON.stringify(blocks));
  });

  /**
   * Everything ingested before this module existed had every run of
   * whitespace collapsed, so the judgment is one unbroken blob. Re-ingesting
   * the archive to fix formatting is not realistic, so it is split at render
   * time instead.
   */
  test("splits a stored blob back into paragraphs", () => {
    const sentence =
      "Í máli þessu er deilt um hvort stefndi hafi sýnt af sér saknæma háttsemi. ";
    const blob = sentence.repeat(40).trim();
    const blocks = parseJudgmentText(blob);
    assert.ok(blocks.length > 1, "a 3,600-character blob must not stay one paragraph");
    assert.ok(
      blocks.every((b) => ("text" in b ? b.text.length : 0) < 1200),
      "no block should still be blob-sized"
    );
  });

  test("does not split an ordinary paragraph on an abbreviation's period", () => {
    // Icelandic legal prose is dense with these; splitting on them shreds a
    // paragraph into fragments.
    const text = "Dómurinn vísar til 2. mgr. 70. gr. laga nr. 88/2008 um þetta atriði.";
    const blocks = parseJudgmentText(text);
    assert.equal(blocks.length, 1, JSON.stringify(blocks));
  });
});

describe("normalizeJudgmentText", () => {
  test("reflows one-line-per-visual-line PDF output into paragraphs", () => {
    const pdfish = [
      "Í máli þessu er deilt um hvort stefndi hafi sýnt af sér",
      "saknæma háttsemi við framkvæmd verksins og hvort tjón",
      "stefnanda verði rakið til hennar.",
      "",
      "Stefndi mótmælir þessu og telur að orsakatengsl skorti",
      "með öllu.",
    ].join("\n");
    const out = normalizeJudgmentText(pdfish);
    assert.equal(out.split("\n").filter(Boolean).length, 2, out);
    assert.ok(out.includes("sýnt af sér saknæma háttsemi"), "wrapped lines must rejoin");
  });

  test("collapses a letter-spaced heading before anything else runs", () => {
    assert.ok(normalizeJudgmentText("D Ó M S O R Ð:\n\nStefndi greiði.").includes("DÓMSORÐ:"));
  });
});

describe("extractSummary", () => {
  const withSummary = [
    "Hæstiréttur Íslands",
    "",
    "Útdráttur",
    "",
    "A höfðaði mál gegn B og krafðist skaðabóta vegna tjóns sem hann taldi B bera ábyrgð á samkvæmt sakarreglunni.",
    "",
    "Dómur Hæstaréttar",
    "",
    "Málið dæma hæstaréttardómararnir Helgi og Ólafur.",
  ].join("\n");

  test("returns the court's own summary and stops at the next heading", () => {
    const s = extractSummary(withSummary);
    assert.ok(s?.startsWith("A höfðaði mál"));
    assert.ok(!s?.includes("Málið dæma"), "must stop at 'Dómur Hæstaréttar'");
  });

  test("returns null when there is no such section", () => {
    // Common outside Hæstiréttur — most boards write no útdráttur at all.
    assert.equal(extractSummary("Dómur Hæstaréttar\n\nMálið dæma dómararnir."), null);
  });

  test("returns null for a summary too short to be worth a disclosure arrow", () => {
    assert.equal(extractSummary("Útdráttur\n\nStutt."), null);
  });

  test("accepts the headings the other sources use", () => {
    for (const heading of ["Reifun", "Ágrip", "Summary"]) {
      const doc = `${heading}\n\nA höfðaði mál gegn B og krafðist skaðabóta vegna tjóns sem hann taldi B bera ábyrgð á.`;
      assert.ok(extractSummary(doc), `${heading} should be recognised`);
    }
  });

  test("empty input is null, not a throw", () => {
    assert.equal(extractSummary(""), null);
  });
});
