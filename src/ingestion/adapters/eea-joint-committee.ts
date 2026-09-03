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
 * The decisions of the EEA Joint Committee — one record per JCD, carrying the
 * decision's own text: "DECISION OF THE EEA JOINT COMMITTEE No 25/2010 of 12
 * March 2010 amending Annex II … to the EEA Agreement". This is the legal
 * instrument by which an EU act enters the EEA Agreement, and it is what
 * someone looking for a decision of the Joint Committee is looking for.
 *
 * WHAT THIS ADAPTER USED TO BE, AND WHY IT IS NOT ANY MORE. Until now this was
 * the `eea-lex` adapter, and it fed two sources: these decisions, and a second
 * source of ~9,164 **EU acts in force**, one record per EEA-Lex factsheet,
 * walked off efta.int/eea-lex filtered to `case_status:14`. That acts register
 * was not the right thing to be ingesting and has been withdrawn — the source,
 * the walk that fed it and the records it stored are all gone, and PURGE below
 * is what removes them from a database that already holds them. EEA-Lex will
 * be ingested again, differently; when it is, it starts from a clean name and
 * an empty table rather than from this.
 *
 * WHERE THE DECISIONS COME FROM NOW. They used to be derived from the acts:
 * every factsheet named its JCD and linked that decision's English PDF, so
 * grouping the stored factsheets by decision number yielded both the set of
 * decisions and, for free, the filter to the ones still doing something. With
 * the acts gone that derivation is gone with them, and this adapter is driven
 * by the gap ledger instead: every decision we know exists but do not hold has
 * an IngestGap row, and a run is one fetch per row until the budget is spent.
 *
 * That is a complete to-do list but not a growing one. The ledger was seeded
 * from the acts at purge time, so the backlog it holds is every decision the
 * register named on the day it was withdrawn, and this adapter will work that
 * backlog to the end — but it discovers nothing new, because it walks no
 * listing of its own. Until it is given one, the source is complete as of that
 * day and honest about it, rather than silently frozen half-fetched.
 *
 * WHERE THAT LISTING SHOULD COME FROM. EUR-Lex publishes these decisions too,
 * in sector 2 — Decision No 154/2018 is CELEX `22018D1022` there, numbered by
 * its place in the Official Journal rather than by its decision number. So the
 * SPARQL endpoint the `eur-lex` adapter already talks to can enumerate every
 * JCD that exists, which is exactly the listing missing here, and Cellar can
 * serve each one's text without a PDF to parse.
 *
 * That is a *listing* for this adapter to walk, not a second ingestion: the
 * decisions are stored once, as documents, under this source. The `eur-lex`
 * adapter deliberately sweeps sector 3 only and must keep doing so — see its
 * TYPES constant — or the same decision would be stored twice, once as a
 * document here and once as an act there.
 *
 * ONE FETCH PER RECORD. The English PDF named by the ledger is the decision's
 * publication and its identity here: `officialUrl` and `pdfUrl` are both that
 * PDF, because a JCD has no page of its own on efta.int. There is no listing
 * to walk and nothing to diff, so a quiet run — one with an empty backlog —
 * costs no requests at all.
 *
 * NOTHING IS RETIRED. The acts pass filtered to what was in force and removed
 * a decision once the last act it incorporated fell out of force. Without that
 * filter there is nothing here that can tell a withdrawn decision from one we
 * simply have, so this adapter deletes nothing but the acts it is purging. A
 * decision that has been superseded stays, which is the safe direction: a JCD
 * is a historical instrument, and the Committee does not unpublish them.
 */

/** The decisions source in src/lib/sources.ts. */
export const DECISIONS_SOURCE_KEY = "eea-joint-committee";
export const DECISIONS_NAME = "Sameiginlega EES-nefndin (EEA Joint Committee)";

/**
 * The withdrawn acts register. Named here only so PURGE can find what it has
 * to delete; it is no longer a source, and nothing is ever written under it.
 */
const RETIRED_ACTS_SOURCE_KEY = "eea-lex";

/** The adapter key the acts and the decisions shared before the split. */
const FORMER_ADAPTER_KEY = "eea-lex";

/**
 * Below this a decision PDF is recorded as a gap rather than stored. The
 * shortest real JCD measured runs to about 1,700 characters; 600 leaves room
 * for one shorter than any seen without accepting an empty extraction.
 */
const MIN_DECISION_CHARS = 600;

const BULLET = "–";

function squish(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** "7/94" → 1994, "25/2010" → 2010. The early decisions are numbered /94. */
export function decisionYear(number: string): number | undefined {
  const raw = /\/(\d{2,4})$/.exec(number)?.[1];
  if (!raw) return undefined;
  const n = Number(raw);
  if (raw.length === 4) return n;
  return n >= 90 ? 1900 + n : 2000 + n;
}

/**
 * "7/1994" → 1994007, so decisions sort oldest first and in number order
 * within a year. A number that will not parse sorts last rather than throwing.
 */
function decisionRank(number: string | null): number {
  if (!number) return Number.MAX_SAFE_INTEGER;
  const m = /^(\d+)\/(\d{2,4})$/.exec(number);
  const year = m ? decisionYear(number) : undefined;
  if (!m || year === undefined) return Number.MAX_SAFE_INTEGER;
  return year * 1000 + Math.min(Number(m[1]), 999);
}

/** A decision to fetch: what the ledger knows about one before it is read. */
export interface DecisionSeed {
  /** "7/1994" — the number as EEA-Lex wrote it, normalised. */
  number: string;
  /** The decision's English text: its publication, and its identity here. */
  url: string;
  /** The adoption date off the ledger, used if the PDF's heading does not say. */
  date?: Date;
  /**
   * Annexes and Protocols the decision amends. Carried by the rows seeded from
   * the acts, which knew them; empty for anything the ledger learned later,
   * where the heading in the decision's own text names the Annex instead.
   */
  areas: string[];
}

const MONTHS =
  "January|February|March|April|May|June|July|August|September|October|November|December";

/**
 * The decision's own heading, which every JCD from 1994 to 2026 opens with:
 *
 *   DECISION OF THE EEA JOINT COMMITTEE No 25/2010 of 12 March 2010
 *   amending Annex II (Technical regulations, standards, testing and
 *   certification) to the EEA Agreement
 *
 * It gives the decision's date and its subject in the Committee's own words,
 * which beats anything we could compose. The subject runs to the recitals, so
 * it is closed on "THE EEA JOINT COMMITTEE," — the address that opens every
 * one of them.
 *
 * The space after "COMMITTEE" is optional because the extraction loses it on
 * some years ("EEA JOINT COMMITTEENo 1/2026"), and the year is matched at two
 * digits as well as four because the early decisions are headed "No 7/94".
 */
const DECISION_HEADING_RE = new RegExp(
  `DECISION\\s+OF\\s+THE\\s+EEA\\s+JOINT\\s+COMMITTEE\\s*No\\s*(\\d{1,3})\\s*/\\s*(\\d{2,4})\\s*` +
    `of\\s+(\\d{1,2})\\s+(${MONTHS})\\s+(\\d{4})\\s*([\\s\\S]{0,400}?)(?=THE\\s+EEA\\s+JOINT\\s+COMMITTEE\\s*,)`,
  "i"
);

/** How much of a decision to look for its heading in. It is the first thing. */
const HEADING_SCAN_CHARS = 6000;

export interface DecisionHeading {
  /** "12 March 2010", as a date. */
  date?: Date;
  /** "amending Annex II (Technical regulations, …) to the EEA Agreement" */
  subject: string;
}

export function parseDecisionHeading(text: string): DecisionHeading | null {
  const m = DECISION_HEADING_RE.exec(text.slice(0, HEADING_SCAN_CHARS));
  if (!m) return null;
  const month = MONTHS.split("|").findIndex((name) => name.toLowerCase() === m[4].toLowerCase());
  const date = month < 0 ? undefined : new Date(Date.UTC(Number(m[5]), month, Number(m[3])));
  return {
    date: date && !Number.isNaN(date.getTime()) ? date : undefined,
    // The newer decisions carry the Official Journal's own reference in
    // brackets after the subject — "[2026/933]" — which is a filing number,
    // not part of what the decision is about.
    subject: squish(m[6]).replace(/\s*\[\d{4}\/\d+\]\s*$/, ""),
  };
}

export function composeDecision(
  seed: DecisionSeed,
  heading: DecisionHeading | null,
  body: string
): string {
  const lines: string[] = [`Decision of the EEA Joint Committee No ${seed.number}`];
  if (heading?.subject) lines.push(heading.subject);

  const details: string[] = [`${BULLET} Decision number: ${seed.number}`];
  if (seed.areas.length) details.push(`${BULLET} Area (EEA Agreement): ${seed.areas.join("; ")}`);
  lines.push("", "Case details:", ...details);

  lines.push("", "Decision:", body);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// PURGE. The one-time removal of the withdrawn acts register, run at the head
// of every pass so it happens on the next scheduled firing with nothing to set
// by hand, and costs one count query once it has nothing left to do.
//
// Order matters. The backlog is carried into the ledger *before* the acts are
// deleted, because the acts are the only record of which decisions exist: drop
// them first and every JCD not yet fetched is forgotten silently, which is
// exactly the failure this step exists to prevent.
// ---------------------------------------------------------------------------

/**
 * Every decision named by an act still stored, oldest first. The last use of
 * the acts register, and the reason the purge reads it before deleting it:
 * each factsheet carries its JCD number in `caseNumber` and that decision's
 * English PDF in `pdfUrl`.
 */
async function decisionSeedsFromActs(): Promise<DecisionSeed[]> {
  const acts = await prisma.document.findMany({
    where: { source: RETIRED_ACTS_SOURCE_KEY, caseNumber: { not: null }, pdfUrl: { not: null } },
    select: { caseNumber: true, pdfUrl: true, date: true, subjectTags: true },
  });

  const byNumber = new Map<string, DecisionSeed>();
  for (const act of acts) {
    const number = act.caseNumber as string;
    const seed = byNumber.get(number);
    if (!seed) {
      byNumber.set(number, {
        number,
        url: act.pdfUrl as string,
        date: act.date ?? undefined,
        areas: [...act.subjectTags],
      });
      continue;
    }
    // Several acts name the same decision. Keep the first URL and date seen
    // and union the areas: one decision commonly amends more than one Annex.
    if (!seed.date && act.date) seed.date = act.date;
    for (const area of act.subjectTags) if (!seed.areas.includes(area)) seed.areas.push(area);
  }

  return [...byNumber.values()].sort((a, b) => decisionRank(a.number) - decisionRank(b.number));
}

async function purgeRetiredActs(ctx: IngestContext): Promise<void> {
  const [actCount, actGaps] = await Promise.all([
    prisma.document.count({ where: { source: RETIRED_ACTS_SOURCE_KEY } }),
    prisma.ingestGap.count({ where: { source: RETIRED_ACTS_SOURCE_KEY } }),
  ]);
  if (actCount === 0 && actGaps === 0) return;

  ctx.log(
    `EEA-Lex acts register withdrawn: ${actCount} stored record(s) and ${actGaps} gap row(s) to remove.`
  );
  if (ctx.dryRun) {
    ctx.log(`[dry-run] would seed the decisions backlog and purge the acts; nothing written.`);
    return;
  }

  // 1. Carry the backlog forward. A decision an act names but we do not hold
  //    becomes a "pending" ledger row — known to exist, not yet fetched —
  //    which is precisely what the pass below works from.
  const seeds = await decisionSeedsFromActs();
  if (seeds.length) {
    const held = new Set(
      (
        await prisma.document.findMany({
          where: { source: DECISIONS_SOURCE_KEY },
          select: { officialUrl: true },
        })
      ).map((d) => d.officialUrl)
    );
    const backlog = seeds.filter((seed) => !held.has(seed.url));
    if (backlog.length) {
      // createMany + skipDuplicates rather than recordGap: a decision that
      // already has a row has already been attempted, and must keep its
      // reason and attempt count rather than being reset to "pending".
      const { count } = await prisma.ingestGap.createMany({
        data: backlog.map((seed) => ({
          adapter: eeaJointCommitteeAdapter.key,
          source: DECISIONS_SOURCE_KEY,
          officialUrl: seed.url,
          court: DECISIONS_NAME,
          caseNumber: seed.number,
          title: `Decision of the EEA Joint Committee No ${seed.number}`,
          date: seed.date ?? null,
          reason: "pending",
          detail: "named by the EEA-Lex acts register before it was withdrawn",
        })),
        skipDuplicates: true,
      });
      ctx.log(`Carried ${count} unfetched decision(s) into the gap ledger before purging the acts.`);
    }
  }

  // 2. Delete the acts themselves — through `retire`, which is the one path
  //    that also drops them from the search index. Deleting the rows directly
  //    would leave every one of them findable in Meilisearch.
  if (actCount) {
    const urls = (
      await prisma.document.findMany({
        where: { source: RETIRED_ACTS_SOURCE_KEY },
        select: { officialUrl: true },
      })
    ).map((d) => d.officialUrl);
    const removed = await ctx.retire(RETIRED_ACTS_SOURCE_KEY, urls);
    ctx.log(`Purged ${removed} EEA-Lex act record(s).`);
  }

  // 3. Whatever is left of the register: gap rows for acts never stored, and
  //    the Source row behind the progress bar it no longer has.
  const gaps = await prisma.ingestGap.deleteMany({ where: { source: RETIRED_ACTS_SOURCE_KEY } });
  const sources = await prisma.source.deleteMany({ where: { key: RETIRED_ACTS_SOURCE_KEY } });
  if (gaps.count || sources.count) {
    ctx.log(`Purged ${gaps.count} act gap row(s) and ${sources.count} source row(s).`);
  }
}

/**
 * Factsheets that were stored under the decisions key before the two were told
 * apart, and ledger rows still stamped with the adapter's old name. Both are
 * leftovers of the same split, and both are cheap to keep tidying.
 */
async function tidyDecisionsSource(ctx: IngestContext): Promise<void> {
  if (ctx.dryRun) return;

  const misfiled = (
    await prisma.document.findMany({
      where: { source: DECISIONS_SOURCE_KEY, officialUrl: { contains: "/eea-lex/" } },
      select: { officialUrl: true },
    })
  ).map((d) => d.officialUrl);
  if (misfiled.length) {
    const removed = await ctx.retire(DECISIONS_SOURCE_KEY, misfiled);
    ctx.log(`Retired ${removed} factsheet(s) filed under the decisions source before the split.`);
  }

  const restamped = await prisma.ingestGap.updateMany({
    where: { source: DECISIONS_SOURCE_KEY, adapter: FORMER_ADAPTER_KEY },
    data: { adapter: eeaJointCommitteeAdapter.key },
  });
  if (restamped.count) ctx.log(`Restamped ${restamped.count} gap row(s) onto this adapter's name.`);
}

export const eeaJointCommitteeAdapter: IngestionAdapter = {
  key: "eea-joint-committee",
  name: "EEA Joint Committee decisions (efta.int)",
  sourceKeys: [DECISIONS_SOURCE_KEY],

  async run(ctx: IngestContext): Promise<IngestStats> {
    const stats: IngestStats = { indexed: 0, skipped: 0, errors: 0 };
    const maxFetches = Number(process.env.INGEST_MAX_CASES ?? 300);

    let fetches = 0;

    const ingestDecision = async (seed: DecisionSeed): Promise<void> => {
      fetches++;
      const identity = {
        adapter: eeaJointCommitteeAdapter.key,
        source: DECISIONS_SOURCE_KEY,
        officialUrl: seed.url,
        court: DECISIONS_NAME,
        caseNumber: seed.number,
        title: `Decision of the EEA Joint Committee No ${seed.number}`,
        date: seed.date ?? null,
      };

      let body: string;
      try {
        const { body: bytes } = await politeFetchBytes(seed.url);
        body = normalizeJudgmentText((await pdfParse(bytes)).text);
      } catch (e) {
        stats.errors++;
        stats.errorSample = stats.errorSample ?? String(e);
        ctx.log(`  JCD ${seed.number}: ${String(e).slice(0, 140)}`);
        await ctx.recordGap({ ...identity, reason: "fetch-failed", detail: String(e).slice(0, 300) });
        return;
      }

      if (body.length < MIN_DECISION_CHARS) {
        stats.skipped++;
        await ctx.recordGap({
          ...identity,
          reason: "no-text",
          detail: body.length
            ? `the decision PDF extracted only ${body.length} chars`
            : "the decision PDF extracted no text at all",
        });
        return;
      }

      try {
        const heading = parseDecisionHeading(body);
        // The decision's own date beats the ledger's: it is the date printed
        // on the instrument, where the ledger's is EEA-Lex's record of it.
        const date = heading?.date ?? seed.date;
        const result = await ctx.save({
          source: DECISIONS_SOURCE_KEY,
          court: DECISIONS_NAME,
          caseNumber: seed.number,
          // The Committee's own statement of what the decision does heads the
          // card; the decision's number sits under it.
          caseName: heading?.subject || undefined,
          title: `Decision of the EEA Joint Committee No ${seed.number}`,
          date,
          year: date?.getUTCFullYear() ?? decisionYear(seed.number),
          language: "en",
          subjectTags: seed.areas,
          officialUrl: seed.url,
          pdfUrl: seed.url,
          fullText: composeDecision(seed, heading, body),
        });
        if (result === "indexed") stats.indexed++;
        else stats.skipped++;
      } catch (e) {
        stats.errors++;
        stats.errorSample = stats.errorSample ?? String(e);
        ctx.log(`  JCD ${seed.number}: ${String(e).slice(0, 140)}`);
        await ctx.recordGap({ ...identity, reason: "error", detail: String(e).slice(0, 300) });
      }
    };

    await purgeRetiredActs(ctx);
    await tidyDecisionsSource(ctx);

    // -----------------------------------------------------------------------
    // The pass itself: the gap ledger and nothing else. Every decision we know
    // exists but do not hold is a row, whether it has been attempted before or
    // not, so there is one queue rather than a backlog and a retry sweep that
    // could disagree about what is outstanding. openGaps orders it by attempts
    // and then by how long ago it was last tried, so an untouched row is
    // reached before a re-attempt and a decision that keeps failing cannot
    // monopolise the budget.
    // -----------------------------------------------------------------------
    const open = await ctx.openGaps([DECISIONS_SOURCE_KEY]);
    const held = await prisma.document.count({ where: { source: DECISIONS_SOURCE_KEY } });

    // The denominator for the progress bar: what we hold plus what we know is
    // still to come. It shrinks as the backlog is worked only if a row turns
    // out not to be a decision at all, which is the honest behaviour — this
    // adapter has no listing to read a total off.
    await recordTotal(ctx, DECISIONS_SOURCE_KEY, held + open.length);

    ctx.log(
      `${held} decision(s) stored; ${open.length} outstanding. Up to ${maxFetches} fetches this run.`
    );
    if (open.length === 0) {
      ctx.log(`Nothing outstanding — no requests made.`);
      return stats;
    }

    // A decision whose PDF never extracts anything keeps its row and so keeps
    // being re-attempted, at the back of the queue. That is the same bargain
    // every retry sweep here makes: a handful of re-fetches a run is the price
    // of recovering the ones that failed transiently.

    for (const [i, gap] of open.entries()) {
      if (fetches >= maxFetches) {
        ctx.log(`Reached INGEST_MAX_CASES=${maxFetches}; ${open.length - i} left for next run.`);
        break;
      }
      if (!gap.caseNumber) {
        // Every row this adapter writes carries the decision's number, and a
        // record cannot be filed without one. Left in the ledger rather than
        // guessed at or dropped: nothing re-seeds this list, so a row that
        // needs a human is one that has to stay visible until it gets one.
        ctx.log(`  skipped a ledger row with no decision number: ${gap.officialUrl}`);
        continue;
      }
      await ingestDecision({
        number: gap.caseNumber,
        url: gap.officialUrl,
        date: gap.date ?? undefined,
        areas: [],
      });
    }

    const stillOpen = await ctx.openGaps([DECISIONS_SOURCE_KEY]);
    if (stillOpen.length) {
      ctx.log(`${stillOpen.length} decision(s) outstanding after this run.`);
      for (const g of stillOpen.slice(0, 25)) {
        ctx.log(`  [${g.reason}, ${g.attempts}x] ${g.caseNumber ?? ""} ${g.officialUrl}`);
      }
    }
    ctx.log(`${fetches} decision(s) fetched.`);
    return stats;
  },
};

async function recordTotal(ctx: IngestContext, key: string, total: number): Promise<void> {
  if (ctx.dryRun) return;
  try {
    await prisma.source.updateMany({ where: { key }, data: { totalAvailable: total } });
  } catch {
    // Bookkeeping only — never fail a run over it.
  }
}
