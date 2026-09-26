/**
 * The act identity rules — which corpus a row belongs to, how it is cited, and
 * where it is read.
 *
 * These exist because the `acts` table now holds three bodies of law under two
 * jurisdiction values. Lög and reglugerðir are both jurisdiction "is", they
 * are numbered the same way, and their numbers overlap completely: reglugerð
 * nr. 91/1991 and lög nr. 91/1991 can both exist. Everything here is what
 * keeps one from being presented as the other.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { actCitation, actPath, parseActRef, corpusFilter, parseActCorpus } from "@/lib/acts";

/** The SQL a filter produces, as one string, for asserting on its conditions. */
function sqlText(sql: { strings?: readonly string[]; sql?: string }): string {
  return (sql.strings ?? [sql.sql ?? ""]).join("?");
}

describe("corpusFilter", () => {
  test("lög are acts, not merely Icelandic", () => {
    // The whole point. Before regulations existed every act query said
    // `jurisdiction = 'is'` inline and meant lög; that condition now also
    // matches reglugerðir, and any query left saying it is showing a
    // regulation as an act.
    const sql = sqlText(corpusFilter("is") as never);
    assert.match(sql, /jurisdiction/);
    assert.match(sql, /doc_type/);
    assert.match(sql, /'act'/);
  });

  test("reglugerðir are their own corpus", () => {
    const sql = sqlText(corpusFilter("is-reg") as never);
    assert.match(sql, /'regulation'/);
    assert.match(sql, /jurisdiction/);
  });

  test("the EU corpus is selected by jurisdiction alone", () => {
    // It holds regulations, directives and decisions; docType separates those
    // from each other, not from the corpus.
    const sql = sqlText(corpusFilter("eu") as never);
    assert.match(sql, /'eu'/);
    assert.ok(!/doc_type/.test(sql), sql);
  });

  test("the unfiltered corpus filters no corpus, but still shows one text per instrument", () => {
    // "all" used to be `TRUE`. It cannot be any more: an instrument stored in two
    // languages — the EEA Agreement — would appear twice in a listing that
    // filtered nothing, under two labels, with the judgments citing each article
    // split between the copies. What "all" means is "every corpus", not "every
    // row".
    const sql = sqlText(corpusFilter("all") as never);
    assert.ok(!/jurisdiction/.test(sql), sql);
    assert.match(sql, /is_canonical/);
  });

  test("every corpus keeps to the canonical text", () => {
    // In one place, on purpose: a listing that forgets this shows a duplicate,
    // and for the well two rows of one article are two sources for one
    // proposition. See corpusFilter's comment.
    for (const corpus of ["is", "is-reg", "eu", "treaty", "all"] as const) {
      assert.match(sqlText(corpusFilter(corpus) as never), /is_canonical/, corpus);
    }
  });

  test("the treaties are a corpus of their own", () => {
    const sql = sqlText(corpusFilter("treaty") as never);
    assert.match(sql, /'treaty'/);
    // Not by docType: an instrument is a treaty because of the corpus it is in.
    assert.ok(!/doc_type/.test(sql), sql);
  });

  test("takes the table alias it is given", () => {
    assert.match(sqlText(corpusFilter("is", "acts2") as never), /acts2\.jurisdiction/);
  });
});

describe("parseActCorpus", () => {
  test("reads the three corpora and the unfiltered case", () => {
    assert.equal(parseActCorpus("is"), "is");
    assert.equal(parseActCorpus("is-reg"), "is-reg");
    assert.equal(parseActCorpus("eu"), "eu");
    assert.equal(parseActCorpus("all"), "all");
  });

  test("falls back to lög rather than to everything", () => {
    // A bad value must not widen the corpus: the safe answer is the one the
    // catalogue opens on.
    for (const bad of [null, undefined, "", "nonsense", "IS"]) {
      assert.equal(parseActCorpus(bad), "is", String(bad));
    }
  });
});

describe("actCitation", () => {
  const is = { jurisdiction: "is", citation: null, actNumber: 91, year: 1991 };

  test("an act is cited as lög", () => {
    assert.equal(actCitation({ ...is, docType: "act" }), "lög nr. 91/1991");
  });

  test("a regulation of the same number is not", () => {
    // Calling it "lög nr. 91/1991" would be a statement about its legal
    // status, not a formatting slip.
    assert.equal(actCitation({ ...is, docType: "regulation" }), "reglugerð nr. 91/1991");
  });

  test("an unstated docType still reads as lög, as it always did", () => {
    assert.equal(actCitation(is), "lög nr. 91/1991");
  });

  test("an EU act keeps its own stored citation", () => {
    assert.equal(
      actCitation({
        jurisdiction: "eu",
        docType: "regulation",
        citation: "Regulation (EU) 2016/679",
        actNumber: 679,
        year: 2016,
      }),
      "Regulation (EU) 2016/679"
    );
  });
});

describe("actPath and parseActRef", () => {
  test("an act and a regulation of the same number get different routes", () => {
    const shared = { jurisdiction: "is", celex: null, actNumber: 300, year: 2020 };
    assert.equal(actPath({ ...shared, docType: "act" }), "/log/300-2020");
    assert.equal(actPath({ ...shared, docType: "regulation" }), "/log/rg-300-2020");
  });

  test("an EU act is served at its CELEX", () => {
    assert.equal(
      actPath({ jurisdiction: "eu", docType: "regulation", celex: "32016R0679", actNumber: 679, year: 2016 }),
      "/log/32016R0679"
    );
  });

  test("every path round-trips back to the row it names", () => {
    for (const docType of ["act", "regulation"] as const) {
      const path = actPath({ jurisdiction: "is", docType, celex: null, actNumber: 300, year: 2020 });
      const ref = parseActRef(path.replace("/log/", ""));
      assert.deepEqual(ref, { jurisdiction: "is", docType, actNumber: 300, year: 2020 }, path);
    }
  });

  test("a four-digit regulation number is parsed, which an act's form cannot be", () => {
    // Regulation numbers run past 1000 in a busy year, so the act form's
    // three-digit limit could never have been the discriminator.
    assert.deepEqual(parseActRef("rg-1135-2021"), {
      jurisdiction: "is",
      docType: "regulation",
      actNumber: 1135,
      year: 2021,
    });
  });

  test("a CELEX is still an EU reference", () => {
    assert.deepEqual(parseActRef("32016R0679"), { jurisdiction: "eu", celex: "32016R0679" });
  });

  test("rejects what is not a reference", () => {
    for (const bad of ["", "nonsense", "rg-2020", "300-20", "rg-", "300-2020-x"]) {
      assert.equal(parseActRef(bad), null, bad);
    }
  });
});
