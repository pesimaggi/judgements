/**
 * EUR-Lex adapter — the EU acts in force, as acts rather than as documents.
 *
 * WHAT IT INGESTS. Every regulation, directive and decision in force, as
 * EUR-Lex records them: about 33,000 acts, stored the way Lagasafn's acts are
 * stored — one `Act` row with `jurisdiction = "eu"`, its chapters, its
 * articles and their numbered paragraphs. An EU act is not case law and does
 * not belong among the sources in the search panel; it belongs in the act
 * library next to lög nr. 38/2001, which is where a reader looking for
 * "Regulation (EU) 2016/679" expects to find it.
 *
 * THIS IS NOT THE WITHDRAWN EEA-LEX REGISTER. That register was a list of
 * factsheets *about* acts, stored as documents in the search index, and it was
 * withdrawn for being neither the acts nor the decisions — see the EEA Joint
 * Committee adapter's header. This is the acts themselves, from the
 * Publications Office, with their text.
 *
 * THREE PASSES, BECAUSE THEY COST DIFFERENT AMOUNTS.
 *
 *   INGEST_MODE=catalogue — what exists. Two SPARQL queries per calendar year
 *     against the Cellar endpoint give every act of that year in force, with
 *     its title, its short names, its dates, whether it is marked EEA-relevant
 *     and which consolidated version is current. Cheap (seconds per year) and
 *     resumable: EURLEX_YEARS_PER_RUN years per firing, from a cursor.
 *
 *   INGEST_MODE=text (the default) — the acts' text, one Cellar fetch each.
 *     This is the expensive pass, so it is bounded by INGEST_MAX_CASES and
 *     ordered EEA-first: the acts that reached Icelandic law arrive before the
 *     ones that never will. EURLEX_TEXT_SCOPE=all lifts that to the whole
 *     library.
 *
 *   INGEST_MODE=eea-links — which acts the EEA Joint Committee actually took
 *     into the Agreement, read out of the decisions this database already
 *     holds. No network at all. See src/lib/eu-citations.ts for why this is
 *     worth doing on top of the relevance marker.
 *
 * WHAT IT DOES NOT INGEST: the Joint Committee's decisions. EUR-Lex publishes
 * those too, in sector 2, but they are already held as documents from
 * efta.int and re-ingesting them here would mean two copies of each. See
 * TYPES below for where that line is drawn, and the EEA Joint Committee
 * adapter's header for the one thing EUR-Lex could still be used for there.
 *
 * THE CATALOGUE IS THE LEDGER. There is no IngestGap row here, because a gap
 * ledger keyed by (source, officialUrl) is about documents and these are not
 * documents. The equivalent lives on the act itself: `textStatus` is "pending"
 * until the text is read, then "stored", "fetch-failed" or "no-articles", and
 * the run prints the breakdown the way the document adapters print their gap
 * counts. So the shortfall is always visible and always retriable
 * (INGEST_MODE=text-retry), and an act whose consolidation has moved on is put
 * back to "pending" by the catalogue pass rather than being quietly stale.
 */
import { createHash } from "crypto";
import { prisma } from "@/lib/db";
import {
  CELLAR_HEADERS,
  cellarTextUrl,
  euCitation,
  euLexUrl,
  parseCelex,
  parseEuActHtml,
  type ParsedEuAct,
} from "@/lib/eur-lex";
import { politeFetchText } from "../adapter";
import {
  compareDecisionNumbers,
  decisionNumberFromTitle,
  extractEuActRefs,
  refLookupKeys,
} from "@/lib/eu-citations";
import {
  catalogueYear,
  jointCommitteeActLinks,
  listJointCommitteeDecisions,
  type CatalogueEntry,
} from "../eurlex-sparql";
import { type IngestionAdapter, type IngestContext, type IngestStats } from "../adapter";

/** The first year swept. The oldest acts still in force date from the 1950s. */
const FIRST_YEAR = Number(process.env.EURLEX_FIRST_YEAR ?? 1952);

/**
 * Cursor key for the catalogue sweep, in the table the court sweeps use.
 *
 * The "-desc" is deliberate and is what retires the old cursor. The sweep used
 * to run forwards from 1952, and a stored year means the opposite thing under
 * a sweep that runs backwards: resuming a descending walk at the ascending
 * walk's 1958 would spend the next decade of runs on the 1950s, which is
 * exactly the problem this key change is fixing. A new key starts the new
 * sweep at this year, where it should have started.
 */
const CURSOR_KEY = "eur-lex-catalogue-desc";

/** The source key the EEA Joint Committee's decisions are stored under. */
const JCD_SOURCE_KEY = "eea-joint-committee";

/**
 * How many EU acts must be stored before the incorporation pass is worth its
 * requests. Roughly one calendar year of acts in force: below that the
 * catalogue sweep has not meaningfully begun, and the pass would ask EUR-Lex
 * for its whole citation graph to match none of it.
 */
const MIN_ACTS_FOR_LINKS = 200;

/**
 * Writes one catalogue entry, without touching its text.
 *
 * `textStatus` is the one field with a rule: an act whose current consolidated
 * version is not the one whose text is stored goes back to "pending", which is
 * how an amendment published upstream becomes work for the text pass. Nothing
 * else here can invalidate stored text.
 */
async function saveCatalogueEntry(entry: CatalogueEntry): Promise<"created" | "updated"> {
  const celex = parseCelex(entry.celex);
  if (!celex) throw new Error(`not a plain sector-3 CELEX: ${entry.celex}`);

  const wanted = entry.consolidatedCelex ?? entry.celex;
  const existing = await prisma.act.findUnique({
    where: { celex: entry.celex },
    select: { id: true, textCelex: true, textStatus: true },
  });

  const shared = {
    jurisdiction: "eu",
    docType: celex.docType,
    actNumber: celex.number,
    year: celex.year,
    title: entry.title,
    aliases: entry.aliases,
    status: "in_force",
    currentVersionUrl: euLexUrl(entry.celex),
    citation: euCitation(entry.title, celex, entry.naturalNumber),
    naturalNumber: entry.naturalNumber,
    eeaRelevant: entry.eeaRelevant,
    entryIntoForce: entry.entryIntoForce,
    endOfValidity: entry.endOfValidity,
    fetchedAt: new Date(),
  };

  if (!existing) {
    await prisma.act.create({
      data: {
        ...shared,
        celex: entry.celex,
        // Written explicitly, empty: a scalar list left out of the insert is
        // NULL in Postgres rather than an empty array, and `cardinality(NULL)`
        // is NULL — so the EEA scope filter would drop the act instead of
        // testing it.
        eeaIncorporatedBy: [],
        // Nothing is hashed yet; the text pass writes the real hash when it
        // stores the articles.
        sourceHash: "",
        textCelex: wanted,
        textStatus: "pending",
      },
    });
    return "created";
  }

  const stale = existing.textCelex !== wanted;
  await prisma.act.update({
    where: { id: existing.id },
    data: {
      ...shared,
      textCelex: wanted,
      // Re-read the text only when the version it should come from changed;
      // a failed act stays failed until the retry pass picks it up.
      ...(stale ? { textStatus: "pending", textAttempts: 0 } : {}),
    },
  });
  return "updated";
}

/**
 * Marks acts of a swept year that the catalogue no longer lists.
 *
 * They are not deleted. An act that has fallen out of force is still the law
 * a judgment of 2011 applied, and the whole point of holding a corpus is that
 * it can answer what the rule was — so it keeps its text and its links and
 * gains a status that says so.
 */
async function retireMissing(year: number, live: Set<string>, ctx: IngestContext): Promise<number> {
  const stored = await prisma.act.findMany({
    where: { jurisdiction: "eu", year, status: "in_force" },
    select: { id: true, celex: true },
  });
  const gone = stored.filter((act) => act.celex && !live.has(act.celex)).map((act) => act.id);
  if (gone.length === 0) return 0;
  if (ctx.dryRun) {
    ctx.log(`[dry-run] would mark ${gone.length} act(s) of ${year} no longer in force`);
    return 0;
  }
  await prisma.act.updateMany({ where: { id: { in: gone } }, data: { status: "no_longer_in_force" } });
  return gone.length;
}

/**
 * The catalogue pass: what exists, year by year, **newest year first**.
 *
 * The direction is the whole point. The first version of this swept forwards
 * from 1952 at three years a firing, and in production that meant the log read
 * "1955: 0 acts in force. 1956: 0. 1957: 0" while the library stayed empty:
 * almost nothing from the 1950s is still in force, and at that rate the acts
 * anyone would search for were two decades of firings away. A corpus that
 * arrives in the wrong order is not a slow corpus, it is an absent one.
 *
 * Backwards from this year puts the acts that matter first — the EEA-relevant
 * ones are overwhelmingly recent — and the empty early years cost their two
 * queries at the end of the sweep rather than at the start. The sweep then
 * wraps to this year again, which is also how amendments and acts falling out
 * of force are picked up.
 */
async function runCatalogue(ctx: IngestContext, stats: IngestStats): Promise<void> {
  const thisYear = new Date().getUTCFullYear();
  // Eight years is one to two minutes of queries, so a full sweep of the ~75
  // years is about ten firings — a day and a bit, rather than a decade.
  const perRun = Math.max(1, Number(process.env.EURLEX_YEARS_PER_RUN ?? 8));

  const cursor = await prisma.ingestCursor.findUnique({ where: { key: CURSOR_KEY } });
  let year =
    cursor?.year && cursor.year >= FIRST_YEAR && cursor.year <= thisYear ? cursor.year : thisYear;

  for (let swept = 0; swept < perRun; swept++) {
    if (year < FIRST_YEAR) {
      ctx.log(`Reached ${FIRST_YEAR}; starting the sweep again at ${thisYear}.`);
      year = thisYear;
    }
    try {
      const entries = await catalogueYear(year);
      let created = 0;
      for (const entry of entries) {
        if (ctx.dryRun) continue;
        const outcome = await saveCatalogueEntry(entry);
        if (outcome === "created") created++;
        stats.indexed++;
      }
      const retired = await retireMissing(year, new Set(entries.map((e) => e.celex)), ctx);
      ctx.log(
        `${year}: ${entries.length} act(s) in force — ${created} new` +
          (retired ? `, ${retired} no longer in force` : "")
      );
    } catch (e) {
      stats.errors++;
      stats.errorSample = stats.errorSample ?? `${year}: ${String(e)}`;
      ctx.log(`  error on ${year}: ${String(e).slice(0, 200)}`);
    }
    year--;
  }

  if (!ctx.dryRun) {
    await prisma.ingestCursor.upsert({
      where: { key: CURSOR_KEY },
      create: { key: CURSOR_KEY, year, nextPage: 0 },
      update: { year },
    });
  }
  ctx.log(`Cursor: next run resumes at ${year < FIRST_YEAR ? thisYear : year}`);
}

// ---------------------------------------------------------------------------
// The text pass
// ---------------------------------------------------------------------------

function hashAct(parsed: ParsedEuAct): string {
  // Separators are written as escapes rather than as raw control characters:
  // typed literally they make this file read as binary to git and grep,
  // hiding it from diffs and code search. Same convention, and the same
  // reason, as the Lagasafn adapter's hashAct.
  const body = parsed.provisions
    .map(
      (p) =>
        `${p.anchor}\u0000${p.displayLabel}\u0000${p.heading ?? ""}\u0000${p.fullText}`
    )
    .join("\u0001");
  return createHash("sha256").update(body).digest("hex");
}

/**
 * Writes one act's structure.
 *
 * Provisions are matched on (actId, anchor) and updated in place, never
 * deleted and recreated, for the same reason the Lagasafn adapter does it that
 * way: CaseProvisionLink cascades from Provision, so a rebuild would throw
 * away every link a judgment has to the act each time the act is amended.
 */
export async function saveEuActText(actId: string, parsed: ParsedEuAct, sourceHash: string): Promise<void> {
  await prisma.chapter.deleteMany({ where: { actId } });
  const chapterIds: string[] = [];
  for (const [i, chapter] of parsed.chapters.entries()) {
    const created = await prisma.chapter.create({
      data: {
        actId,
        numeral: null,
        letter: null,
        label: chapter.label,
        title: chapter.title,
        ordering: i,
      },
    });
    chapterIds.push(created.id);
  }

  const seenAnchors: string[] = [];
  for (const [i, provision] of parsed.provisions.entries()) {
    seenAnchors.push(provision.anchor);
    const data = {
      chapterId: provision.chapterIndex !== null ? chapterIds[provision.chapterIndex] ?? null : null,
      kind: provision.kind,
      articleNumber: provision.articleNumber,
      articleLetter: provision.articleLetter,
      displayLabel: provision.displayLabel,
      heading: provision.heading,
      fullText: provision.fullText,
      isRepealed: false,
      ordering: i,
    };
    const stored = await prisma.provision.upsert({
      where: { actId_anchor: { actId, anchor: provision.anchor } },
      create: { actId, anchor: provision.anchor, ...data },
      update: data,
    });

    await prisma.provisionParagraph.deleteMany({ where: { provisionId: stored.id } });
    if (provision.paragraphs.length) {
      await prisma.provisionParagraph.createMany({
        data: provision.paragraphs.map((paragraph, j) => ({
          provisionId: stored.id,
          number: paragraph.number,
          anchor: paragraph.anchor,
          text: paragraph.text,
          ordering: j,
        })),
      });
    }
  }

  await prisma.provision.deleteMany({ where: { actId, anchor: { notIn: seenAnchors } } });
  await prisma.act.update({
    where: { id: actId },
    data: { sourceHash, textStatus: "stored", fetchedAt: new Date() },
  });

  if (process.env.SEARCH_PROVIDER === "meilisearch") {
    const { syncActToMeilisearch } = await import("@/lib/search/meilisearch");
    const act = await prisma.act.findUniqueOrThrow({
      where: { id: actId },
      include: { provisions: { orderBy: { ordering: "asc" } } },
    });
    await syncActToMeilisearch(act);
  }
}

/**
 * Reads one act's text, preferring the consolidated version.
 *
 * The consolidated version is the text in force, which is what this library is
 * for — but Cellar does not hold every one it names, so a 404 there falls back
 * to the act as adopted rather than losing the act. Returns which CELEX the
 * text actually came from, so the stored `textCelex` says what was read.
 */
async function fetchActText(
  celex: string,
  consolidated: string | null
): Promise<{ parsed: ParsedEuAct; from: string } | null> {
  const candidates = consolidated && consolidated !== celex ? [consolidated, celex] : [celex];
  let lastError: unknown = null;
  for (const candidate of candidates) {
    try {
      const html = await politeFetchText(cellarTextUrl(candidate), CELLAR_HEADERS);
      // Cellar answers a throttled or unavailable request with a short body
      // and a 2xx; treating that as an act with no articles would record a
      // permanent failure for a transient one.
      if (html.trim().length < 500) throw new Error(`empty response for ${candidate}`);
      const parsed = parseEuActHtml(html);
      if (parsed.provisions.length > 0) return { parsed, from: candidate };
      lastError = new Error(`no articles parsed from ${candidate}`);
    } catch (e) {
      lastError = e;
    }
  }
  if (lastError instanceof Error && /HTTP 4\d\d|empty response/.test(lastError.message)) {
    throw lastError;
  }
  return null;
}

/** The text pass: one Cellar fetch per act, EEA-relevant acts first. */
async function runText(ctx: IngestContext, stats: IngestStats, retry: boolean): Promise<void> {
  const budget = Number(process.env.INGEST_MAX_CASES ?? 200);
  const scope = process.env.EURLEX_TEXT_SCOPE ?? "eea";
  const only = process.env.EURLEX_ONLY;

  const where: Record<string, unknown> = { jurisdiction: "eu" };
  // Diagnostic: read one act by CELEX, whatever state it is in. Everything
  // else is bounded by what still needs reading.
  if (only) where.celex = only.toUpperCase();
  else where.textStatus = retry ? { in: ["fetch-failed", "no-articles"] } : "pending";
  // The EEA subset first, and by default only it: an Icelandic researcher's
  // question is almost always about an act that reached Icelandic law, and at
  // one polite fetch each the whole library is days of requests. Set
  // EURLEX_TEXT_SCOPE=all to ingest the rest.
  if (!only && scope === "eea") {
    where.OR = [{ eeaRelevant: true }, { NOT: { eeaIncorporatedBy: { isEmpty: true } } }];
  }

  const acts = await prisma.act.findMany({
    where,
    select: { id: true, celex: true, title: true, textCelex: true, sourceHash: true },
    orderBy: [{ eeaRelevant: "desc" }, { year: "desc" }, { actNumber: "asc" }],
    take: Math.max(1, budget),
  });
  ctx.log(`${acts.length} act(s) to read (${retry ? "retry" : scope} scope)`);

  for (const act of acts) {
    const celex = act.celex as string;
    try {
      if (ctx.dryRun) {
        ctx.log(`[dry-run] would read ${celex} (${act.textCelex ?? celex})`);
        stats.skipped++;
        continue;
      }
      const result = await fetchActText(celex, act.textCelex);
      if (!result) {
        await prisma.act.update({
          where: { id: act.id },
          data: { textStatus: "no-articles", textAttempts: { increment: 1 } },
        });
        stats.skipped++;
        ctx.log(`  ${celex}: no articles could be read from the published text`);
        continue;
      }

      const hash = hashAct(result.parsed);
      if (act.sourceHash === hash) {
        await prisma.act.update({
          where: { id: act.id },
          data: { textStatus: "stored", textCelex: result.from, fetchedAt: new Date() },
        });
        stats.skipped++;
        continue;
      }

      await saveEuActText(act.id, result.parsed, hash);
      await prisma.act.update({ where: { id: act.id }, data: { textCelex: result.from } });
      stats.indexed++;
      if (stats.indexed % 25 === 0) ctx.log(`  … ${stats.indexed} acts written (at ${celex})`);
    } catch (e) {
      stats.errors++;
      stats.errorSample = stats.errorSample ?? `${celex}: ${String(e)}`;
      if (!ctx.dryRun) {
        await prisma.act.update({
          where: { id: act.id },
          data: { textStatus: "fetch-failed", textAttempts: { increment: 1 } },
        });
      }
      ctx.log(`  error on ${celex}: ${String(e).slice(0, 200)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// The EEA incorporation pass
// ---------------------------------------------------------------------------

/**
 * Records, on each EU act, the decisions of the EEA Joint Committee that name
 * it — the cross-reference behind the "tekin upp" tag.
 *
 * TWO SOURCES, MERGED, because each covers what the other misses.
 *
 *   EUR-Lex's own citation graph is the authority and the bulk of it: every
 *     decision the Committee has adopted, whether or not this database holds
 *     its text, and the Publications Office's record of the relationship
 *     rather than our reading of a sentence. About 21,900 pairs, in a handful
 *     of queries. See jointCommitteeActLinks().
 *   The decisions' own text catches what the graph does not state. A decision
 *     inserting an act names it in the Official Journal's two-part form and
 *     EUR-Lex does not always record that as a citation, particularly for the
 *     older decisions; this reads the stored text and costs no requests.
 *
 * Both answer the same question — which decisions name this act — so they
 * merge into one sorted list per act rather than competing. What that list
 * means is deliberately modest: the Committee has dealt with the act, and here
 * are the decision numbers to check. It is not read as "inserted by", because
 * a decision that deletes a point names the act it deletes and EUR-Lex offers
 * nothing finer to tell the two apart.
 */
async function runEeaLinks(ctx: IngestContext, stats: IngestStats): Promise<void> {
  // Every EU act, by every key a reference can name it under. An act is only
  // ever matched to a reference resolving to a key here, so a mis-read
  // reference resolves to nothing rather than to the wrong act.
  const acts = await prisma.act.findMany({
    where: { jurisdiction: "eu" },
    select: { id: true, celex: true, docType: true, year: true, actNumber: true, naturalNumber: true, eeaIncorporatedBy: true },
  });
  if (acts.length === 0) {
    ctx.log("No EU acts stored yet — run the catalogue pass first.");
    return;
  }

  const letterFor: Record<string, string> = { regulation: "R", directive: "L", decision: "D" };
  const byKey = new Map<string, string>();
  const ambiguous = new Set<string>();
  const held = new Map<string, string[]>();
  for (const act of acts) {
    // Null rather than empty for any act stored before this column existed.
    held.set(act.id, act.eeaIncorporatedBy ?? []);
    const letter = letterFor[act.docType];
    if (!letter || !act.celex) continue;
    byKey.set(act.celex, act.id);
    for (const number of new Set([act.actNumber, act.naturalNumber ?? act.actNumber])) {
      const key = `${letter}:${act.year}:${number}`;
      // Two acts answering to one citation is a citation that cannot identify
      // either; recording neither is the honest outcome.
      if (byKey.has(key) && byKey.get(key) !== act.id) ambiguous.add(key);
      else byKey.set(key, act.id);
    }
  }
  for (const key of ambiguous) byKey.delete(key);

  const found = new Map<string, Set<string>>();
  const record = (actId: string, number: string) => {
    const set = found.get(actId) ?? new Set<string>();
    set.add(number);
    found.set(actId, set);
  };

  // ---- EUR-Lex's citation graph -------------------------------------------
  // Skipped while the catalogue has barely started. The listing and the link
  // queries are about thirty-five requests, and with a handful of acts stored
  // every one of those references resolves to nothing — which is exactly what
  // the first production run did: "6783 decision(s), 20403 act reference(s), 0
  // of them to acts held here". The local text scan below costs nothing and
  // still runs.
  const enoughToMatch = acts.length >= MIN_ACTS_FOR_LINKS;
  if (!enoughToMatch) {
    ctx.log(
      `Only ${acts.length} EU act(s) stored — not asking EUR-Lex for its citation graph yet ` +
        `(needs ${MIN_ACTS_FOR_LINKS}). The catalogue pass fills this.`
    );
  }
  if (enoughToMatch && process.env.EURLEX_JCD_LINKS !== "0") {
    const decisions = await listJointCommitteeDecisions();
    // The decision's own number is what a reader cites and what gets stored;
    // EUR-Lex files it under an Official Journal number instead, so the
    // listing is what translates one to the other.
    const numberFor = new Map(decisions.map((d) => [d.celex, d.number]));
    const links = await jointCommitteeActLinks(decisions.map((d) => d.celex));
    let matched = 0;
    for (const link of links) {
      const number = numberFor.get(link.jcdCelex);
      const actId = byKey.get(link.actCelex);
      if (!number || !actId) continue;
      record(actId, number);
      matched++;
    }
    ctx.log(
      `EUR-Lex: ${decisions.length} decision(s), ${links.length} act reference(s), ` +
        `${matched} of them to acts held here`
    );
  }

  // ---- the decisions' own text --------------------------------------------
  const CHUNK = 200;
  let scanned = 0;
  for (let skip = 0; ; skip += CHUNK) {
    const decisions = await prisma.document.findMany({
      where: { source: JCD_SOURCE_KEY },
      select: { caseNumber: true, title: true, fullText: true },
      orderBy: { id: "asc" },
      skip,
      take: CHUNK,
    });
    if (decisions.length === 0) break;
    for (const decision of decisions) {
      scanned++;
      // The decision's own number is what gets recorded against the act, so a
      // decision whose number was never parsed out of its PDF is read off its
      // title rather than dropped.
      const number = decision.caseNumber ?? decisionNumberFromTitle(decision.title);
      if (!number) continue;
      for (const ref of extractEuActRefs(decision.fullText)) {
        const actId = refLookupKeys(ref)
          .map((key) => byKey.get(key))
          .find(Boolean);
        if (actId) record(actId, number);
      }
    }
    if (decisions.length < CHUNK) break;
  }
  ctx.log(`Scanned the text of ${scanned} stored decision(s)`);

  for (const [actId, numbers] of found) {
    // In the order the Committee adopted them, not alphabetically: a list
    // reading "120/2006, 91/2000" is a list nobody can scan.
    const incorporated = Array.from(numbers).sort(compareDecisionNumbers);
    const current = held.get(actId) ?? [];
    if (current.length === incorporated.length && current.every((n, i) => n === incorporated[i])) {
      stats.skipped++;
      continue;
    }
    if (ctx.dryRun) {
      stats.skipped++;
      continue;
    }
    await prisma.act.update({ where: { id: actId }, data: { eeaIncorporatedBy: incorporated } });
    stats.indexed++;
  }
  ctx.log(`${found.size} act(s) named by a decision; ${stats.indexed} updated`);
}

export const eurLexAdapter: IngestionAdapter = {
  key: "eur-lex",
  name: "EUR-Lex (EU acts in force)",
  // Acts are not a court source, so no Source row's lastIngestedAt is stamped
  // — the same arrangement the Lagasafn adapter has.
  sourceKeys: [],

  async run(ctx: IngestContext): Promise<IngestStats> {
    const stats: IngestStats = { indexed: 0, skipped: 0, errors: 0 };
    const mode = process.env.INGEST_MODE ?? "text";

    if (mode === "catalogue") await runCatalogue(ctx, stats);
    else if (mode === "eea-links") await runEeaLinks(ctx, stats);
    else await runText(ctx, stats, mode === "text-retry");

    // The equivalent of the document adapters' outstanding-gap count: what
    // this library is still missing, itemised, printed on every run so a
    // shortfall is visible in the deploy log rather than only as a number on a
    // page nobody can explain.
    const outstanding = await prisma.act.groupBy({
      by: ["textStatus"],
      where: { jurisdiction: "eu" },
      _count: { _all: true },
    });
    if (outstanding.length) {
      const breakdown = outstanding
        .map((row) => `${row.textStatus ?? "unknown"}=${row._count._all}`)
        .join(" ");
      ctx.log(`EU acts by text status: ${breakdown}`);
    }
    return stats;
  },
};
