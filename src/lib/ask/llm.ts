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
 *   ASK_EFFORT           "low" | "medium" | "high" | "xhigh" | "max". How hard
 *                        the model works on the answer, and the fallback for
 *                        every per-stage effort variable in lib/ask/config.ts,
 *                        which is where the rest of the well's configuration
 *                        now lives.
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

/**
 * What a call cost, where the provider says. Reported through a callback
 * rather than a return value so that adding it changed no signature and broke
 * no caller — a fake model in a test simply never calls it.
 */
export interface AskUsage {
  inputTokens?: number;
  outputTokens?: number;
  /** Tokens read from the provider's prompt cache, where it reports them. */
  cachedInputTokens?: number;
}

export interface CompleteRequest {
  system: string;
  messages: AskTurn[];
  maxTokens: number;
  effort: AskEffort;
  /** Called once, with what the provider reported, when it reports anything. */
  onUsage?: (usage: AskUsage) => void;
  /**
   * Called with each chunk of visible text as it arrives.
   *
   * Passing this switches the provider to its streaming endpoint; leaving it
   * off keeps the single request/response call exactly as it was, which is
   * what the evaluation harness and every non-interactive caller use. The
   * return value is identical either way — the complete answer — so nothing
   * downstream of `complete()` has to know which path ran.
   *
   * Never the whole answer so far: only the new text. And never thinking
   * tokens, which are not the answer and must not reach a reader.
   */
  onDelta?: (text: string) => void;
}

export interface ExtractRequest<T> {
  system: string;
  messages: AskTurn[];
  maxTokens: number;
  effort: AskEffort;
  onUsage?: (usage: AskUsage) => void;
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
  // Per-stage configuration; see lib/ask/config.ts, which is where these are
  // read and where their defaults and precedence live.
  ASK_PLAN_EFFORT?: string;
  ASK_EFFORT_SIMPLE?: string;
  ASK_EFFORT_COMPLEX?: string;
  ASK_VERIFY_EFFORT?: string;
  ASK_VERIFY_CITATIONS?: string;
  ASK_RERANK_WITH_MODEL?: string;
  ASK_MAX_CANDIDATES?: string;
  ASK_MAX_SOURCES?: string;
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
    const params = {
      model: this.model,
      max_tokens: req.maxTokens,
      betas: [FALLBACK_BETA],
      fallbacks: "default" as const,
      thinking: { type: "adaptive" as const },
      output_config: { effort: req.effort },
      // The system prompt is the same on every question and sits first in the
      // request, so caching it costs one write and is read back on every
      // question after it.
      system: [
        { type: "text" as const, text: req.system, cache_control: { type: "ephemeral" as const } },
      ],
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
    };

    // The streamed and unstreamed paths converge on the same BetaMessage, so
    // the refusal and usage handling below is written once. `finalMessage()`
    // is what makes that possible — it resolves to the complete message even
    // though the text has already been handed out in pieces.
    const response = req.onDelta
      ? await this.streamed(params, req.onDelta)
      : await this.client.beta.messages.create(params);

    // Checked before the content is read: on a refusal `content` carries no
    // answer, and treating it as an empty string would put a blank card in
    // the well rather than an explanation.
    reportAnthropicUsage(req.onUsage, response.usage);

    if (response.stop_reason === "refusal") {
      throw new AskRefusal(response.stop_details?.explanation ?? undefined);
    }

    return response.content
      .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();
  }

  /**
   * The same call, streamed.
   *
   * Only `text` deltas are forwarded. Thinking is on (adaptive) and its
   * summaries arrive as their own delta type — they are the model reasoning
   * about the answer, not the answer, and putting them in front of a reader
   * as legal prose would be indefensible.
   *
   * A refusal mid-stream still resolves through `finalMessage()`, so it is
   * handled by the shared code above rather than separately here.
   */
  private async streamed(
    params: Parameters<typeof this.client.beta.messages.create>[0] & object,
    onDelta: (text: string) => void
  ): Promise<Anthropic.Beta.BetaMessage> {
    const stream = this.client.beta.messages.stream(
      params as Parameters<typeof this.client.beta.messages.stream>[0]
    );
    stream.on("text", onDelta);
    return stream.finalMessage();
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

    reportAnthropicUsage(req.onUsage, response.usage);

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
    if (req.onDelta) return this.streamed(req, req.onDelta);

    const response = await this.client.chat.completions.create({
      model: this.model,
      max_completion_tokens: req.maxTokens,
      reasoning_effort: req.effort,
      messages: this.messages(req),
    });

    reportOpenAIUsage(req.onUsage, response.usage);

    const choice = response.choices[0];
    if (choice?.finish_reason === "content_filter") throw new AskRefusal();
    return choice?.message?.content?.trim() ?? "";
  }

  /**
   * The same call, streamed.
   *
   * `include_usage` is asked for explicitly: on this API a streamed response
   * reports usage only in a final chunk that carries no choices, and without
   * the flag it is not reported at all — which would silently blank the token
   * counts in the metrics line for every streamed question.
   */
  private async streamed(req: CompleteRequest, onDelta: (text: string) => void): Promise<string> {
    const stream = await this.client.chat.completions.create({
      model: this.model,
      max_completion_tokens: req.maxTokens,
      reasoning_effort: req.effort,
      messages: this.messages(req),
      stream: true,
      stream_options: { include_usage: true },
    });

    let text = "";
    let filtered = false;

    for await (const chunk of stream) {
      if (chunk.usage) reportOpenAIUsage(req.onUsage, chunk.usage);
      const choice = chunk.choices[0];
      if (!choice) continue;
      if (choice.finish_reason === "content_filter") filtered = true;
      const delta = choice.delta?.content;
      if (delta) {
        text += delta;
        onDelta(delta);
      }
    }

    // Raised after the stream is drained rather than mid-loop, so usage from
    // the final chunk is still reported for a request that was filtered.
    if (filtered) throw new AskRefusal();
    return text.trim();
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

    reportOpenAIUsage(req.onUsage, response.usage);

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
 * Usage, in the two providers' own words.
 *
 * Neither is asked for; both report it on every response, and it is the only
 * way to know what a question cost. Wrapped in try/catch because a usage
 * field that moved is not a reason to fail a question that was answered.
 */
function reportAnthropicUsage(
  onUsage: ((usage: AskUsage) => void) | undefined,
  usage: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number | null } | undefined
): void {
  if (!onUsage || !usage) return;
  try {
    onUsage({
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cachedInputTokens: usage.cache_read_input_tokens ?? undefined,
    });
  } catch {
    /* metrics must never fail a request */
  }
}

function reportOpenAIUsage(
  onUsage: ((usage: AskUsage) => void) | undefined,
  usage: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } | null } | undefined
): void {
  if (!onUsage || !usage) return;
  try {
    onUsage({
      inputTokens: usage.prompt_tokens,
      outputTokens: usage.completion_tokens,
      cachedInputTokens: usage.prompt_tokens_details?.cached_tokens ?? undefined,
    });
  } catch {
    /* metrics must never fail a request */
  }
}

/** The model declined the request outright. Reported, not swallowed. */
export class AskRefusal extends Error {
  constructor(explanation?: string) {
    super(explanation ?? "The model declined to answer this question.");
    this.name = "AskRefusal";
  }
}

/**
 * Which provider and model are actually in play, for the metrics line and for
 * the evaluation report. Returns nulls rather than throwing when the well is
 * switched off — this is called to describe a request, including a failed one.
 */
export function askProviderInfo(env: AskEnv = process.env): {
  provider: AskProvider | null;
  model: string | null;
} {
  const provider = resolveProvider(env);
  return { provider, model: provider ? askModelId(provider, env) : null };
}

export function getAskModel(): AskModel {
  const provider = resolveProvider();
  if (provider === "anthropic") return new AnthropicAskModel();
  if (provider === "openai") return new OpenAIAskModel();
  // The route checks isAskEnabled() first, so this is a misconfiguration
  // reached only by calling into the well directly.
  throw new Error("No LLM provider configured: set OPENAI_API_KEY or ANTHROPIC_API_KEY.");
}
