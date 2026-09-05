/**
 * The response size cap in src/ingestion/adapter.ts.
 *
 * It exists because one document killed a production run: EUR-Lex serves
 * Commission Implementing Regulation (EU) 2024/348 as 193 MB of XHTML, and
 * buffering it for cheerio exhausted Node's default heap — the adapter died
 * with "Ineffective mark-compacts near heap limit" and exit 134, having stored
 * nothing. Cellar answers chunked with no Content-Length, so the cap has to
 * hold while the body is being read and not only from the headers.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ResponseTooLargeError, readCapped } from "@/ingestion/adapter";

const LIMIT = Number(process.env.INGEST_MAX_BYTES ?? 32 * 1024 * 1024);
const URL_UNDER_TEST = "https://publications.europa.eu/resource/celex/32024R0348";

/** A chunked response — no Content-Length, exactly as Cellar answers. */
function chunked(totalBytes: number, chunkSize = 1024 * 1024): Response {
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= totalBytes) return controller.close();
      const size = Math.min(chunkSize, totalBytes - sent);
      sent += size;
      controller.enqueue(new Uint8Array(size));
    },
  });
  return new Response(body);
}

describe("readCapped", () => {
  test("returns a body that fits", async () => {
    const body = await readCapped(new Response(Buffer.from("%PDF-1.4")), URL_UNDER_TEST);
    assert.equal(body.toString(), "%PDF-1.4");
  });

  test("reassembles a chunked body in order", async () => {
    const parts = ["one ", "two ", "three"];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const part of parts) controller.enqueue(new TextEncoder().encode(part));
        controller.close();
      },
    });
    const read = await readCapped(new Response(body), URL_UNDER_TEST);
    assert.equal(read.toString(), "one two three");
  });

  test("refuses a body that declares itself too large, without reading it", async () => {
    let pulled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled = true;
        controller.enqueue(new Uint8Array(1024));
      },
    });
    const res = new Response(body, { headers: { "content-length": String(LIMIT + 1) } });
    await assert.rejects(() => readCapped(res, URL_UNDER_TEST), ResponseTooLargeError);
    assert.equal(pulled, false, "an advertised size costs no transfer at all");
  });

  test("stops a chunked body at the cap rather than buffering all of it", async () => {
    // The production case: 193 MB, announced by nothing.
    await assert.rejects(
      () => readCapped(chunked(LIMIT * 2), URL_UNDER_TEST),
      (e: unknown) => {
        assert.ok(e instanceof ResponseTooLargeError);
        assert.ok(e.bytesRead <= LIMIT + 1024 * 1024, "gave up at the cap, not at the end");
        assert.match(e.message, /exceeds the 32 MB limit/);
        assert.match(e.message, /32024R0348/);
        return true;
      }
    );
  });

  test("lets a body right up to the cap through", async () => {
    const body = await readCapped(chunked(LIMIT), URL_UNDER_TEST);
    assert.equal(body.length, LIMIT);
  });
});
