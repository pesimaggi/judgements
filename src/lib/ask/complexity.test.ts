/**
 * The complexity classifier.
 *
 * Two things are held down here. First, that the ordinary question stays
 * simple — the whole point is to spend the reasoning budget where it is needed,
 * and a classifier that calls everything complex is a classifier that does
 * nothing but cost money. Second, that nothing here ever selects an effort
 * above "medium" on its own.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { classifyComplexity, looksConflicting, HISTORICAL, CROSS_JURISDICTION } from "@/lib/ask/complexity";
import type { QueryPlan } from "@/lib/ask/types";

function plan(over: Partial<QueryPlan> = {}): QueryPlan {
  return {
    terms: ["gæsluvarðhald"],
    concepts: ["gæsluvarðhald"],
    phrases: [],
    actQueries: [],
    provisionQueries: [],
    decisionQueries: [],
    sourceCategories: ["legislation"],
    date: null,
    historical: false,
    language: "is",
    legal: true,
    standalone: "Hvenær má beita gæsluvarðhaldi?",
    ...over,
  };
}

describe("the Icelandic patterns actually match Icelandic", () => {
  // JavaScript's \b is ASCII-only, so /\bþágildandi\b/ matches nothing at all.
  // These would have been silently dead. See lib/word-boundary.ts.
  test("historical wording is recognised", () => {
    assert.equal(HISTORICAL.test("þágildandi ákvæði"), true);
    assert.equal(HISTORICAL.test("eins og það hljóðaði fyrir breytinguna"), true);
    assert.equal(HISTORICAL.test("as it stood in 2009"), true);
    assert.equal(HISTORICAL.test("Hvaða reglur gilda um uppsögn?"), false);
  });

  test("EEA and EU wording is recognised", () => {
    assert.equal(CROSS_JURISDICTION.test("Á þetta við samkvæmt EES-samningnum?"), true);
    assert.equal(CROSS_JURISDICTION.test("tilskipun 2003/88"), true);
    assert.equal(CROSS_JURISDICTION.test("Hvenær má beita gæsluvarðhaldi?"), false);
  });
});

describe("classifyComplexity", () => {
  test("an ordinary single-issue question is simple", () => {
    const { complex, signals } = classifyComplexity(plan());
    assert.equal(complex, false);
    assert.deepEqual(signals, []);
  });

  test("historical law alone makes it complex — the answer has to state a limitation", () => {
    const { complex, signals } = classifyComplexity(plan({ historical: true }));
    assert.equal(complex, true);
    assert.deepEqual(signals, ["historical-law"]);
  });

  test("one EEA mention alone does not, because nearly every question has one", () => {
    const { complex } = classifyComplexity(
      plan({ standalone: "Hvað segir tilskipunin um vinnutíma?" })
    );
    assert.equal(complex, false);
  });

  test("two signals together do", () => {
    const { complex, signals } = classifyComplexity(
      plan({
        standalone: "Hvað segir EES-samningurinn um vinnutíma og hvernig var þetta fyrir breytinguna?",
      })
    );
    assert.equal(complex, true);
    assert.ok(signals.includes("cross-jurisdiction"));
    assert.ok(signals.includes("historical-law"));
  });

  test("several governing acts is a signal", () => {
    const { signals } = classifyComplexity(plan({ actQueries: ["stjórnsýslulög", "útlendingalög"] }));
    assert.ok(signals.includes("multiple-acts"));
  });

  test("so is a question that names two decisions", () => {
    const { signals } = classifyComplexity(
      plan({ standalone: "Hver er munurinn á 22/2023 og 41/2021?" })
    );
    assert.ok(signals.includes("decision-comparison"));
  });

  test("so are sources that point in different directions", () => {
    const { signals } = classifyComplexity(plan(), {
      distinctActs: 1,
      jurisdictions: ["is"],
      decisions: 4,
      conflicting: true,
    });
    assert.ok(signals.includes("conflicting-sources"));
  });

  test("two questions in one is two issues", () => {
    const { signals } = classifyComplexity(
      plan({ standalone: "Hvenær má beita gæsluvarðhaldi? Og hvað varir það lengi?" })
    );
    assert.ok(signals.includes("multiple-issues"));
  });

  test("retrieval that spans both corpora is cross-jurisdictional", () => {
    const { signals } = classifyComplexity(plan(), {
      distinctActs: 2,
      jurisdictions: ["is", "eu"],
      decisions: 1,
    });
    assert.ok(signals.includes("cross-jurisdiction"));
  });

  test("a long question is a signal but not a verdict on its own", () => {
    const long = `Hvað ${"orð ".repeat(50)}?`;
    const { complex, signals } = classifyComplexity(plan({ standalone: long }));
    assert.ok(signals.includes("long-question"));
    assert.equal(complex, false);
  });
});

describe("looksConflicting", () => {
  test("three different courts on one question is the shape of a conflict", () => {
    assert.equal(
      looksConflicting([
        { kind: "decision", authority: "Hæstiréttur Íslands" },
        { kind: "decision", authority: "Landsréttur" },
        { kind: "decision", authority: "Héraðsdómar" },
      ]),
      true
    );
  });

  test("three judgments from one court is not", () => {
    assert.equal(
      looksConflicting([
        { kind: "decision", authority: "Hæstiréttur Íslands" },
        { kind: "decision", authority: "Hæstiréttur Íslands" },
        { kind: "decision", authority: "Hæstiréttur Íslands" },
      ]),
      false
    );
  });

  test("provisions are not a conflict, whatever else is in the list", () => {
    assert.equal(
      looksConflicting([{ kind: "provision" }, { kind: "provision" }, { kind: "provision" }]),
      false
    );
  });
});
