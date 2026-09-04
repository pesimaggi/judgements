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
import { resolveProvider, isAskEnabled, askModelId, askEffort } from "@/lib/ask/llm";

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
