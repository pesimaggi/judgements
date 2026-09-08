/**
 * What the well records about a question, and — more to the point — what it
 * does not.
 *
 * Everything here is operational: how long each stage took, how many sources
 * were considered and how many survived, which provider and effort answered,
 * what the citation check found, whether the well abstained. That is enough to
 * answer the questions an operator actually has ("why is it slow", "is the
 * verifier catching anything", "did the rerank flag change the counts")
 * without any of it being about a person.
 *
 * WHAT IS NEVER LOGGED, by default and by construction: the question, the
 * conversation history, the answer text, and the claims the citation check
 * flagged — a flagged claim is a sentence of the answer, which is a sentence
 * about the question. Only counts of those leave this module. `requestId` is
 * random per request and carries nothing derived from the question, so a
 * feedback submission can be matched to a metrics line without the question
 * ever being stored to make the match.
 *
 * One line of JSON per request on stdout, which is what a log aggregator wants
 * and what `railway logs` is readable as.
 */
import { randomUUID } from "node:crypto";
import type { AskUsage } from "./llm";
import type { ComplexitySignal } from "./complexity";
import type { AskValidationIssue } from "./types";

export interface AskMetrics {
  /** Random per request. Not derived from the question. */
  requestId: string;
  provider: string | null;
  model: string | null;
  /** The effort the answer stage actually ran at. */
  effort: string | null;
  planEffort: string | null;
  /** Whether the complexity classifier called it complex, and why. */
  complex: boolean;
  complexitySignals: ComplexitySignal[];

  /** Milliseconds per stage. A stage that did not run is absent. */
  timings: {
    plan?: number;
    retrieve?: number;
    rerank?: number;
    answer?: number;
    verify?: number;
    total: number;
  };

  retrieval: {
    candidates: number;
    sources: number;
    acts: number;
    provisions: number;
    decisions: number;
    /** Sources the answer ended up citing. */
    cited: number;
  };

  /** Summed across every model call in the request, where the provider says. */
  tokens: { input: number; output: number; cachedInput: number };

  validation: {
    nonexistentCitations: number;
    uncitedClaims: number;
    unsupportedClaims: number;
    contradictedClaims: number;
    /** Claims the verifier actually checked. 0 when it did not run. */
    verified: number;
  };

  /** Which optional stages ran, as opposed to being switched on and failing. */
  stages: { planned: boolean; reranked: boolean; verified: boolean; researched: boolean };
  /**
   * The deep research loop, when it ran. `steps` is tool calls made, `rounds`
   * model round-trips; `exhausted` means the round ceiling stopped it, and
   * `fellBack` that it read nothing and the ordinary retrieval stood in. Those
   * last two are the numbers worth watching — one says the ceiling is too low,
   * the other that the loop is not working at all.
   */
  research?: { steps: number; rounds: number; exhausted: boolean; fellBack: boolean };

  language: string | null;
  /** True when the well declined to answer rather than answering from nothing. */
  abstained: boolean;
  /** True when the answer had to state a historical-law limitation. */
  historical: boolean;
  ok: boolean;
  /** The error's class name only — never its message, which can quote input. */
  errorKind?: string;
}

/**
 * A metrics record being filled in as a request runs.
 *
 * Mutable on purpose: the alternative is threading a growing object through
 * five stages, and the stages already have enough to carry.
 */
export class AskMetricsRecorder {
  readonly requestId = randomUUID();
  private readonly startedAt = Date.now();
  private readonly timings: Record<string, number> = {};
  private readonly usage = { input: 0, output: 0, cachedInput: 0 };

  provider: string | null = null;
  model: string | null = null;
  effort: string | null = null;
  planEffort: string | null = null;
  complex = false;
  complexitySignals: ComplexitySignal[] = [];
  candidates = 0;
  sources = 0;
  acts = 0;
  provisions = 0;
  decisions = 0;
  cited = 0;
  verifiedClaims = 0;
  language: string | null = null;
  abstained = false;
  historical = false;
  ok = true;
  errorKind?: string;
  stages = { planned: false, reranked: false, verified: false, researched: false };
  research: AskMetrics["research"];

  private issues: AskValidationIssue[] = [];

  /** Times one stage, and records how long it took whether it threw or not. */
  async time<T>(stage: string, work: () => Promise<T>): Promise<T> {
    const at = Date.now();
    try {
      return await work();
    } finally {
      this.timings[stage] = Date.now() - at;
    }
  }

  /** For a stage timed by somebody else — the rerank, inside retrieval. */
  setTiming(stage: string, ms: number): void {
    this.timings[stage] = ms;
  }

  /** Passed as `onUsage` to every model call in the request. */
  readonly addUsage = (usage: AskUsage): void => {
    this.usage.input += usage.inputTokens ?? 0;
    this.usage.output += usage.outputTokens ?? 0;
    this.usage.cachedInput += usage.cachedInputTokens ?? 0;
  };

  addIssues(issues: AskValidationIssue[] | undefined): void {
    if (issues?.length) this.issues.push(...issues);
  }

  private count(kind: AskValidationIssue["kind"]): number {
    return this.issues.filter((i) => i.kind === kind).length;
  }

  snapshot(): AskMetrics {
    return {
      requestId: this.requestId,
      provider: this.provider,
      model: this.model,
      effort: this.effort,
      planEffort: this.planEffort,
      complex: this.complex,
      complexitySignals: this.complexitySignals,
      timings: { ...this.timings, total: Date.now() - this.startedAt },
      retrieval: {
        candidates: this.candidates,
        sources: this.sources,
        acts: this.acts,
        provisions: this.provisions,
        decisions: this.decisions,
        cited: this.cited,
      },
      tokens: { ...this.usage },
      validation: {
        nonexistentCitations: this.count("nonexistent-citation"),
        uncitedClaims: this.count("uncited-claim"),
        unsupportedClaims: this.count("unsupported-claim"),
        contradictedClaims: this.count("contradicted-claim"),
        verified: this.verifiedClaims,
      },
      stages: { ...this.stages },
      ...(this.research ? { research: { ...this.research } } : {}),
      language: this.language,
      abstained: this.abstained,
      historical: this.historical,
      ok: this.ok,
      errorKind: this.errorKind,
    };
  }

  /** Records a failure, by class name. The message is never logged. */
  fail(error: unknown): void {
    this.ok = false;
    this.errorKind = error instanceof Error ? error.name : "Error";
  }
}

/**
 * Writes one line. Wrapped, because a logging failure must never be the reason
 * a reader did not get their answer.
 */
export function logAskMetrics(metrics: AskMetrics): void {
  try {
    console.info(JSON.stringify({ event: "ask", ...metrics }));
  } catch {
    /* nothing here is worth failing a request over */
  }
}
