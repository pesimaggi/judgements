/**
 * The well, end to end.
 *
 * Plan → retrieve → rank → answer → validate → (verify). The route used to
 * hold this, three lines long; it is longer now, and it does not belong in a
 * route handler for two reasons. The evaluation harness has to be able to run
 * exactly what a request runs, against a fake model, without an HTTP server.
 * And the timing, the fallbacks and the metrics are the same on both paths —
 * duplicating them is how the harness ends up measuring something the app does
 * not do.
 *
 * Which stages are allowed to fail is the design here:
 *
 *   plan       degrades to keyword heuristics. A question is answerable
 *              without a plan; it is not answerable without law.
 *   retrieve   fails the request. Nothing else can stand in for it.
 *   rerank     optional, off by default, degrades to the deterministic order.
 *   answer     fails the request, including when it comes back empty.
 *   verify     optional, off by default, degrades to the deterministic
 *              validation that has already run.
 */
import { getAskModel, askProviderInfo, type AskModel } from "./llm";
import { askConfig, type AskConfig } from "./config";
import { planQuery, heuristicPlan } from "./plan";
import { retrieve, type Retrieval } from "./retrieve";
import { answer } from "./answer";
import { verifyAnswer } from "./verify";
import { AskMetricsRecorder, logAskMetrics, type AskMetrics } from "./metrics";
import { withTimeout, withTimeoutOr } from "./timeout";
import type { AskEvent, AskResponse, AskTurn } from "./types";

export interface AskOptions {
  scope?: "eea" | "eu";
  model?: AskModel;
  config?: AskConfig;
  /** Skips the metrics line — the evaluation harness reports its own. */
  quiet?: boolean;
  /**
   * Called as each stage produces something a reader could be shown.
   *
   * Purely additive: with no `onEvent` this function behaves exactly as it did
   * before — one request, one response — which is what the evaluation harness
   * runs and why it can keep measuring the same thing. With one, the same
   * stages in the same order also report as they finish, and the answer stage
   * streams line by line.
   *
   * Never throws into the pipeline: an event handler that fails is the
   * caller's problem, not a reason to fail a question that was answered. See
   * `emit`.
   */
  onEvent?: (event: AskEvent) => void;
  /**
   * Stands in for the retrieval stage.
   *
   * The one seam in this module, and it exists for the evaluation harness:
   * scoring an answer against recorded sources means replaying the retrieval
   * that produced them, and everything after it — ranking's output, the
   * prompt, the validation, the verifier — has to be the code the app runs,
   * not a copy of it. Nothing in the app passes this.
   */
  retrieve?: (plan: Parameters<typeof retrieve>[0], config: AskConfig) => Promise<Retrieval>;
}

export interface AskResult {
  response: AskResponse;
  metrics: AskMetrics;
}

export async function ask(
  question: string,
  history: AskTurn[] = [],
  options: AskOptions = {}
): Promise<AskResult> {
  const config = options.config ?? askConfig();
  /**
   * Sends one event, and swallows anything the handler throws.
   *
   * A closed connection is the ordinary case here — the reader navigated away
   * mid-answer — and it must not turn into a failed request in the log or an
   * exception that skips the metrics line.
   */
  const emit = (event: AskEvent): void => {
    if (!options.onEvent) return;
    try {
      options.onEvent(event);
    } catch (e) {
      console.error("Ask: event handler threw, continuing:", e);
    }
  };
  const model = options.model ?? getAskModel();
  const metrics = new AskMetricsRecorder();

  const { provider, model: modelId } = askProviderInfo();
  metrics.provider = provider;
  metrics.model = modelId;
  metrics.planEffort = config.planEffort;

  try {
    // ---- plan ------------------------------------------------------------
    // planQuery already swallows its own failures; the timeout is the case it
    // cannot see — a call that never returns at all.
    const plan = await metrics.time("plan", () =>
      withTimeoutOr(
        () => planQuery(question, history, model, config, metrics.addUsage),
        config.timeouts.plan,
        "planning",
        heuristicPlan(question, history)
      )
    );
    metrics.stages.planned = true;
    metrics.language = plan.language;
    metrics.historical = plan.historical;
    // The first thing that can be shown, and the most reassuring: it says the
    // question was understood and names the words the corpus is about to be
    // searched for.
    emit({
      type: "plan",
      language: plan.language,
      standalone: plan.standalone,
      terms: [...plan.actQueries, ...plan.provisionQueries, ...plan.phrases, ...plan.concepts],
      historical: plan.historical,
    });

    // ---- retrieve --------------------------------------------------------
    const runRetrieval = options.retrieve
      ? () => options.retrieve!(plan, config)
      : () =>
          retrieve(plan, config, {
            scope: options.scope ?? "eea",
            model,
            onRerank: ({ ran, ms }) => {
              metrics.stages.reranked = ran;
              metrics.setTiming("rerank", ms);
            },
          });

    const retrieval: Retrieval = await metrics.time("retrieve", () =>
      withTimeout(
        runRetrieval(),
        // The rerank runs inside retrieval and shares its budget, so a rerank
        // that hangs cannot add its own timeout to the total.
        config.timeouts.retrieve + (config.rerankWithModel ? config.timeouts.rerank : 0),
        "retrieval"
      )
    );
    metrics.candidates = retrieval.counts.candidates;
    metrics.sources = retrieval.sources.length;
    metrics.acts = retrieval.counts.acts;
    metrics.provisions = retrieval.counts.provisions;
    metrics.decisions = retrieval.counts.decisions;
    // `cited` is false on every one of these: nothing has been written yet, so
    // nothing has been cited yet. The final "answer" event carries the same
    // sources with that filled in.
    emit({ type: "sources", sources: retrieval.sources });

    // ---- answer ----------------------------------------------------------
    const response = await metrics.time("answer", () =>
      withTimeout(
        answer(plan, retrieval, history, model, {
          config,
          onUsage: metrics.addUsage,
          onDecision: ({ effort, complexity }) => {
            metrics.effort = effort;
            metrics.complex = complexity.complex;
            metrics.complexitySignals = complexity.signals;
          },
          // Only when somebody is listening. Without this the answer stage
          // makes a single unstreamed call, as it always did.
          onLine: options.onEvent ? (text) => emit({ type: "line", text }) : undefined,
        }),
        config.timeouts.answer,
        "answer"
      )
    );
    metrics.abstained = response.abstained ?? false;
    metrics.addIssues(response.issues);

    // ---- verify (optional) ----------------------------------------------
    let final = response;
    if (config.verifyCitations && !response.abstained && response.sources.length > 0) {
      const verified = await metrics.time("verify", () =>
        withTimeoutOr(
          () =>
            verifyAnswer(
              response.answer,
              response.sources,
              retrieval.evidence,
              response.language,
              model,
              config,
              metrics.addUsage
            ),
          config.timeouts.verify,
          "citation verification",
          { answer: response.answer, issues: [], checked: 0, ran: false }
        )
      );
      metrics.stages.verified = verified.ran;
      metrics.verifiedClaims = verified.checked;
      metrics.addIssues(verified.issues);
      final = {
        ...response,
        answer: verified.answer,
        issues: [...(response.issues ?? []), ...verified.issues],
      };
    }

    metrics.cited = final.sources.filter((s) => s.cited).length;

    const snapshot = metrics.snapshot();
    if (!options.quiet) logAskMetrics(snapshot);
    const finalResponse = { ...final, requestId: metrics.requestId };
    // Supersedes the streamed lines. Normally identical to them — but the
    // optional verifier runs after the answer is complete and can qualify a
    // line the reader has already been shown, and an abstention never streamed
    // at all.
    emit({ type: "answer", response: finalResponse });
    return { response: finalResponse, metrics: snapshot };
  } catch (e) {
    metrics.fail(e);
    const snapshot = metrics.snapshot();
    if (!options.quiet) logAskMetrics(snapshot);
    throw e;
  }
}
