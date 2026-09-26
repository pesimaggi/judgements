/**
 * Lagasafn adapter — the in-force text of Icelandic law (althingi.is/lagas).
 *
 * Ingests every act in Lagasafn's current index (~900), parsing each into
 * chapters, provisions (greinar) and paragraphs (málsgreinar). Provisions are
 * what this feature exists for: the citation job links judgments to them, and
 * the act reader renders them.
 *
 * Source of truth for *which* acts exist is the alphabetical in-force index
 * at /lagasafn/nuna/, not the bulk zip. The index is authoritative about what
 * is currently in force — the zip additionally contains repealed material —
 * and it is one request rather than a crawl.
 *
 * Each act's text then comes from its own /lagas/nuna/{year}{nr}.html page:
 *   - it is the canonical permalink this app stores and links to;
 *   - it is served as UTF-8, whereas the bulk zip is ISO-8859-1;
 *   - it lets a run be bounded and resumed act by act.
 * The trade-off is ~900 rate-limited requests on a cold run. Repeat runs cost
 * far less: an act whose stored codex version already matches the index's is
 * skipped without being fetched at all, so a run against an unchanged
 * Lagasafn release makes a single request in total.
 *
 * Incremental and resumable, like the court adapters:
 *   - LAGASAFN_MAX_ACTS bounds one run; the next picks up where it stopped,
 *     from a cursor in IngestCursor.
 *   - an act whose sourceHash is unchanged is left alone.
 *   - a failure on one act is logged and counted, never fatal to the run.
 */
import { load } from "cheerio";
import { createHash } from "crypto";
import { prisma } from "@/lib/db";
import { parseLagasafnHtml, actUrl, type ParsedAct } from "@/lib/lagasafn";
import type { IngestionAdapter, IngestContext, IngestStats } from "../adapter";

const INDEX_URL =
  process.env.LAGASAFN_INDEX_URL ?? "https://www.althingi.is/lagasafn/nuna/";

/** Cursor key for the resume point, in the same table the court sweeps use. */
const CURSOR_KEY = "lagasafn";

/**
 * What this adapter extracts from a Lagasafn page, as a number.
 *
 * The cheap skip below passes over an act whose codex version we already hold
 * *without fetching it*, which is what keeps a run against an unchanged
 * Lagasafn release down to a single request. The cost is that widening the
 * parse reaches almost nothing: the index pins 903 of ~905 acts to one codex
 * version, so a new field would land only on acts amended since, and the rest
 * would stay blank indefinitely.
 *
 * So: bump this whenever the parse starts storing something it did not store
 * before. Acts behind it are re-fetched and re-saved once, and the backfill is
 * the next scheduled run rather than someone remembering to set
 * LAGASAFN_FORCE=1.
 *
 *   1 — chapters, provisions, paragraphs.
 *   2 — provision footnotes, and the act's ferill and bill links.
 */
const PARSE_VERSION = 2;

export interface ActIndexEntry {
  actNumber: number;
  year: number;
  title: string;
  /** Codex version the index links to, e.g. "157b". */
  codexVersion: string | null;
}

/**
 * Reads the alphabetical in-force index into a list of acts.
 *
 * Entries link to a pinned codex version (/lagas/157b/1991091.html); we keep
 * the version for change detection but always store and link the /nuna/ form.
 */
export function parseActIndex(html: string): ActIndexEntry[] {
  const $ = load(html);
  const byKey = new Map<string, ActIndexEntry>();

  $("a[href*='/lagas/']").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const m = /\/lagas\/(nuna|\d+[a-z]?)\/(\d{4})(\d{3})\.html/.exec(href);
    if (!m) return;
    const year = Number(m[2]);
    // The filename's number is not always the act's own number: for pre-1900
    // material Lagasafn uses a sequence number there ("1700104.html" is 1700
    // nr. 17), and "000" where an act has no number at all — Kristinréttur
    // Árna biskups Þorlákssonar (1275) is one such, and rejecting 0 here
    // dropped it from the corpus entirely. Where the act's own page states a
    // number, saveAct() prefers that; this is only how the entry is found.
    const actNumber = Number(m[3]);
    const title = $(el).text().trim();
    if (!title || !year || Number.isNaN(actNumber)) return;
    const key = `${actNumber}/${year}`;
    // The index lists each act once; guard against duplicates from any
    // repeated navigation links on the page.
    if (!byKey.has(key)) {
      byKey.set(key, {
        actNumber,
        year,
        title,
        codexVersion: m[1] === "nuna" ? null : m[1],
      });
    }
  });

  return Array.from(byKey.values());
}

/**
 * Fingerprints everything the act's row and its children hold, so that "the
 * hash is unchanged" means "there is nothing to write" rather than "the
 * article text is unchanged".
 *
 * The footnotes are in here for a reason that looks like a corner case and is
 * not: a regulation set under an article adds a footnote to a provision whose
 * own text does not move. Hashing only the text would skip that act for ever.
 */
function hashAct(parsed: ParsedAct): string {
  // Separators are written as escapes rather than as raw control
  // characters: typed literally they make this file read as binary to git
  // and grep, hiding it from diffs and code search. What reaches the hash
  // is identical either way, so stored sourceHash values stay valid.
  const body = parsed.provisions
    .map(
      (p) =>
        `${p.anchor}\u0000${p.displayLabel}\u0000${p.heading ?? ""}\u0000${p.fullText}` +
        `\u0000${p.footnotes.join("\u0002")}`
    )
    .join("\u0001");
  const links = `${parsed.ferillUrl ?? ""}\u0000${parsed.billUrl ?? ""}`;
  return createHash("sha256")
    .update(`${parsed.title}\u0001${links}\u0001${body}`)
    .digest("hex");
}


/**
 * Writes one parsed act and its structure.
 *
 * Provisions are matched on (actId, anchor) and updated in place rather than
 * deleted and recreated. That matters: CaseProvisionLink cascades from
 * Provision, so a delete-and-reinsert would throw away every judgment link on
 * the act each time Lagasafn published a routine amendment, and the citation
 * job would have to rescan the entire corpus to rebuild them. Only provisions
 * that genuinely disappeared from the act are deleted.
 */
export async function saveAct(
  parsed: ParsedAct,
  entry: ActIndexEntry,
  sourceHash: string
): Promise<void> {
  const actNumber = parsed.actNumber ?? entry.actNumber;
  const year = parsed.year ?? entry.year;

  const act = await prisma.act.upsert({
    // Acts are keyed by jurisdiction and instrument as well as by number and
    // year, since the table now also holds EU acts and a regulation can share
    // a number and a year with an Icelandic act. Lagasafn writes the
    // Icelandic half of that key on every row.
    where: {
      jurisdiction_docType_actNumber_year_language: {
        jurisdiction: "is",
        docType: "act",
        actNumber,
        year,
        language: "is",
      },
    },
    create: {
      jurisdiction: "is",
      docType: "act",
      actNumber,
      year,
      title: parsed.title || entry.title,
      status: "in_force",
      currentVersionUrl: actUrl(actNumber, year),
      codexVersion: parsed.codexVersion ?? entry.codexVersion,
      ferillUrl: parsed.ferillUrl,
      billUrl: parsed.billUrl,
      sourceHash,
      parseVersion: PARSE_VERSION,
      fetchedAt: new Date(),
    },
    update: {
      title: parsed.title || entry.title,
      status: "in_force",
      currentVersionUrl: actUrl(actNumber, year),
      codexVersion: parsed.codexVersion ?? entry.codexVersion,
      ferillUrl: parsed.ferillUrl,
      billUrl: parsed.billUrl,
      sourceHash,
      parseVersion: PARSE_VERSION,
      fetchedAt: new Date(),
    },
  });

  // Chapters carry no stable identifier in the source, so they are rebuilt.
  // Provisions reference them with ON DELETE SET NULL and are re-pointed
  // below, so rebuilding chapters never cascades into provision loss.
  await prisma.chapter.deleteMany({ where: { actId: act.id } });
  const chapterIds: string[] = [];
  for (const [i, c] of parsed.chapters.entries()) {
    const created = await prisma.chapter.create({
      data: {
        actId: act.id,
        numeral: c.numeral,
        letter: c.letter,
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
    const chapterId = p.chapterIndex !== null ? chapterIds[p.chapterIndex] ?? null : null;
    const data = {
      chapterId,
      kind: p.kind,
      articleNumber: p.articleNumber,
      articleLetter: p.articleLetter,
      displayLabel: p.displayLabel,
      heading: p.heading,
      fullText: p.fullText,
      isRepealed: p.isRepealed,
      footnotes: p.footnotes,
      ordering: i,
    };

    const provision = await prisma.provision.upsert({
      where: { actId_anchor: { actId: act.id, anchor: p.anchor } },
      create: { actId: act.id, anchor: p.anchor, ...data },
      update: data,
    });

    // Paragraphs are small, wholly derived from the provision's text, and
    // nothing references them, so replacing them outright is simplest.
    await prisma.provisionParagraph.deleteMany({ where: { provisionId: provision.id } });
    if (p.paragraphs.length) {
      await prisma.provisionParagraph.createMany({
        data: p.paragraphs.map((par, j) => ({
          provisionId: provision.id,
          number: par.number,
          anchor: par.anchor,
          text: par.text,
          ordering: j,
        })),
      });
    }
  }

  // Provisions that no longer appear in the act at all — repealed outright
  // and removed from the consolidated text rather than left as "…".
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

export const lagasafnAdapter: IngestionAdapter = {
  key: "lagasafn",
  name: "Lagasafn (althingi.is — in-force Icelandic acts)",
  // Acts are not a court source, so no Source row's lastIngestedAt is stamped.
  sourceKeys: [],

  async run(ctx: IngestContext): Promise<IngestStats> {
    const stats: IngestStats = { indexed: 0, skipped: 0, errors: 0 };

    const indexHtml = await ctx.fetchText(INDEX_URL);
    const entries = parseActIndex(indexHtml);
    if (entries.length === 0) {
      throw new Error(`No acts found in the Lagasafn index at ${INDEX_URL}`);
    }
    entries.sort((a, b) => a.year - b.year || a.actNumber - b.actNumber);
    ctx.log(`In-force index: ${entries.length} acts`);

    // Diagnostic: ingest a single act, bypassing the cursor.
    const only = process.env.LAGASAFN_ONLY;
    if (only) {
      const [nr, yr] = only.split("/").map(Number);
      const one = entries.filter((e) => e.actNumber === nr && e.year === yr);
      if (one.length === 0) throw new Error(`${only} is not in the in-force index`);
      entries.length = 0;
      entries.push(...one);
    }

    const maxActs = Number(process.env.LAGASAFN_MAX_ACTS ?? 1000);
    const force = process.env.LAGASAFN_FORCE === "1";

    const cursor = only
      ? null
      : await prisma.ingestCursor.findUnique({ where: { key: CURSOR_KEY } });
    // nextPage doubles as "next index position" here; the column is a plain
    // resume counter and the court sweeps use it the same way.
    let start = cursor ? Math.max(0, cursor.nextPage) : 0;
    if (start >= entries.length) {
      ctx.log(`Cursor at ${start} is past the end of the index; starting over.`);
      start = 0;
    }

    const known = new Map(
      (
        await prisma.act.findMany({
          // The Icelandic half of the table only: the EU acts alongside it are
          // tens of thousands of rows this pass has no use for.
          where: { jurisdiction: "is" },
          select: {
            actNumber: true,
            year: true,
            sourceHash: true,
            codexVersion: true,
            parseVersion: true,
          },
        })
      ).map((a) => [`${a.actNumber}/${a.year}`, a])
    );

    // The one-off cost of a PARSE_VERSION bump, said out loud before it is
    // paid: a run that would normally make a single request is about to fetch
    // every act in the index. Silence here would look like the cheap skip
    // having broken.
    //
    // Counted over the acts this run can actually reach, not over everything
    // stored. The database holds 26 acts that are no longer in the in-force
    // index — repealed since they were ingested — and the loop below only
    // walks the index, so those can never be re-parsed. Counting them made the
    // line read "26 act(s) … re-fetching them once" on every single run, for
    // ever, which is precisely the cry-wolf log this message exists to avoid.
    const inIndex = new Set(entries.map((e) => `${e.actNumber}/${e.year}`));
    const behind = Array.from(known.entries()).filter(
      ([key, a]) => inIndex.has(key) && a.parseVersion !== PARSE_VERSION
    ).length;
    if (behind > 0) {
      ctx.log(
        `${behind} act(s) stored by an older parse (< v${PARSE_VERSION}) — re-fetching ` +
          `them once to fill in what it did not extract.`
      );
    }

    let newActs = 0;
    let processed = 0;
    let position = start;
    for (; position < entries.length && processed < maxActs; position++) {
      const entry = entries[position];
      const key = `${entry.actNumber}/${entry.year}`;
      try {
        const existing = known.get(key);
        // Stored by an older parse than this adapter now performs, so what is
        // on the row is incomplete whatever Lagasafn has done since. Neither
        // skip below may fire: this act has to be re-fetched and re-saved.
        // See PARSE_VERSION.
        const stale = !existing || existing.parseVersion !== PARSE_VERSION;

        // Cheapest skip: the index says this act still belongs to the codex
        // version we already parsed, so its text cannot have changed.
        if (
          !force &&
          !stale &&
          existing &&
          entry.codexVersion &&
          existing.codexVersion === entry.codexVersion
        ) {
          stats.skipped++;
          continue;
        }

        processed++;
        const html = await ctx.fetchText(actUrl(entry.actNumber, entry.year));
        const parsed = parseLagasafnHtml(html);

        // Around a tenth of in-force acts have no provisions in Lagasafn at
        // all — mostly older authorising acts whose operative text was never
        // republished online, leaving only a title and a pointer to a printed
        // volume. The act is still stored: it is genuinely in force, it should
        // be findable in the act lookup, and its page can link to the official
        // text. Only a page that fails to yield even an act title is treated
        // as a parse failure.
        if (!parsed.title && parsed.provisions.length === 0) {
          throw new Error("neither a title nor any provisions could be parsed");
        }
        if (parsed.provisions.length === 0) {
          ctx.log(`  ${key} "${entry.title}": no provisions published in Lagasafn`);
        }

        const hash = hashAct(parsed);
        if (!force && !stale && existing?.sourceHash === hash) {
          // Text unchanged, but the codex version moved on: record that so the
          // cheap skip above applies next time.
          await prisma.act.update({
            where: {
              jurisdiction_docType_actNumber_year_language: {
                jurisdiction: "is",
                docType: "act",
                actNumber: entry.actNumber,
                year: entry.year,
                language: "is",
              },
            },
            data: { codexVersion: parsed.codexVersion ?? entry.codexVersion, fetchedAt: new Date() },
          });
          stats.skipped++;
          continue;
        }

        // Judged on the act's *own* number, not the index entry's. For the ~16
        // pre-1900 acts whose filename number differs from their stated one,
        // the index key never matches a stored act, so keying this on `entry`
        // marked them "new" on every single run — clearing the citation
        // watermark and forcing a full corpus rescan every time.
        const storedKey = `${parsed.actNumber ?? entry.actNumber}/${parsed.year ?? entry.year}`;
        if (!known.has(storedKey)) newActs++;
        await saveAct(parsed, entry, hash);
        stats.indexed++;
        if (stats.indexed % 25 === 0) {
          ctx.log(`  … ${stats.indexed} acts written (at ${key}, index position ${position})`);
        }
      } catch (e) {
        stats.errors++;
        stats.errorSample = stats.errorSample ?? `${key}: ${String(e)}`;
        ctx.log(`  error on ${key} "${entry.title}": ${String(e).slice(0, 200)}`);
      }
    }

    if (!only) {
      // Wrap to the start once the index has been walked, so a scheduled run
      // keeps refreshing rather than parking at the end.
      const next = position >= entries.length ? 0 : position;
      await prisma.ingestCursor.upsert({
        where: { key: CURSOR_KEY },
        create: { key: CURSOR_KEY, nextPage: next },
        update: { nextPage: next },
      });
      ctx.log(`Cursor: next run resumes at index position ${next}/${entries.length}`);
    }

    // An act this database has never held is a link target no judgment has
    // ever been scanned against. The citation job is incremental on each
    // judgment's own text hash, so without this it would consider the whole
    // corpus already done and never link anything to the new acts — the case
    // that bit a cold start, where acts arriving after the first citation
    // pass stayed permanently unlinked.
    //
    // Clearing the watermark makes the next citation run a full rescan. That
    // is the point, and it is rare: it fires on a cold start and when Alþingi
    // passes a new act, not on the routine amendments Lagasafn publishes,
    // which only update provisions that already exist.
    if (newActs > 0) {
      const cleared = await prisma.document.updateMany({
        where: { citationScanHash: { not: null } },
        data: { citationScanHash: null },
      });
      ctx.log(
        `${newActs} previously unknown act(s) ingested — cleared the citation ` +
          `watermark on ${cleared.count} judgments so the next citations run re-links them.`
      );
    }

    return stats;
  },
};
