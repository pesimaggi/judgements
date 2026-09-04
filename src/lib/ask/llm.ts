/**
 * The one place this app talks to a language model.
 *
 * Everything above it — planning, retrieval, answering — is written against
 * the two methods below and knows nothing about which model answers. That is
 * deliberate: the retrieval is the part that makes the well worth using, and
 * it should survive changing your mind about the model. Both providers are
 * implemented here and nowhere else; swapping between them is one environment
 * variable and no code.
 *
 * Configuration, all from the environment:
 *
 *   ASK_PROVIDER         "openai" | "anthropic". The switch. Leave it unset
 *                        and the provider is whichever key is present; set it
 *                        to pick, which is what you want with both keys
 *                        configured and a comparison to run.
 *   OPENAI_API_KEY       the key for the OpenAI side.
 *   ANTHROPIC_API_KEY    the key for the Anthropic side.
 *   With neither, the well is switched off: the launcher never renders and
 *   /api/ask answers 503.
 *
 *   ASK_MODEL_OPENAI     model id, default "gpt-5.6-terra".
 *   ASK_MODEL_ANTHROPIC  model id, default "claude-opus-5".
 *   ASK_MODEL            overrides whichever of those is active. Set the two
 *                        above once and flip ASK_PROVIDER; use this one for a
 *                        quick one-off.
 *
 *   ASK_EFFORT           "low" | "medium" | "high" | "xhigh" | "max", default
 *                        "medium". How hard the model works on the answer.
 *                        Both APIs take this same vocabulary. A legal answer
 *                        is worth thinking about, but somebody is watching a
 *                        bucket go down a well while it does, so the default
 *                        sits below either API's own default of "high". Raise
 *                        it if you would rather wait.
 */
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { AskTurn } from "./types";

/**
 * How hard the model is asked to work. Both providers happen to take the same
 * five words, so nothing has to be translated between them.
 */
export type AskEffort = "low" | "medium" | "high" | "xhigh" | "max";

export type AskProvider = "openai" | "anthropic";

const DEFAULT_MODELS: Record<AskProvider, string> = {
  openai: "gpt-5.6-terra",
  anthropic: "claude-opus-5",
};

/**
 * Claude Opus 5's safety classifiers can decline a request outright. With
 * this beta on, a declined request is re-run server-side on a substitute
 * model chosen by refusal category, instead of the refusal coming back to us
 * as an empty answer in the well. Anthropic only; the OpenAI side reports a
 * filtered completion through `finish_reason` instead.
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
   * The shape to extract. Sent as a strict tool to Anthropic and as a strict
   * `json_schema` response format to OpenAI — both validate the arguments
   * against the schema before they reach us, so one JSON Schema serves both.
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

/**
 * The environment this module reads. Passed in so it can be tested, and with
 * an index signature so `process.env` itself is assignable to it.
 */
export interface AskEnv {
  [key: string]: string | undefined;
  ASK_PROVIDER?: string;
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  ASK_MODEL?: string;
  ASK_MODEL_OPENAI?: string;
  ASK_MODEL_ANTHROPIC?: string;
  ASK_EFFORT?: string;
}

/**
 * Which provider answers, and whether one can.
 *
 * `ASK_PROVIDER` wins outright, including when its key is missing: naming a
 * provider and getting the other one silently is worse than an error that
 * says the key is not set. With it unset, the one configured key decides,
 * which is the case that wants no thought at all.
 *
 * Both keys and no `ASK_PROVIDER` is genuinely ambiguous. It resolves to
 * OpenAI and says so in the log, rather than switching the well off over a
 * config that plainly meant to enable it.
 */
export function resolveProvider(env: AskEnv = process.env): AskProvider | null {
  const named = env.ASK_PROVIDER?.trim().toLowerCase();
  if (named === "openai" || named === "anthropic") return named;

  const openai = Boolean(env.OPENAI_API_KEY);
  const anthropic = Boolean(env.ANTHROPIC_API_KEY);

  if (openai && anthropic) {
    console.warn(
      "Ask: both OPENAI_API_KEY and ANTHROPIC_API_KEY are set and ASK_PROVIDER is not. Using OpenAI; set ASK_PROVIDER to choose."
    );
    return "openai";
  }
  if (openai) return "openai";
  if (anthropic) return "anthropic";
  return null;
}

/** The key the resolved provider needs, which it may not actually have. */
export function providerKey(provider: AskProvider, env: AskEnv = process.env): string | undefined {
  return provider === "openai" ? env.OPENAI_API_KEY : env.ANTHROPIC_API_KEY;
}

/**
 * True when a provider is resolved *and* holds a key. Both halves matter:
 * `ASK_PROVIDER=openai` with no OpenAI key is a well that would render a
 * launcher and then fail on the first question.
 */
export function isAskEnabled(env: AskEnv = process.env): boolean {
  const provider = resolveProvider(env);
  return provider !== null && Boolean(providerKey(provider, env));
}

export function askEffort(env: AskEnv = process.env): AskEffort {
  const raw = env.ASK_EFFORT;
  const allowed: AskEffort[] = ["low", "medium", "high", "xhigh", "max"];
  return allowed.includes(raw as AskEffort) ? (raw as AskEffort) : "medium";
}

/** `ASK_MODEL` overrides, then the provider's own variable, then the default. */
export function askModelId(provider: AskProvider, env: AskEnv = process.env): string {
  const perProvider = provider === "openai" ? env.ASK_MODEL_OPENAI : env.ASK_MODEL_ANTHROPIC;
  return env.ASK_MODEL?.trim() || perProvider?.trim() || DEFAULT_MODELS[provider];
}

/**
 * One client per provider for the process. Each holds a connection pool, and
 * building a new one per question would throw that away on every question.
 */
let anthropicClient: Anthropic | undefined;
let openaiClient: OpenAI | undefined;

class AnthropicAskModel implements AskModel {
  private client = (anthropicClient ??= new Anthropic());
  private model = askModelId("anthropic");

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

class OpenAIAskModel implements AskModel {
  private client = (openaiClient ??= new OpenAI());
  private model = askModelId("openai");

  /**
   * The system prompt goes in a `developer` message, which is what the role
   * is called on this API. `max_completion_tokens`, not `max_tokens`: the
   * older name does not cover the reasoning tokens these models spend before
   * they write anything.
   */
  private messages(req: CompleteRequest | ExtractRequest<unknown>) {
    return [
      { role: "developer" as const, content: req.system },
      ...req.messages.map((m) => ({ role: m.role, content: m.content })),
    ];
  }

  async complete(req: CompleteRequest): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      max_completion_tokens: req.maxTokens,
      reasoning_effort: req.effort,
      messages: this.messages(req),
    });

    const choice = response.choices[0];
    if (choice?.finish_reason === "content_filter") throw new AskRefusal();
    return choice?.message?.content?.trim() ?? "";
  }

  async extract<T>(req: ExtractRequest<T>): Promise<T | null> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      max_completion_tokens: req.maxTokens,
      reasoning_effort: req.effort,
      messages: this.messages(req),
      // Strict, so the JSON validates against the schema before it reaches
      // `parse` — the same guarantee the Anthropic side gets from a strict
      // tool, from the same one schema.
      response_format: {
        type: "json_schema",
        json_schema: {
          name: req.tool.name,
          description: req.tool.description,
          schema: req.tool.schema,
          strict: true,
        },
      },
    });

    const choice = response.choices[0];
    if (choice?.finish_reason === "content_filter") return null;
    const text = choice?.message?.content;
    if (!text) return null;
    try {
      return req.parse(JSON.parse(text));
    } catch {
      // A truncated or non-JSON body is a failed plan, not a failed question:
      // the caller falls back to keywords.
      return null;
    }
  }
}


/**
 * Turns a provider's error into something the person who configured this
 * deployment can act on.
 *
 * This exists because of how the well fails. A planning failure is swallowed
 * on purpose — it degrades to keywords — so the *first* place a bad key or an
 * unavailable model actually surfaces is the answer call, and from the outside
 * that looked identical to every other kind of failure: "the well could not
 * answer that". Every one of the cases below is a setup mistake with a
 * specific fix, and none of them is fixable from a generic message.
 *
 * Returns null for anything unrecognised, which stays generic and goes to the
 * log.
 */
export function describeProviderError(
  error: unknown,
  provider: AskProvider,
  model: string
): string | null {
  const apiError =
    error instanceof OpenAI.APIError || error instanceof Anthropic.APIError ? error : null;
  if (!apiError) return null;

  const keyVar = provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY";
  const modelVar = provider === "openai" ? "ASK_MODEL_OPENAI" : "ASK_MODEL_ANTHROPIC";
  // Only the OpenAI side carries a `code`; read it off without assuming it.
  const raw = (apiError as { code?: unknown }).code;
  const code = typeof raw === "string" ? raw : "";

  switch (apiError.status) {
    case 401:
      return `The ${provider} API key was rejected. Check ${keyVar} on this deployment — a copied key often picks up a trailing space or newline.`;
    case 403:
      return `The ${provider} API key is valid but not allowed to use this endpoint. If it is a project-scoped key, check that the project has access.`;
    case 404:
      return `The model "${model}" does not exist for this ${provider} key. Set ${modelVar} to a model your account can use.`;
    case 429:
      // A brand-new key with no billing set up returns this on every call,
      // which is not the same problem as asking too fast.
      return code === "insufficient_quota"
        ? `The ${provider} account has no available quota. Add billing or credit to the account this key belongs to — a new key with no credit fails on its first request.`
        : `The ${provider} API is rate-limiting this deployment. Wait a moment and ask again.`;
    case 400:
      return /model/i.test(apiError.message)
        ? `The ${provider} API rejected the model "${model}". Set ${modelVar} to a model your account can use.`
        : null;
    default:
      // A connection error carries no status at all.
      return apiError.status === undefined
        ? `Could not reach the ${provider} API from this deployment.`
        : null;
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
  const provider = resolveProvider();
  if (provider === "anthropic") return new AnthropicAskModel();
  if (provider === "openai") return new OpenAIAskModel();
  // The route checks isAskEnabled() first, so this is a misconfiguration
  // reached only by calling into the well directly.
  throw new Error("No LLM provider configured: set OPENAI_API_KEY or ANTHROPIC_API_KEY.");
}
