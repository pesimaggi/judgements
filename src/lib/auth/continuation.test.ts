import { test } from "node:test";
import assert from "node:assert/strict";
import { parseContinuation, safeReturnTo, type Continuation } from "./continuation";

const pending: Continuation = { version: 1, id: "test", createdAt: 1000,
  returnTo: "/document/doc_1?q=upps%C3%B6gn#text", action: { type: "save-document", documentId: "doc_1" },
  userId: null, scrollY: 480, views: { search: { selected: ["haestirettur"], page: 3 } } };
test("continuation retains query, anchor, scroll, action and view state across redirects", () => {
  assert.deepEqual(parseContinuation(JSON.stringify(pending), 2000), pending);
});
test("only local, non-auth return destinations are accepted", () => {
  for (const path of ["https://evil.test", "//evil.test", "/\\evil.test", "/\nevil", "/sign-in", "/sign-up/continue", "javascript:alert(1)"]) {
    assert.equal(safeReturnTo(path), "/");
  }
  assert.equal(safeReturnTo("/?q=hello%20world#results"), "/?q=hello%20world#results");
});
test("malformed, expired and unknown actions cannot be replayed", () => {
  assert.equal(parseContinuation("not json"), null);
  for (const change of [{ createdAt: -2e6 }, { createdAt: 5000 }, { action: { type: "fetch", url: "/delete" } },
    { action: { type: "save-document", documentId: "../user" } }, { returnTo: "//evil.test" }, { scrollY: "480" }, { userId: 123 }]) {
    assert.equal(parseContinuation(JSON.stringify({ ...pending, ...change }), 2000), null);
  }
});
