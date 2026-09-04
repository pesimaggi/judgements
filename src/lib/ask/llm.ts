/**
 * The one place this app talks to a language model.
 *
 * Everything above it — planning, retrieval, answering — is written against
 * the two methods below and knows nothing about which model answers. That is
 * deliberate: the retrieval is the part that makes the well worth using, and
 * it should survive changing your mind about the model.
 *
 * Configuration, all from the environment:
 *
 *   ANTHROPIC_API_KEY   required. Without it the well is switched off — the
 *                       launcher never renders and /api/ask answers 503.
 *   ASK_MODEL           model id, default "claude-opus-5".
 *   ASK_EFFORT          "low" | "medium" | "high" | "xhigh" | "max", default
 *                       "medium". How hard the model works on the answer. A
 *                       legal answer is worth thinking about, but somebody is
 *                       watching a bucket go down a well while it does, so the
 *                       default sits below the API's own default of "high".
 *                       Raise it if you would rather wait.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { AskTurn } from "./types";

/** How hard the model is asked to work. The Messages API's own vocabulary. */
export type AskEffort = "low" | "medium" | "high" | "xhigh" | "max";

const DEFAULT_MODEL = "claude-opus-5";

/**
 * Claude Opus 5's safety classifiers can decline a request outright. With
 * this beta on, a declined request is re-run server-side on a substitute
 * model chosen by refusal category, instead of the refusal coming back to us
 * as an empty answer in the well.
 */
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export interface CompleteRequest {
  system: string;
  messages: AskTurn[];
  maxTokens: number;
  effort: AskEffort;
}

export interface ExtractRequest<T> {
  system: string;
  messages: AskTurn[];
  maxTokens: number;
  effort: AskEffort;
  /**
   * The shape to extract, as a tool the model is made to call. A strict tool
   * rather than a "reply with JSON" instruction, so the arguments are
   * validated against the schema before they ever reach us.
   */
  tool: {
    name: string;
    description: string;
    schema: Record<string, unknown>;
  };
  /** Narrows the validated arguments to T, or rejects them. */
  parse: (input: unknown) => T | null;
}

export interface AskModel {
  /** Prose, in the model's own words. */
  complete(req: CompleteRequest): Promise<string>;
  /**
   * A structured value. Null when the model declined or returned something
   * the caller's own `parse` rejected — callers fall back rather than throw,
   * because a question is still answerable without a plan.
   */
  extract<T>(req: ExtractRequest<T>): Promise<T | null>;
}

/** True when the well has an API key to work with. */
export function isAskEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export function askEffort(): AskEffort {
  const raw = process.env.ASK_EFFORT;
  const allowed: AskEffort[] = ["low", "medium", "high", "xhigh", "max"];
  return allowed.includes(raw as AskEffort) ? (raw as AskEffort) : "medium";
}

export function askModelId(): string {
  return process.env.ASK_MODEL?.trim() || DEFAULT_MODEL;
}

/**
 * One client for the process. It holds a connection pool, and building a new
 * one per question would throw that away on every question.
 */
let client: Anthropic | undefined;

class AnthropicAskModel implements AskModel {
  private client = (client ??= new Anthropic());
  private model = askModelId();

  async complete(req: CompleteRequest): Promise<string> {
    const response = await this.client.beta.messages.create({
      model: this.model,
      max_tokens: req.maxTokens,
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: req.effort },
      // The system prompt is the same on every question and sits first in the
      // request, so caching it costs one write and is read back on every
      // question after it.
      system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
    });

    // Checked before the content is read: on a refusal `content` carries no
    // answer, and treating it as an empty string would put a blank card in
    // the well rather than an explanation.
    if (response.stop_reason === "refusal") {
      throw new AskRefusal(response.stop_details?.explanation ?? undefined);
    }

    return response.content
      .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();
  }

  async extract<T>(req: ExtractRequest<T>): Promise<T | null> {
    const response = await this.client.beta.messages.create({
      model: this.model,
      max_tokens: req.maxTokens,
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: req.effort },
      system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      tools: [
        {
          name: req.tool.name,
          description: req.tool.description,
          // Guarantees the arguments validate against the schema, so `parse`
          // is narrowing a known shape rather than defending against one.
          strict: true,
          input_schema: req.tool.schema as Anthropic.Beta.BetaTool["input_schema"],
        },
      ],
      tool_choice: { type: "tool", name: req.tool.name },
    });

    if (response.stop_reason === "refusal") return null;

    const call = response.content.find(
      (block): block is Anthropic.Beta.BetaToolUseBlock =>
        block.type === "tool_use" && block.name === req.tool.name
    );
    return call ? req.parse(call.input) : null;
  }
}

/** The model declined the request outright. Reported, not swallowed. */
export class AskRefusal extends Error {
  constructor(explanation?: string) {
    super(explanation ?? "The model declined to answer this question.");
    this.name = "AskRefusal";
  }
}

export function getAskModel(): AskModel {
  return new AnthropicAskModel();
}
