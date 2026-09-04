/**
 * Which provider answers, and on which model.
 *
 * Worth a test because it is configuration rather than code: the whole point
 * of the switch is that it is flipped on a deployment dashboard by somebody
 * who cannot see this file, and the failure modes are quiet ones. A provider
 * silently falling back to the other one would produce answers from a model
 * nobody chose; a launcher rendered without a key would fail on the first
 * question rather than never appearing.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import {
  resolveProvider,
  isAskEnabled,
  askModelId,
  askEffort,
  describeProviderError,
} from "@/lib/ask/llm";

describe("resolveProvider", () => {
  test("one configured key needs no ASK_PROVIDER", () => {
    assert.equal(resolveProvider({ OPENAI_API_KEY: "sk-x" }), "openai");
    assert.equal(resolveProvider({ ANTHROPIC_API_KEY: "sk-ant-x" }), "anthropic");
  });

  test("ASK_PROVIDER decides when both keys are present", () => {
    const both = { OPENAI_API_KEY: "sk-x", ANTHROPIC_API_KEY: "sk-ant-x" };
    assert.equal(resolveProvider({ ...both, ASK_PROVIDER: "anthropic" }), "anthropic");
    assert.equal(resolveProvider({ ...both, ASK_PROVIDER: "openai" }), "openai");
  });

  test("ASK_PROVIDER wins over the key that happens to be set", () => {
    // Naming a provider and quietly getting the other one is the one outcome
    // that would be genuinely confusing to debug from a dashboard.
    assert.equal(
      resolveProvider({ ASK_PROVIDER: "anthropic", OPENAI_API_KEY: "sk-x" }),
      "anthropic"
    );
  });

  test("is case- and whitespace-tolerant, because it is typed into a form", () => {
    assert.equal(resolveProvider({ ASK_PROVIDER: " OpenAI " }), "openai");
  });

  test("an unrecognised ASK_PROVIDER falls through to the keys", () => {
    assert.equal(resolveProvider({ ASK_PROVIDER: "gemini", ANTHROPIC_API_KEY: "k" }), "anthropic");
    assert.equal(resolveProvider({ ASK_PROVIDER: "gemini" }), null);
  });

  test("no keys at all resolves to nothing", () => {
    assert.equal(resolveProvider({}), null);
  });
});

describe("isAskEnabled", () => {
  test("is true only when the resolved provider has its own key", () => {
    assert.equal(isAskEnabled({ OPENAI_API_KEY: "sk-x" }), true);
    assert.equal(isAskEnabled({ ANTHROPIC_API_KEY: "sk-ant-x" }), true);
    assert.equal(isAskEnabled({}), false);
  });

  test("is false when ASK_PROVIDER names a provider whose key is missing", () => {
    // Otherwise the launcher renders and every question 500s.
    assert.equal(isAskEnabled({ ASK_PROVIDER: "openai", ANTHROPIC_API_KEY: "sk-ant-x" }), false);
  });
});

describe("askModelId", () => {
  test("defaults per provider", () => {
    assert.equal(askModelId("openai", {}), "gpt-5.6-terra");
    assert.equal(askModelId("anthropic", {}), "claude-opus-5");
  });

  test("each provider reads its own variable, so both can be set at once", () => {
    const env = { ASK_MODEL_OPENAI: "gpt-5.6-sol", ASK_MODEL_ANTHROPIC: "claude-sonnet-5" };
    assert.equal(askModelId("openai", env), "gpt-5.6-sol");
    assert.equal(askModelId("anthropic", env), "claude-sonnet-5");
  });

  test("ASK_MODEL overrides whichever provider is active", () => {
    assert.equal(askModelId("openai", { ASK_MODEL: "gpt-6-astra" }), "gpt-6-astra");
    assert.equal(
      askModelId("openai", { ASK_MODEL: "gpt-6-astra", ASK_MODEL_OPENAI: "gpt-5.6-luna" }),
      "gpt-6-astra"
    );
  });

  test("a blank variable is not a model name", () => {
    assert.equal(askModelId("openai", { ASK_MODEL: "   " }), "gpt-5.6-terra");
  });
});

describe("askEffort", () => {
  test("defaults below the APIs' own default, because somebody is waiting", () => {
    assert.equal(askEffort({}), "medium");
  });

  test("takes the five levels both APIs share", () => {
    assert.equal(askEffort({ ASK_EFFORT: "xhigh" }), "xhigh");
    assert.equal(askEffort({ ASK_EFFORT: "low" }), "low");
  });

  test("ignores a value neither API would accept", () => {
    assert.equal(askEffort({ ASK_EFFORT: "maximum" }), "medium");
  });
});

describe("describeProviderError", () => {
  // Built through the SDK's own `generate`, which is the path a real HTTP
  // response takes — it unwraps the body's `error` object, which is where the
  // `code` this function branches on actually lives.
  const openaiError = (status: number, code?: string, message = "boom") =>
    OpenAI.APIError.generate(status, { error: { code, message } }, message, new Headers());

  test("a rejected key points at the key variable", () => {
    const described = describeProviderError(openaiError(401), "openai", "gpt-5.6-terra");
    assert.match(described ?? "", /OPENAI_API_KEY/);
  });

  test("an unknown model names the model and the variable that sets it", () => {
    const described = describeProviderError(openaiError(404), "openai", "gpt-5.6-terra");
    assert.match(described ?? "", /gpt-5\.6-terra/);
    assert.match(described ?? "", /ASK_MODEL_OPENAI/);
  });

  test("no quota is told apart from being rate-limited", () => {
    // A new key with no billing 429s on its very first call, which is not the
    // same problem as asking too fast, and does not go away by waiting.
    const quota = describeProviderError(
      openaiError(429, "insufficient_quota"),
      "openai",
      "gpt-5.6-terra"
    );
    assert.match(quota ?? "", /no credit left/);

    // The message this account actually returned, which carried no code we
    // can rely on. Recognised from the text, because telling somebody with no
    // credit to "wait a moment" sends them to watch a problem that will never
    // resolve.
    const byMessage = describeProviderError(
      openaiError(429, undefined, "You have no credits remaining. Add credits to continue using the API."),
      "openai",
      "gpt-5.6-luna"
    );
    assert.match(byMessage ?? "", /no credit left/);

    const throttled = describeProviderError(
      openaiError(429, undefined, "Rate limit reached for requests"),
      "openai",
      "gpt-5.6-terra"
    );
    assert.match(throttled ?? "", /rate-limiting/);
  });

  test("names the right variables for the Anthropic side", () => {
    const e = Anthropic.APIError.generate(404, { error: { message: "nope" } }, "nope", new Headers());
    const described = describeProviderError(e, "anthropic", "claude-opus-5");
    assert.match(described ?? "", /ASK_MODEL_ANTHROPIC/);
  });

  test("anything that is not a provider error stays generic", () => {
    assert.equal(describeProviderError(new Error("kaboom"), "openai", "m"), null);
    assert.equal(describeProviderError(openaiError(500), "openai", "m"), null);
  });
});
