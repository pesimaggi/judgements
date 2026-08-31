import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  recallAt,
  strictRecallAt,
  reciprocalRank,
  ndcgAt,
  pairwiseAccuracy,
  pairedBootstrapCI,
  mean,
} from "@/search-eval/metrics";

describe("recallAt / strictRecallAt", () => {
  test("recall counts any relevant result", () => {
    assert.equal(recallAt([0, 1, 0], 5), 1);
    assert.equal(recallAt([0, 0, 0], 5), 0);
  });

  test("recall respects the cutoff", () => {
    assert.equal(recallAt([0, 0, 3], 2), 0);
    assert.equal(recallAt([0, 0, 3], 3), 1);
  });

  test("strict recall wants the primary answer, not merely something relevant", () => {
    // A search for "vaxtalög" returning eight cases that mention interest but
    // not the act itself is not a success.
    assert.equal(recallAt([1, 1, 1], 5), 1);
    assert.equal(strictRecallAt([1, 1, 1], 5), 0);
    assert.equal(strictRecallAt([1, 3, 1], 5), 1);
  });
});

describe("reciprocalRank", () => {
  test("is 1 when the first result is relevant", () => {
    assert.equal(reciprocalRank([3, 0, 0]), 1);
  });

  test("decays with the rank of the first relevant result", () => {
    assert.equal(reciprocalRank([0, 2, 0]), 1 / 2);
    assert.equal(reciprocalRank([0, 0, 1]), 1 / 3);
  });

  test("is 0 when nothing relevant came back", () => {
    assert.equal(reciprocalRank([0, 0, 0]), 0);
    assert.equal(reciprocalRank([]), 0);
  });
});

describe("ndcgAt", () => {
  test("a perfect ranking scores 1", () => {
    assert.equal(ndcgAt([3, 2, 1], [3, 2, 1], 10), 1);
  });

  test("order matters", () => {
    const good = ndcgAt([3, 1], [3, 1], 10);
    const bad = ndcgAt([1, 3], [3, 1], 10);
    assert.ok(bad < good, `${bad} should be worse than ${good}`);
  });

  /**
   * The denominator has to come from the case's declared grades, not from
   * what the engine returned — otherwise an engine that finds one of three
   * relevant documents and ranks it first scores a perfect 1.0.
   */
  test("missing a relevant document is penalised", () => {
    const foundAll = ndcgAt([3, 2], [3, 2], 10);
    const foundOne = ndcgAt([3], [3, 2], 10);
    assert.equal(foundAll, 1);
    assert.ok(foundOne < 1, `missing a grade-2 document still scored ${foundOne}`);
  });

  test("is 0 when the case declares nothing relevant", () => {
    assert.equal(ndcgAt([0, 0], [], 10), 0);
  });

  test("respects the cutoff", () => {
    // The grade-3 hit sits at rank 3 and is outside @2.
    assert.equal(ndcgAt([0, 0, 3], [3], 2), 0);
    assert.ok(ndcgAt([0, 0, 3], [3], 3) > 0);
  });
});

describe("pairwiseAccuracy", () => {
  const pairs = [{ before: "a", after: "b" }];

  test("scores a correctly ordered pair", () => {
    const p = pairwiseAccuracy(new Map([["a", 0], ["b", 1]]), pairs);
    assert.deepEqual(p, { correct: 1, total: 1 });
  });

  test("scores an inverted pair as wrong", () => {
    const p = pairwiseAccuracy(new Map([["a", 3], ["b", 1]]), pairs);
    assert.deepEqual(p, { correct: 0, total: 1 });
  });

  test("a pair where neither was returned is not scored at all", () => {
    // It says nothing about ordering; counting it as a failure would punish
    // a retrieval miss twice.
    assert.deepEqual(pairwiseAccuracy(new Map(), pairs), { correct: 0, total: 0 });
  });

  test("returning only the winner counts as correct", () => {
    assert.deepEqual(pairwiseAccuracy(new Map([["a", 0]]), pairs), { correct: 1, total: 1 });
  });

  test("returning only the loser counts as wrong", () => {
    assert.deepEqual(pairwiseAccuracy(new Map([["b", 0]]), pairs), { correct: 0, total: 1 });
  });
});

describe("pairedBootstrapCI", () => {
  test("is deterministic — the same inputs give the same interval", () => {
    const deltas = [0.1, -0.05, 0.2, 0.0, 0.15, -0.1, 0.05];
    assert.deepEqual(pairedBootstrapCI(deltas), pairedBootstrapCI(deltas));
  });

  test("a consistent improvement gives an interval above zero", () => {
    const ci = pairedBootstrapCI(Array(40).fill(0.2));
    assert.ok(ci.lower > 0, JSON.stringify(ci));
  });

  /**
   * The case the harness exists to catch: a positive average that the
   * evidence does not support.
   */
  test("noise around zero gives an interval containing zero", () => {
    const noisy = Array.from({ length: 40 }, (_, i) => (i % 2 ? 0.4 : -0.38));
    const ci = pairedBootstrapCI(noisy);
    assert.ok(ci.mean > 0, "the headline average is positive");
    assert.ok(ci.lower < 0 && ci.upper > 0, `but the interval should straddle zero: ${JSON.stringify(ci)}`);
  });

  test("handles an empty set without throwing", () => {
    assert.deepEqual(pairedBootstrapCI([]), { mean: 0, lower: 0, upper: 0 });
  });
});

describe("mean", () => {
  test("averages", () => {
    assert.equal(mean([1, 2, 3]), 2);
  });
  test("is 0 for an empty list rather than NaN", () => {
    assert.equal(mean([]), 0);
  });
});
