/**
 * Lagastoð adapter — links each regulation to the act it is made under.
 *
 * Reads the lagastoð clause out of every stored regulation's own text and
 * resolves it against the acts this database holds, writing one
 * `RegulationBasis` row per article named (or one for the act alone, where the
 * clause names no article). See src/lib/lagastod.ts for the extraction and why
 * it is not the general citation extractor.
 *
 * What it buys: the reader of lög nr. 60/2007 can see the regulations made
 * under it, article by article, and the reader of a regulation can see what
 * authorises it. Without it the two corpora sit side by side and never refer
 * to one another, which was the main argument against ingesting regulations
 * at all.
 *
 * ── Incremental, on the same watermark the citation job uses ───────────────
 *
 * `Act.lagastodScanHash` holds the `sourceHash` the regulation had when it was
 * last scanned. A regulation whose hash still matches is skipped; one whose
 * text has changed is re-scanned and its rows replaced wholesale. So a run
 * after an unchanged ingest does nothing, and the job is safe to interrupt at
 * any point — each regulation's links and its watermark move in one
 * transaction.
 *
 * ── The act index is lög only, and that is load-bearing ────────────────────
 *
 * "laga nr. 91/1991" gives a number and a year and nothing else, so the index
 * is keyed on those alone. Reglugerð nr. 91/1991 exists and would collide; the
 * citation job learned this the same way. Only acts are resolvable targets
 * here anyway — a regulation is not made under another regulation.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { extractLagastod } from "@/lib/lagastod";
import type { IngestionAdapter, IngestContext, IngestStats } from "../adapter";

const BATCH_SIZE = Number(process.env.LAGASTOD_BATCH_SIZE ?? 100);

/** act "number/year" → act id, and act id → "articleNumber|letter" → provision id. */
export interface LagastodIndexes {
  acts: Map<string, string>;
  provisions: Map<string, Map<string, string>>;
}

const actKey = (actNumber: number, year: number) => `${actNumber}/${year}`;
const articleKey = (n: number, letter: string | null) => `${n}|${letter ?? ""}`;

export async function loadActIndexes(): Promise<LagastodIndexes> {
  const actRows = await prisma.act.findMany({
    where: { jurisdiction: "is", docType: "act" },
    select: { id: true, actNumber: true, year: true },
  });
  const acts = new Map(actRows.map((a) => [actKey(a.actNumber, a.year), a.id]));

  const provisionRows = await prisma.provision.findMany({
    where: {
      kind: "article",
      articleNumber: { not: null },
      act: { jurisdiction: "is", docType: "act" },
    },
    select: { id: true, actId: true, articleNumber: true, articleLetter: true },
  });
  const provisions = new Map<string, Map<string, string>>();
  for (const p of provisionRows) {
    let byArticle = provisions.get(p.actId);
    if (!byArticle) {
      byArticle = new Map();
      provisions.set(p.actId, byArticle);
    }
    byArticle.set(articleKey(p.articleNumber!, p.articleLetter), p.id);
  }
  return { acts, provisions };
}

export interface BasisRow {
  actId: string;
  provisionId: string | null;
  matchType: string;
  citationText: string;
  excerpt: string;
  charOffset: number;
}

export interface ScanResult {
  rows: BasisRow[];
  /** Acts named as a basis that this database does not hold, for the log. */
  unknownActs: Set<string>;
  /** Articles named that the act we hold has no provision for. */
  unknownArticles: Set<string>;
}

/**
 * Resolves one regulation's stated basis against the act index.
 *
 * An article that does not resolve is *not* dropped: the row is written
 * against the act with a null provision. The regulation does rest on that act,
 * and saying so with less precision is right where the alternative is saying
 * nothing. Lagasafn genuinely lacks provisions for about a tenth of acts in
 * force, and an article repealed since the regulation was made is gone from
 * the consolidated text by construction.
 */
export function scanRegulation(text: string, indexes: LagastodIndexes): ScanResult {
  const result: ScanResult = {
    rows: [],
    unknownActs: new Set(),
    unknownArticles: new Set(),
  };
  const seen = new Set<string>();

  for (const c of extractLagastod(text)) {
    const key = actKey(c.actNumber, c.year);
    const actId = indexes.acts.get(key);
    if (!actId) {
      result.unknownActs.add(key);
      continue;
    }
    const byArticle = indexes.provisions.get(actId);
    const resolved: (string | null)[] = [];
    for (const a of c.articles) {
      const provisionId = byArticle?.get(articleKey(a.number, a.letter));
      if (provisionId) resolved.push(provisionId);
      else result.unknownArticles.add(`${key} ${a.number}${a.letter ?? ""}. gr.`);
    }
    // No article named, or none of them resolved: one row for the act itself.
    if (resolved.length === 0) resolved.push(null);

    for (const provisionId of resolved) {
      const rowKey = `${actId}|${provisionId ?? ""}`;
      if (seen.has(rowKey)) continue;
      seen.add(rowKey);
      result.rows.push({
        actId,
        provisionId,
        matchType: "stated",
        citationText: c.citationText,
        excerpt: c.excerpt,
        charOffset: c.index,
      });
    }
  }
  return result;
}

export const lagastodAdapter: IngestionAdapter = {
  key: "lagastod",
  name: "Lagastoð (regulations → the acts they are made under)",
  sourceKeys: [],

  async run(ctx: IngestContext): Promise<IngestStats> {
    const stats: IngestStats = { indexed: 0, skipped: 0, errors: 0 };

    const indexes = await loadActIndexes();
    if (indexes.acts.size === 0) {
      throw new Error("No acts ingested yet — run --adapter=lagasafn first.");
    }
    ctx.log(`Act index: ${indexes.acts.size} acts, ${indexes.provisions.size} with provisions`);

    const force = process.env.LAGASTOD_FORCE === "1";
    const maxRegulations = Number(
      process.env.LAGASTOD_MAX_REGULATIONS ?? Number.MAX_SAFE_INTEGER
    );
    const unknownActs = new Map<string, number>();
    let rowsWritten = 0;
    let processed = 0;

    while (processed < maxRegulations) {
      // Re-queried each round rather than paged with an offset, for the reason
      // the citation job gives: every batch moves its own watermark, so the
      // set of outstanding work shrinks under an offset and rows get skipped.
      // Raw, and written with the NULL case spelled out, because that case is
      // the whole job on a first run: `NOT (lagastod_scan_hash = source_hash)`
      // is NULL — and therefore false — for a regulation never scanned, so the
      // obvious form silently selects only the ones already done. The citation
      // job's query says `IS NULL OR <>` for the same reason.
      const outstanding = force
        ? Prisma.empty
        : Prisma.sql`AND (lagastod_scan_hash IS NULL OR lagastod_scan_hash <> source_hash)`;
      const batch = await prisma.$queryRaw<
        { id: string; act_number: number; year: number; source_hash: string }[]
      >`
        SELECT id, act_number, year, source_hash
          FROM acts
         WHERE jurisdiction = 'is' AND doc_type = 'regulation'
           ${outstanding}
         LIMIT ${Math.min(BATCH_SIZE, maxRegulations - processed)}
      `;
      if (batch.length === 0) break;

      for (const reg of batch) {
        const label = `${reg.act_number}/${reg.year}`;
        try {
          // The regulation's text is its provisions, in order — the same text
          // the reader shows, so an offset in a stored excerpt means something.
          const provisions = await prisma.provision.findMany({
            where: { actId: reg.id },
            orderBy: { ordering: "asc" },
            select: { fullText: true },
          });
          const text = provisions.map((p) => p.fullText).join("\n\n");
          const scan = scanRegulation(text, indexes);
          for (const key of scan.unknownActs) {
            unknownActs.set(key, (unknownActs.get(key) ?? 0) + 1);
          }

          // Links and watermark in one commit, so an interrupted run never
          // leaves a regulation half-linked or marked done without its rows.
          await prisma.$transaction([
            prisma.regulationBasis.deleteMany({ where: { regulationId: reg.id } }),
            prisma.regulationBasis.createMany({
              data: scan.rows.map((r) => ({ ...r, regulationId: reg.id })),
            }),
            prisma.act.update({
              where: { id: reg.id },
              data: { lagastodScanHash: reg.source_hash },
            }),
          ]);

          rowsWritten += scan.rows.length;
          if (scan.rows.length > 0) stats.indexed++;
          else stats.skipped++;
        } catch (e) {
          stats.errors++;
          stats.errorSample = stats.errorSample ?? `${label}: ${String(e)}`;
          ctx.log(`  error on ${label}: ${String(e).slice(0, 200)}`);
        }
        processed++;
      }

      // A forced run rewrites rows whose watermark already matches, so the
      // query above would return the same batch for ever. One pass is the
      // whole job in that mode.
      if (force) break;
    }

    ctx.log(
      `Scanned ${processed} regulation(s): ${stats.indexed} with a stated basis, ` +
        `${stats.skipped} without, ${rowsWritten} links written.`
    );
    if (unknownActs.size > 0) {
      const worst = [...unknownActs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
      ctx.log(
        `Acts named as a basis but not held (${unknownActs.size}): ` +
          worst.map(([k, n]) => `${k}×${n}`).join(", ")
      );
    }
    return stats;
  },
};
