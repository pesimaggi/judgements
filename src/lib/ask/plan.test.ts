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
import {
  parsePlan,
  heuristicPlan,
  planQuery,
  termsToQuery,
  termToQuery,
  mergeHeuristics,
} from "@/lib/ask/plan";
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

/**
 * The structured plan.
 *
 * The fields are separate because they are *searched* separately: a phrase has
 * to match as a phrase, a case number has to match exactly, and a concept is
 * one of several names for the same subject. Folding them back into one OR
 * query is the behaviour this replaced, and the tests below are what stops it
 * coming back by accident.
 */
describe("parsePlan — the structured fields", () => {
  test("keeps each kind of query in its own field", () => {
    const plan = parsePlan(
      {
        concepts: ["gæsluvarðhald", "farbann"],
        phrases: ["rökstuddur grunur"],
        actQueries: ["lög um meðferð sakamála"],
        provisionQueries: ["95. gr. laga nr. 88/2008"],
        decisionQueries: ["22/2023"],
        sourceCategories: ["legislation", "decisions"],
        date: "2023",
        historical: false,
        language: "is",
        legal: true,
        standalone: "Hvenær má beita gæsluvarðhaldi?",
      },
      "Hvenær má beita gæsluvarðhaldi?"
    );
    assert.deepEqual(plan?.concepts, ["gæsluvarðhald", "farbann"]);
    assert.deepEqual(plan?.phrases, ["rökstuddur grunur"]);
    assert.deepEqual(plan?.provisionQueries, ["95. gr. laga nr. 88/2008"]);
    assert.deepEqual(plan?.decisionQueries, ["22/2023"]);
    assert.deepEqual(plan?.sourceCategories, ["legislation", "decisions"]);
    assert.equal(plan?.date, "2023");
  });

  test("a plan in the older single-terms shape still works", () => {
    // Recorded fixtures and anything written against the previous schema.
    const plan = parsePlan({ terms: ["ríkisborgararéttur", "búseta"] }, QUESTION);
    assert.deepEqual(plan?.concepts, ["ríkisborgararéttur", "búseta"]);
    assert.deepEqual(plan?.terms, ["ríkisborgararéttur", "búseta"]);
  });

  test("terms are derived from concepts and phrases when only those are given", () => {
    const plan = parsePlan({ concepts: ["búseta"], phrases: ["samfelld búseta"] }, QUESTION);
    assert.deepEqual(plan?.terms, ["búseta", "samfelld búseta"]);
  });

  test("rejects a plan with nothing to search on", () => {
    assert.equal(parsePlan({ actQueries: ["stjórnsýslulög"] }, QUESTION), null);
  });

  test("a phrase alone is enough to search on", () => {
    assert.ok(parsePlan({ phrases: ["frjálsri för launþega"] }, QUESTION));
  });

  test("caps every list, so one plan cannot become a corpus scan", () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => `term${i}`);
    const plan = parsePlan(
      {
        concepts: many(20),
        phrases: many(20),
        actQueries: many(20),
        provisionQueries: many(20),
        decisionQueries: many(20),
      },
      QUESTION
    );
    assert.equal(plan?.concepts.length, 5);
    assert.equal(plan?.phrases.length, 3);
    assert.equal(plan?.actQueries.length, 3);
    assert.equal(plan?.provisionQueries.length, 3);
    assert.equal(plan?.decisionQueries.length, 3);
  });

  test("drops a source category it does not recognise rather than passing it on", () => {
    const plan = parsePlan(
      { concepts: ["búseta"], sourceCategories: ["legislation", "astrology"] },
      QUESTION
    );
    assert.deepEqual(plan?.sourceCategories, ["legislation"]);
  });

  test("historical is read off the question when the model did not say", () => {
    const plan = parsePlan(
      { concepts: ["vextir"], standalone: "Hvað gilti um vexti fyrir breytinguna?" },
      QUESTION
    );
    assert.equal(plan?.historical, true);
  });

  test("a date is only kept when it is a string the model actually gave", () => {
    assert.equal(parsePlan({ concepts: ["vextir"], date: null }, QUESTION)?.date, null);
    assert.equal(parsePlan({ concepts: ["vextir"], date: "  " }, QUESTION)?.date, null);
    // A number is not a date the *user* supplied — it is the model filling in.
    assert.equal(parsePlan({ concepts: ["vextir"], date: 2019 }, QUESTION)?.date, null);
  });
});

describe("heuristicPlan — the structured fields", () => {
  test("reads a case number straight out of the question", () => {
    const plan = heuristicPlan("Hvað sagði Hæstiréttur í máli 22/2023 um gæsluvarðhald?");
    assert.deepEqual(plan.decisionQueries, ["22/2023"]);
  });

  test("reads a quoted phrase as a phrase", () => {
    const plan = heuristicPlan('Hvað þýðir "frjáls för launþega" í reglunum?');
    assert.deepEqual(plan.phrases, ["frjáls för launþega"]);
  });

  test("spots a question about the law as it stood", () => {
    assert.equal(heuristicPlan("Hvað sagði þágildandi ákvæði um vexti?").historical, true);
    assert.equal(heuristicPlan("Hvað segir ákvæðið um vexti?").historical, false);
  });

  test("asks for EU material only when the question mentions it", () => {
    assert.ok(heuristicPlan("Hvað segir EES-samningurinn?").sourceCategories.includes("eu"));
    assert.ok(!heuristicPlan("Hvenær má beita gæsluvarðhaldi?").sourceCategories.includes("eu"));
  });

  test("still never returns an empty concept list", () => {
    assert.ok(heuristicPlan("hvað?").concepts.length > 0);
  });
});

describe("mergeHeuristics", () => {
  const base = heuristicPlan("Hvenær má beita gæsluvarðhaldi?");

  test("keeps a case number the user typed even when the model did not repeat it", () => {
    const merged = mergeHeuristics(
      { ...base, decisionQueries: [] },
      "Hvað sagði rétturinn í máli 22/2023?"
    );
    assert.deepEqual(merged.decisionQueries, ["22/2023"]);
  });

  test("keeps a phrase the user quoted, ahead of the model's own", () => {
    const merged = mergeHeuristics(
      { ...base, phrases: ["eitthvað annað"] },
      'Hvað þýðir "frjáls för launþega"?'
    );
    assert.equal(merged.phrases[0], "frjáls för launþega");
  });

  test("does not duplicate what the model already had", () => {
    const merged = mergeHeuristics(
      { ...base, decisionQueries: ["22/2023"] },
      "Hvað sagði rétturinn í máli 22/2023?"
    );
    assert.deepEqual(merged.decisionQueries, ["22/2023"]);
  });

  test("gives a plan with no categories the default two", () => {
    const merged = mergeHeuristics({ ...base, sourceCategories: [] }, "q");
    assert.deepEqual(merged.sourceCategories, ["legislation", "decisions"]);
  });
});

describe("termToQuery", () => {
  test("sends a single term as itself — this is the focused search", () => {
    assert.equal(termToQuery("gæsluvarðhald"), "gæsluvarðhald");
  });

  test("quotes a multi-word term so it matches as a phrase", () => {
    assert.equal(termToQuery("rökstuddur grunur"), '"rökstuddur grunur"');
  });

  test("an empty term produces an empty query, not a stray quote", () => {
    assert.equal(termToQuery("  "), "");
    assert.equal(termToQuery('""'), "");
  });
});
