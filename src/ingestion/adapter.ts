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
  /** Stable source key — must match a key in src/lib/sources.ts. */
  key: string;
  name: string;
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
  for (let attempt = 0; ; attempt++) {
    const wait = lastFetch + DELAY_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastFetch = Date.now();
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (res.ok) return res.text();
    if (res.status < 500 || attempt >= MAX_RETRIES) {
      throw new Error(`HTTP ${res.status} for ${url}`);
    }
    await new Promise((r) => setTimeout(r, RETRY_BASE_MS * 2 ** attempt));
  }
}

export function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
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
