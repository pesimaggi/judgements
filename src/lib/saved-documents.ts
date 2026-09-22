import { validDocumentId } from "./auth/continuation";

export interface SavedDocument {
  documentId: string;
  createdAt: string;
  document: { id: string; title: string; caseName: string | null; court: string; caseNumber: string | null };
}

interface Dependencies {
  configured: () => boolean;
  userId: () => Promise<string | null>;
  list: (userId: string) => Promise<unknown>;
  exists: (documentId: string) => Promise<boolean>;
  save: (userId: string, documentId: string) => Promise<void>;
  remove: (userId: string, documentId: string) => Promise<void>;
  allowedOrigins?: () => string[];
}
const json = (body: unknown, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "private, no-store", Vary: "Cookie" },
});

/** The seam lets tests exercise real HTTP authorization and ownership without
 * inventing test-only sessions or a production authentication bypass. */
export function savedDocumentHandlers(deps: Dependencies) {
  async function handle(request: Request) {
    try {
      if (!deps.configured()) return json({ error: "Innskráning er ekki tilbúin. Leitin er áfram opin." }, 503);
      const userId = await deps.userId();
      if (!userId) return json({ error: "Skráðu þig inn til að vista." }, 401);
      if (request.method === "GET") return json({ items: await deps.list(userId) });
      // These are same-origin cookie-authenticated writes. Reject cross-origin
      // form posts even if a browser happens to attach a session cookie.
      const allowedOrigins = deps.allowedOrigins?.() ?? [];
      // On Railway the Node request URL can contain the internal proxy host.
      // Prefer explicitly configured public origins over trusting forwarded
      // headers supplied by a request; local development can use its own URL.
      const origins = allowedOrigins.length ? allowedOrigins : [new URL(request.url).origin];
      if (!origins.includes(request.headers.get("origin") ?? "") ||
          request.headers.get("content-type")?.split(";")[0] !== "application/json") {
        return json({ error: "Ógild beiðni." }, 403);
      }
      let body: unknown;
      try { body = await request.json(); } catch { return json({ error: "Ógild beiðni." }, 400); }
      if (!body || typeof body !== "object" || !("documentId" in body) ||
          !validDocumentId(body.documentId) || Object.keys(body).some(k => k !== "documentId")) {
        return json({ error: "Ógild beiðni." }, 400);
      }
      if (request.method === "PUT") {
        if (!await deps.exists(body.documentId)) return json({ error: "Úrlausnin fannst ekki." }, 404);
        await deps.save(userId, body.documentId);
      } else if (request.method === "DELETE") {
        await deps.remove(userId, body.documentId);
      } else return json({ error: "Ógild aðgerð." }, 405);
      return json({ ok: true });
    } catch {
      // Do not send database errors or identity/session details to the browser.
      return json({ error: "Ekki tókst að afgreiða vistun. Reyndu aftur." }, 503);
    }
  }
  return { GET: handle, PUT: handle, DELETE: handle };
}
