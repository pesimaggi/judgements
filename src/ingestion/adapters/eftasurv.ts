import pdfParse from "pdf-parse";
import { prisma } from "@/lib/db";
import { normalizeJudgmentText } from "@/lib/judgment-text";
import {
  politeFetchBytes,
  type IngestionAdapter,
  type IngestContext,
  type IngestStats,
} from "../adapter";

/**
 * EFTA Surveillance Authority — the public document database at eftasurv.int.
 *
 * ESA is the EEA's enforcement half: it polices whether Iceland, Liechtenstein
 * and Norway apply the acts the Joint Committee incorporated. Its public
 * document database is the paper trail of that work — **6,725 documents** back
 * to 1994: College decisions, letters of formal notice, reasoned opinions,
 * closure decisions, requests for information, the states' replies, and the
 * State aid notifications under the block exemption regulation.
 *
 * For an Icelandic researcher this is the missing middle of the EEA chain the
 * app already carries at both ends: the act incorporated (EEA-Lex), the
 * enforcement correspondence (here), and the judgment when it reaches
 * Luxembourg (the EFTA Court).
 *
 * VERIFIED against the live site (August 2026):
 *
 *  - robots.txt is `User-agent: *` with an empty `Disallow:` and two query
 *    strings excluded (`?source=pwa`, `?fbclid=*`). Nothing here is off
 *    limits: not the API below, not `/cms/sites/default/files/`.
 *
 *  - **The page is a single-page app, so the HTML is empty** — fetching it
 *    yields "You need to enable JavaScript to run this app". The app reads a
 *    plain JSON API, which is what this adapter reads too:
 *
 *      /cms/api/node?url=<page alias>&search=page%3D<n>
 *
 *    `search` carries what would have been the page's query string, which is
 *    where the paging lives. The response's `listing.data` gives `page`,
 *    `nodesPerPage` (50), `nodesCount` (6,725) and the page's `nodes`. Asking
 *    past the last page returns the last page rather than an empty one, so the
 *    walk is bounded by `nodesCount`, not by an empty response.
 *
 *  - **Each node is one document**, with its title, ESA case number and case
 *    name, document type, the state it concerns, the ESA document number, a
 *    Unix-seconds date, and an `attachment` — the PDF itself.
 *
 *  - **There is no page per document.** The attachment is the publication, so
 *    the PDF is the `officialUrl`, as it already is for Óbyggðanefnd and
 *    Áfrýjunarnefnd neytendamála.
 *
 * THE PDFs ARE FETCHED, unlike the EFTA Court's. Two reasons, both checked
 * rather than assumed. The site asks crawlers to stay out of nothing, so there
 * is no restriction to weigh against the value. And the record without the PDF
 * would be almost empty: a node carries a title and a case name and no prose
 * at all, so the document's own text is the entire substance of this source.
 * A sample of fourteen documents across the whole date range extracted text
 * from all fourteen — these are digital PDFs, not scans.
 *
 * WHAT THE DOCUMENT NUMBER IS NOT is unique: ESA issues one number to a set of
 * documents sent together, so "1620942" can name several PDFs. The attachment
 * URL is the identity, and is what `officialUrl` carries.
 *
 * BOUNDED AND RESUMABLE, on the same pattern as the other archives here: every
 * run enumerates the whole database (135 API calls), diffs it against what is
 * stored, and spends `INGEST_MAX_CASES` fetches on the oldest thing missing. A
 * quiet run costs the enumeration and no document fetches at all.
 * `INGEST_MODE=retry` works the gap ledger and enumerates nothing.
 */

const BASE = (process.env.ESA_BASE ?? "https://www.eftasurv.int").replace(/\/$/, "");

/** The database's page alias, which the API takes as its `url` parameter. */
const LISTING_ALIAS =
  process.env.ESA_LISTING_ALIAS ??
  "/esa-at-a-glance/publications/public-access-to-documents/public-documents";

export const ESA_SOURCE_KEY = "eftasurv";
export const ESA_NAME = "EFTA Surveillance Authority";

/** Below this a PDF is recorded as a gap rather than stored as a document. */
const MIN_TEXT_CHARS = 400;

/** Guard against walking forever if the API stops reporting a count. */
const MAX_LISTING_PAGES = Number(process.env.ESA_MAX_PAGES ?? 400);

/** The three EEA EFTA States, as the node's `state` code writes them. */
const STATES: Record<string, string> = {
  ICE: "Iceland",
  NOR: "Norway",
  LIE: "Liechtenstein",
};

interface ListingNode {
  title?: string | null;
  /** "NOR" | "ICE" | "LIE", when the document concerns one state. */
  state?: string | null;
  country?: { code?: string | null; name?: string | null } | null;
  /** "College Decision", "Letter of Formal Notice", "Correspondence In", … */
  type?: string | null;
  /** ESA's own case number, e.g. "96401". */
  caseNumber?: string | null;
  caseName?: string | null;
  attachment?: { url?: string | null; description?: string | null } | null;
  /** Unix seconds. Absent on the oldest documents. */
  date?: number | null;
  /** ESA's document number. Not unique — see the header. */
  number?: string | null;
  collegeDecision?: string | null;
  description?: string | null;
}

/** One document, as this adapter needs it. */
export interface EsaDocument {
  /** The PDF — the publication itself, and this document's identity. */
  url: string;
  title: string;
  type: string;
  caseNumber: string;
  caseName: string;
  state: string;
  documentNumber: string;
  collegeDecision: string;
  date?: Date;
}

function squish(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function absolute(href: string): string {
  try {
    return new URL(href, `${BASE}/`).toString();
  } catch {
    return "";
  }
}

/**
 * The API URL for one page of the database. `search` is the page's own query
 * string, URL-encoded whole — that is how the site's app passes paging through
 * to the CMS, and a bare `&page=` on the API URL is ignored.
 */
export function listingApiUrl(page: number): string {
  return (
    `${BASE}/cms/api/node?url=${encodeURIComponent(LISTING_ALIAS)}` +
    `&search=${encodeURIComponent(`page=${page}`)}`
  );
}

interface ListingPage {
  page: number;
  nodesPerPage: number;
  nodesCount: number;
  documents: EsaDocument[];
}

/** Reads one API response into documents. Throws if it is not the listing. */
export function parseListingPage(json: string): ListingPage {
  const data = JSON.parse(json)?.listing?.data;
  if (!data || !Array.isArray(data.nodes)) {
    throw new Error("listing.data.nodes missing — the CMS API's shape has changed");
  }

  const documents: EsaDocument[] = [];
  for (const node of data.nodes as ListingNode[]) {
    const url = absolute(node.attachment?.url ?? "");
    if (!url) continue;
    const date =
      typeof node.date === "number" && Number.isFinite(node.date)
        ? new Date(node.date * 1000)
        : undefined;
    documents.push({
      url,
      title: squish(node.title ?? ""),
      type: squish(node.type ?? ""),
      caseNumber: squish(node.caseNumber ?? ""),
      caseName: squish(node.caseName ?? ""),
      state: squish(node.country?.name ?? STATES[node.state ?? ""] ?? ""),
      documentNumber: squish(node.number ?? ""),
      collegeDecision: squish(node.collegeDecision ?? ""),
      date: date && !Number.isNaN(date.getTime()) ? date : undefined,
    });
  }

  return {
    page: Number(data.page) || 1,
    nodesPerPage: Number(data.nodesPerPage) || documents.length,
    nodesCount: Number(data.nodesCount) || documents.length,
    documents,
  };
}

/**
 * The stored record: what the database knows about the document, then the
 * document itself.
 *
 * The headings carry a colon so the shared judgment parser reads them as
 * headings rather than running them into the text beneath — the same shape the
 * EFTA Court and EEA-Lex records use.
 */
const BULLET = "–";

export function composeRecord(doc: EsaDocument, body: string): string {
  const lines: string[] = [ESA_NAME];
  if (doc.title) lines.push(doc.title);
  if (doc.caseName && doc.caseName !== doc.title) lines.push(doc.caseName);

  const details: string[] = [];
  if (doc.type) details.push(`${BULLET} Type: ${doc.type}`);
  if (doc.caseNumber) details.push(`${BULLET} Case number: ${doc.caseNumber}`);
  if (doc.state) details.push(`${BULLET} EEA EFTA State: ${doc.state}`);
  if (doc.collegeDecision) details.push(`${BULLET} College decision: ${doc.collegeDecision}`);
  if (doc.documentNumber) details.push(`${BULLET} Document number: ${doc.documentNumber}`);
  if (details.length) lines.push("", "Case details:", ...details);

  lines.push("", "Document:", body);
  return lines.join("\n");
}

async function recordTotal(total: number): Promise<void> {
  try {
    await prisma.source.updateMany({
      where: { key: ESA_SOURCE_KEY },
      data: { totalAvailable: total },
    });
  } catch {
    // Bookkeeping only — never fail a run over it.
  }
}

/**
 * Every document in the database, newest first, as the API serves them.
 *
 * Paging stops on the count the API itself reports rather than on an empty
 * page: asking past the end returns the last page again, so an "until it comes
 * back empty" loop would never finish. A page that returns nothing new is
 * treated as the end too, which covers the API changing its mind about how
 * many there are.
 */
async function enumerate(ctx: IngestContext): Promise<{ documents: EsaDocument[]; total: number }> {
  const documents: EsaDocument[] = [];
  const seen = new Set<string>();
  let total = 0;

  for (let page = 1; page <= MAX_LISTING_PAGES; page++) {
    let listing: ListingPage;
    try {
      listing = parseListingPage(await ctx.fetchText(listingApiUrl(page)));
    } catch (e) {
      // As elsewhere: one bad page ends the enumeration, not the run. What has
      // been read is still a list of documents worth fetching.
      if (page === 1) throw e;
      ctx.log(`Listing page ${page} failed (${String(e).slice(0, 120)}) — enumerating no further this run.`);
      break;
    }
    if (page === 1) {
      total = listing.nodesCount;
      ctx.log(`ESA lists ${total} public document(s), ${listing.nodesPerPage} per page.`);
    }

    let added = 0;
    for (const doc of listing.documents) {
      if (seen.has(doc.url)) continue;
      seen.add(doc.url);
      documents.push(doc);
      added++;
    }
    if (added === 0) break;
    if (documents.length >= total && total > 0) break;
  }

  return { documents, total: total || documents.length };
}

export const eftaSurvAdapter: IngestionAdapter = {
  key: "eftasurv",
  name: "EFTA Surveillance Authority public documents (eftasurv.int)",
  sourceKeys: [ESA_SOURCE_KEY],

  async run(ctx: IngestContext): Promise<IngestStats> {
    const stats: IngestStats = { indexed: 0, skipped: 0, errors: 0 };
    const mode = process.env.INGEST_MODE || "recent";
    const maxFetches = Number(process.env.INGEST_MAX_CASES ?? 300);

    let fetches = 0;

    const ingestOne = async (doc: EsaDocument): Promise<void> => {
      fetches++;
      const label = doc.title || doc.caseName || doc.url;
      const identity = {
        adapter: "eftasurv",
        source: ESA_SOURCE_KEY,
        officialUrl: doc.url,
        court: ESA_NAME,
        caseNumber: doc.caseNumber || null,
        title: label,
        date: doc.date ?? null,
      };

      let body: string;
      try {
        const { body: bytes } = await politeFetchBytes(doc.url);
        body = normalizeJudgmentText((await pdfParse(bytes)).text);
      } catch (e) {
        stats.errors++;
        stats.errorSample = stats.errorSample ?? String(e);
        ctx.log(`  ${label}: ${String(e).slice(0, 140)}`);
        await ctx.recordGap({ ...identity, reason: "fetch-failed", detail: String(e).slice(0, 300) });
        return;
      }

      if (body.length < MIN_TEXT_CHARS) {
        stats.skipped++;
        await ctx.recordGap({
          ...identity,
          reason: "no-text",
          detail: body.length
            ? `the PDF extracted only ${body.length} chars`
            : "the PDF extracted no text at all — most likely a scan",
        });
        return;
      }

      try {
        const title = doc.title || doc.caseName || doc.documentNumber || doc.url;
        const result = await ctx.save({
          source: ESA_SOURCE_KEY,
          court: ESA_NAME,
          // ESA's case number, which is how its own correspondence refers to
          // the matter ("Case No: 93562"), not the document number.
          caseNumber: doc.caseNumber || undefined,
          caseName: title,
          // What kind of document it is, and which state it concerns, is what
          // separates two documents in the same case — so the title says both.
          title: [doc.type, doc.state].filter(Boolean).join(" · ") || title,
          date: doc.date,
          year: doc.date?.getUTCFullYear(),
          // ESA works in English and publishes in it. A minority of documents
          // are a state's own reply in Icelandic or Norwegian; they are stored
          // as they were published, under the source's declared language.
          language: "en",
          // The document type and the state are ESA's own classification, and
          // are the two filters its database offers over 6,725 documents.
          subjectTags: [doc.type, doc.state].filter(Boolean),
          officialUrl: doc.url,
          pdfUrl: doc.url,
          fullText: composeRecord(doc, body),
        });
        if (result === "indexed") stats.indexed++;
        else stats.skipped++;
      } catch (e) {
        stats.errors++;
        stats.errorSample = stats.errorSample ?? String(e);
        ctx.log(`  ${label}: ${String(e).slice(0, 140)}`);
        await ctx.recordGap({ ...identity, reason: "error", detail: String(e).slice(0, 300) });
      }
    };

    // -----------------------------------------------------------------------
    // Retry sweep: the gap ledger and nothing else, no enumeration in front.
    // -----------------------------------------------------------------------
    if (mode === "retry") {
      const open = await ctx.openGaps([ESA_SOURCE_KEY]);
      ctx.log(`Retry sweep: ${open.length} outstanding document(s); up to ${maxFetches} fetches.`);
      for (const gap of open) {
        if (fetches >= maxFetches) {
          ctx.log(`Reached INGEST_MAX_CASES=${maxFetches}; re-run to continue.`);
          break;
        }
        await ingestOne({
          url: gap.officialUrl,
          title: "",
          type: "",
          caseNumber: gap.caseNumber ?? "",
          caseName: "",
          state: "",
          documentNumber: "",
          collegeDecision: "",
        });
      }
      ctx.log(`Retry sweep done: ${stats.indexed} recovered, ${stats.skipped} still unread.`);
      return stats;
    }

    const { documents, total } = await enumerate(ctx);
    if (documents.length === 0) {
      throw new Error(
        `No documents from ${listingApiUrl(1)} — the database could not be read, and an ` +
          `empty list here is indistinguishable from "nothing new".`
      );
    }
    await recordTotal(total);

    const known = new Set(
      (
        await prisma.document.findMany({
          where: { source: ESA_SOURCE_KEY },
          select: { officialUrl: true },
        })
      ).map((d) => d.officialUrl)
    );
    const missing = documents.filter((d) => !known.has(d.url));
    stats.skipped += documents.length - missing.length;
    ctx.log(
      `Database carries ${documents.length} document(s); ${known.size} stored, ${missing.length} missing. ` +
        `Up to ${maxFetches} fetches this run.`
    );

    // Oldest first. The API serves newest first, and taking it in that order
    // would mean a bounded run re-covering the newest end of a gap it had
    // already filled; from the back, each run's budget lands on new ground.
    for (const doc of missing.reverse()) {
      if (fetches >= maxFetches) {
        ctx.log(`Reached INGEST_MAX_CASES=${maxFetches}; ${missing.length - fetches} left for next run.`);
        break;
      }
      await ingestOne(doc);
    }

    const open = await ctx.openGaps([ESA_SOURCE_KEY]);
    if (open.length) {
      ctx.log(`${open.length} document(s) outstanding — run INGEST_MODE=retry to re-attempt them.`);
      for (const g of open.slice(0, 25)) {
        ctx.log(`  [${g.reason}, ${g.attempts}x] ${g.caseNumber ?? ""} ${g.officialUrl}`);
      }
    }
    ctx.log(`${fetches} document(s) fetched.`);
    return stats;
  },
};
