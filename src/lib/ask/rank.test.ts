/**
 * Authority-aware ranking.
 *
 * The cases below are the ones where textual relevance gives the wrong answer,
 * which is the reason this ranker exists: a journal article that discusses the
 * question at length is not evidence of what the law is, and a district court
 * judgment does not outrank the Supreme Court because it used the query's words
 * more often.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  rankCandidates,
  scoreCandidate,
  authorityTier,
  applyModelOrder,
  type RankCandidate,
} from "@/lib/ask/rank";
import type { QueryPlan } from "@/lib/ask/types";

const PLAN: QueryPlan = {
  terms: ["gæsluvarðhald"],
  concepts: ["gæsluvarðhald"],
  phrases: [],
  actQueries: [],
  provisionQueries: [],
  decisionQueries: [],
  sourceCategories: ["legislation", "decisions"],
  date: null,
  historical: false,
  language: "is",
  legal: true,
  standalone: "Hvenær má beita gæsluvarðhaldi?",
};

const NOW = Date.parse("2026-01-01T00:00:00Z");

function candidate(over: Partial<RankCandidate> = {}): RankCandidate {
  return {
    key: over.key ?? "k",
    kind: "decision",
    text: "gæsluvarðhald",
    relevance: 0.5,
    matchedBy: ["concept:gæsluvarðhald", "broad"],
    bestRank: 1,
    ...over,
  };
}

describe("authorityTier", () => {
  test("puts legislation, the courts and the boards where they belong", () => {
    assert.equal(authorityTier("provision"), "legislation");
    assert.equal(authorityTier("decision", "haestirettur"), "supreme");
    assert.equal(authorityTier("decision", "landsrettur"), "appellate");
    assert.equal(authorityTier("decision", "heradsdomar"), "first-instance");
    assert.equal(authorityTier("opinion", "umbodsmadur"), "oversight");
    assert.equal(authorityTier("commentary", "logretta"), "commentary");
  });

  test("an unknown source is administrative, which is the tier that adds least", () => {
    assert.equal(authorityTier("decision", "some-new-board"), "administrative");
  });
});

describe("scoreCandidate", () => {
  test("the Supreme Court outranks a district court on equal relevance", () => {
    const supreme = scoreCandidate(candidate({ sourceKey: "haestirettur" }), PLAN, NOW);
    const district = scoreCandidate(candidate({ sourceKey: "heradsdomar" }), PLAN, NOW);
    assert.ok(supreme.score > district.score);
  });

  test("commentary is penalised, and never outranks the law it discusses", () => {
    const article = scoreCandidate(
      candidate({ kind: "commentary", sourceKey: "logretta", relevance: 1 }),
      PLAN,
      NOW
    );
    const provision = scoreCandidate(candidate({ kind: "provision", relevance: 0.4 }), PLAN, NOW);
    assert.ok(provision.score > article.score, "a provision at 0.4 beats an article at 1.0");
  });

  test("an exact phrase actually present in the text is rewarded", () => {
    const plan = { ...PLAN, phrases: ["frjálsri för launþega"] };
    const has = scoreCandidate(candidate({ text: "um frjálsri för launþega innan EES" }), plan, NOW);
    const hasNot = scoreCandidate(candidate({ text: "um eitthvað allt annað" }), plan, NOW);
    assert.ok(has.score > hasNot.score);
    assert.equal(hasNot.features.exactPhrase, 0);
  });

  test("naming the act the question named counts", () => {
    const plan = { ...PLAN, actQueries: ["lög um meðferð sakamála"] };
    const named = scoreCandidate(candidate({ text: "5. gr. lög um meðferð sakamála" }), plan, NOW);
    assert.ok(named.features.actMatch > 0);
  });

  test("an EU source is background on a question that did not ask about EU law", () => {
    const eu = scoreCandidate(candidate({ kind: "provision", jurisdiction: "eu" }), PLAN, NOW);
    assert.ok(eu.features.jurisdiction < 0);
  });

  test("and is rewarded on a question that did", () => {
    const plan = { ...PLAN, sourceCategories: ["eu" as const] };
    const eu = scoreCandidate(candidate({ kind: "provision", jurisdiction: "eu" }), plan, NOW);
    assert.ok(eu.features.jurisdiction > 0);
  });

  test("a recent decision edges out an old one, but only just", () => {
    const recent = scoreCandidate(candidate({ date: "2024-01-01" }), PLAN, NOW);
    const old = scoreCandidate(candidate({ date: "1994-01-01" }), PLAN, NOW);
    assert.ok(recent.score > old.score);
    assert.ok(recent.score - old.score < 0.15, "recency must not swamp authority");
  });

  test("a document found by one loose synonym, a long way down, is penalised", () => {
    const tangential = scoreCandidate(
      candidate({ matchedBy: ["concept:x"], bestRank: 9 }),
      PLAN,
      NOW
    );
    assert.ok(tangential.features.tangential < 0);
  });

  test("a missing or unparseable date costs nothing rather than throwing", () => {
    assert.equal(scoreCandidate(candidate({ date: null }), PLAN, NOW).features.recency, 0);
    assert.equal(scoreCandidate(candidate({ date: "soon" }), PLAN, NOW).features.recency, 0);
  });
});

describe("rankCandidates", () => {
  test("orders by score and breaks ties on input order, so runs are comparable", () => {
    const candidates = [
      candidate({ key: "a", sourceKey: "heradsdomar" }),
      candidate({ key: "b", sourceKey: "haestirettur" }),
      candidate({ key: "c", sourceKey: "heradsdomar" }),
    ];
    const ranked = rankCandidates(candidates, PLAN, NOW);
    assert.equal(ranked[0].candidate.key, "b");
    assert.deepEqual(
      ranked.slice(1).map((r) => r.candidate.key),
      ["a", "c"]
    );
  });

  test("every feature is reported, so a surprising order can be explained", () => {
    const [first] = rankCandidates([candidate()], PLAN, NOW);
    assert.deepEqual(Object.keys(first.features).sort(), [
      "actMatch",
      "authority",
      "commentary",
      "exactPhrase",
      "jurisdiction",
      "kind",
      "recency",
      "relevance",
      "tangential",
    ]);
  });
});

describe("applyModelOrder", () => {
  const ranked = rankCandidates(
    [candidate({ key: "a" }), candidate({ key: "b" }), candidate({ key: "c" })],
    PLAN,
    NOW
  );

  test("reorders to what the model asked for", () => {
    const out = applyModelOrder(ranked, ["c", "a", "b"]);
    assert.deepEqual(
      out.map((r) => r.candidate.key),
      ["c", "a", "b"]
    );
  });

  test("a key the model invented is ignored — it cannot add a source", () => {
    const out = applyModelOrder(ranked, ["ghost", "c"]);
    assert.equal(out.length, 3);
    assert.equal(out[0].candidate.key, "c");
  });

  test("a key the model dropped keeps its place at the back — it cannot remove one", () => {
    const out = applyModelOrder(ranked, ["c"]);
    assert.deepEqual(
      out.map((r) => r.candidate.key),
      ["c", "a", "b"]
    );
  });

  test("a key repeated by the model appears once", () => {
    const out = applyModelOrder(ranked, ["b", "b", "a"]);
    assert.deepEqual(
      out.map((r) => r.candidate.key),
      ["b", "a", "c"]
    );
  });

  test("an empty order leaves the deterministic ranking untouched", () => {
    assert.deepEqual(
      applyModelOrder(ranked, []).map((r) => r.candidate.key),
      ranked.map((r) => r.candidate.key)
    );
  });
});
