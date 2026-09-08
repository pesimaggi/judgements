import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { researchBrief } from "./research";
import { ResearchSession } from "./tools";
import type { QueryPlan } from "./types";

const PLAN: QueryPlan = {
  terms: ["ríkisborgararéttur"],
  concepts: ["ríkisborgararéttur"],
  phrases: [],
  actQueries: [],
  provisionQueries: [],
  decisionQueries: ["E-5/21"],
  sourceCategories: ["legislation", "decisions"],
  date: null,
  historical: false,
  language: "is",
  legal: true,
  standalone: "Hver var niðurstaðan í E-5/21 og hefur Hæstiréttur dæmt í málinu?",
};

describe("the brief the loop is given", () => {
  test("carries the planner's vocabulary rather than making it rediscover it", () => {
    const brief = researchBrief(PLAN);
    assert.match(brief, /Hver var niðurstaðan/);
    assert.match(brief, /ríkisborgararéttur/);
  });

  test("a decision named in the question is pointed at find_citing_cases", () => {
    // The failure this whole path exists for: the well found E-5/21 and never
    // asked what had cited it since.
    const brief = researchBrief(PLAN);
    assert.match(brief, /E-5\/21/);
    assert.match(brief, /find_citing_cases/);
  });

  test("the historical limitation is passed on when the planner saw one", () => {
    assert.match(researchBrief({ ...PLAN, historical: true }), /as it stood at an earlier time/);
  });
});

describe("the tools, and what they refuse to do", () => {
  const session = () => new ResearchSession(PLAN, "eea");

  test("every tool the system prompt names is actually defined", () => {
    // The prompt tells the loop to use these by name; a name that does not
    // exist is a round wasted on an error message.
    const names = session().tools().map((t) => t.name);
    for (const named of [
      "search_decisions",
      "search_provisions",
      "find_citing_cases",
      "read_decision",
      "read_provision",
      "list_subject_tags",
    ]) {
      assert.ok(names.includes(named), `${named} is missing`);
    }
  });

  test("an unknown tool is reported, not thrown", () => {
    // The loop must survive the model inventing a tool: it costs one round and
    // a message telling it what actually exists.
    return session()
      .run("search_the_internet", { query: "x" })
      .then((out) => {
        assert.match(out, /No tool named/);
        assert.match(out, /search_decisions/);
      });
  });

  test("a call with no arguments is reported, not thrown", async () => {
    const s = session();
    assert.match(await s.run("search_decisions", {}), /needs a query/);
    assert.match(await s.run("read_decision", {}), /needs a documentId/);
    assert.match(await s.run("find_citing_cases", {}), /needs a caseNumber/);
  });

  test("an unknown source key is named back with the valid ones", async () => {
    const out = await session().run("search_decisions", {
      query: "ríkisborgararéttur",
      sources: ["supreme_court_of_iceland"],
    });
    assert.match(out, /Unknown source key/);
    assert.match(out, /haestirettur/);
  });

  test("every call is recorded, including the ones that failed", async () => {
    const s = session();
    await s.run("read_decision", {});
    await s.run("nope", {});
    assert.equal(s.calls.length, 2);
  });

  test("nothing is citable until it has been read", () => {
    // The rule that keeps the answer honest. A search fills `seen`; only a read
    // fills `documents`, and only `documents` becomes sources.
    const s = session();
    assert.equal(s.documents.size, 0);
    assert.equal(s.provisions.size, 0);
  });

  test("the tool schemas are strict objects, as both providers require", () => {
    for (const tool of session().tools()) {
      const schema = tool.schema as Record<string, unknown>;
      assert.equal(schema.type, "object", `${tool.name} is not an object schema`);
      assert.equal(schema.additionalProperties, false, `${tool.name} allows extra properties`);
      assert.ok(Array.isArray(schema.required), `${tool.name} has no required list`);
      assert.ok(
        tool.description.length > 40,
        `${tool.name} has no description worth reading — the model chooses tools by these`
      );
    }
  });
});
