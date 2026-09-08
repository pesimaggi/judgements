/**
 * The well end to end, with the model and the search both faked.
 *
 * What is being held down is which stages are allowed to fail. Planning,
 * reranking and verification are improvements and must degrade; retrieval and
 * the answer are the feature and must fail loudly. Getting that backwards
 * either way is invisible in normal operation and catastrophic in the two
 * cases that matter — a reader gets a blank card, or a question is refused
 * because a helper stage timed out.
 *
 * Also here: both providers' calling conventions, at the seam this app
 * controls. The provider classes themselves are thin wrappers over two SDKs,
 * and everything above them is written against `AskModel` — so what has to
 * hold is that either provider's way of returning a structured value produces
 * the same plan and the same answer.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ask } from "@/lib/ask/pipeline";
import { AskEmptyAnswer } from "@/lib/ask/answer";
import { AskTimeout } from "@/lib/ask/timeout";
import { askConfig } from "@/lib/ask/config";
import type { AskModel } from "@/lib/ask/llm";
import type { Retrieval } from "@/lib/ask/retrieve";
import type { AskEvent, AskSource } from "@/lib/ask/types";

const SOURCES: AskSource[] = [
  { n: 1, kind: "provision", title: "8. gr. laga nr. 100/1952", subtitle: "…", path: "/log/100-1952#G8", cited: false },
  { n: 2, kind: "decision", title: "Hrd. 12/2019", subtitle: "Hæstiréttur Íslands — 2019-03-14", path: "/document/x", cited: false },
];

function retrieval(over: Partial<Retrieval> = {}): Retrieval {
  return {
    sources: SOURCES,
    context: "<<<SOURCE 1>>>\n[1] PROVISION — 8. gr.\nProvision text: Heimilt er að veita.\n<<<END SOURCE 1>>>",
    counts: { acts: 0, provisions: 1, decisions: 1, candidates: 12 },
    evidence: new Map([[1, "Provision text: Heimilt er að veita."]]),
    limitations: [],
    shape: { distinctActs: 1, jurisdictions: ["is"], decisions: 1 },
    ...over,
  };
}

const PLAN_ARGS = {
  concepts: ["ríkisborgararéttur"],
  phrases: [],
  actQueries: [],
  provisionQueries: [],
  decisionQueries: [],
  sourceCategories: ["legislation"],
  date: null,
  historical: false,
  language: "is",
  legal: true,
  standalone: "Hvernig sæki ég um íslenskan ríkisborgararétt?",
};

/**
 * The Anthropic side hands `parse` the tool's already-validated arguments.
 * The OpenAI side hands it the parsed body of a strict `json_schema` reply.
 * Both arrive at `parse` as a plain object, which is the point of the seam —
 * so one fake covers both, and the pair below proves it.
 */
function model(over: Partial<AskModel> = {}): AskModel {
  return {
    complete: async () => "Svarið er þetta [1].",
    extract: async (req) => (req.tool.name === "plan_search" ? req.parse(PLAN_ARGS) : null),
    ...over,
  };
}

const QUIET = { quiet: true as const, config: askConfig({}) };

describe("the happy path", () => {
  test("plans, retrieves, answers, validates and marks what was cited", async () => {
    const { response, metrics } = await ask("Hvernig sæki ég um ríkisborgararétt?", [], {
      ...QUIET,
      model: model(),
      retrieve: async () => retrieval(),
    });

    assert.match(response.answer, /Svarið er þetta \[1\]/);
    assert.equal(response.sources.find((s) => s.n === 1)?.cited, true);
    assert.equal(response.sources.find((s) => s.n === 2)?.cited, false);
    assert.equal(response.abstained, false);
    assert.ok(response.requestId, "the reader needs an id to attach feedback to");
    assert.equal(metrics.retrieval.candidates, 12);
    assert.equal(metrics.retrieval.cited, 1);
    assert.equal(metrics.ok, true);
  });

  test("records the timings and the effort actually chosen", async () => {
    const { metrics } = await ask("Hvenær má beita gæsluvarðhaldi?", [], {
      ...QUIET,
      model: model(),
      retrieve: async () => retrieval(),
    });
    assert.ok(typeof metrics.timings.plan === "number");
    assert.ok(typeof metrics.timings.retrieve === "number");
    assert.ok(typeof metrics.timings.answer === "number");
    assert.equal(metrics.effort, "low", "a simple question runs at the simple effort");
    assert.equal(metrics.complex, false);
  });

  test("a complex question runs at the complex effort, and says why", async () => {
    const historical = { ...PLAN_ARGS, historical: true };
    const { metrics } = await ask("Hvernig hljóðaði ákvæðið fyrir breytinguna?", [], {
      ...QUIET,
      model: model({ extract: async (req) => req.parse(historical) }),
      retrieve: async () => retrieval(),
    });
    assert.equal(metrics.complex, true);
    assert.equal(metrics.effort, "medium");
    assert.ok(metrics.complexitySignals.includes("historical-law"));
  });

  test("nothing above medium is ever chosen automatically", async () => {
    const { metrics } = await ask("Hvað segir EES-samningurinn og hvað gilti fyrir breytinguna?", [], {
      ...QUIET,
      model: model({ extract: async (req) => req.parse({ ...PLAN_ARGS, historical: true }) }),
      retrieve: async () => retrieval(),
    });
    assert.ok(["low", "medium"].includes(metrics.effort ?? ""));
  });
});

describe("degrading stages", () => {
  test("a planning failure falls back to keywords and still answers", async () => {
    const { response, metrics } = await ask("Hvenær má beita gæsluvarðhaldi?", [], {
      ...QUIET,
      model: model({
        extract: async () => {
          throw new Error("planner is down");
        },
      }),
      retrieve: async () => retrieval(),
    });
    assert.match(response.answer, /Svarið er þetta/);
    assert.equal(metrics.ok, true);
  });

  test("a planning call that never returns is given up on, not waited out", async () => {
    const config = askConfig({ ASK_TIMEOUT_PLAN_MS: "1000" });
    const { response } = await ask("Hvenær má beita gæsluvarðhaldi?", [], {
      quiet: true,
      config,
      model: model({ extract: () => new Promise(() => {}) }),
      retrieve: async () => retrieval(),
    });
    assert.match(response.answer, /Svarið er þetta/);
  });

  test("a verification failure leaves the deterministically validated answer", async () => {
    const config = askConfig({ ASK_VERIFY_CITATIONS: "1" });
    const { response, metrics } = await ask("Hvenær má beita gæsluvarðhaldi?", [], {
      quiet: true,
      config,
      model: model({
        extract: async (req) => {
          if (req.tool.name === "plan_search") return req.parse(PLAN_ARGS);
          throw new Error("verifier is down");
        },
      }),
      retrieve: async () => retrieval(),
    });
    assert.match(response.answer, /Svarið er þetta \[1\]/);
    assert.equal(metrics.stages.verified, false);
  });
});

describe("failing stages", () => {
  test("a retrieval failure fails the request — nothing can stand in for law", async () => {
    await assert.rejects(
      ask("Hvenær má beita gæsluvarðhaldi?", [], {
        ...QUIET,
        model: model(),
        retrieve: async () => {
          throw new Error("database is down");
        },
      }),
      /database is down/
    );
  });

  test("a retrieval that hangs times out rather than hanging the reader", async () => {
    await assert.rejects(
      ask("Hvenær má beita gæsluvarðhaldi?", [], {
        quiet: true,
        config: askConfig({ ASK_TIMEOUT_RETRIEVE_MS: "1000" }),
        model: model(),
        retrieve: () => new Promise(() => {}),
      }),
      AskTimeout
    );
  });

  test("an empty completion is an error, not a blank card", async () => {
    await assert.rejects(
      ask("Hvenær má beita gæsluvarðhaldi?", [], {
        ...QUIET,
        model: model({ complete: async () => "   " }),
        retrieve: async () => retrieval(),
      }),
      AskEmptyAnswer
    );
  });

  test("a failure is recorded by class name, never by message", async () => {
    // The message can quote the request; this is a public endpoint's log line.
    await assert.rejects(
      ask("q", [], {
        ...QUIET,
        model: model({ complete: async () => "" }),
        retrieve: async () => retrieval(),
      }),
      (e: Error) => e.name === "AskEmptyAnswer"
    );
  });
});

describe("abstention", () => {
  test("nothing retrieved means the model is never asked to answer", async () => {
    let asked = false;
    const { response } = await ask("Hvaða reglur gilda um geimferðir?", [], {
      ...QUIET,
      model: model({
        complete: async () => {
          asked = true;
          return "…";
        },
      }),
      retrieve: async () => retrieval({ sources: [], context: "", evidence: new Map() }),
    });
    assert.equal(asked, false);
    assert.equal(response.abstained, true);
  });

  test("a question that is not legal is not asked either", async () => {
    let asked = false;
    const { response } = await ask("Hvað er klukkan?", [], {
      ...QUIET,
      model: model({
        extract: async (req) => req.parse({ ...PLAN_ARGS, legal: false }),
        complete: async () => {
          asked = true;
          return "…";
        },
      }),
      retrieve: async () => retrieval(),
    });
    assert.equal(asked, false);
    assert.equal(response.abstained, true);
  });
});

describe("invalid model output", () => {
  test("a plan that is not an object at all falls back to keywords", async () => {
    for (const reply of [null, "a string", 42, [], { concepts: "not an array" }]) {
      const { response } = await ask("Hvenær má beita gæsluvarðhaldi?", [], {
        ...QUIET,
        model: model({ extract: async (req) => req.parse(reply) }),
        retrieve: async () => retrieval(),
      });
      assert.match(response.answer, /Svarið er þetta/);
    }
  });

  test("an answer citing a source that does not exist has the marker removed", async () => {
    const { response, metrics } = await ask("Hvenær má beita gæsluvarðhaldi?", [], {
      ...QUIET,
      model: model({ complete: async () => "Reglan gildir [7]." }),
      retrieve: async () => retrieval(),
    });
    assert.doesNotMatch(response.answer, /\[7\]/);
    assert.equal(metrics.validation.nonexistentCitations, 1);
    assert.equal(
      response.sources.every((s) => !s.cited),
      true,
      "and it is not quietly reassigned to a real source"
    );
  });

  test("an answer full of markup the renderer does not accept still comes back", async () => {
    const { response } = await ask("Hvenær má beita gæsluvarðhaldi?", [], {
      ...QUIET,
      model: model({ complete: async () => "| a | b |\n```code```\n<script>x</script> [1]" }),
      retrieve: async () => retrieval(),
    });
    assert.ok(response.answer.length > 0);
  });
});

describe("both providers' conventions produce the same result", () => {
  // Anthropic validates the tool arguments and hands them over as an object;
  // OpenAI validates a strict json_schema reply and hands over its parsed
  // body. Everything above lib/ask/llm.ts sees one interface either way.
  const anthropicStyle = model({ extract: async (req) => req.parse(PLAN_ARGS) });
  const openaiStyle = model({
    extract: async (req) => {
      try {
        return req.parse(JSON.parse(JSON.stringify(PLAN_ARGS)));
      } catch {
        return null;
      }
    },
  });

  test("the same plan and the same answer come out of both", async () => {
    const [a, b] = await Promise.all([
      ask("Hvernig sæki ég um ríkisborgararétt?", [], {
        ...QUIET,
        model: anthropicStyle,
        retrieve: async () => retrieval(),
      }),
      ask("Hvernig sæki ég um ríkisborgararétt?", [], {
        ...QUIET,
        model: openaiStyle,
        retrieve: async () => retrieval(),
      }),
    ]);
    assert.equal(a.response.answer, b.response.answer);
    assert.equal(a.response.standalone, b.response.standalone);
    assert.deepEqual(
      a.response.sources.map((s) => s.cited),
      b.response.sources.map((s) => s.cited)
    );
  });

  test("a provider that reports usage has it summed into the metrics", async () => {
    const reporting = model({
      complete: async (req) => {
        req.onUsage?.({ inputTokens: 1200, outputTokens: 300, cachedInputTokens: 900 });
        return "Svarið er þetta [1].";
      },
      extract: async (req) => {
        req.onUsage?.({ inputTokens: 400, outputTokens: 50 });
        return req.tool.name === "plan_search" ? req.parse(PLAN_ARGS) : null;
      },
    });
    const { metrics } = await ask("Hvernig sæki ég um ríkisborgararétt?", [], {
      ...QUIET,
      model: reporting,
      retrieve: async () => retrieval(),
    });
    assert.equal(metrics.tokens.input, 1600);
    assert.equal(metrics.tokens.output, 350);
    assert.equal(metrics.tokens.cachedInput, 900);
  });

  test("a provider that reports nothing leaves the counts at zero", async () => {
    const { metrics } = await ask("Hvernig sæki ég um ríkisborgararétt?", [], {
      ...QUIET,
      model: model(),
      retrieve: async () => retrieval(),
    });
    assert.equal(metrics.tokens.input, 0);
  });
});

describe("historical law", () => {
  test("the limitation is carried into the answer's context and reported", async () => {
    let prompt = "";
    const { response, metrics } = await ask("Hvernig hljóðaði ákvæðið fyrir breytinguna?", [], {
      ...QUIET,
      model: model({
        extract: async (req) => req.parse({ ...PLAN_ARGS, historical: true }),
        complete: async (req) => {
          prompt = req.messages[req.messages.length - 1].content;
          return "Aðeins gildandi texti er í safninu [1].";
        },
      }),
      retrieve: async () =>
        retrieval({ limitations: ["The act library holds only the current consolidated text."] }),
    });
    assert.match(prompt, /LIMITATIONS OF THIS SEARCH/);
    assert.match(prompt, /current consolidated text/);
    assert.equal(response.limitations?.length, 1);
    assert.equal(metrics.historical, true);
  });
});

describe("streaming events", () => {
  /** A model that streams its answer in small pieces, as a real one does. */
  function streamingModel(answer: string): AskModel {
    return model({
      complete: async (req) => {
        for (const chunk of answer.match(/.{1,7}/gs) ?? []) req.onDelta?.(chunk);
        return answer;
      },
    });
  }

  test("the stages report in order: plan, then sources, then lines, then the answer", async () => {
    const events: AskEvent[] = [];
    await ask("Hvernig sæki ég um ríkisborgararétt?", [], {
      ...QUIET,
      retrieve: async () => retrieval(),
      model: streamingModel("Svarið er þetta [1].\n\n## Ákvæðin\n\nHeimilt er að veita [1]."),
      onEvent: (e) => events.push(e),
    });

    const order = events.map((e) => e.type);
    assert.equal(order[0], "plan");
    assert.equal(order[1], "sources");
    assert.equal(order[order.length - 1], "answer");
    assert.ok(order.slice(2, -1).every((t) => t === "line"), `unexpected: ${order.join(",")}`);
  });

  test("the plan event names the terms the corpus will be searched for", async () => {
    const events: AskEvent[] = [];
    await ask("Hvernig sæki ég um ríkisborgararétt?", [], {
      ...QUIET,
      retrieve: async () => retrieval(),
      model: streamingModel("Svarið [1]."),
      onEvent: (e) => events.push(e),
    });

    const plan = events.find((e) => e.type === "plan");
    assert.ok(plan && plan.type === "plan");
    assert.deepEqual(plan.terms, ["ríkisborgararéttur"]);
    assert.equal(plan.language, "is");
  });

  test("the streamed lines reassemble into the answer that is returned", async () => {
    // The property that matters to a reader: what they watched being written
    // is what they are left with. If these diverge the client would visibly
    // rewrite the answer at the end.
    const events: AskEvent[] = [];
    const { response } = await ask("Hvernig?", [], {
      ...QUIET,
      retrieve: async () => retrieval(),
      model: streamingModel("Svarið er þetta [1].\n\n## Ákvæðin\n\nHeimilt er að veita [1]."),
      onEvent: (e) => events.push(e),
    });

    const streamed = events
      .filter((e): e is Extract<AskEvent, { type: "line" }> => e.type === "line")
      .map((e) => e.text)
      .join("\n");
    assert.equal(streamed, response.answer);
  });

  test("a citation to a source that does not exist is never streamed", async () => {
    const events: AskEvent[] = [];
    await ask("Hvernig?", [], {
      ...QUIET,
      retrieve: async () => retrieval(),
      // Only two sources came back; [9] does not exist.
      model: streamingModel("Umsækjandi skal uppfylla skilyrði [9]."),
      onEvent: (e) => events.push(e),
    });

    for (const e of events) {
      if (e.type === "line") assert.ok(!e.text.includes("[9]"), `leaked: ${e.text}`);
    }
  });

  test("an event handler that throws does not fail the question", async () => {
    // The ordinary case is a reader who navigated away mid-answer, closing the
    // connection the handler writes to.
    const { response } = await ask("Hvernig?", [], {
      ...QUIET,
      retrieve: async () => retrieval(),
      model: streamingModel("Svarið er þetta [1]."),
      onEvent: () => {
        throw new Error("connection closed");
      },
    });
    assert.match(response.answer, /Svarið/);
  });

  test("without onEvent the answer stage does not stream at all", async () => {
    // Guards the promise made to the evaluation harness: no handler, no
    // streaming, one call, same behaviour as before any of this existed.
    let streamed = false;
    await ask("Hvernig?", [], {
      ...QUIET,
      retrieve: async () => retrieval(),
      model: model({
        complete: async (req) => {
          streamed = req.onDelta !== undefined;
          return "Svarið er þetta [1].";
        },
      }),
    });
    assert.equal(streamed, false);
  });

  test("an abstention still arrives, as the answer event", async () => {
    const events: AskEvent[] = [];
    await ask("hvað er klukkan?", [], {
      ...QUIET,
      retrieve: async () => retrieval({ sources: [], context: "", evidence: new Map() }),
      model: streamingModel(""),
      onEvent: (e) => events.push(e),
    });

    const last = events[events.length - 1];
    assert.ok(last.type === "answer");
    assert.equal(last.response.abstained, true);
    // Nothing was written, so nothing should have been streamed as prose.
    assert.equal(events.filter((e) => e.type === "line").length, 0);
  });
});
