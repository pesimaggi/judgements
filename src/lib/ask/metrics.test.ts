/**
 * Operational metrics, and the promise they make about privacy.
 *
 * The corpus is law, and the questions people bring to it are frequently the
 * most sensitive thing they could type — a question about dismissal, about
 * custody, about a criminal charge. So the test that matters most here is the
 * negative one: whatever else the metrics line carries, it does not carry the
 * question, the conversation, or the answer.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { AskMetricsRecorder, logAskMetrics } from "@/lib/ask/metrics";

describe("what the line does not carry", () => {
  test("nothing in a snapshot is derived from the question or the answer", () => {
    const metrics = new AskMetricsRecorder();
    metrics.provider = "anthropic";
    metrics.model = "claude-opus-5";
    metrics.language = "is";
    metrics.addIssues([
      { kind: "uncited-claim", claim: "Atvinnurekanda ber að greiða laun.", action: "qualified" },
    ]);

    const line = JSON.stringify(metrics.snapshot());
    assert.doesNotMatch(line, /Atvinnurekanda/, "a flagged claim is a sentence of the answer");
    assert.match(line, /"uncitedClaims":1/, "and only the count of it leaves the module");
  });

  test("a failure is recorded by class name, never by message", () => {
    // An error message can quote the request, and this is a public endpoint.
    const metrics = new AskMetricsRecorder();
    metrics.fail(new Error("failed to answer: Má reka mig fyrirvaralaust?"));
    const snapshot = metrics.snapshot();
    assert.equal(snapshot.ok, false);
    assert.equal(snapshot.errorKind, "Error");
    assert.doesNotMatch(JSON.stringify(snapshot), /reka mig/);
  });

  test("something that is not an Error at all is still recorded safely", () => {
    const metrics = new AskMetricsRecorder();
    metrics.fail("a string thrown from somewhere");
    assert.equal(metrics.snapshot().errorKind, "Error");
  });

  test("the request id is random, not derived from anything", () => {
    const a = new AskMetricsRecorder().requestId;
    const b = new AskMetricsRecorder().requestId;
    assert.notEqual(a, b);
    assert.match(a, /^[0-9a-f-]{36}$/);
  });
});

describe("what it does carry", () => {
  test("a timing per stage, whether the stage succeeded or threw", async () => {
    const metrics = new AskMetricsRecorder();
    await metrics.time("plan", async () => "ok");
    await assert.rejects(
      metrics.time("answer", async () => {
        throw new Error("boom");
      })
    );
    const { timings } = metrics.snapshot();
    assert.equal(typeof timings.plan, "number");
    assert.equal(typeof timings.answer, "number", "a stage that threw is still timed");
    assert.equal(typeof timings.total, "number");
  });

  test("token usage summed across every model call in the request", () => {
    const metrics = new AskMetricsRecorder();
    metrics.addUsage({ inputTokens: 100, outputTokens: 10, cachedInputTokens: 80 });
    metrics.addUsage({ inputTokens: 5, outputTokens: 1 });
    metrics.addUsage({});
    assert.deepEqual(metrics.snapshot().tokens, { input: 105, output: 11, cachedInput: 80 });
  });

  test("which optional stages actually ran, as opposed to being switched on", () => {
    const metrics = new AskMetricsRecorder();
    metrics.stages.verified = false;
    metrics.stages.reranked = true;
    const { stages } = metrics.snapshot();
    assert.equal(stages.reranked, true);
    assert.equal(stages.verified, false);
  });

  test("a stage timed by somebody else can still be recorded", () => {
    const metrics = new AskMetricsRecorder();
    metrics.setTiming("rerank", 340);
    assert.equal(metrics.snapshot().timings.rerank, 340);
  });

  test("a snapshot is a copy, so it cannot be mutated afterwards", () => {
    const metrics = new AskMetricsRecorder();
    const first = metrics.snapshot();
    metrics.addUsage({ inputTokens: 50 });
    assert.equal(first.tokens.input, 0);
    assert.equal(metrics.snapshot().tokens.input, 50);
  });
});

describe("logAskMetrics", () => {
  test("never throws, whatever it is handed", () => {
    const circular = new AskMetricsRecorder().snapshot() as unknown as Record<string, unknown>;
    circular.self = circular;
    assert.doesNotThrow(() => logAskMetrics(circular as never));
  });
});
