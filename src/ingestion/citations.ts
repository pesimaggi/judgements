/**
 * Citation-extraction job — links judgments to the provisions they cite.
 *
 * This is the deterministic pass: a judgment is linked to a provision only
 * where the article and its act appear together in the text ("1. mgr. 175.
 * gr. laga nr. 91/1991"), so no inference is involved and the link is as
 * reliable as the source sentence. Bare references ("skv. 5. gr." with the
 * act named earlier) are deliberately not resolved here — measured over the
 * corpus, resolving them by carrying the last-named act forward is only
 * reliable within a few hundred characters and wrong more often than not
 * beyond that. `CaseProvisionLink.matchType` exists so such links can be
 * added later as a separate, separately-trustable class.
 *
 * Scholarly journals are deliberately left out. An article citing 26. gr.
 * skaðabótalaga is worth finding, but CaseProvisionLink is modelled as *a
 * decision in a case citing a provision* and the act reader counts its rows as
 * "úrlausnir" — so feeding articles into it would quietly make every one of
 * those counts wrong. An article is not an úrlausn: nobody decided anything.
 * Journal articles stay fully searchable; linking them to provisions needs a
 * link type and a label of their own first.
 *
 * Incremental and resumable, like the other pipelines here: a judgment is
 * rescanned only when its text has changed since the last scan, which is one
 * comparison of Document.citationScanHash against Document.textHash. A run
 * that dies partway loses nothing — every document it finished is already
 * marked. To force a full rebuild (after new acts land, say):
 *
 *   UPDATE "Document" SET citation_scan_hash = NULL;
 *
 * Run with:  npm run ingest -- --adapter=citations
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { SCHOLARSHIP_SOURCE_KEYS } from "@/lib/sources";
import {
  extractActCitations,
  extractProvisionCitations,
  normalizeSpacesPreservingOffsets,
  sentenceAround,
} from "@/lib/legal-citations";
import type { IngestionAdapter, IngestContext, IngestStats } from "./adapter";

/** How many judgments to hold in memory at once; their full text is large. */
const BATCH_SIZE = Number(process.env.CITATION_BATCH_SIZE ?? 50);

const MATCH_EXPLICIT = "explicit_citation";

/** actNumber/year → act id. */
type ActIndex = Map<string, string>;
/** act id → "articleNumber|letter" → provision id. */
type ProvisionIndex = Map<string, Map<string, string>>;

const actKey = (actNumber: number, year: number) => `${actNumber}/${year}`;
const articleKey = (n: number, letter: string | null) => `${n}|${letter ?? ""}`;

async function loadIndexes(ctx: IngestContext): Promise<{
  acts: ActIndex;
  provisions: ProvisionIndex;
}> {
  const actRows = await prisma.act.findMany({
    select: { id: true, actNumber: true, year: true },
  });
  const acts: ActIndex = new Map(actRows.map((a) => [actKey(a.actNumber, a.year), a.id]));

  // Only "article" provisions are resolvable targets. Temporary provisions
  // carry no article number, and annexed treaty text has its own numbering
  // that would otherwise collide with the act's own — see lib/lagasafn.ts.
  const provisionRows = await prisma.provision.findMany({
    where: { kind: "article", articleNumber: { not: null } },
    select: { id: true, actId: true, articleNumber: true, articleLetter: true },
  });
  const provisions: ProvisionIndex = new Map();
  for (const p of provisionRows) {
    let byArticle = provisions.get(p.actId);
    if (!byArticle) {
      byArticle = new Map();
      provisions.set(p.actId, byArticle);
    }
    byArticle.set(articleKey(p.articleNumber!, p.articleLetter), p.id);
  }

  ctx.log(`Indexed ${acts.size} acts and ${provisionRows.length} provisions`);
  return { acts, provisions };
}

interface ScanResult {
  provisionLinks: {
    provisionId: string;
    matchType: string;
    paragraphNumber: number | null;
    pointNumber: number | null;
    citationText: string;
    excerpt: string;
    charOffset: number;
  }[];
  actLinks: { actId: string; matchType: string; excerpt: string; charOffset: number }[];
  /** act id → alias → count, merged into Act.aliases at the end of the run. */
  aliases: Map<string, Map<string, number>>;
  /** Citations naming an act we do not hold, for the run's log. */
  unknownActs: Set<string>;
}

/** Extracts every link a single judgment's text supports. */
export function scanDocument(
  rawText: string,
  acts: ActIndex,
  provisions: ProvisionIndex
): ScanResult {
  // Length-preserving, so every offset below indexes into the caller's own
  // text and the UI can jump straight to the passage.
  const text = normalizeSpacesPreservingOffsets(rawText);

  const result: ScanResult = {
    provisionLinks: [],
    actLinks: [],
    aliases: new Map(),
    unknownActs: new Set(),
  };

  const provisionCitations = extractProvisionCitations(text);
  const covered: [number, number][] = [];
  // The unique key is (document, provision, offset); two citations to the
  // same provision at the same offset cannot happen, but the same provision
  // cited twice in one judgment should produce two rows at two offsets.
  const seen = new Set<string>();

  for (const c of provisionCitations) {
    covered.push([c.index, c.index + c.length]);
    const actId = acts.get(actKey(c.actNumber, c.year));
    if (!actId) {
      result.unknownActs.add(actKey(c.actNumber, c.year));
      continue;
    }
    const provisionId = provisions.get(actId)?.get(articleKey(c.articleNumber, c.articleLetter));
    if (!provisionId) continue;

    const key = `${provisionId}|${c.index}`;
    if (seen.has(key)) continue;
    seen.add(key);

    result.provisionLinks.push({
      provisionId,
      matchType: MATCH_EXPLICIT,
      paragraphNumber: c.paragraphNumber,
      pointNumber: c.pointNumber,
      citationText: c.text,
      excerpt: sentenceAround(text, c.index),
      charOffset: c.index,
    });
  }

  const seenActLinks = new Set<string>();
  for (const c of extractActCitations(text)) {
    const actId = acts.get(actKey(c.actNumber, c.year));
    if (!actId) {
      result.unknownActs.add(actKey(c.actNumber, c.year));
      continue;
    }

    if (c.alias) {
      let byAlias = result.aliases.get(actId);
      if (!byAlias) {
        byAlias = new Map();
        result.aliases.set(actId, byAlias);
      }
      byAlias.set(c.alias, (byAlias.get(c.alias) ?? 0) + 1);
    }

    // An act reference that is part of a provision citation is already
    // represented by the provision link; only bare act references get their
    // own row.
    if (covered.some(([s, e]) => c.index >= s && c.index < e)) continue;

    const key = `${actId}|${c.index}`;
    if (seenActLinks.has(key)) continue;
    seenActLinks.add(key);

    result.actLinks.push({
      actId,
      matchType: MATCH_EXPLICIT,
      excerpt: sentenceAround(text, c.index),
      charOffset: c.index,
    });
  }

  return result;
}

export const citationsAdapter: IngestionAdapter = {
  key: "citations",
  name: "Citation extraction (judgments → provisions)",
  sourceKeys: [],

  async run(ctx: IngestContext): Promise<IngestStats> {
    const stats: IngestStats = { indexed: 0, skipped: 0, errors: 0 };
    const { acts, provisions } = await loadIndexes(ctx);
    if (acts.size === 0) {
      throw new Error("No acts ingested yet — run --adapter=lagasafn first.");
    }

    const maxDocs = Number(process.env.CITATION_MAX_DOCS ?? Number.MAX_SAFE_INTEGER);
    // Empty-safe: with no scholarly sources registered this adds no condition
    // at all, rather than an `IN ()` Postgres would reject.
    const excludeScholarship = SCHOLARSHIP_SOURCE_KEYS.length
      ? Prisma.sql`AND source NOT IN (${Prisma.join(SCHOLARSHIP_SOURCE_KEYS)})`
      : Prisma.empty;
    const aliasTotals = new Map<string, Map<string, number>>();
    const unknownActs = new Map<string, number>();
    let linksWritten = 0;
    let processed = 0;

    while (processed < maxDocs) {
      // Re-queried each round rather than paged with an offset: every batch
      // marks its documents as scanned, so the set of outstanding work
      // shrinks and "the next unscanned batch" is always the right query.
      // An offset would skip documents as the result set moved under it.
      const batch = await prisma.$queryRaw<
        { id: string; full_text: string; text_hash: string }[]
      >`
        SELECT id, full_text, text_hash
          FROM "Document"
         WHERE (citation_scan_hash IS NULL OR citation_scan_hash <> text_hash)
           ${excludeScholarship}
         LIMIT ${Math.min(BATCH_SIZE, maxDocs - processed)}
      `;
      if (batch.length === 0) break;

      for (const doc of batch) {
        try {
          const scan = scanDocument(doc.full_text, acts, provisions);

          for (const [actId, byAlias] of scan.aliases) {
            let totals = aliasTotals.get(actId);
            if (!totals) {
              totals = new Map();
              aliasTotals.set(actId, totals);
            }
            for (const [alias, n] of byAlias) totals.set(alias, (totals.get(alias) ?? 0) + n);
          }
          for (const key of scan.unknownActs) {
            unknownActs.set(key, (unknownActs.get(key) ?? 0) + 1);
          }

          // One transaction per judgment: its links are replaced wholesale
          // and the watermark moves in the same commit, so the job can be
          // interrupted anywhere without leaving a document half-linked.
          await prisma.$transaction([
            prisma.caseProvisionLink.deleteMany({ where: { documentId: doc.id } }),
            prisma.caseActLink.deleteMany({ where: { documentId: doc.id } }),
            prisma.caseProvisionLink.createMany({
              data: scan.provisionLinks.map((l) => ({ ...l, documentId: doc.id })),
              skipDuplicates: true,
            }),
            prisma.caseActLink.createMany({
              data: scan.actLinks.map((l) => ({ ...l, documentId: doc.id })),
              skipDuplicates: true,
            }),
            prisma.document.update({
              where: { id: doc.id },
              data: { citationScanHash: doc.text_hash },
            }),
          ]);

          linksWritten += scan.provisionLinks.length + scan.actLinks.length;
          stats.indexed++;
        } catch (e) {
          stats.errors++;
          stats.errorSample = stats.errorSample ?? `${doc.id}: ${String(e)}`;
          ctx.log(`  error on document ${doc.id}: ${String(e).slice(0, 200)}`);
          // Leave citationScanHash untouched so the next run retries it.
        }
        processed++;
      }

      ctx.log(`  … ${stats.indexed} judgments scanned, ${linksWritten} links written`);
    }

    await writeAliases(ctx, aliasTotals);

    if (unknownActs.size) {
      const top = [...unknownActs.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([k, n]) => `${k}×${n}`);
      ctx.log(
        `Cited acts not held (repealed, amending, or not yet ingested): ` +
          `${unknownActs.size} distinct — most cited: ${top.join(", ")}`
      );
    }
    ctx.log(`Done: ${stats.indexed} judgments, ${linksWritten} links`);
    return stats;
  },
};

/**
 * Records the short names judgments actually use for each act, most-used
 * first, so the act type-ahead can match "vaxtalög" to lög nr. 38/2001 —
 * whose official title contains no such word.
 */
async function writeAliases(
  ctx: IngestContext,
  totals: Map<string, Map<string, number>>
): Promise<void> {
  let updated = 0;
  for (const [actId, byAlias] of totals) {
    const aliases = [...byAlias.entries()]
      .sort((a, b) => b[1] - a[1])
      // A name used once is as likely to be a typo in one judgment as a real
      // short name; the fuzzy search handles genuine misspellings anyway.
      .filter(([, n]) => n >= 2)
      .slice(0, 6)
      .map(([alias]) => alias);
    if (aliases.length === 0) continue;
    await prisma.act.update({ where: { id: actId }, data: { aliases } });
    updated++;
  }
  ctx.log(`Aliases refreshed for ${updated} acts`);
}
