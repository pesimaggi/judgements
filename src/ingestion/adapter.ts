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
  /**
   * True when the run must not write anything. `save`, `recordGap` and
   * `retire` already honour it on their own, so an adapter only needs to read
   * this when it writes through Prisma directly — a one-off migration or
   * clean-up step, which has no context helper to hide behind.
   */
  dryRun: boolean;
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
  /**
   * Record a case we know exists but could not store. Call this on every path
   * that gives up on a case; `save` clears the row again when the case finally
   * lands, so the open rows stay an accurate to-do list rather than a log.
   */
  recordGap(gap: GapRecord): Promise<void>;
  /** Open (unresolved) gaps for these sources, oldest attempt first. */
  openGaps(sources: string[]): Promise<OpenGap[]>;
  /**
   * Delete stored documents, by official URL. Returns how many rows went.
   * This is the only path that also drops them from the search index, so it
   * is the only correct way to remove a document: deleting the rows directly
   * leaves every one of them findable in Meilisearch.
   *
   * It exists for a source that stops publishing what it published, which is
   * rare and always deliberate. Its one standing use is the EEA Joint
   * Committee adapter's purge of the withdrawn EEA-Lex acts register — see
   * that adapter's header. Every other source here publishes an archive that
   * only grows, and must never call this.
   */
  retire(source: string, officialUrls: string[]): Promise<number>;
  /**
   * URLs already known to be terminally unreadable, so a listing pass can
   * leave them out of its work. `openGaps` filters them from the retry
   * sweeps; this is the other half, for the pass that decides what is missing
   * by diffing a listing against what is stored — an unreadable document is
   * never stored, so without this it looks missing on every firing and is
   * re-fetched for ever.
   */
  terminalGaps(sources: string[]): Promise<Set<string>>;
  log(msg: string): void;
}

/**
 * Why a case seen in a listing did not get stored.
 *
 * "pending" is the one that is not a failure: the case is known to exist and
 * has simply not been fetched yet. Only the EEA Joint Committee adapter writes
 * it, and it writes it for one reason — the acts register that used to say
 * which decisions exist was withdrawn, so the outstanding decisions were moved
 * into this ledger to keep the to-do list rather than lose it with the acts.
 *
 * "unreadable" is the one that is terminal. Everything else here describes
 * something a later run might succeed at, and the retry sweeps re-attempt them
 * for exactly that reason; this one says the bytes at that URL are not a
 * document we can ever read — ESA publishes spreadsheets and scanned e-mails
 * under a .XLS or .JPG name, and no number of re-fetches turns one into a PDF.
 * See TERMINAL_REASONS.
 */
export type GapReason =
  | "no-text"
  | "fetch-failed"
  | "unmapped-court"
  | "pending"
  | "error"
  | "unreadable";

/**
 * Gap reasons a retry sweep must not pick up again.
 *
 * They stay in the ledger and keep being counted — the shortfall is real and
 * should be visible — but re-fetching them is spending a bounded budget on a
 * guaranteed failure. Before this, ESA's 33 non-PDF documents were re-fetched
 * on every three-hourly firing, for ever.
 */
const TERMINAL_REASONS: GapReason[] = ["unreadable"];

export interface GapRecord {
  adapter: string;
  source: string;
  officialUrl: string;
  court?: string | null;
  caseNumber?: string | null;
  title?: string | null;
  date?: Date | null;
  reason: GapReason;
  detail?: string | null;
}

export interface OpenGap {
  source: string;
  officialUrl: string;
  court: string | null;
  caseNumber: string | null;
  /**
   * What the listing knew the case was called. Carried through because a
   * listing often states things the document itself does not: EUR-Lex's title
   * for a judgment holds its parties, its referring court and the Court's own
   * index terms, none of which appear in the judgment's text.
   */
  title: string | null;
  /** The date recorded when the gap was written, if the listing gave one. */
  date: Date | null;
  reason: string;
  attempts: number;
}

const DELAY_MS = Number(process.env.INGEST_DELAY_MS ?? 1500);
const USER_AGENT =
  process.env.INGEST_USER_AGENT ??
  "logbrunnur-mvp/0.1 (unofficial legal research tool)";

let lastFetch = 0;

const RETRY_BASE_MS = Number(process.env.INGEST_RETRY_BASE_MS ?? 3000);
const MAX_RETRIES = 3;
const TOO_MANY_REQUESTS = 429;

/**
 * The largest response any adapter will read into memory.
 *
 * This exists because a single document killed a production run. EUR-Lex
 * serves Commission Implementing Regulation (EU) 2024/348 — the EBA benchmark
 * portfolio standards, which are annexes of spreadsheets — as 193 MB of
 * XHTML, and its neighbour 2024/351 as 226 MB. Buffering either and handing it
 * to cheerio needs far more than Node's ~4 GB default heap, so the process
 * died with "Ineffective mark-compacts near heap limit" and the whole adapter
 * exited 134, having stored nothing.
 *
 * A cap turns that from a crash into one skipped document. 32 MB is far above
 * anything this corpus legitimately holds — the largest are Óbyggðanefnd's
 * þjóðlendu úrskurðir at about 5 MB — and far below what the heap can take.
 *
 * Cellar answers chunked with no Content-Length, so the limit cannot be
 * enforced from the headers alone: the body is read incrementally and the
 * connection dropped the moment the cap is passed, which also means the 193 MB
 * is never transferred. Raise INGEST_MAX_BYTES for a deliberate one-off.
 */
const MAX_BYTES = Number(process.env.INGEST_MAX_BYTES ?? 32 * 1024 * 1024);

/**
 * A response bigger than an adapter will hold in memory. Distinct from a
 * fetch failure because it is not transient and re-attempting it is pointless:
 * the caller records it as terminal rather than as work still to do.
 */
export class ResponseTooLargeError extends Error {
  readonly url: string;
  readonly limit: number;
  /** Bytes read before giving up — a lower bound when the body was chunked. */
  readonly bytesRead: number;

  constructor(url: string, bytesRead: number, limit: number, exact: boolean) {
    const mb = (n: number) => `${(n / 1024 / 1024).toFixed(0)} MB`;
    super(
      `response exceeds the ${mb(limit)} limit for ${url}` +
        (exact ? ` (${mb(bytesRead)} declared)` : ` (stopped reading at ${mb(bytesRead)})`)
    );
    this.name = "ResponseTooLargeError";
    this.url = url;
    this.limit = limit;
    this.bytesRead = bytesRead;
  }
}

/**
 * Reads a response body, giving up once it passes MAX_BYTES.
 *
 * Content-Length is checked first where the server sends one, so an oversized
 * document costs no transfer at all. Where it does not — Cellar answers
 * `transfer-encoding: chunked` — the body is read chunk by chunk and the
 * connection cancelled at the cap.
 *
 * Exported for its test: the behaviour worth pinning down is what it does to a
 * body of a given shape, which is awkward to reach through the rate limiter.
 */
export async function readCapped(res: Response, url: string): Promise<Buffer> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BYTES) {
    await res.body?.cancel();
    throw new ResponseTooLargeError(url, declared, MAX_BYTES, true);
  }
  if (!res.body) return Buffer.from(await res.arrayBuffer());

  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      throw new ResponseTooLargeError(url, total, MAX_BYTES, false);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, total);
}

/** How long a 429's Retry-After asks us to wait, in ms. Capped, and undefined
 *  if the header is absent or is a date we cannot read. */
function retryAfterMs(res: Response): number | undefined {
  const header = res.headers.get("retry-after");
  if (!header) return undefined;
  const seconds = Number(header.trim());
  const ms = Number.isFinite(seconds)
    ? seconds * 1000
    : Date.parse(header) - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return undefined;
  return Math.min(ms, 60_000);
}

/**
 * Rate-limited fetch. One request at a time, min INGEST_DELAY_MS between
 * requests, honest User-Agent. Before enabling any adapter against a live
 * site, check its robots.txt and terms of use — see README "Adding a source".
 *
 * Retries a few times with backoff on 5xx (observed to be transient — a
 * case page can 503 once and succeed seconds later, likely a rarely-cached
 * page being rendered on demand upstream) and on 429, where the server is
 * explicitly asking for a slower pace and says how long to wait. Other 4xx
 * (e.g. a genuine 404) fail immediately since retrying won't change the
 * outcome.
 */
export async function politeFetchText(
  url: string,
  headers?: Record<string, string>
): Promise<string> {
  const { body, contentType } = await politeFetchBytes(url, headers);
  return decodeHtml(body, contentType);
}

/**
 * The bytes behind politeFetchText, sharing its rate limiter and retries.
 * Needed where the response's own encoding has to be inspected rather than
 * assumed — see decodeHtml().
 *
 * `headers` are merged over the shared User-Agent, for a source that serves a
 * machine something different from what it serves a browser: Cellar, the
 * Publications Office's content API, answers 404 unless asked for a format it
 * holds the document in — see src/lib/eur-lex.ts.
 */
export async function politeFetchBytes(
  url: string,
  headers?: Record<string, string>
): Promise<{ body: Buffer; contentType: string | null }> {
  for (let attempt = 0; ; attempt++) {
    const wait = lastFetch + DELAY_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastFetch = Date.now();
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, ...headers } });
    if (res.ok) {
      // Throws ResponseTooLargeError rather than retrying: a document does not
      // get smaller on a second attempt.
      return { body: await readCapped(res, url), contentType: res.headers.get("content-type") };
    }
    const retryable = res.status >= 500 || res.status === TOO_MANY_REQUESTS;
    if (!retryable || attempt >= MAX_RETRIES) {
      throw new Error(`HTTP ${res.status} for ${url}`);
    }
    // A 429 usually carries Retry-After, and a server that has told us how
    // long to wait deserves to be taken at its word rather than backed off
    // against a schedule of our own.
    await new Promise((r) => setTimeout(r, retryAfterMs(res) ?? RETRY_BASE_MS * 2 ** attempt));
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

/**
 * Records a case we know exists but could not store, or bumps the attempt
 * count on one already recorded. Never throws: a bookkeeping failure must not
 * cost us the rest of the run.
 */
export async function recordIngestGap(gap: GapRecord): Promise<void> {
  try {
    await prisma.ingestGap.upsert({
      where: { source_officialUrl: { source: gap.source, officialUrl: gap.officialUrl } },
      create: {
        adapter: gap.adapter,
        source: gap.source,
        officialUrl: gap.officialUrl,
        court: gap.court ?? null,
        caseNumber: gap.caseNumber ?? null,
        title: gap.title ?? null,
        date: gap.date ?? null,
        reason: gap.reason,
        detail: gap.detail?.slice(0, 500) ?? null,
      },
      update: {
        // A re-attempt that fails differently should say so, and a row that
        // was resolved and has regressed becomes open again.
        reason: gap.reason,
        detail: gap.detail?.slice(0, 500) ?? null,
        attempts: { increment: 1 },
        lastTriedAt: new Date(),
        resolvedAt: null,
      },
    });
  } catch {
    // Deliberately silent: see above.
  }
}

/** Open gaps for these sources, least-attempted first so a case that keeps
 *  failing cannot monopolise a bounded retry budget. Terminal ones are left
 *  out: they are still missing, but re-fetching them cannot change that. */
export async function openIngestGaps(sources: string[]): Promise<OpenGap[]> {
  return prisma.ingestGap.findMany({
    where: {
      source: { in: sources },
      resolvedAt: null,
      reason: { notIn: TERMINAL_REASONS },
    },
    orderBy: [{ attempts: "asc" }, { lastTriedAt: "asc" }],
    select: {
      source: true, officialUrl: true, court: true, caseNumber: true,
      title: true, date: true, reason: true, attempts: true,
    },
  });
}

/**
 * The URLs of terminal gaps — recorded as missing for a reason no re-fetch can
 * change. See TERMINAL_REASONS and IngestContext.terminalGaps.
 */
export async function terminalGapUrls(sources: string[]): Promise<Set<string>> {
  const rows = await prisma.ingestGap.findMany({
    where: { source: { in: sources }, resolvedAt: null, reason: { in: TERMINAL_REASONS } },
    select: { officialUrl: true },
  });
  return new Set(rows.map((row) => row.officialUrl));
}

/** Marks any gap for this document closed. Cheap enough to do unconditionally:
 *  the (source, officialUrl) unique index makes it a single indexed update. */
async function resolveIngestGap(source: string, officialUrl: string): Promise<void> {
  try {
    await prisma.ingestGap.updateMany({
      where: { source, officialUrl, resolvedAt: null },
      data: { resolvedAt: new Date() },
    });
  } catch {
    // Bookkeeping only — never fail a successful save over it.
  }
}

/**
 * Deletes stored documents for a source, by official URL. Their citation
 * links go with them (both link tables cascade on the document), and so do
 * their gap rows: a case the source has withdrawn is not a case we are still
 * missing.
 *
 * Chunked, because the caller's list is a whole source's worth of URLs and a
 * single `IN` of several thousand strings is a query nobody wants to debug.
 */
export async function retireDocuments(source: string, officialUrls: string[]): Promise<number> {
  const CHUNK = 500;
  let removed = 0;
  for (let i = 0; i < officialUrls.length; i += CHUNK) {
    const batch = officialUrls.slice(i, i + CHUNK);
    const rows = await prisma.document.findMany({
      where: { source, officialUrl: { in: batch } },
      select: { id: true },
    });
    if (rows.length === 0) continue;
    await prisma.document.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
    await prisma.ingestGap.deleteMany({ where: { source, officialUrl: { in: batch } } });
    if (process.env.SEARCH_PROVIDER === "meilisearch") {
      const { deleteDocumentsFromMeilisearch } = await import("@/lib/search/meilisearch");
      await deleteDocumentsFromMeilisearch(rows.map((r) => r.id));
    }
    removed += rows.length;
  }
  return removed;
}

/**
 * Removes the one character PostgreSQL cannot store.
 *
 * A `text` column holds any Unicode except U+0000: the driver sends the value
 * as UTF-8 and the server answers `22021 invalid byte sequence for encoding
 * "UTF8": 0x00`, which Prisma surfaces as an opaque
 * `PrismaClientUnknownRequestError`. Nothing about the message says "your text
 * has a NUL in it", which is why this took a reproduction to find.
 *
 * The documents that carry them are real: ESA publishes e-mail exports,
 * spreadsheets and .MSG attachments as PDFs, and pdf-parse hands back their
 * embedded binary as NUL-riddled text. Before this, every one of those failed
 * to store, was written to the gap ledger, and was re-fetched on every retry
 * sweep to fail again — the ledger showed the same documents at 21, 27, 29
 * attempts. A character no database can hold is not a transient failure.
 *
 * Stripping is the right repair rather than rejecting the document: what
 * surrounds the NULs is the readable text of the document, and it is what
 * someone searching would want to find.
 */
export function stripNulls(text: string): string {
  return text.includes("\u0000") ? text.replace(/\u0000/g, "") : text;
}

export async function saveDocument(doc: NormalizedDocument): Promise<"indexed" | "skipped"> {
  // Before the hash, so that a document's hash is the hash of what is stored:
  // hashing the raw text would make every stripped document look changed on
  // the next run and be rewritten for ever.
  const fullText = stripNulls(doc.fullText);
  const textHash = hashText(fullText);
  const existing = await prisma.document.findUnique({
    where: { source_officialUrl: { source: doc.source, officialUrl: doc.officialUrl } },
    select: { id: true, textHash: true },
  });
  // Unchanged, but stored — so it is not a gap, whatever an earlier run thought.
  if (existing?.textHash === textHash) {
    await resolveIngestGap(doc.source, doc.officialUrl);
    return "skipped";
  }

  // Every text field, not just the body: a NUL anywhere in the row fails the
  // whole insert, and these documents carry titles taken from the same
  // extraction as their text.
  const data = {
    source: doc.source,
    court: stripNulls(doc.court),
    caseNumber: doc.caseNumber ? stripNulls(doc.caseNumber) : null,
    caseName: doc.caseName ? stripNulls(doc.caseName) : null,
    title: stripNulls(doc.title),
    date: doc.date ?? null,
    year: doc.year ?? (doc.date ? doc.date.getFullYear() : null),
    language: doc.language,
    parties: doc.parties ? stripNulls(doc.parties) : null,
    subjectTags: doc.subjectTags.map(stripNulls),
    officialUrl: doc.officialUrl,
    pdfUrl: doc.pdfUrl ?? null,
    htmlUrl: doc.htmlUrl ?? null,
    fullText,
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
  // The case has landed; whatever kept it out before no longer applies.
  await resolveIngestGap(doc.source, doc.officialUrl);
  return "indexed";
}
