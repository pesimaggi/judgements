/**
 * Configuration, and the one promise it makes: `ASK_EFFORT` keeps working.
 *
 * These variables are set on a deployment dashboard by somebody who cannot see
 * this file, and the failure modes are quiet. A deployment that set
 * `ASK_EFFORT=high` and then gets "low" because a newer variable took over is a
 * change nobody asked for and nobody would notice until the bill or the answers
 * changed.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { askConfig, flag } from "@/lib/ask/config";

describe("backward compatibility with ASK_EFFORT", () => {
  test("with nothing set at all, the defaults are the cheap ones", () => {
    const config = askConfig({});
    assert.equal(config.planEffort, "low");
    assert.equal(config.simpleEffort, "low");
    assert.equal(config.complexEffort, "medium");
    assert.equal(config.verifyEffort, "low");
  });

  test("ASK_EFFORT alone still governs both complexity branches", () => {
    const config = askConfig({ ASK_EFFORT: "high" });
    assert.equal(config.simpleEffort, "high");
    assert.equal(config.complexEffort, "high");
  });

  test("a per-stage variable overrides it, and only for that stage", () => {
    const config = askConfig({ ASK_EFFORT: "high", ASK_EFFORT_SIMPLE: "low" });
    assert.equal(config.simpleEffort, "low");
    assert.equal(config.complexEffort, "high");
  });

  test("planning does not inherit ASK_EFFORT — it is a different kind of call", () => {
    // The planner emits six short strings. Paying "max" for that is paying for
    // nothing, and it is the stage the reader waits on before anything happens.
    assert.equal(askConfig({ ASK_EFFORT: "max" }).planEffort, "low");
  });

  test("a blank ASK_EFFORT is not a setting", () => {
    assert.equal(askConfig({ ASK_EFFORT: "  " }).simpleEffort, "low");
  });

  test("an effort neither API would accept falls back rather than being sent", () => {
    assert.equal(askConfig({ ASK_EFFORT_COMPLEX: "maximum" }).complexEffort, "medium");
  });
});

describe("the optional stages are off unless switched on", () => {
  test("both cost a model call, so neither is on by default", () => {
    const config = askConfig({});
    assert.equal(config.verifyCitations, false);
    assert.equal(config.rerankWithModel, false);
  });

  test("ASK_VERIFY_CITATIONS=1 switches verification on", () => {
    assert.equal(askConfig({ ASK_VERIFY_CITATIONS: "1" }).verifyCitations, true);
  });

  test("ASK_RERANK_WITH_MODEL=1 switches the rerank on", () => {
    assert.equal(askConfig({ ASK_RERANK_WITH_MODEL: "1" }).rerankWithModel, true);
  });

  test("0 and the empty string a cleared variable leaves behind are both off", () => {
    assert.equal(askConfig({ ASK_VERIFY_CITATIONS: "0" }).verifyCitations, false);
    assert.equal(askConfig({ ASK_VERIFY_CITATIONS: "" }).verifyCitations, false);
  });
});

describe("flag", () => {
  test("takes the words people actually type into a dashboard", () => {
    for (const on of ["1", "true", "TRUE", "yes", "on", " On "]) assert.equal(flag(on), true);
    for (const off of ["0", "false", "no", "off", "", undefined]) assert.equal(flag(off), false);
  });
});

describe("counts and ceilings", () => {
  test("candidates and sources take their documented defaults", () => {
    const config = askConfig({});
    assert.equal(config.maxCandidates, 30);
    assert.equal(config.maxSources, 10);
  });

  test("they are read from the environment when set", () => {
    const config = askConfig({ ASK_MAX_CANDIDATES: "50", ASK_MAX_SOURCES: "6" });
    assert.equal(config.maxCandidates, 50);
    assert.equal(config.maxSources, 6);
  });

  test("a typo in a dashboard cannot become a corpus scan", () => {
    assert.equal(askConfig({ ASK_MAX_CANDIDATES: "100000" }).maxCandidates, 120);
    assert.equal(askConfig({ ASK_MAX_SOURCES: "0" }).maxSources, 3);
    assert.equal(askConfig({ ASK_MAX_CANDIDATES: "banana" }).maxCandidates, 30);
  });

  test("the token ceilings leave room for reasoning without leaving room for a runaway", () => {
    const config = askConfig({});
    // ~450 words of answer is around 700 tokens; the rest is thinking.
    assert.ok(config.answerMaxTokens >= 6000 && config.answerMaxTokens <= 12000);
    assert.ok(config.planMaxTokens <= config.answerMaxTokens);
  });

  test("every stage has a wall-clock budget", () => {
    const { timeouts } = askConfig({});
    for (const stage of ["plan", "retrieve", "answer", "verify", "rerank"] as const) {
      assert.ok(timeouts[stage] > 0, `${stage} has no timeout`);
    }
  });
});
