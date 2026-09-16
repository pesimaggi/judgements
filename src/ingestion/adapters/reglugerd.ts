/**
 * Reglugerð adapter — Icelandic regulations, from reglugerd.is.
 *
 * Regulations are stored in the same table as lög and EU acts, as
 * `jurisdiction: "is", docType: "regulation"`. They are the same shape — a
 * titled instrument with numbered articles, cited by number and year — so the
 * act reader, provision search and the citation linker work on them unchanged.
 * What separates them from lög is `docType`, and every query that means lög
 * must say so; corpusFilter() in src/lib/acts.ts is where that is written.
 *
 * ── Where the data comes from ──────────────────────────────────────────────
 *
 * The register is only enumerable through the JSON API at api.reglugerd.is:
 *   /regulations/newest?page=N        the whole register, newest first, 30 a page
 *   /regulation/{nnnn-yyyy}/current   one regulation, consolidated
 *
 * The site itself has no crawlable index — /reglugerdir/allar/ is a search
 * form that renders one item — so there is no HTML-only route to "what
 * exists". Individual regulations are another matter: about three quarters of
 * them come back from the API as a four-field stub, and their text is on the
 * page the stub points at. So this adapter reads both hosts, and regulation
 * text is fetched from the page whenever the API does not carry it.
 *
 * ── Pace ───────────────────────────────────────────────────────────────────
 *
 * A cold walk of the whole register is about 14,600 requests — every base
 * regulation, plus every amending one, which has to be read for its effects
 * even though it is never stored. At the shared INGEST_DELAY_MS that is some
 * hours of request time spread across the scheduled firings, bounded per run
 * by REGLUGERD_MAX_PAGES. Worth asking island.is for a bulk dump if this is
 * ever re-run from nothing; it would replace the lot with one request.
 *
 * ── What is stored, and what is not ────────────────────────────────────────
 *
 * Base regulations only. More than half the register is amending regulations
 * ("Reglugerð um (1.) breytingu á reglugerð nr. 842/2026 …"), and `/current`
 * already returns the base regulation with its amendments folded in — exactly
 * as Lagasafn publishes a consolidated act and a list of amending acts, and we
 * store one act. Storing them would add several thousand titles to search that
 * nobody searches for and that say nothing on their own.
 *
 * Amending regulations are still *read*, because they are the change signal:
 * an amendment's own `effects[]` names the base regulation it changes, and
 * that base regulation is then re-fetched. That is the whole of incremental
 * change detection here, and it is why the walk cannot skip them.
 */
import { createHash } from "crypto";
import { prisma } from "@/lib/db";
import {
  parseRegulationBody,
  extractRegulationBody,
  parseRegulationName,
  regulationUrl,
  regulationSlug,
  type ParsedRegulation,
} from "@/lib/reglugerd";
import type { IngestionAdapter, IngestContext, IngestStats } from "../adapter";

const API = process.env.REGLUGERD_API ?? "https://api.reglugerd.is/api/v1";

/** Cursor key for the resume point, in the table the other sweeps use. */
const CURSOR_KEY = "reglugerd";

/**
 * What this adapter extracts, as a number — the same self-healing backfill the
 * Lagasafn adapter carries. A regulation whose stored parse is behind this is
 * re-fetched and re-saved even when nothing about it has changed at the
 * source. See PARSE_VERSION there for the argument.
 *
 *   1 — chapters, articles, paragraphs; ministry, dates, amendment history.
 */
const PARSE_VERSION = 1;

/**
 * An optional extra gap between requests, on top of the INGEST_DELAY_MS the
 * shared politeFetch already enforces for every source. Zero by default: this
 * source is paced like the rest of the ingest. REGLUGERD_DELAY_MS raises it
 * for a run that should tread more lightly.
 */
const DELAY_MS = Number(process.env.REGLUGERD_DELAY_MS ?? 0);
let lastRequest = 0;

async function paced<T>(fn: () => Promise<T>): Promise<T> {
  if (DELAY_MS > 0) {
    const wait = lastRequest + DELAY_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
  lastRequest = Date.now();
  return fn();
}

/** One entry in the register listing. */
export interface RegisterEntry {
  /** "0945/2026". */
  name: string;
  number: number;
  year: number;
  title: string;
  /** "base" — a regulation in its own right; "amending" — a change to one. */
  type: string;
  publishedDate: string | null;
  effectiveDate: string | null;
  repealed: boolean;
  ministry: string | null;
}

export function parseRegisterPage(json: unknown): {
  entries: RegisterEntry[];
  totalPages: number;
  totalItems: number;
} {
  const page = json as { data?: unknown[]; totalPages?: number; totalItems?: number };
  const entries: RegisterEntry[] = [];
  for (const raw of page.data ?? []) {
    const it = raw as Record<string, unknown>;
    const name = typeof it.name === "string" ? it.name : "";
    const ref = parseRegulationName(name);
    if (!ref) continue;
    const ministry = it.ministry as { name?: string } | null | undefined;
    entries.push({
      name,
      number: ref.number,
      year: ref.year,
      title: typeof it.title === "string" ? it.title : "",
      type: typeof it.type === "string" ? it.type : "base",
      publishedDate: typeof it.publishedDate === "string" ? it.publishedDate : null,
      effectiveDate: typeof it.effectiveDate === "string" ? it.effectiveDate : null,
      repealed: it.repealed === true,
      ministry: ministry?.name ?? null,
    });
  }
  return {
    entries,
    totalPages: Number(page.totalPages ?? 0),
    totalItems: Number(page.totalItems ?? 0),
  };
}

/** What `/regulation/{slug}/current` answers with, in either of its shapes. */
export interface RegulationRecord {
  name: string;
  number: number;
  year: number;
  title: string;
  /** Null when the API answered with a stub; the text is then on the page. */
  text: string | null;
  type: string | null;
  repealed: boolean;
  ministry: string | null;
  publishedDate: string | null;
  effectiveDate: string | null;
  lastAmendDate: string | null;
  /** Amending regulations folded into `text`, by name ("0840/2021"). */
  amendedBy: string[];
  /** Subject chapters, by name. */
  subjectChapters: string[];
  /** What this regulation does to others — how an amendment names its base. */
  effects: { name: string; effect: string }[];
  originalDocUrl: string | null;
}

export function parseRegulationRecord(json: unknown): RegulationRecord | null {
  const d = json as Record<string, unknown>;
  const name = typeof d.name === "string" ? d.name : "";
  const ref = parseRegulationName(name);
  if (!ref) return null;
  const ministry = d.ministry as { name?: string } | null | undefined;
  const history = Array.isArray(d.history) ? d.history : [];
  const effects = Array.isArray(d.effects) ? d.effects : [];
  const chapters = Array.isArray(d.lawChapters) ? d.lawChapters : [];
  return {
    name,
    number: ref.number,
    year: ref.year,
    title: typeof d.title === "string" ? d.title : "",
    text: typeof d.text === "string" && d.text.trim() ? d.text : null,
    type: typeof d.type === "string" ? d.type : null,
    repealed: d.repealed === true,
    ministry: ministry?.name ?? null,
    publishedDate: typeof d.publishedDate === "string" ? d.publishedDate : null,
    effectiveDate: typeof d.effectiveDate === "string" ? d.effectiveDate : null,
    lastAmendDate: typeof d.lastAmendDate === "string" ? d.lastAmendDate : null,
    amendedBy: history
      .map((h) => (h as { name?: unknown }).name)
      .filter((n): n is string => typeof n === "string"),
    subjectChapters: chapters
      .map((c) => (c as { name?: unknown }).name)
      .filter((n): n is string => typeof n === "string"),
    effects: effects
      .map((e) => e as { name?: unknown; effect?: unknown })
      .filter((e) => typeof e.name === "string")
      .map((e) => ({ name: e.name as string, effect: String(e.effect ?? "") })),
    originalDocUrl: typeof d.originalDoc === "string" ? d.originalDoc : null,
  };
}

function toDate(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Fingerprints everything stored, so an unchanged regulation is not rewritten.
 *
 * The separators are written as escapes rather than as literal control
 * characters, as the Lagasafn adapter's are: typed literally they make the
 * file read as binary to git and grep.
 */
export function hashRegulation(record: RegulationRecord, parsed: ParsedRegulation): string {
  const UNIT = " ";
  const RECORD = "";
  const body = parsed.provisions
    .map((p) => [p.anchor, p.displayLabel, p.heading ?? "", p.fullText].join(UNIT))
    .join(RECORD);
  const meta = [
    record.title,
    record.repealed ? "repealed" : "in_force",
    record.lastAmendDate ?? "",
    record.amendedBy.join(","),
    parsed.structure,
  ].join(UNIT);
  return createHash("sha256").update(`${meta}${RECORD}${body}`).digest("hex");
}

/**
 * Writes one regulation and its structure.
 *
 * Provisions are matched on (actId, anchor) and updated in place, never
 * deleted and recreated, for the reason the Lagasafn adapter gives:
 * `CaseProvisionLink` cascades from `Provision`, and rebuilding would throw
 * away every judgment link each time a regulation was amended.
 */
export async function saveRegulation(
  record: RegulationRecord,
  parsed: ParsedRegulation,
  sourceHash: string
): Promise<void> {
  const fields = {
    title: parsed.title || record.title,
    status: record.repealed ? "repealed" : "in_force",
    currentVersionUrl: regulationUrl(record.number, record.year),
    sourceHash,
    parseVersion: PARSE_VERSION,
    ministry: record.ministry,
    publishedDate: toDate(record.publishedDate),
    entryIntoForce: toDate(record.effectiveDate),
    lastAmendDate: toDate(record.lastAmendDate),
    amendedBy: record.amendedBy,
    subjectChapters: record.subjectChapters,
    originalDocUrl: record.originalDocUrl,
    structureSource: parsed.structure,
    fetchedAt: new Date(),
  };

  const act = await prisma.act.upsert({
    where: {
      jurisdiction_docType_actNumber_year: {
        jurisdiction: "is",
        docType: "regulation",
        actNumber: record.number,
        year: record.year,
      },
    },
    create: {
      jurisdiction: "is",
      docType: "regulation",
      actNumber: record.number,
      year: record.year,
      ...fields,
    },
    update: fields,
  });

  await prisma.chapter.deleteMany({ where: { actId: act.id } });
  const chapterIds: string[] = [];
  for (const [i, c] of parsed.chapters.entries()) {
    const created = await prisma.chapter.create({
      data: {
        actId: act.id,
        numeral: c.numeral,
        letter: null,
        label: c.label,
        title: c.title,
        ordering: i,
      },
    });
    chapterIds.push(created.id);
  }

  const seenAnchors: string[] = [];
  for (const [i, p] of parsed.provisions.entries()) {
    seenAnchors.push(p.anchor);
    const data = {
      chapterId: p.chapterIndex !== null ? (chapterIds[p.chapterIndex] ?? null) : null,
      kind: "article",
      articleNumber: p.articleNumber,
      articleLetter: p.articleLetter,
      displayLabel: p.displayLabel,
      heading: p.heading,
      fullText: p.fullText,
      isRepealed: false,
      ordering: i,
    };
    const provision = await prisma.provision.upsert({
      where: { actId_anchor: { actId: act.id, anchor: p.anchor } },
      create: { actId: act.id, anchor: p.anchor, ...data },
      update: data,
    });

    await prisma.provisionParagraph.deleteMany({ where: { provisionId: provision.id } });
    if (p.paragraphs.length) {
      await prisma.provisionParagraph.createMany({
        data: p.paragraphs.map((par, j) => ({
          provisionId: provision.id,
          number: par.number,
          // reglugerd.is publishes no paragraph anchors, so one is synthesised
          // from the provision's: "A12M1" reads like Lagasafn's "G12M1" and is
          // stable for the same reason — it is derived, not positional.
          anchor: `${p.anchor}M${par.number}`,
          text: par.text,
          ordering: j,
        })),
      });
    }
  }

  await prisma.provision.deleteMany({
    where: { actId: act.id, anchor: { notIn: seenAnchors } },
  });

  if (process.env.SEARCH_PROVIDER === "meilisearch") {
    const { syncActToMeilisearch } = await import("@/lib/search/meilisearch");
    const stored = await prisma.act.findUniqueOrThrow({
      where: { id: act.id },
      include: { provisions: { orderBy: { ordering: "asc" } } },
    });
    await syncActToMeilisearch(stored);
  }
}

/** Fetches one regulation: from the API where it has text, the page where not. */
async function fetchRegulation(
  ctx: IngestContext,
  entry: { number: number; year: number }
): Promise<{ record: RegulationRecord; parsed: ParsedRegulation } | null> {
  const slug = regulationSlug(entry.number, entry.year);
  const json = await paced(() => ctx.fetchText(`${API}/regulation/${slug}/current`));
  const record = parseRegulationRecord(JSON.parse(json));
  if (!record) return null;

  let body = record.text;
  if (!body) {
    // The API answered with a stub. The text is on the page it points at,
    // which is also the host whose robots.txt permits this.
    const page = await paced(() => ctx.fetchText(regulationUrl(entry.number, entry.year)));
    body = extractRegulationBody(page);
  }
  if (!body) return null;
  return { record, parsed: parseRegulationBody(body, record.title) };
}

export const reglugerdAdapter: IngestionAdapter = {
  key: "reglugerd",
  name: "Reglugerðir (reglugerd.is — Icelandic regulations)",
  // Regulations are legislation, not a decision source, so no Source row's
  // lastIngestedAt is stamped — the same as the Lagasafn adapter.
  sourceKeys: [],

  async run(ctx: IngestContext): Promise<IngestStats> {
    const stats: IngestStats = { indexed: 0, skipped: 0, errors: 0 };

    const only = process.env.REGLUGERD_ONLY;
    const maxItems = Number(process.env.REGLUGERD_MAX_ITEMS ?? 400);
    const force = process.env.REGLUGERD_FORCE === "1";

    const known = new Map(
      (
        await prisma.act.findMany({
          where: { jurisdiction: "is", docType: "regulation" },
          select: {
            actNumber: true,
            year: true,
            sourceHash: true,
            parseVersion: true,
          },
        })
      ).map((a) => [`${a.actNumber}/${a.year}`, a])
    );

    /** Base regulations to (re-)fetch, keyed "number/year". */
    const wanted = new Map<string, { number: number; year: number; title: string }>();

    if (only) {
      // Diagnostic: one regulation, bypassing the register walk entirely.
      const ref = parseRegulationName(only);
      if (!ref) throw new Error(`REGLUGERD_ONLY must be like 300/2020, got ${only}`);
      wanted.set(`${ref.number}/${ref.year}`, { ...ref, title: "" });
    } else {
      await collectFromRegister(ctx, stats, wanted, maxItems);
    }

    const behind = Array.from(known.values()).filter(
      (a) => a.parseVersion !== PARSE_VERSION
    ).length;
    if (behind > 0) {
      ctx.log(`${behind} regulation(s) stored by an older parse (< v${PARSE_VERSION}).`);
    }

    for (const [key, entry] of wanted) {
      if (stats.indexed + stats.skipped >= maxItems) break;
      try {
        const existing = known.get(key);
        const stale = !existing || existing.parseVersion !== PARSE_VERSION;

        const fetched = await fetchRegulation(ctx, entry);
        if (!fetched) {
          // No text from the API and none readable on the page. Counted, not
          // fatal: a regulation published only as a scan is a real part of the
          // register, and re-fetching it will not change that.
          stats.skipped++;
          ctx.log(`  ${key}: no readable text at either source`);
          continue;
        }
        const { record, parsed } = fetched;
        if (parsed.provisions.length === 0) {
          stats.skipped++;
          ctx.log(`  ${key} "${record.title}": no articles could be read`);
          continue;
        }

        const hash = hashRegulation(record, parsed);
        if (!force && !stale && existing?.sourceHash === hash) {
          stats.skipped++;
          continue;
        }

        if (ctx.dryRun) {
          ctx.log(
            `  [dry run] ${key} "${record.title}" — ${parsed.provisions.length} articles,` +
              ` ${parsed.structure}`
          );
          stats.indexed++;
          continue;
        }

        await saveRegulation(record, parsed, hash);
        stats.indexed++;
        if (stats.indexed % 25 === 0) ctx.log(`  … ${stats.indexed} regulations written`);
      } catch (e) {
        stats.errors++;
        stats.errorSample = stats.errorSample ?? `${key}: ${String(e)}`;
        ctx.log(`  error on ${key}: ${String(e).slice(0, 200)}`);
      }
    }

    return stats;
  },
};

/**
 * Walks the register from the stored cursor, filling `wanted` with the base
 * regulations this run should fetch.
 *
 * An amending entry contributes the base regulation it changes rather than
 * itself — see the header. It costs one request to learn that, which is why
 * the walk is bounded by pages as well as by items: a page of thirty
 * amendments is thirty requests before a single regulation is stored.
 */
async function collectFromRegister(
  ctx: IngestContext,
  stats: IngestStats,
  wanted: Map<string, { number: number; year: number; title: string }>,
  maxItems: number
): Promise<void> {
  const cursor = await prisma.ingestCursor.findUnique({ where: { key: CURSOR_KEY } });
  let page = cursor ? Math.max(1, cursor.nextPage) : 1;

  const readPage = async (n: number) =>
    parseRegisterPage(JSON.parse(await paced(() => ctx.fetchText(`${API}/regulations/newest?page=${n}`))));

  let first = await readPage(page);
  if (first.entries.length === 0 && page > 1) {
    ctx.log(`Page ${page} is past the end of the register; starting over.`);
    page = 1;
    first = await readPage(page);
  }
  ctx.log(`Register: ${first.totalItems} regulations across ${first.totalPages} pages`);

  const maxPages = Number(process.env.REGLUGERD_MAX_PAGES ?? 8);
  let pagesRead = 0;
  let current = first;
  for (; page <= first.totalPages && pagesRead < maxPages && wanted.size < maxItems; page++) {
    if (pagesRead > 0) current = await readPage(page);
    pagesRead++;

    for (const e of current.entries) {
      // Checked per entry, not just per page. An amending entry costs a
      // request of its own before anything is stored, so a page-level check
      // lets one page do thirty requests under a cap of three.
      if (wanted.size >= maxItems) return finish();
      if (e.type !== "amending") {
        wanted.set(`${e.number}/${e.year}`, { number: e.number, year: e.year, title: e.title });
        continue;
      }
      try {
        const slug = regulationSlug(e.number, e.year);
        const rec = parseRegulationRecord(
          JSON.parse(await paced(() => ctx.fetchText(`${API}/regulation/${slug}/current`)))
        );
        for (const eff of rec?.effects ?? []) {
          const ref = parseRegulationName(eff.name);
          if (!ref) continue;
          wanted.set(`${ref.number}/${ref.year}`, { ...ref, title: "" });
        }
      } catch (err) {
        stats.errors++;
        stats.errorSample = stats.errorSample ?? `${e.name}: ${String(err)}`;
        ctx.log(`  error reading amendment ${e.name}: ${String(err).slice(0, 160)}`);
      }
    }
  }

  await finish();

  /**
   * Parks the cursor wherever the walk stopped, and wraps at the end.
   *
   * A page whose entries all failed is still left behind rather than retried
   * now: the walk wraps, so it comes round again on its own, and a page that
   * fails because the source is having a bad afternoon should not stop the
   * rest of the register being read. A cold start reaches the whole register
   * in about 489/REGLUGERD_MAX_PAGES runs.
   */
  async function finish(): Promise<void> {
    const next = page > first.totalPages ? 1 : page;
    await prisma.ingestCursor.upsert({
      where: { key: CURSOR_KEY },
      create: { key: CURSOR_KEY, nextPage: next },
      update: { nextPage: next },
    });
    ctx.log(`Cursor: next run resumes at register page ${next}/${first.totalPages}`);
  }
}
