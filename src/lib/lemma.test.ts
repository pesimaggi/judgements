import { test } from "node:test";
import assert from "node:assert/strict";
import { hasPhrase, lemmaQuery, queryWords, type LemmaMap } from "./lemma";

/** A slice of BÍN, as lookupLemmas would return it: form → lemmas, sorted. */
const BIN: LemmaMap = new Map([
  ["ríkisborgararéttinum", ["ríkisborgararéttur"]],
  ["ríkisborgararéttar", ["ríkisborgararéttur"]],
  ["ríkisborgararéttur", ["ríkisborgararéttur"]],
  ["stjórnsýslulögum", ["stjórnsýslulög"]],
  ["dráttarvaxta", ["dráttarvextir"]],
  ["uppsögn", ["uppsögn"]],
  // Genuinely ambiguous: "vörn" (a defence) and "vörður" (a warden).
  ["varðar", ["varða", "vörður"]],
]);

test("hasPhrase spots every quote character a reader might type", () => {
  assert.equal(hasPhrase('"sönnun um orsakatengsl"'), true);
  assert.equal(hasPhrase("„sönnun“"), true);
  assert.equal(hasPhrase("«sönnun»"), true);
  // Unbalanced still counts: erring towards leaving the query alone.
  assert.equal(hasPhrase('sönnun um "orsakatengsl'), true);
  assert.equal(hasPhrase("sönnun um orsakatengsl"), false);
});

test("queryWords lowercases, drops operators, and skips phrase queries", () => {
  assert.deepEqual(queryWords("Stjórnsýslulögum OR dráttarvaxta"), [
    "stjórnsýslulögum",
    "dráttarvaxta",
  ]);
  // A phrase query is off this path entirely, so nothing needs looking up.
  assert.deepEqual(queryWords('"stjórnsýslulögum og dráttarvaxta"'), []);
  // Single characters carry no lemma worth the lookup; a real word does.
  assert.deepEqual(queryWords("a b lög"), ["lög"]);
});

test("negation and OR survive the rewrite", () => {
  assert.equal(
    lemmaQuery("stjórnsýslulögum -dráttarvaxta", BIN),
    "stjórnsýslulög -dráttarvextir"
  );
  assert.equal(
    lemmaQuery("stjórnsýslulögum OR dráttarvaxta", BIN),
    "stjórnsýslulög OR dráttarvextir"
  );
});

test("the inflected form the reader typed becomes the form the corpus is indexed under", () => {
  assert.equal(lemmaQuery("ríkisborgararéttinum", BIN), "ríkisborgararéttur");
  assert.equal(lemmaQuery("ríkisborgararéttar", BIN), "ríkisborgararéttur");
});

test("a word BÍN does not know keeps its own spelling", () => {
  // bin_lemma_vector() does the same on the corpus side; the two must agree,
  // or an unknown word is indexed under itself and searched for as nothing.
  assert.equal(lemmaQuery("Kópavogsbær stjórnsýslulögum", BIN), "Kópavogsbær stjórnsýslulög");
});

test("an ambiguous form takes its first lemma, deterministically", () => {
  // Sorted at lookup, so this is "varða" on every run — and the exact vector
  // is still matching alongside, so the other candidate is not simply lost.
  assert.equal(lemmaQuery("varðar", BIN), "varða");
});

test("nothing to gain returns null so the caller can omit the SQL", () => {
  // A phrase query: never lemmatised.
  assert.equal(lemmaQuery('"stjórnsýslulögum"', BIN), null);
  // Empty.
  assert.equal(lemmaQuery("", BIN), null);
  // No word in the dictionary at all.
  assert.equal(lemmaQuery("Kópavogsbær Hafnarfjörður", BIN), null);
});

test("a query that is only partly known is still rewritten", () => {
  assert.equal(lemmaQuery("uppsögn dráttarvaxta", BIN), "uppsögn dráttarvextir");
});

test("a query already in dictionary form is still worth running", () => {
  // The regression this guards: "uppsögn" and "stjórnsýslulög" rewrite to
  // themselves, and skipping them as redundant is what made the feature miss
  // its own central case. The plain condition matches this string against
  // search_vector (surface forms); this one matches it against lemma_vector
  // (lemmas), so the same string finds documents the other cannot — the ones
  // that only ever spell it "uppsagnar" or "stjórnsýslulögum".
  assert.equal(lemmaQuery("uppsögn", BIN), "uppsögn");
  assert.equal(lemmaQuery("ríkisborgararéttur", BIN), "ríkisborgararéttur");
});
