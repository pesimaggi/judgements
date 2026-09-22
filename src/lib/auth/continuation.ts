/** A small allowlist of application actions, never an arbitrary URL to POST to.
 * Add future persistent actions here and to the gate's executor. The server
 * still authenticates each operation; this is workflow state, not authority. */
export type AuthAction = { type: "save-document"; documentId: string } | { type: "open-saved" };
export interface Continuation {
  version: 1;
  id: string;
  createdAt: number;
  returnTo: string;
  action: AuthAction | null;
  userId: string | null;
  scrollY: number;
  views: Record<string, unknown>;
  cancelled?: boolean;
}
export const CONTINUATION_KEY = "logbrunnur.auth.continuation.v1";
export const CAPTURE_VIEW_EVENT = "logbrunnur:auth-capture-view";
const MAX_AGE = 30 * 60 * 1000;

export function safeReturnTo(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") ||
      /[\\\u0000-\u0020]/.test(value)) return "/";
  try {
    const url = new URL(value, "https://logbrunnur.invalid");
    if (url.origin !== "https://logbrunnur.invalid" || /^\/(sign-in|sign-up)(\/|$)/.test(url.pathname)) return "/";
    return url.pathname + url.search + url.hash;
  } catch { return "/"; }
}

export function parseContinuation(raw: string | null, now = Date.now()): Continuation | null {
  try {
    const p = JSON.parse(raw ?? "null");
    if (!p || p.version !== 1 || typeof p.id !== "string" || typeof p.createdAt !== "number" ||
        now - p.createdAt > MAX_AGE || p.createdAt > now || p.returnTo !== safeReturnTo(p.returnTo) ||
        !(p.userId === null || typeof p.userId === "string") ||
        !Number.isFinite(p.scrollY) || p.scrollY < 0 || !p.views || typeof p.views !== "object" ||
        (p.cancelled !== undefined && typeof p.cancelled !== "boolean")) return null;
    if (p.action !== null && !(p.action?.type === "open-saved" ||
        (p.action?.type === "save-document" && validDocumentId(p.action.documentId)))) return null;
    return p;
  } catch { return null; }
}

export function validDocumentId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
}

export function readContinuation(): Continuation | null {
  try { return parseContinuation(sessionStorage.getItem(CONTINUATION_KEY)); }
  catch { return null; }
}
export function writeContinuation(value: Continuation | null) {
  try {
    if (value) sessionStorage.setItem(CONTINUATION_KEY, JSON.stringify(value));
    else sessionStorage.removeItem(CONTINUATION_KEY);
  } catch { /* Popup/email login can still finish in memory when storage is unavailable. */ }
}
export function currentPath() {
  return window.location.pathname + window.location.search + window.location.hash;
}
export function captureContinuation(action: AuthAction | null, userId: string | null): Continuation {
  const views: Record<string, unknown> = {};
  window.dispatchEvent(new CustomEvent(CAPTURE_VIEW_EVENT, { detail: views }));
  return { version: 1, id: crypto.randomUUID(), createdAt: Date.now(), returnTo: safeReturnTo(currentPath()),
    action, userId, scrollY: window.scrollY, views };
}

/** Read at mount, before an asynchronous page load or completed action clears
 * the intent. Nothing is restored on an unrelated page or a later visit. */
export function readView<T>(name: string): T | null {
  const pending = readContinuation();
  return pending?.returnTo === currentPath() ? pending.views[name] as T ?? null : null;
}
