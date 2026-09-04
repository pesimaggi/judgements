/**
 * The planning stage, which decides what the search actually runs on.
 *
 * Two things are tested here. First, that a plan the model returns is
 * sanitised before it reaches the search — an empty term is a query for
 * everything. Second, and more important, that a planning failure degrades
 * instead of failing: the model call is one of the two things in this feature
 * that can go down, and a question is still answerable without it.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parsePlan, heuristicPlan, planQuery, termsToQuery } from "@/lib/ask/plan";
import type { AskModel } from "@/lib/ask/llm";

const QUESTION = "Hvernig sæki ég um íslenskan ríkisborgararétt?";

/** A model that answers with whatever it is handed, or fails on demand. */
function fakeModel(result: unknown | Error): AskModel {
  return {
    complete: async () => "",
    extract: async (req) => {
      if (result instanceof Error) throw result;
      return req.parse(result);
    },
  };
}

describe("parsePlan", () => {
  test("keeps a well-formed plan", () => {
    const plan = parsePlan(
      {
        terms: ["ríkisborgararéttur", "veiting ríkisborgararéttar"],
        actQueries: ["lög um íslenskan ríkisborgararétt"],
        language: "is",
        legal: true,
        standalone: QUESTION,
      },
      QUESTION
    );
    assert.equal(plan?.terms.length, 2);
    assert.equal(plan?.actQueries[0], "lög um íslenskan ríkisborgararétt");
    assert.equal(plan?.language, "is");
  });

  test("drops blank and one-character terms, and de-duplicates", () => {
    const plan = parsePlan(
      { terms: ["búseta", "búseta", "", " ", "x"], actQueries: [], language: "en", legal: true },
      QUESTION
    );
    assert.deepEqual(plan?.terms, ["búseta"]);
  });

  test("caps the term list, so one plan cannot become a corpus scan", () => {
    const plan = parsePlan(
      { terms: ["a1", "b2", "c3", "d4", "e5", "f6", "g7", "h8"], actQueries: [] },
      QUESTION
    );
    assert.equal(plan?.terms.length, 6);
  });

  test("rejects a plan with no terms at all", () => {
    assert.equal(parsePlan({ terms: [], actQueries: [] }, QUESTION), null);
    assert.equal(parsePlan({}, QUESTION), null);
    assert.equal(parsePlan(null, QUESTION), null);
  });

  test("falls back to the question when no standalone form is given", () => {
    const plan = parsePlan({ terms: ["búseta"] }, QUESTION);
    assert.equal(plan?.standalone, QUESTION);
  });

  test("legal defaults to true, and is only false when said so", () => {
    assert.equal(parsePlan({ terms: ["búseta"] }, QUESTION)?.legal, true);
    assert.equal(parsePlan({ terms: ["búseta"], legal: false }, QUESTION)?.legal, false);
  });
});

describe("heuristicPlan", () => {
  test("keeps the words carrying the subject and drops the grammar", () => {
    const plan = heuristicPlan(QUESTION);
    assert.ok(plan.terms.includes("ríkisborgararétt"));
    // "hvernig" and "íslenskan" are grammar around the question, not its
    // subject, and searching on them matches most of the corpus.
    assert.ok(!plan.terms.includes("hvernig"));
    assert.ok(!plan.terms.includes("íslenskan"));
  });

  test("reads the language off the alphabet", () => {
    assert.equal(heuristicPlan("Hvenær má beita gæsluvarðhaldi?").language, "is");
    assert.equal(heuristicPlan("How do I apply for citizenship?").language, "en");
  });

  test("a follow-up with nothing of its own borrows the question before it", () => {
    const plan = heuristicPlan("Og hvað svo?", [
      { role: "user", content: "Hvenær má beita gæsluvarðhaldi?" },
      { role: "assistant", content: "…" },
    ]);
    assert.ok(plan.terms.includes("gæsluvarðhaldi"));
  });

  test("never returns an empty term list", () => {
    assert.equal(heuristicPlan("hvað?").terms.length > 0, true);
  });
});

describe("planQuery", () => {
  test("uses the model's plan when it returns one", async () => {
    const plan = await planQuery(
      QUESTION,
      [],
      fakeModel({
        terms: ["ríkisborgararéttur"],
        actQueries: ["útlendingalög"],
        language: "is",
        legal: true,
        standalone: QUESTION,
      })
    );
    assert.deepEqual(plan.terms, ["ríkisborgararéttur"]);
    assert.deepEqual(plan.actQueries, ["útlendingalög"]);
  });

  test("falls back to keywords when the model throws", async () => {
    const plan = await planQuery(QUESTION, [], fakeModel(new Error("no api key")));
    assert.ok(plan.terms.length > 0);
    assert.deepEqual(plan.actQueries, []);
  });

  test("falls back to keywords when the model returns something unusable", async () => {
    const plan = await planQuery(QUESTION, [], fakeModel({ terms: [] }));
    assert.ok(plan.terms.length > 0);
  });
});

describe("termsToQuery", () => {
  test("joins with OR, because the terms are alternatives not conditions", () => {
    assert.equal(termsToQuery(["búseta", "ríkisfang"]), "búseta OR ríkisfang");
  });

  test("quotes a multi-word term so it matches as a phrase", () => {
    assert.equal(
      termsToQuery(["veiting ríkisborgararéttar", "búseta"]),
      '"veiting ríkisborgararéttar" OR búseta'
    );
  });

  test("strips quotes out of a term rather than letting it break the query", () => {
    assert.equal(termsToQuery(['veiting "ríkisborgararéttar"']), '"veiting ríkisborgararéttar"');
  });

  test("an empty plan produces an empty query, not a stray OR", () => {
    assert.equal(termsToQuery([]), "");
    assert.equal(termsToQuery(["", "  "]), "");
  });
});
