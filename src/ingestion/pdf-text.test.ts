/**
 * The two guards in src/ingestion/pdf-text.ts.
 *
 * Both exist because of one production run: ESA's document endpoint served
 * spreadsheets and scanned e-mails from a PDF fetch, and pdf.js printed a
 * warning per malformed byte until Railway dropped 8,596 log lines.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { looksLikePdf, pdfText } from "@/ingestion/pdf-text";

describe("looksLikePdf", () => {
  test("accepts a PDF", () => {
    assert.equal(looksLikePdf(Buffer.from("%PDF-1.4")), true);
  });

  test("accepts a PDF behind a short preamble, as pdf.js does", () => {
    const padded = Buffer.concat([Buffer.alloc(200, 0x20), Buffer.from("%PDF-1.7")]);
    assert.equal(looksLikePdf(padded), true);
  });

  test("rejects the formats ESA serves from a PDF fetch", () => {
    // An OLE2 compound file, which is what a .XLS or .PPT of that era is.
    assert.equal(looksLikePdf(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])), false);
    // A JPEG, which is how ESA publishes some scanned e-mails.
    assert.equal(looksLikePdf(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), false);
    // A zip, which is every .xlsx and .docx.
    assert.equal(looksLikePdf(Buffer.from("PK")), false);
  });

  test("rejects an empty body, which is not a verdict on the document either", () => {
    assert.equal(looksLikePdf(Buffer.alloc(0)), false);
  });

  test("does not go looking beyond the first kilobyte", () => {
    // A signature this deep is not a PDF header, and scanning a 5 MB scan for
    // one would cost more than the check is worth.
    const late = Buffer.concat([Buffer.alloc(4096, 0x41), Buffer.from("%PDF-1.4")]);
    assert.equal(looksLikePdf(late), false);
  });
});

describe("pdfText", () => {
  test("swallows pdf.js's warnings and leaves console.log as it found it", async () => {
    const real = console.log;
    const seen: string[] = [];
    console.log = (...args: unknown[]) => {
      seen.push(String(args[0]));
    };
    let restored: typeof console.log;
    try {
      // Not a PDF, so pdf.js writes "Warning: Indexing all PDF objects" before
      // giving up: exactly the line that must not reach the log.
      await pdfText(Buffer.from("not a pdf at all")).catch(() => "");
      console.log("an ordinary line");
    } finally {
      restored = console.log;
      console.log = real;
    }

    assert.deepEqual(
      seen.filter((line) => line.startsWith("Warning: ")),
      [],
      "no pdf.js warning reached the log"
    );
    assert.ok(seen.includes("an ordinary line"), "ordinary logging still works");
    assert.ok(restored !== real, "the test's own spy was in place throughout");
  });
});
