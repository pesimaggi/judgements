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
  /** Characters of a provision's text, cut at a paragraph boundary. */
  provisionChars: number;
  /** Ceiling on the answer call, reasoning tokens included. */
  answerMaxTokens: number;
  /** Ceiling on the planning call. */
  planMaxTokens: number;
  /** Ceiling on the verification call. */
  verifyMaxTokens: number;
  /** Per-stage wall-clock budgets, in milliseconds. */
  timeouts: { plan: number; retrieve: number; answer: number; verify: number; rerank: number };
}

/**
 * Token ceilings.
 *
 * The old values were 8,000 for a plan of six short strings and 16,000 for an
 * answer of 450 words. Both are far more than either stage can use: the answer
 * is ~700 tokens of prose, and the rest of the ceiling exists only for
 * reasoning tokens. These leave generous room for thinking — roughly 5,000
 * reasoning tokens on the answer at "medium" — without leaving room for a
 * runaway that bills for a minute and returns nothing.
 */
const DEFAULT_PLAN_TOKENS = 3000;
const DEFAULT_ANSWER_TOKENS = 8000;
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
    maxCandidates: count(env.ASK_MAX_CANDIDATES, 30, 5, 120),
    maxSources: count(env.ASK_MAX_SOURCES, 10, 3, 30),
    evidenceWindow: count(env.ASK_EVIDENCE_CHARS, 1200, 200, 6000),
    provisionChars: count(env.ASK_PROVISION_CHARS, 2400, 400, 12000),
    answerMaxTokens: count(env.ASK_ANSWER_MAX_TOKENS, DEFAULT_ANSWER_TOKENS, 1500, 32000),
    planMaxTokens: count(env.ASK_PLAN_MAX_TOKENS, DEFAULT_PLAN_TOKENS, 500, 32000),
    verifyMaxTokens: count(env.ASK_VERIFY_MAX_TOKENS, DEFAULT_VERIFY_TOKENS, 500, 32000),
    timeouts: {
      plan: count(env.ASK_TIMEOUT_PLAN_MS, 20_000, 1000, 120_000),
      retrieve: count(env.ASK_TIMEOUT_RETRIEVE_MS, 20_000, 1000, 120_000),
      answer: count(env.ASK_TIMEOUT_ANSWER_MS, 90_000, 1000, 300_000),
      verify: count(env.ASK_TIMEOUT_VERIFY_MS, 30_000, 1000, 120_000),
      rerank: count(env.ASK_TIMEOUT_RERANK_MS, 20_000, 1000, 120_000),
    },
  };
}
