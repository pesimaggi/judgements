/**
 * The database boundary in src/ingestion/adapter.ts.
 *
 * One test, for one character. PostgreSQL stores any Unicode in a `text`
 * column except U+0000, and a document carrying one fails its insert with
 * `22021 invalid byte sequence for encoding "UTF8": 0x00` — which Prisma
 * reports as an opaque PrismaClientUnknownRequestError that says nothing about
 * NULs. ESA's e-mail and spreadsheet exports carry them by the hundred, and
 * before this every one of those documents failed, was written to the gap
 * ledger, and was re-fetched to fail again on every retry sweep.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { stripNulls } from "@/ingestion/adapter";

const NUL = String.fromCharCode(0);

describe("stripNulls", () => {
  test("removes the character Postgres cannot store", () => {
    assert.equal(stripNulls(`Case No. 73469${NUL} body`), "Case No. 73469 body");
    assert.equal(stripNulls(`${NUL}${NUL}leading`), "leading");
  });

  test("keeps everything else, including the characters that look suspicious", () => {
    // Icelandic and Norwegian text, tabs and newlines all survive: the point is
    // to store the document, not to sanitise it.
    const text = "Høvringen\tTyulekov\nÚrskurður nr. 4/94 — “quoted” · 100%";
    assert.equal(stripNulls(text), text);
  });

  test("returns the same string when there is nothing to strip", () => {
    // The common case by far, and it should not allocate a copy of every
    // judgment in the corpus.
    const text = "an ordinary judgment";
    assert.equal(stripNulls(text), text);
  });
});
