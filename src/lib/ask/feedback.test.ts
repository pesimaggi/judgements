/**
 * Feedback, and the one thing it is not allowed to do.
 *
 * Somebody reporting that a citation did not support a claim is doing us a
 * favour. It is not consent to keep the legal question they asked, which for
 * this corpus is frequently the most sensitive thing a person could type. So
 * the question survives parsing only when the reader explicitly asked for it
 * to — and a client that sends it without asking does not get it kept.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseFeedback, isFeedbackKind, FEEDBACK_KINDS, FEEDBACK_LABELS } from "@/lib/ask/feedback";

const BASE = { requestId: "abc-123", kind: "wrong-source" };

describe("privacy", () => {
  test("the question is dropped unless the reader ticked the box", () => {
    const parsed = parseFeedback({ ...BASE, question: "Má reka mig fyrirvaralaust?" });
    assert.equal(parsed?.question, undefined);
  });

  test("submitting feedback is not that tick, even with the question attached", () => {
    const parsed = parseFeedback({
      ...BASE,
      question: "Má reka mig fyrirvaralaust?",
      shareQuestion: false,
    });
    assert.equal(parsed?.question, undefined);
  });

  test("and it is kept when they did tick it", () => {
    const parsed = parseFeedback({ ...BASE, question: "Spurning", shareQuestion: true });
    assert.equal(parsed?.question, "Spurning");
  });

  test("a note is optional and capped", () => {
    const parsed = parseFeedback({ ...BASE, note: "x".repeat(5000) });
    assert.equal(parsed?.note?.length, 500);
  });
});

describe("parseFeedback", () => {
  test("needs an answer to be about", () => {
    assert.equal(parseFeedback({ kind: "helpful" }), null);
    assert.equal(parseFeedback({ requestId: "   ", kind: "helpful" }), null);
  });

  test("needs one of the seven kinds", () => {
    assert.equal(parseFeedback({ requestId: "a", kind: "thumbs-down" }), null);
    assert.equal(parseFeedback({ requestId: "a" }), null);
  });

  test("takes every kind the panel offers", () => {
    for (const kind of FEEDBACK_KINDS) {
      assert.equal(parseFeedback({ requestId: "a", kind })?.kind, kind);
    }
  });

  test("keeps the answer's shape, which is what makes a report actionable", () => {
    const parsed = parseFeedback({
      ...BASE,
      sourceN: 3,
      language: "is",
      provider: "anthropic",
      model: "claude-opus-5",
      effort: "medium",
      sources: 8,
      cited: 4,
    });
    assert.equal(parsed?.sourceN, 3);
    assert.equal(parsed?.provider, "anthropic");
    assert.equal(parsed?.cited, 4);
  });

  test("drops numbers that are not plausible source numbers", () => {
    assert.equal(parseFeedback({ ...BASE, sourceN: 0 })?.sourceN, undefined);
    assert.equal(parseFeedback({ ...BASE, sourceN: 1000 })?.sourceN, undefined);
    assert.equal(parseFeedback({ ...BASE, sourceN: "3" })?.sourceN, 3);
    assert.equal(parseFeedback({ ...BASE, sourceN: 2.5 })?.sourceN, undefined);
  });

  test("only recognises the two languages the well answers in", () => {
    assert.equal(parseFeedback({ ...BASE, language: "de" })?.language, undefined);
    assert.equal(parseFeedback({ ...BASE, language: "en" })?.language, "en");
  });

  test("rejects a body that is not an object", () => {
    for (const body of [null, "x", 42, []]) assert.equal(parseFeedback(body), null);
  });
});

describe("the seven kinds", () => {
  test("each one names a different stage of the pipeline", () => {
    // A single thumbs-down would tell us nothing about where to look.
    assert.deepEqual(FEEDBACK_KINDS, [
      "helpful",
      "wrong-source",
      "missing-source",
      "citation-unsupported",
      "missed-exception",
      "too-vague",
      "incorrect-conclusion",
    ]);
  });

  test("each has a label in both languages the well answers in", () => {
    for (const kind of FEEDBACK_KINDS) {
      assert.ok(FEEDBACK_LABELS[kind].is.length > 0);
      assert.ok(FEEDBACK_LABELS[kind].en.length > 0);
    }
  });

  test("isFeedbackKind is not fooled by a near-miss", () => {
    assert.equal(isFeedbackKind("helpful"), true);
    assert.equal(isFeedbackKind("helpfull"), false);
    assert.equal(isFeedbackKind(undefined), false);
  });
});
