import { test } from "node:test";
import assert from "node:assert/strict";
import { savedDocumentHandlers } from "./saved-documents";

function setup() {
  let user: string | null = "user_a";
  const rows = new Set<string>();
  const handlers = savedDocumentHandlers({ configured: () => true, userId: async () => user,
    exists: async id => id === "doc_1", list: async owner => [...rows].filter(k => k.startsWith(owner + ":")),
    save: async (owner, id) => { rows.add(`${owner}:${id}`); },
    remove: async (owner, id) => { rows.delete(`${owner}:${id}`); },
  });
  return { handlers, rows, setUser: (id: string | null) => { user = id; } };
}
function request(method: string, body: unknown = { documentId: "doc_1" }, origin = "https://app.test") {
  return new Request("https://app.test/api/saved-documents", { method,
    headers: { origin, "Content-Type": "application/json" }, ...(method === "GET" ? {} : { body: JSON.stringify(body) }) });
}
test("signed-out reads and writes fail closed before accessing application data", async () => {
  const s = setup(); s.setUser(null);
  for (const method of ["GET", "PUT", "DELETE"] as const) assert.equal((await s.handlers[method](request(method))).status, 401);
  assert.equal(s.rows.size, 0);
});
test("server identity scopes reads, saves and removals; repeats are idempotent", async () => {
  const s = setup();
  await s.handlers.PUT(request("PUT")); await s.handlers.PUT(request("PUT"));
  assert.deepEqual([...s.rows], ["user_a:doc_1"]);
  s.setUser("user_b");
  assert.deepEqual(await (await s.handlers.GET(request("GET"))).json(), { items: [] });
  await s.handlers.DELETE(request("DELETE"));
  assert.equal(s.rows.size, 1);
  await s.handlers.PUT(request("PUT"));
  s.setUser("user_a"); await s.handlers.DELETE(request("DELETE"));
  assert.deepEqual([...s.rows], ["user_b:doc_1"]);
});
test("forged identities, missing documents, malformed requests and cross-origin writes are rejected", async () => {
  const s = setup();
  assert.equal((await s.handlers.PUT(request("PUT", { documentId: "doc_1", userId: "user_b" }))).status, 400);
  assert.equal((await s.handlers.PUT(request("PUT", { documentId: "doc_missing" }))).status, 404);
  assert.equal((await s.handlers.PUT(request("PUT", { documentId: "doc_1" }, "https://evil.test"))).status, 403);
  assert.equal((await s.handlers.DELETE(request("DELETE", { documentId: "doc_1" }, "null"))).status, 403);
  assert.equal((await s.handlers.PUT(request("PUT", { documentId: "../escape" }))).status, 400);
  assert.equal(s.rows.size, 0);
});
test("private responses are never cacheable", async () => {
  const s = setup();
  assert.equal((await s.handlers.GET(request("GET"))).headers.get("cache-control"), "private, no-store");
});
