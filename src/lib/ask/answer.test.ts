/**
 * The rules the answer stage enforces in code rather than in the prompt.
 *
 * The prompt does most of the work of keeping an answer honest, and a prompt
 * is a request. These are the two places where the code refuses instead: a
 * question with no retrieved law never reaches the model at all, because
 * asking a model to answer from nothing is asking it to invent — which is the
 * single failure this feature exists to prevent.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { answer, markCited, answerSystemPrompt, answerUserMessage } from "@/lib/ask/answer";
import type { AskModel } from "@/lib/ask/llm";
import type { AskSource, QueryPlan } from "@/lib/ask/types";
import type { Retrieval } from "@/lib/ask/retrieve";

const PLAN: QueryPlan = {
  terms: ["ríkisborgararéttur"],
  actQueries: ["lög um íslenskan ríkisborgararétt"],
  language: "is",
  legal: true,
  standalone: "Hvernig sæki ég um íslenskan ríkisborgararétt?",
};

const SOURCES: AskSource[] = [
  { n: 1, kind: "act", title: "lög nr. 100/1952", subtitle: "…", path: "/log/100-1952", cited: false },
  { n: 2, kind: "provision", title: "8. gr.", subtitle: "…", path: "/log/100-1952#G8", cited: false },
  { n: 3, kind: "decision", title: "Hrd. 12/2019", subtitle: "…", path: "/document/x", cited: false },
];

const RETRIEVAL: Retrieval = {
  sources: SOURCES,
  context: "[1] ACT — lög nr. 100/1952",
  counts: { acts: 1, provisions: 1, decisions: 1 },
};

const EMPTY: Retrieval = { sources: [], context: "", counts: { acts: 0, provisions: 0, decisions: 0 } };

/** Records whether it was called, and with what. */
function spyModel(reply = "Svar [2].") {
  const calls: { system: string; user: string }[] = [];
  const model: AskModel = {
    complete: async (req) => {
      const last = req.messages[req.messages.length - 1];
      calls.push({ system: req.system, user: last.content });
      return reply;
    },
    extract: async () => null,
  };
  return { model, calls };
}

describe("markCited", () => {
  test("marks the sources the answer names, and only those", () => {
    const marked = markCited("Búseta [2]. Sjá einnig [3].", SOURCES);
    assert.deepEqual(
      marked.map((s) => s.cited),
      [false, true, true]
    );
  });

  test("does not mutate the sources it was given", () => {
    markCited("[1]", SOURCES);
    assert.equal(SOURCES[0].cited, false);
  });

  test("an answer with no citations marks nothing", () => {
    assert.deepEqual(
      markCited("Ekkert fannst.", SOURCES).map((s) => s.cited),
      [false, false, false]
    );
  });
});

describe("answer", () => {
  test("asks the model, and marks what the reply cited", async () => {
    const { model, calls } = spyModel("Umsókn fer eftir 8. gr. [2].");
    const result = await answer(PLAN, RETRIEVAL, [], model);

    assert.equal(calls.length, 1);
    assert.equal(result.sources.find((s) => s.n === 2)?.cited, true);
    assert.equal(result.sources.find((s) => s.n === 1)?.cited, false);
    assert.equal(result.language, "is");
  });

  test("hands the model the retrieved law along with the question", async () => {
    const { model, calls } = spyModel();
    await answer(PLAN, RETRIEVAL, [], model);
    assert.match(calls[0].user, /QUESTION: Hvernig sæki ég/);
    assert.match(calls[0].user, /\[1\] ACT — lög nr\. 100\/1952/);
  });

  test("never calls the model when nothing was retrieved", async () => {
    const { model, calls } = spyModel();
    const result = await answer(PLAN, EMPTY, [], model);

    assert.equal(calls.length, 0, "a question with no sources must not reach the model");
    assert.deepEqual(result.sources, []);
    // The terms that were tried are reported, so the reader can adjust them.
    assert.match(result.answer, /ríkisborgararéttur/);
  });

  test("never calls the model when the question is not a legal one", async () => {
    const { model, calls } = spyModel();
    const result = await answer({ ...PLAN, legal: false }, RETRIEVAL, [], model);

    assert.equal(calls.length, 0);
    assert.deepEqual(result.sources, []);
    assert.match(result.answer, /brunnur/i);
  });

  test("says so in English when the question was asked in English", async () => {
    const { model } = spyModel();
    const result = await answer({ ...PLAN, language: "en", legal: false }, RETRIEVAL, [], model);
    assert.match(result.answer, /This well holds law/);
    assert.equal(result.language, "en");
  });
});

describe("the prompt itself", () => {
  test("names the language the answer must be written in", () => {
    assert.match(answerSystemPrompt("is"), /Write the answer in Icelandic\./);
    assert.match(answerSystemPrompt("en"), /Write the answer in English\./);
  });

  test("states the rule the whole feature rests on", () => {
    // If this sentence ever goes missing from the prompt, the well can start
    // citing act numbers that do not exist and nothing else would catch it.
    assert.match(answerSystemPrompt("is"), /If you cannot cite it, do not write it\./);
  });

  test("counts the sources for the model", () => {
    assert.match(answerUserMessage("q", RETRIEVAL), /1 acts, 1 provisions, 1 decisions/);
  });
});
