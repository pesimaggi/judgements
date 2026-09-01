/**
 * Runs the committed search cases against a live database and reports how the
 * current configuration does on them.
 *
 * The point is to make a search change measurable. Lögbrunnur ships two
 * providers behind one interface and, until this existed, no way to tell
 * which answers better — or whether a ranking change helped. Run it before
 * and after, compare the same numbers on the same cases.
 *
 *   npm run eval:search
 *   npm run eval:search -- --split development --limit 10
 *   SEARCH_PROVIDER=meilisearch npm run eval:search -- --json > meili.json
 *
 * Two kinds of case, because the corpus is not labelled yet and waiting for
 * labels would mean measuring nothing for months:
 *
 *   assertions  properties that hold without knowing the answer — a case
 *               number's own case is the top hit, a scoped query returns only
 *               the ticked sources, a phrase query's hits contain the phrase,
 *               nonsense returns nothing. These run today.
 *   grades      `relevant: [{ officialUrl, grade }]`, hand-labelled, scored
 *               with recall/MRR/nDCG. Add them as real failures turn up;
 *               `--record` prints the current top hits in the right shape to
 *               paste in.
 *
 * Assertions are not a lesser thing to measure. Most search regressions here
 * would be caught by "this returned nothing" long before they would be caught
 * by a tenth of a point of nDCG.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getSearchProvider } from "@/lib/search";
import type { SearchHit } from "@/lib/types";
import {
  ndcgAt,
  recallAt,
  strictRecallAt,
  reciprocalRank,
  pairwiseAccuracy,
  mean,
} from "@/search-eval/metrics";

interface Assertions {
  minResults?: number;
  maxResults?: number;
  topHitCaseNumber?: string;
  act?: { actNumber: number; year: number };
  onlySources?: string[];
  /** The top hit must be a real match, not a trigram near-match. */
  topHitIsExact?: boolean;
  everyHitContains?: string;
  noHitContains?: string;
}

interface EvalCase {
  id: string;
  category: string;
  split?: "development" | "holdout";
  query: string;
  sources?: string[];
  note?: string;
  assert?: Assertions;
  relevant?: { officialUrl: string; grade: number }[];
  mustOutrank?: { before: string; after: string }[];
}

interface QuerySet {
  defaultSources: string[];
  cases: EvalCase[];
}

interface CaseResult {
  id: string;
  category: string;
  split: string;
  query: string;
  hits: number;
  labelled: boolean;
  failures: string[];
  metrics?: {
    recall1: number;
    recall5: number;
    strictRecall1: number;
    mrr: number;
    ndcg10: number;
    pairwise: { correct: number; total: number };
  };
}

function parseArgs(argv: string[]) {
  const opts = {
    split: null as string | null,
    limit: 10,
    json: false,
    record: false,
    only: null as string | null,
    cases: join(process.cwd(), "src/search-eval/queries.json"),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") opts.json = true;
    else if (a === "--record") opts.record = true;
    else if (a === "--split") opts.split = argv[++i];
    else if (a === "--limit") opts.limit = Number(argv[++i]);
    else if (a === "--case") opts.only = argv[++i];
    else if (a === "--cases") opts.cases = argv[++i];
    else if (a === "--help" || a === "-h") {
      console.log(
        [
          "Usage: npm run eval:search -- [options]",
          "",
          "  --split <development|holdout>  Only this split. Omit for both.",
          "  --limit <n>                    Results per query (default 10, max 50).",
          "  --case <id>                    Run one case.",
          "  --cases <path>                 A different query set.",
          "  --record                       Print top hits as labelling stubs.",
          "  --json                         Machine-readable report.",
          "",
          "Reads SEARCH_PROVIDER and DATABASE_URL from the environment, so it",
          "measures whatever the app itself would run.",
        ].join("\n")
      );
      process.exit(0);
    }
  }
  return opts;
}

/** Grades for the returned hits, in rank order, from the case's labels. */
function gradeHits(hits: SearchHit[], relevant: EvalCase["relevant"]): number[] {
  const byUrl = new Map((relevant ?? []).map((r) => [r.officialUrl, r.grade]));
  return hits.map((h) => byUrl.get(h.officialUrl) ?? 0);
}

function checkAssertions(c: EvalCase, hits: SearchHit[], total: number): string[] {
  const a = c.assert;
  if (!a) return [];
  const failures: string[] = [];
  const top = hits[0];

  if (a.minResults !== undefined && total < a.minResults) {
    failures.push(`expected ≥${a.minResults} results, got ${total}`);
  }
  if (a.maxResults !== undefined && total > a.maxResults) {
    failures.push(
      `expected ≤${a.maxResults} results, got ${total}` +
        (top ? ` (top: ${top.caseNumber ?? top.title.slice(0, 40)})` : "")
    );
  }
  if (a.topHitCaseNumber !== undefined) {
    if (!top) failures.push(`expected ${a.topHitCaseNumber} as top hit, got nothing`);
    else if (top.caseNumber !== a.topHitCaseNumber) {
      failures.push(`top hit is ${top.caseNumber ?? "(no case number)"}, expected ${a.topHitCaseNumber}`);
    }
  }
  if (a.topHitIsExact) {
    if (!top) failures.push("expected an exact top hit, got nothing");
    else if (top.isFuzzy) {
      failures.push(
        `top hit ${top.caseNumber ?? top.title.slice(0, 30)} is a fuzzy near-match, not an exact one`
      );
    }
  }
  if (a.onlySources) {
    const stray = [...new Set(hits.map((h) => h.source))].filter((s) => !a.onlySources!.includes(s));
    if (stray.length) failures.push(`results leaked from unticked sources: ${stray.join(", ")}`);
  }
  if (a.everyHitContains) {
    const needle = a.everyHitContains.toLowerCase();
    const missing = hits.filter(
      (h) => !`${h.title} ${h.snippet} ${h.summary ?? ""}`.toLowerCase().includes(needle)
    );
    if (missing.length) {
      failures.push(`${missing.length}/${hits.length} hits do not mention "${a.everyHitContains}"`);
    }
  }
  if (a.noHitContains) {
    const needle = a.noHitContains.toLowerCase();
    const offending = hits.filter((h) =>
      `${h.title} ${h.snippet} ${h.summary ?? ""}`.toLowerCase().includes(needle)
    );
    if (offending.length) {
      failures.push(`${offending.length} hits contain the excluded term "${a.noHitContains}"`);
    }
  }
  return failures;
}

/** Act assertions go through the act lookup, which is a separate code path. */
async function checkActAssertion(c: EvalCase): Promise<string[]> {
  const want = c.assert?.act;
  if (!want) return [];
  const acts = await getSearchProvider().searchActs({ query: c.query, limit: 5 });
  if (acts.length === 0) return [`act lookup returned nothing for "${c.query}"`];
  const top = acts[0];
  if (top.actNumber !== want.actNumber || top.year !== want.year) {
    const got = acts.slice(0, 3).map((a) => `${a.actNumber}/${a.year}`).join(", ");
    return [`act lookup top hit is ${top.actNumber}/${top.year}, expected ${want.actNumber}/${want.year} (top 3: ${got})`];
  }
  return [];
}

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (!process.env.DATABASE_URL) {
    console.error(
      [
        "DATABASE_URL is not set.",
        "",
        "The evaluation runs against a real corpus — it measures ranking over the",
        "documents actually ingested, so there is nothing meaningful to run without",
        "one. Point it at a database with the corpus in it:",
        "",
        "  docker compose up -d db && npm run db:push && npm run db:setup-search",
        "",
        "The metric functions themselves are unit-tested without a database:",
        "  npm test -- src/search-eval/metrics.test.ts",
      ].join("\n")
    );
    process.exit(1);
  }

  const set: QuerySet = JSON.parse(readFileSync(opts.cases, "utf8"));
  let cases = set.cases;
  if (opts.split) cases = cases.filter((c) => (c.split ?? "development") === opts.split);
  if (opts.only) cases = cases.filter((c) => c.id === opts.only);

  if (cases.length === 0) {
    console.error("No cases matched.");
    process.exit(1);
  }

  const provider = getSearchProvider();
  const providerName = process.env.SEARCH_PROVIDER ?? "postgres";
  const results: CaseResult[] = [];

  for (const c of cases) {
    const sources = c.sources ?? set.defaultSources;
    const { hits, total } = await provider.search({
      query: c.query,
      sources,
      sort: "relevance",
      page: 1,
      pageSize: Math.min(50, opts.limit),
    });

    const failures = [...checkAssertions(c, hits, total), ...(await checkActAssertion(c))];
    const labelled = (c.relevant?.length ?? 0) > 0;

    const result: CaseResult = {
      id: c.id,
      category: c.category,
      split: c.split ?? "development",
      query: c.query,
      hits: total,
      labelled,
      failures,
    };

    if (labelled) {
      const graded = gradeHits(hits, c.relevant);
      const positions = new Map(hits.map((h, i) => [h.officialUrl, i]));
      result.metrics = {
        recall1: recallAt(graded, 1),
        recall5: recallAt(graded, 5),
        strictRecall1: strictRecallAt(graded, 1),
        mrr: reciprocalRank(graded),
        ndcg10: ndcgAt(graded, c.relevant!.map((r) => r.grade), 10),
        pairwise: pairwiseAccuracy(positions, c.mustOutrank ?? []),
      };
    }

    results.push(result);

    if (opts.record) {
      console.log(`\n// ${c.id} — ${c.query}`);
      console.log(
        JSON.stringify(
          hits.slice(0, 5).map((h) => ({
            officialUrl: h.officialUrl,
            grade: 0,
            _: `${h.caseNumber ?? ""} ${h.title}`.trim().slice(0, 80),
          })),
          null,
          2
        )
      );
    }
  }

  const labelledResults = results.filter((r) => r.metrics);
  const failed = results.filter((r) => r.failures.length > 0);

  const summary = {
    provider: providerName,
    limit: opts.limit,
    split: opts.split ?? "all",
    cases: results.length,
    assertionsPassed: results.length - failed.length,
    assertionsFailed: failed.length,
    labelledCases: labelledResults.length,
    ranking: labelledResults.length
      ? {
          recall1: mean(labelledResults.map((r) => r.metrics!.recall1)),
          recall5: mean(labelledResults.map((r) => r.metrics!.recall5)),
          strictRecall1: mean(labelledResults.map((r) => r.metrics!.strictRecall1)),
          mrr: mean(labelledResults.map((r) => r.metrics!.mrr)),
          ndcg10: mean(labelledResults.map((r) => r.metrics!.ndcg10)),
        }
      : null,
    node: process.version,
    platform: process.platform,
  };

  if (opts.json) {
    console.log(JSON.stringify({ summary, results }, null, 2));
  } else {
    console.log(`\nSearch evaluation — provider=${providerName} split=${summary.split} limit=${opts.limit}\n`);
    for (const r of results) {
      const mark = r.failures.length ? "FAIL" : " ok ";
      const m = r.metrics ? `  nDCG@10 ${r.metrics.ndcg10.toFixed(3)}` : "";
      console.log(`[${mark}] ${r.id.padEnd(32)} ${String(r.hits).padStart(6)} hits${m}`);
      for (const f of r.failures) console.log(`         ↳ ${f}`);
    }

    console.log(`\nAssertions: ${summary.assertionsPassed}/${summary.cases} passed`);
    if (summary.ranking) {
      console.log(
        `Ranking over ${summary.labelledCases} labelled case(s): ` +
          `recall@1 ${pct(summary.ranking.recall1)}  recall@5 ${pct(summary.ranking.recall5)}  ` +
          `MRR ${summary.ranking.mrr.toFixed(3)}  nDCG@10 ${summary.ranking.ndcg10.toFixed(3)}`
      );
    } else {
      console.log(
        `Ranking: no labelled cases yet. Add "relevant" to a case to score it — ` +
          `\`npm run eval:search -- --record\` prints the stubs.`
      );
    }

    const byCategory = new Map<string, { pass: number; total: number }>();
    for (const r of results) {
      const e = byCategory.get(r.category) ?? { pass: 0, total: 0 };
      e.total++;
      if (r.failures.length === 0) e.pass++;
      byCategory.set(r.category, e);
    }
    console.log(
      "\nBy category: " +
        [...byCategory].map(([k, v]) => `${k} ${v.pass}/${v.total}`).join("   ")
    );
  }

  // A failed assertion is a real regression, so the command fails — this is
  // meant to be usable as a gate, not only read by a person.
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
