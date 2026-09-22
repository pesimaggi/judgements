import { test } from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { AuthGate, useAppAuth } from "./AuthProvider";
import { SaveDocumentButton } from "./SaveDocumentButton";
import { CONTINUATION_KEY, readContinuation } from "@/lib/auth/continuation";

// Exercise the real gate and components with changes at Clerk's session seam.
// These tests deliberately do not pretend to verify external OAuth/OTP delivery.
test("contextual login resumes once, cancellation clears intent, reload resumes, and failures can retry", async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: "https://app.test/document/doc_1?q=uppsogn#text" });
  Object.assign(globalThis, { React, window: dom.window, document: dom.window.document,
    sessionStorage: dom.window.sessionStorage, CustomEvent: dom.window.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true });
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  dom.window.HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  const writes: string[] = [];
  let fail = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    if (init?.method === "PUT") {
      writes.push(String(init.body));
      return Response.json({ ok: !fail }, { status: fail ? 503 : 200 });
    }
    return Response.json({ items: [] });
  };
  const destinations: string[] = [];
  const router = { push: (path: string) => destinations.push(path), replace: () => {}, refresh: () => {},
    back: () => {}, forward: () => {}, prefetch: async () => {} };
  const element = document.getElementById("root")!;
  let root = createRoot(element);
  function Harness() {
    const auth = useAppAuth();
    return React.createElement("div", null,
      React.createElement("input", { "aria-label": "Search", defaultValue: "uppsögn" }),
      React.createElement(SaveDocumentButton, { documentId: "doc_1" }),
      React.createElement("button", { onClick: auth.cancel }, "Cancel"),
      React.createElement("button", { onClick: auth.leaveSignIn }, "Leave sign in"));
  }
  async function render(userId: string | null, path?: string) {
    if (path) dom.window.history.replaceState(null, "", path);
    await act(async () => { root.render(React.createElement(PathnameContext.Provider, { value: window.location.pathname },
      React.createElement(AppRouterContext.Provider, { value: router },
        React.createElement(AuthGate, { configured: false, ready: true, userId, children: React.createElement(Harness) })))); });
  }
  async function click(text: string) {
    const button = [...document.querySelectorAll("button")].find(b => b.textContent === text);
    assert.ok(button, `Button ${text} exists`);
    await act(async () => button.click());
  }
  try {
    await render(null);
    assert.equal(document.querySelector("dialog"), null);
    await click("Vista");
    assert.match(document.querySelector("dialog")!.textContent!, /Skrá inn til að vista/);
    assert.equal(writes.length, 0);
    assert.equal(readContinuation()?.returnTo, "/document/doc_1?q=uppsogn#text");
    await render("user_a");
    await render("user_a");
    assert.equal(writes.length, 1, "one write after session activation");
    assert.deepEqual(JSON.parse(writes[0]), { documentId: "doc_1" });
    assert.equal(document.querySelector("dialog"), null);
    assert.equal((document.querySelector("input") as HTMLInputElement).value, "uppsögn");
    assert.deepEqual(destinations, [], "saving never navigates away");
    assert.equal(sessionStorage.getItem(CONTINUATION_KEY), null);

    await render(null); await click("Vista"); await click("Cancel"); await render("user_a");
    assert.equal(writes.length, 1, "cancelled actions do not run at a later login");

    await render(null); await click("Vista");
    await act(async () => root.unmount()); root = createRoot(element);
    await render("user_a");
    assert.equal(writes.length, 2, "a redirect/reload resumes the serialized intent");

    fail = true; await click("Vista");
    assert.equal(writes.length, 3);
    assert.ok(readContinuation(), "failed writes retain their intent");
    await render("user_a"); assert.equal(writes.length, 3, "failure does not start a retry loop");
    fail = false; await click("Reyna aftur");
    assert.equal(writes.length, 4); assert.equal(readContinuation(), null);

    // A pending write that belonged to an authenticated account is never
    // silently applied to another account after a redirect.
    fail = true; await click("Vista");
    const count = writes.length;
    await act(async () => root.unmount()); root = createRoot(element);
    await render("user_b");
    assert.equal(writes.length, count);
    assert.match(element.textContent!, /Aðgangurinn breyttist/);

    fail = false;
    await render(null); await click("Vista");
    await render("user_a", "/sign-in");
    assert.equal(writes.length, count, "fallback page waits for return before consuming the action");
    await render("user_a", "/document/doc_1?q=uppsogn#text");
    assert.equal(writes.length, count + 1, "client-side return from sign-in resumes too");

    await render(null); await click("Vista");
    await render(null, "/sign-in"); await click("Leave sign in");
    assert.equal(readContinuation()?.cancelled, true);
    await render(null, "/document/doc_1?q=uppsogn#text");
    assert.equal(readContinuation(), null);
    assert.equal(document.querySelector("dialog"), null, "fallback cancellation does not reopen login");
    await render("user_a"); assert.equal(writes.length, count + 1);
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = originalFetch;
    dom.window.close();
  }
});
