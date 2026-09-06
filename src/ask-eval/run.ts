/**
 * Evaluates the well's *answers*, as opposed to its search.
 *
 *   npm run eval:ask                       # offline, no model, no database
 *   npm run eval:ask -- --json > ask.json
 *   npm run eval:ask -- --category citation-validation
 *   npm run eval:ask -- --live             # against the real thing, costs money
 *   npm run eval:ask -- --live --record    # re-record the fixtures
 *
 * TWO MODES, AND THE DEFAULT IS THE FREE ONE.
 *
 * Offline (the default) replays a recorded run: the plan the planner produced,
 * the sources retrieval returned, and the answer the model wrote, all committed
 * in fixtures.json. Everything after retrieval — the answer prompt, the
 * citation validation, the qualifiers, the abstentions — is the code the app
 * runs, driven by a fake model that hands back the recorded answer. So a change
 * to validation, to the prompt's rules, or to the complexity classifier is
 * measured here on every commit, on any machine, with no API key and no corpus.
 *
 * Live runs the real pipeline against the real database and a real model. It
 * measures what offline cannot — whether retrieval still finds the right
 * provision — and it is explicitly opted into because it spends money.
 *
 * What is reported either way: retrieval recall, citation validity, claim
 * support, invented authority identifiers, correct abstention, correct
 * language, latency, retrieval counts, the provider and model, and token usage
 * where the provider reported it.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ask } from "@/lib/ask/pipeline";
import { askConfig } from "@/lib/ask/config";
import { askProviderInfo } from "@/lib/ask/llm";
import { parsePlan } from "@/lib/ask/plan";
import { heuristicPlan } from "@/lib/ask/plan";
import type { AskModel } from "@/lib/ask/llm";
import type { Retrieval } from "@/lib/ask/retrieve";
import { historicalLimitation } from "@/lib/ask/retrieve";
import type { AskSource } from "@/lib/ask/types";
import type { AskFixture, FixtureSet, RecordedSource } from "@/ask-eval/types";
import {
  citationValidity,
  claimSupport,
  detectLanguage,
  forbiddenCited,
  inventedAuthorities,
  mean,
  missingPoints,
  prohibitedPresent,
  retrievalRecall,
  statesHistoricalLimitation,
} from "@/ask-eval/metrics";

interface Options {
  json: boolean;
  live: boolean;
  record: boolean;
  category: string | null;
  only: string | null;
  split: string | null;
  fixtures: string;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    json: false,
    live: false,
    record: false,
    category: null,
    only: null,
    split: null,
    fixtures: join(process.cwd(), "src/ask-eval/fixtures.json"),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") opts.json = true;
    else if (a === "--live") opts.live = true;
    else if (a === "--record") opts.record = true;
    else if (a === "--category") opts.category = argv[++i];
    else if (a === "--case" || a === "--id") opts.only = argv[++i];
    else if (a === "--split") opts.split = argv[++i];
    else if (a === "--fixtures") opts.fixtures = argv[++i];
    else if (a === "--help" || a === "-h") {
      console.log(
        [
          "Usage: npm run eval:ask -- [options]",
          "",
          "  --live               Run the real pipeline. Needs DATABASE_URL and an",
          "                       API key, and makes paid model calls.",
          "  --record             With --live, write the run back into the fixture",
          "                       file as the recorded run.",
          "  --category <name>    Only fixtures in this category.",
          "  --split <name>       Only this split (development | holdout).",
          "  --id <id>            Only this fixture.",
          "  --fixtures <path>    A different fixture file.",
          "  --json               Machine-readable report.",
          "",
          "Without --live nothing is called: the recorded plan, sources and answer",
          "in the fixture file drive the real pipeline through a fake model.",
        ].join("\n")
      );
      process.exit(0);
    }
  }
  return opts;
}

/**
 * A model that answers with what the fixture recorded.
 *
 * `extract` covers the planner and, if either optional stage is switched on,
 * the reranker and the verifier: it returns the recorded plan for the first
 * and null for the others, which is precisely the "the optional stage declined"
 * path both of them are built to survive. So the offline run also exercises
 * those fallbacks.
 */
function recordedModel(fixture: AskFixture): AskModel {
  return {
    complete: async () => fixture.recorded?.answer ?? "",
    extract: async (req) => {
      if (req.tool.name !== "plan_search") return null;
      return req.parse(fixture.recorded?.plan ?? {});
    },
  };
}

/** The recorded sources, as the retrieval stage would have produced them. */
function recordedRetrieval(fixture: AskFixture, language: "is" | "en", historical: boolean): Retrieval {
  const recorded = fixture.recorded?.sources ?? [];
  const sources: AskSource[] = recorded.map((s: RecordedSource) => ({
    n: s.n,
    kind: s.kind,
    title: s.title,
    subtitle: s.subtitle,
    path: s.path,
    authority: s.authority,
    date: s.date,
    jurisdiction: s.jurisdiction,
    excerpt: s.evidence,
    cited: false,
  }));

  const evidence = new Map<number, string>(
    recorded.map((s) => [s.n, s.evidence ?? `${s.title} — ${s.subtitle}`])
  );

  const context = recorded
    .map((s) =>
      [
        `<<<SOURCE ${s.n}>>>`,
        `[${s.n}] ${s.kind.toUpperCase()} — ${s.title}`,
        s.evidence ?? s.subtitle,
        `<<<END SOURCE ${s.n}>>>`,
      ].join("\n")
    )
    .join("\n\n");

  return {
    sources,
    context,
    counts: {
      acts: recorded.filter((s) => s.kind === "act").length,
      provisions: recorded.filter((s) => s.kind === "provision").length,
      decisions: recorded.filter((s) => s.kind !== "act" && s.kind !== "provision").length,
      candidates: recorded.length,
    },
    evidence,
    limitations: historical ? [historicalLimitation(language)] : [],
    shape: {
      distinctActs: new Set(recorded.map((s) => s.subtitle)).size,
      jurisdictions: Array.from(
        new Set(recorded.map((s) => s.jurisdiction).filter(Boolean) as string[])
      ),
      decisions: recorded.filter((s) => s.kind === "decision").length,
      conflicting: false,
    },
  };
}

interface CaseResult {
  id: string;
  category: string;
  failures: string[];
  metrics: {
    retrievalRecall: number;
    citationValidity: number;
    claimSupport: number;
    inventedAuthorities: string[];
    correctAbstention: boolean;
    correctLanguage: boolean;
    historicalLimitationStated: boolean | null;
    latencyMs: number;
    sources: number;
    candidates: number;
    cited: number;
    tokens: { input: number; output: number };
  };
  recorded?: { plan: Record<string, unknown>; sources: RecordedSource[]; answer: string };
}

async function runFixture(fixture: AskFixture, opts: Options): Promise<CaseResult> {
  const config = askConfig();
  const startedAt = Date.now();

  // The plan is needed before the run in offline mode, to know the language and
  // the historical flag the recorded retrieval has to carry. It is validated
  // through the app's own parser rather than trusted as written.
  const plan =
    parsePlan(fixture.recorded?.plan ?? {}, fixture.question) ?? heuristicPlan(fixture.question);

  const { response, metrics } = await ask(fixture.question, [], {
    config,
    quiet: true,
    ...(opts.live
      ? {}
      : {
          model: recordedModel(fixture),
          retrieve: async () => recordedRetrieval(fixture, plan.language, plan.historical),
        }),
  });

  const latencyMs = Date.now() - startedAt;
  const answer = response.answer;
  const evidence = (fixture.recorded?.sources ?? []).map((s) => s.evidence ?? "");

  const recall = retrievalRecall(response.sources, fixture.expectSources);
  const validity = citationValidity(answer, response.sources);
  const support = claimSupport(answer);
  const invented = inventedAuthorities(answer, response.sources, evidence);
  const forbidden = forbiddenCited(response.sources, fixture.forbiddenSources);
  const missing = missingPoints(answer, fixture.requiredPoints);
  const prohibited = prohibitedPresent(answer, fixture.prohibitedConclusions);
  const correctAbstention = (response.abstained ?? false) === (fixture.expectAbstention ?? false);
  const correctLanguage = detectLanguage(answer) === fixture.language;
  const historicalStated = fixture.expectHistoricalLimitation
    ? statesHistoricalLimitation(answer)
    : null;

  const failures: string[] = [];
  if (recall.missing.length) failures.push(`missing expected source(s): ${recall.missing.join(", ")}`);
  if (validity.invalid.length) failures.push(`citations to sources that do not exist: ${validity.invalid.join(", ")}`);
  if (invented.length) failures.push(`authority identifiers not in any source: ${invented.join(", ")}`);
  if (forbidden.length) failures.push(`cited a forbidden source: ${forbidden.join(", ")}`);
  if (missing.length) failures.push(`answer does not make required point(s): ${missing.join(", ")}`);
  if (prohibited.length) failures.push(`answer contains prohibited text: ${prohibited.join(", ")}`);
  if (!correctAbstention) {
    failures.push(
      fixture.expectAbstention ? "expected the well to abstain, it answered" : "the well abstained unexpectedly"
    );
  }
  // An abstention is a fixed message in the corpus's own language; measuring
  // the answer's language against the fixture is only meaningful when the
  // model actually wrote one.
  if (!correctLanguage && !response.abstained) {
    failures.push(`answered in ${detectLanguage(answer)}, expected ${fixture.language}`);
  }
  if (historicalStated === false) failures.push("historical-law limitation was not stated");

  return {
    id: fixture.id,
    category: fixture.category,
    failures,
    metrics: {
      retrievalRecall: recall.recall,
      citationValidity: validity.validity,
      claimSupport: support.support,
      inventedAuthorities: invented,
      correctAbstention,
      correctLanguage,
      historicalLimitationStated: historicalStated,
      latencyMs,
      sources: response.sources.length,
      candidates: metrics.retrieval.candidates,
      cited: response.sources.filter((s) => s.cited).length,
      tokens: { input: metrics.tokens.input, output: metrics.tokens.output },
    },
    recorded: opts.record
      ? {
          plan: { ...(fixture.recorded?.plan ?? {}) },
          sources: response.sources.map((s) => ({
            n: s.n,
            kind: s.kind,
            title: s.title,
            subtitle: s.subtitle,
            path: s.path,
            authority: s.authority,
            date: s.date,
            jurisdiction: s.jurisdiction,
            evidence: s.excerpt,
          })),
          answer: response.answer,
        }
      : undefined,
  };
}

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const set: FixtureSet = JSON.parse(readFileSync(opts.fixtures, "utf8"));

  let fixtures = set.fixtures;
  if (opts.category) fixtures = fixtures.filter((f) => f.category === opts.category);
  if (opts.split) fixtures = fixtures.filter((f) => (f.split ?? "development") === opts.split);
  if (opts.only) fixtures = fixtures.filter((f) => f.id === opts.only);

  if (opts.live && !process.env.DATABASE_URL) {
    console.error(
      [
        "--live needs DATABASE_URL: it runs the real retrieval against the real",
        "corpus. Without it, run the default offline mode, which replays the",
        "recorded runs in the fixture file:",
        "",
        "  npm run eval:ask",
      ].join("\n")
    );
    process.exit(1);
  }
  if (!opts.live) {
    const unrecorded = fixtures.filter((f) => !f.recorded);
    if (unrecorded.length) {
      console.error(
        `These fixtures have no recorded run and cannot be scored offline: ${unrecorded
          .map((f) => f.id)
          .join(", ")}. Record them with --live --record, or run with --live.`
      );
      process.exit(1);
    }
  }
  if (fixtures.length === 0) {
    console.error("No fixtures matched.");
    process.exit(1);
  }

  const { provider, model } = opts.live ? askProviderInfo() : { provider: "recorded", model: "recorded" };
  const config = askConfig();
  const results: CaseResult[] = [];
  for (const fixture of fixtures) {
    results.push(await runFixture(fixture, opts));
  }

  if (opts.record && opts.live) {
    const byId = new Map(results.map((r) => [r.id, r.recorded]));
    const updated: FixtureSet = {
      ...set,
      fixtures: set.fixtures.map((f) =>
        byId.has(f.id) ? { ...f, recorded: { ...f.recorded, ...byId.get(f.id)! } } : f
      ),
    };
    writeFileSync(opts.fixtures, `${JSON.stringify(updated, null, 2)}\n`);
    console.error(`Recorded ${byId.size} run(s) into ${opts.fixtures}.`);
  }

  const failed = results.filter((r) => r.failures.length > 0);
  const summary = {
    mode: opts.live ? "live" : "offline",
    provider,
    model,
    effort: { simple: config.simpleEffort, complex: config.complexEffort, plan: config.planEffort },
    stages: {
      verifyCitations: config.verifyCitations,
      rerankWithModel: config.rerankWithModel,
      maxCandidates: config.maxCandidates,
      maxSources: config.maxSources,
    },
    fixtures: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    retrievalRecall: mean(results.map((r) => r.metrics.retrievalRecall)),
    citationValidity: mean(results.map((r) => r.metrics.citationValidity)),
    claimSupport: mean(results.map((r) => r.metrics.claimSupport)),
    inventedAuthorities: results.reduce((n, r) => n + r.metrics.inventedAuthorities.length, 0),
    correctAbstention: mean(results.map((r) => (r.metrics.correctAbstention ? 1 : 0))),
    correctLanguage: mean(results.map((r) => (r.metrics.correctLanguage ? 1 : 0))),
    medianLatencyMs: median(results.map((r) => r.metrics.latencyMs)),
    tokens: {
      input: results.reduce((n, r) => n + r.metrics.tokens.input, 0),
      output: results.reduce((n, r) => n + r.metrics.tokens.output, 0),
    },
    node: process.version,
  };

  if (opts.json) {
    console.log(JSON.stringify({ summary, results }, null, 2));
  } else {
    console.log(
      `\nAnswer evaluation — ${summary.mode}  provider=${provider ?? "none"} model=${model ?? "none"}\n`
    );
    for (const r of results) {
      const mark = r.failures.length ? "FAIL" : " ok ";
      console.log(
        `[${mark}] ${r.id.padEnd(34)} recall ${pct(r.metrics.retrievalRecall).padStart(6)}  ` +
          `cites ${pct(r.metrics.citationValidity).padStart(6)}  claims ${pct(r.metrics.claimSupport).padStart(6)}  ` +
          `${String(r.metrics.latencyMs).padStart(5)}ms`
      );
      for (const f of r.failures) console.log(`         ↳ ${f}`);
    }
    console.log(`\nFixtures: ${summary.passed}/${summary.fixtures} passed`);
    console.log(
      `Retrieval recall ${pct(summary.retrievalRecall)}   citation validity ${pct(summary.citationValidity)}   ` +
        `claim support ${pct(summary.claimSupport)}`
    );
    console.log(
      `Invented authority identifiers: ${summary.inventedAuthorities}   ` +
        `correct abstention ${pct(summary.correctAbstention)}   correct language ${pct(summary.correctLanguage)}`
    );
    console.log(
      `Median latency ${summary.medianLatencyMs}ms   tokens in/out ${summary.tokens.input}/${summary.tokens.output}   ` +
        `verify=${config.verifyCitations ? "on" : "off"} rerank=${config.rerankWithModel ? "on" : "off"}`
    );
    if (!opts.live) {
      console.log(
        "\nOffline mode: no model was called and no database was read. Retrieval\n" +
          "recall here measures the recorded sources, not a live search — run with\n" +
          "--live to measure retrieval itself."
      );
    }
  }

  process.exit(failed.length > 0 ? 1 : 0);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
