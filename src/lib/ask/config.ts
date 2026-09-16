/**
 * Everything the well reads from the environment, in one place.
 *
 * There are now five model calls the well *can* make — plan, rerank, answer,
 * verify, and the answer's repair pass — and only two of them are on by
 * default. That is deliberate: each optional stage costs money and latency on
 * every question, and a deployment should be able to switch one on, measure
 * it, and switch it off again from a dashboard.
 *
 * The one rule that governs all of it: **`ASK_EFFORT` keeps working**. It was
 * the single knob before this file existed, it is set on the deployment that
 * is running today, and every per-stage variable below falls back to it before
 * it falls back to its own default. Setting nothing new changes nothing.
 */
import type { AskEffort, AskEnv } from "./llm";
import { askEffort } from "./llm";

const EFFORTS: AskEffort[] = ["low", "medium", "high", "xhigh", "max"];

function effort(raw: string | undefined, fallback: AskEffort): AskEffort {
  const value = raw?.trim().toLowerCase();
  return EFFORTS.includes(value as AskEffort) ? (value as AskEffort) : fallback;
}

/** A count, clamped so a typo in a dashboard cannot become a corpus scan. */
function count(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/**
 * A flag. "1", "true", "yes", "on" are on; everything else, including the
 * empty string Railway leaves behind when a variable is cleared, is off.
 */
export function flag(raw: string | undefined, fallback = false): boolean {
  const value = raw?.trim().toLowerCase();
  if (value === undefined || value === "") return fallback;
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

export interface AskConfig {
  /** Effort for the planning call. Cheap and structured; low is enough. */
  planEffort: AskEffort;
  /** Effort for a question the classifier calls simple. */
  simpleEffort: AskEffort;
  /** Effort for a question the classifier calls complex. */
  complexEffort: AskEffort;
  /** Effort for the citation verifier, when it is on. */
  verifyEffort: AskEffort;
  /** Model-assisted citation verification. Off by default; costs a call. */
  verifyCitations: boolean;
  /** Model-assisted reranking. Off by default; costs a call. */
  rerankWithModel: boolean;
  /** How many candidates retrieval gathers before ranking chooses among them. */
  maxCandidates: number;
  /** How many sources survive ranking and are shown to the model. */
  maxSources: number;
  /** Characters of surrounding text around a matched passage. */
  evidenceWindow: number;
  /** Characters of the court's own útdráttur. */
  summaryChars: number;
  /**
   * Characters of a judgment's Niðurstaða.
   *
   * The most consequential of these four. A judgment's reasoning is where it
   * says *why*, and a budget that fits two paragraphs of it produces an answer
   * that can name a case and cannot say what it turned on — which reads,
   * accurately, as an answer written off summaries.
   */
  reasoningChars: number;
  /** Characters of the Dómsorð. See DEFAULT_EVIDENCE_BUDGET on why 800 was wrong. */
  holdingChars: number;
  /** Characters of a provision's text, cut at a paragraph boundary. */
  provisionChars: number;
  /** Ceiling on the answer call, reasoning tokens included. */
  answerMaxTokens: number;
  /** Ceiling on the planning call. */
  planMaxTokens: number;
  /** Ceiling on the verification call. */
  verifyMaxTokens: number;
  /** Deep research: the model goes and looks, instead of one fan of searches. */
  research: boolean;
  /** Effort for the research loop. It is the stage that most repays thinking. */
  researchEffort: AskEffort;
  /** Hard ceiling on model round-trips inside the loop. */
  researchMaxRounds: number;
  /** Ceiling on each research call. */
  researchMaxTokens: number;
  /**
   * Calls the loop must make before it is allowed to say it is finished.
   *
   * A loop that searches twice and stops has not researched; it has guessed
   * with extra steps. See `ResearchSession.finishBlocked`.
   */
  researchMinCalls: number;
  /**
   * How the deep tier differs from the quick one.
   *
   * Applied by `deepen()`, which the pipeline calls when the research loop
   * runs. Everything downstream — ranking, composition, the answer prompt, the
   * verifier — then reads an ordinary `AskConfig` and needs no knowledge that
   * there are two tiers at all.
   */
  deep: {
    maxSources: number;
    evidenceWindow: number;
    summaryChars: number;
    reasoningChars: number;
    holdingChars: number;
    provisionChars: number;
    answerEffort: AskEffort;
    answerMaxTokens: number;
    /** The verifier, which on a four-minute run is one more call and worth it. */
    verifyCitations: boolean;
    verifyEffort: AskEffort;
  };
  /** Per-stage wall-clock budgets, in milliseconds. */
  timeouts: {
    plan: number;
    retrieve: number;
    answer: number;
    verify: number;
    rerank: number;
    research: number;
  };
}

/**
 * Token ceilings.
 *
 * The plan is six short strings and 3,000 is generous for it. The answer is
 * the one that had to move: 8,000 was sized for "around 250-450 words", and
 * the quick tier still writes that. The deep tier does not — a question with
 * four limbs in it (what is the rule, may it be terminated, on what
 * conditions, and what have the courts done about it on each side of the
 * public/private line) is several thousand words of prose before any
 * reasoning tokens are spent.
 */
const DEFAULT_PLAN_TOKENS = 3000;
const DEFAULT_ANSWER_TOKENS = 16_000;
const DEFAULT_DEEP_ANSWER_TOKENS = 32_000;
const DEFAULT_VERIFY_TOKENS = 4000;

export function askConfig(env: AskEnv = process.env): AskConfig {
  // The old single knob. Where it is set, it is what the answer stage used, so
  // it is what both complexity branches keep using unless something newer
  // says otherwise — a deployment that set ASK_EFFORT=high still gets high.
  const legacy = env.ASK_EFFORT?.trim() ? askEffort(env) : null;

  return {
    planEffort: effort(env.ASK_PLAN_EFFORT, "low"),
    simpleEffort: effort(env.ASK_EFFORT_SIMPLE, legacy ?? "low"),
    complexEffort: effort(env.ASK_EFFORT_COMPLEX, legacy ?? "medium"),
    verifyEffort: effort(env.ASK_VERIFY_EFFORT, "low"),
    verifyCitations: flag(env.ASK_VERIFY_CITATIONS),
    rerankWithModel: flag(env.ASK_RERANK_WITH_MODEL),
    maxCandidates: count(env.ASK_MAX_CANDIDATES, 60, 5, 240),
    maxSources: count(env.ASK_MAX_SOURCES, 14, 3, 80),
    evidenceWindow: count(env.ASK_EVIDENCE_CHARS, 2400, 200, 20_000),
    summaryChars: count(env.ASK_SUMMARY_CHARS, 2000, 200, 20_000),
    reasoningChars: count(env.ASK_REASONING_CHARS, 4000, 200, 40_000),
    holdingChars: count(env.ASK_HOLDING_CHARS, 2400, 200, 20_000),
    provisionChars: count(env.ASK_PROVISION_CHARS, 12_000, 400, 60_000),
    answerMaxTokens: count(env.ASK_ANSWER_MAX_TOKENS, DEFAULT_ANSWER_TOKENS, 1500, 64_000),
    planMaxTokens: count(env.ASK_PLAN_MAX_TOKENS, DEFAULT_PLAN_TOKENS, 500, 32000),
    verifyMaxTokens: count(env.ASK_VERIFY_MAX_TOKENS, DEFAULT_VERIFY_TOKENS, 500, 32000),
    // Deep research is what this tool is for, so it is what it does unless a
    // deployment says otherwise. The quick path remains one toggle away in the
    // well, and one variable away on a dashboard.
    research: flag(env.ASK_RESEARCH, true),
    researchEffort: effort(env.ASK_RESEARCH_EFFORT, legacy ?? "high"),
    researchMaxRounds: count(env.ASK_RESEARCH_MAX_ROUNDS, 24, 1, 60),
    researchMaxTokens: count(env.ASK_RESEARCH_MAX_TOKENS, 24_000, 2000, 64_000),
    researchMinCalls: count(env.ASK_RESEARCH_MIN_CALLS, 6, 0, 40),
    deep: {
      maxSources: count(env.ASK_DEEP_MAX_SOURCES, 28, 3, 80),
      evidenceWindow: count(env.ASK_DEEP_EVIDENCE_CHARS, 3000, 200, 20_000),
      summaryChars: count(env.ASK_DEEP_SUMMARY_CHARS, 2500, 200, 20_000),
      reasoningChars: count(env.ASK_DEEP_REASONING_CHARS, 6000, 200, 40_000),
      holdingChars: count(env.ASK_DEEP_HOLDING_CHARS, 3000, 200, 20_000),
      provisionChars: count(env.ASK_DEEP_PROVISION_CHARS, 16_000, 400, 60_000),
      answerEffort: effort(env.ASK_DEEP_ANSWER_EFFORT, "high"),
      answerMaxTokens: count(
        env.ASK_DEEP_ANSWER_MAX_TOKENS,
        DEFAULT_DEEP_ANSWER_TOKENS,
        1500,
        64_000
      ),
      verifyCitations: flag(env.ASK_DEEP_VERIFY_CITATIONS, true),
      verifyEffort: effort(env.ASK_DEEP_VERIFY_EFFORT, "medium"),
    },
    timeouts: {
      research: count(env.ASK_TIMEOUT_RESEARCH_MS, 420_000, 5000, 900_000),
      plan: count(env.ASK_TIMEOUT_PLAN_MS, 20_000, 1000, 120_000),
      retrieve: count(env.ASK_TIMEOUT_RETRIEVE_MS, 20_000, 1000, 120_000),
      answer: count(env.ASK_TIMEOUT_ANSWER_MS, 180_000, 1000, 600_000),
      verify: count(env.ASK_TIMEOUT_VERIFY_MS, 60_000, 1000, 180_000),
      rerank: count(env.ASK_TIMEOUT_RERANK_MS, 20_000, 1000, 120_000),
    },
  };
}

/**
 * The same config, with the deep tier's numbers substituted in.
 *
 * One seam, called once, in lib/ask/pipeline.ts when the research loop is the
 * retrieval. Everything after it — `select`, `composeRetrieval`, `answer`,
 * `verifyAnswer` — reads the fields it always read and never learns that there
 * are two tiers.
 *
 * This is why the deep tier is allowed to be expensive. The quick path answers
 * "what does 8. gr. say" in ten seconds off fourteen sources; there is no
 * reason for it to pay for twenty-eight sources and six thousand characters of
 * reasoning per judgment, and no reason for the deep path not to.
 */
export function deepen(config: AskConfig): AskConfig {
  return {
    ...config,
    maxSources: config.deep.maxSources,
    evidenceWindow: config.deep.evidenceWindow,
    summaryChars: config.deep.summaryChars,
    reasoningChars: config.deep.reasoningChars,
    holdingChars: config.deep.holdingChars,
    provisionChars: config.deep.provisionChars,
    answerMaxTokens: config.deep.answerMaxTokens,
    verifyCitations: config.deep.verifyCitations,
    verifyEffort: config.deep.verifyEffort,
  };
}
