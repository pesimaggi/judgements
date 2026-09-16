/**
 * The parts of the research session that decide *whether it has researched*.
 *
 * The tools themselves reach the database and are exercised against it by the
 * evaluation harness. What is tested here is the reasoning that does not: the
 * sector heuristic a lawyer uses to tell one side of the labour market from
 * the other, and the gate that refuses a loop permission to stop early.
 *
 * That gate is the answer to a specific complaint — answers that read as if
 * they had been written off search summaries — and the failure it prevents is
 * silent, so it is worth asserting directly rather than inferring from an
 * answer that happens to look better.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { ResearchSession, asksBothSectors, sectorOf } from "@/lib/ask/tools";
import type { QueryPlan } from "@/lib/ask/types";
import type { SearchHit } from "@/lib/types";

function plan(overrides: Partial<QueryPlan> = {}): QueryPlan {
  return {
    concepts: [],
    phrases: [],
    actQueries: [],
    provisionQueries: [],
    decisionQueries: [],
    sourceCategories: [],
    terms: [],
    date: null,
    historical: false,
    language: "is",
    legal: true,
    standalone: "Hvaða reglur gilda um uppsögn tímabundinna ráðningarsamninga?",
    ...overrides,
  } as QueryPlan;
}

function hit(caseName: string): SearchHit {
  return {
    id: caseName,
    source: "haestirettur",
    court: "Hæstiréttur",
    caseNumber: "1/2020",
    caseName,
    title: caseName,
    date: null,
    year: 2020,
    subjectTags: [],
    officialUrl: "",
    pdfUrl: null,
    snippet: "",
    summary: null,
    isSample: false,
    isFuzzy: false,
  };
}

describe("sectorOf", () => {
  test("reads a private employer off the company form", () => {
    assert.equal(sectorOf("Sandra Sif Baldursdóttir gegn Sjóklæðagerðinni hf."), "private");
    assert.equal(sectorOf("Jón Jónsson gegn Einhverju ehf."), "private");
  });

  test("reads a public employer off the party", () => {
    assert.equal(sectorOf("Hafliði Páll Guðjónsson gegn íslenska ríkinu"), "public");
    assert.equal(sectorOf("A gegn Reykjavíkurborg"), "public");
  });

  test("says nothing about an anonymised party rather than guessing", () => {
    // Hæstiréttur anonymises, so this is the common case and the one where a
    // guess would be a fabricated fact about the case.
    assert.equal(sectorOf("A gegn B"), "unknown");
    assert.equal(sectorOf(""), "unknown");
    assert.equal(sectorOf(null), "unknown");
  });
});

describe("asksBothSectors", () => {
  test("recognises the question that asks about both markets", () => {
    assert.equal(
      asksBothSectors(
        "Eru til dómar um uppsögn tímabundinna ráðningarsamninga á almennum vinnumarkaði? En opinberum?"
      ),
      true
    );
  });

  test("is false when only one side is in play", () => {
    assert.equal(asksBothSectors("Hvaða reglur gilda um uppsögn á almennum vinnumarkaði?"), false);
    assert.equal(asksBothSectors("Hvað segir 41. gr. laga um réttindi ríkisstarfsmanna?"), false);
  });
});

describe("finishBlocked", () => {
  /** A session with `calls` and the read maps filled in, without a database. */
  function session(opts: {
    calls?: number;
    provisions?: number;
    documents?: string[];
    standalone?: string;
    minCalls?: number;
  }) {
    const s = new ResearchSession(
      plan(opts.standalone ? { standalone: opts.standalone } : {}),
      "eea",
      opts.minCalls ?? 6
    );
    for (let i = 0; i < (opts.calls ?? 20); i++) s.calls.push({ name: "search_decisions", input: {} });
    for (let i = 0; i < (opts.provisions ?? 2); i++) {
      s.provisions.set(`p${i}`, { id: `p${i}` } as never);
    }
    for (const name of opts.documents ?? ["A gegn Einhverju ehf."]) s.documents.set(name, hit(name));
    return s;
  }

  test("refuses a loop that has barely searched", () => {
    const blocked = session({ calls: 3 }).finishBlocked();
    assert.ok(blocked, "three calls is not research");
    assert.match(blocked!, /tool calls/);
  });

  test("refuses a loop that has read no law", () => {
    const blocked = session({ provisions: 0 }).finishBlocked();
    assert.match(blocked!, /not read a single provision/);
  });

  test("refuses a loop that has opened no decision", () => {
    const blocked = session({ documents: [] }).finishBlocked();
    assert.match(blocked!, /not opened a single decision/);
  });

  test("accepts a run that read law and cases", () => {
    assert.equal(session({}).finishBlocked(), null);
  });

  const BOTH =
    "Eru til dómar um uppsögn tímabundinna ráðningarsamninga á almennum vinnumarkaði? En opinberum?";

  test("refuses a two-sector question answered from one sector", () => {
    const blocked = session({
      standalone: BOTH,
      documents: ["Jón gegn Sjóklæðagerðinni hf."],
    }).finishBlocked();
    assert.match(blocked!, /opinbera/);
  });

  test("accepts it once both sectors have been read", () => {
    const s = session({
      standalone: BOTH,
      documents: ["Jón gegn Sjóklæðagerðinni hf.", "Hafliði gegn íslenska ríkinu"],
    });
    assert.equal(s.finishBlocked(), null);
  });

  test("a gap declared honestly is accepted in place of coverage", () => {
    // Being clear about what the corpus does not hold is a useful result; the
    // gate refuses silence, not absence.
    const s = session({ standalone: BOTH, documents: ["Jón gegn Sjóklæðagerðinni hf."] });
    assert.equal(s.finishBlocked(["Engir dómar fundust um opinbera vinnumarkaðinn"]), null);
  });
});
