/**
 * Word boundaries in Icelandic.
 *
 * This module exists because of a bug that was already in this repository's
 * new code and would have shipped invisibly: JavaScript's `\b` is defined
 * against the ASCII word class, so `/\bþágildandi\b/` matches *nothing*. A
 * recogniser written that way is not imprecise; it is switched off, and it
 * looks correct in review.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { wordAlternation, wholeWord, BEFORE, AFTER } from "@/lib/word-boundary";

describe("the failure this replaces", () => {
  test("ASCII \\b does not fire next to an Icelandic letter", () => {
    // Kept as a test rather than a comment: it is the whole reason for the
    // module, and it is the kind of thing somebody will "simplify" back.
    assert.equal(/\bþágildandi\b/i.test("þágildandi ákvæði"), false);
    assert.equal(/ber\s+að\b/i.test("honum ber að greiða"), false);
  });

  test("the Unicode boundaries do", () => {
    assert.equal(wholeWord("þágildandi").test("þágildandi ákvæði"), true);
    assert.equal(wholeWord("ber\\s+að").test("honum ber að greiða"), true);
  });
});

describe("wordAlternation", () => {
  const RE = wordAlternation(["skal", "ber\\s+(?:\\S+\\s+)?að", "eldri\\s+lög(?:um)?"]);

  test("matches a whole word wherever it sits in the sentence", () => {
    assert.equal(RE.test("Stjórnvald skal taka ákvörðun."), true);
    assert.equal(RE.test("skal"), true);
    assert.equal(RE.test("Það er svo að stjórnvald skal."), true);
  });

  test("matches a phrase with a hole in it", () => {
    assert.equal(RE.test("Atvinnurekanda ber ávallt að greiða laun."), true);
    assert.equal(RE.test("Honum ber að greiða."), true);
  });

  test("does not match inside a longer word", () => {
    assert.equal(RE.test("skalinn"), false);
    assert.equal(RE.test("óskal"), false);
  });

  test("is case-insensitive, because a heading is capitalised", () => {
    assert.equal(RE.test("SKAL"), true);
  });

  test("handles an Icelandic word at the end of the string", () => {
    assert.equal(wordAlternation(["eldri\\s+lögum"]).test("samkvæmt eldri lögum"), true);
  });

  test("does not match across a word boundary that is a letter", () => {
    assert.equal(wordAlternation(["lög"]).test("lögum"), false);
    assert.equal(wordAlternation(["lög"]).test("um lög."), true);
  });
});

describe("BEFORE and AFTER", () => {
  test("compose into a pattern that treats digits as word characters too", () => {
    const re = new RegExp(`${BEFORE}gr${AFTER}`, "iu");
    assert.equal(re.test("5. gr. laganna"), true);
    assert.equal(re.test("gr5"), false);
  });
});
