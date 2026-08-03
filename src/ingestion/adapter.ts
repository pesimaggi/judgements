import { createHash } from "crypto";
import { prisma } from "@/lib/db";
import type { NormalizedDocument } from "@/lib/types";

export interface IngestStats {
  indexed: number;
  skipped: number;
  errors: number;
  errorSample?: string;
}

export interface IngestionAdapter {
  /** Stable adapter name, e.g. "icelandic-courts". Not a source key. */
  key: string;
  name: string;
  /**
   * The source keys (src/lib/sources.ts) this adapter feeds. Used to stamp
   * Source.lastIngestedAt after a run — an adapter can serve several sources,
   * as the Icelandic one does for its three courts.
   */
  sourceKeys: string[];
  /**
   * Run one ingestion pass. Implementations should be incremental where the
   * source allows it (e.g. newest-first pages, stop when known docs appear).
   */
  run(ctx: IngestContext): Promise<IngestStats>;
}

export interface IngestContext {
  /** Polite fetch: shared UA, rate-limited, throws on non-2xx. */
  fetchText(url: string): Promise<string>;
  /** Upsert a normalized document; returns "indexed" or "skipped" (unchanged). */
  save(doc: NormalizedDocument): Promise<"indexed" | "skipped">;
  /**
   * Whether this document has already been stored. Lets an incremental run
   * skip a case before paying for its detail-page fetch, which is the
   * expensive, rate-limited part of ingestion.
   */
  isKnown(source: string, officialUrl: string): Promise<boolean>;
  log(msg: string): void;
}

const DELAY_MS = Number(process.env.INGEST_DELAY_MS ?? 1500);
const USER_AGENT =
  process.env.INGEST_USER_AGENT ??
  "logbrunnur-mvp/0.1 (unofficial legal research tool)";

let lastFetch = 0;

const RETRY_BASE_MS = Number(process.env.INGEST_RETRY_BASE_MS ?? 3000);
const MAX_RETRIES = 3;

/**
 * Rate-limited fetch. One request at a time, min INGEST_DELAY_MS between
 * requests, honest User-Agent. Before enabling any adapter against a live
 * site, check its robots.txt and terms of use — see README "Adding a source".
 *
 * Retries a few times with backoff on 5xx (observed to be transient — a
 * case page can 503 once and succeed seconds later, likely a rarely-cached
 * page being rendered on demand upstream); 4xx (e.g. a genuine 404) fails
 * immediately since retrying won't change the outcome.
 */
export async function politeFetchText(url: string): Promise<string> {
  const { body, contentType } = await politeFetchBytes(url);
  return decodeHtml(body, contentType);
}

/**
 * The bytes behind politeFetchText, sharing its rate limiter and retries.
 * Needed where the response's own encoding has to be inspected rather than
 * assumed — see decodeHtml().
 */
export async function politeFetchBytes(
  url: string
): Promise<{ body: Buffer; contentType: string | null }> {
  for (let attempt = 0; ; attempt++) {
    const wait = lastFetch + DELAY_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastFetch = Date.now();
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (res.ok) {
      return {
        body: Buffer.from(await res.arrayBuffer()),
        contentType: res.headers.get("content-type"),
      };
    }
    if (res.status < 500 || attempt >= MAX_RETRIES) {
      throw new Error(`HTTP ${res.status} for ${url}`);
    }
    await new Promise((r) => setTimeout(r, RETRY_BASE_MS * 2 ** attempt));
  }
}

/**
 * Decodes an HTML response using the encoding it actually declares.
 *
 * Not every Icelandic source serves UTF-8: Lagasafn's live pages do, but its
 * bulk zip is ISO-8859-1, and decoding those bytes as UTF-8 turns every
 * accented character into a replacement char. Trusting `Response.text()`
 * (which assumes UTF-8 when the header omits a charset) silently corrupts
 * exactly the characters this project exists to preserve.
 *
 * Order of preference: the Content-Type header, then the document's own
 * <meta charset>, then UTF-8.
 */
export function decodeHtml(body: Buffer, contentType?: string | null): string {
  const fromHeader = /charset=["']?([\w-]+)/i.exec(contentType ?? "")?.[1];
  // The meta tag is ASCII-compatible in every encoding we care about, so
  // sniffing it from a latin1 view of the head of the document is safe.
  const head = body.subarray(0, 4096).toString("latin1");
  const fromMeta =
    /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1] ??
    /<\?xml[^>]+encoding=["']([\w-]+)/i.exec(head)?.[1];

  const label = (fromHeader ?? fromMeta ?? "utf-8").toLowerCase();
  try {
    return new TextDecoder(label).decode(body);
  } catch {
    // An unknown or misspelled charset label should not fail the ingest.
    return new TextDecoder("utf-8").decode(body);
  }
}

export function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export async function isDocumentKnown(source: string, officialUrl: string): Promise<boolean> {
  const existing = await prisma.document.findUnique({
    where: { source_officialUrl: { source, officialUrl } },
    select: { id: true },
  });
  return existing !== null;
}

export async function saveDocument(doc: NormalizedDocument): Promise<"indexed" | "skipped"> {
  const textHash = hashText(doc.fullText);
  const existing = await prisma.document.findUnique({
    where: { source_officialUrl: { source: doc.source, officialUrl: doc.officialUrl } },
    select: { id: true, textHash: true },
  });
  if (existing?.textHash === textHash) return "skipped";

  const data = {
    source: doc.source,
    court: doc.court,
    caseNumber: doc.caseNumber ?? null,
    caseName: doc.caseName ?? null,
    title: doc.title,
    date: doc.date ?? null,
    year: doc.year ?? (doc.date ? doc.date.getFullYear() : null),
    language: doc.language,
    parties: doc.parties ?? null,
    subjectTags: doc.subjectTags,
    officialUrl: doc.officialUrl,
    pdfUrl: doc.pdfUrl ?? null,
    htmlUrl: doc.htmlUrl ?? null,
    fullText: doc.fullText,
    textHash,
    isSample: doc.isSample ?? false,
  };

  const saved = existing
    ? await prisma.document.update({ where: { id: existing.id }, data })
    : await prisma.document.create({ data });

  if (process.env.SEARCH_PROVIDER === "meilisearch") {
    const { syncDocumentToMeilisearch } = await import("@/lib/search/meilisearch");
    await syncDocumentToMeilisearch(saved);
  }
  return "indexed";
}
