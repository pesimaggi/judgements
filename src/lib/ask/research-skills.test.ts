import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  RESEARCH_SKILLS,
  researchSkillSections,
  researchSkillsFor,
  type ResearchSkillContext,
} from "./research-skills";
import { researchSystem } from "./research";
import type { QueryPlan } from "./types";

/** A domestic question, with nothing European anywhere in it. */
const DOMESTIC: QueryPlan = {
  terms: ["riftun"],
  concepts: ["riftun", "húsaleiga"],
  phrases: [],
  actQueries: ["húsaleigulög"],
  provisionQueries: [],
  decisionQueries: [],
  sourceCategories: ["legislation", "decisions"],
  date: null,
  historical: false,
  language: "is",
  legal: true,
  standalone: "Hvenær má rifta leigusamningi vegna vanskila á húsaleigu?",
};

function ask(overrides: Partial<QueryPlan>, scope: "eea" | "eu" = "eea"): ResearchSkillContext {
  return { plan: { ...DOMESTIC, ...overrides }, scope };
}

const fields = (context: ResearchSkillContext) => researchSkillsFor(context).map((s) => s.key);

const EU_EEA = RESEARCH_SKILLS.find((s) => s.key === "eu-eea-law");

describe("which field guidance a question gets", () => {
  test("a question with nothing European in it gets none", () => {
    // The gate has to be capable of saying no, or it is not a gate and every
    // field ever added is paid for on every question.
    assert.deepEqual(fields(ask({})), []);
  });

  test("Icelandic inflection does not switch the gate off", () => {
    // The whole reason the markers go through wordAlternation. Written with
    // JavaScript's ASCII \b, every one of these matches nothing and the
    // specialist method disappears with no error to show for it.
    for (const standalone of [
      "Hvaða áhrif hefur fjórfrelsið á reglur um búvörur?",
      "Hvernig er bókun 35 beitt fyrir íslenskum dómstólum?",
      "Er tilskipunin tekin upp í EES-samninginn?",
      "Hefur Evrópudómstóllinn skýrt þetta ákvæði?",
      "Hvaða ákvæði laga nr. 2/1993 gilda um skýringu íslenskra laga?",
    ]) {
      assert.deepEqual(fields(ask({ standalone })), ["eu-eea-law"], standalone);
    }
  });

  test("the English half of the corpus's vocabulary is matched too", () => {
    // Questions arrive in English, and so is most of the material this field is
    // about. "directive" on its own would miss "directives": the trailing word
    // boundary refuses a letter after the match.
    for (const standalone of [
      "Which directives govern posted workers?",
      "Does the internal market reach a measure of this kind?",
      "Is there free movement of capital here?",
    ]) {
      assert.deepEqual(fields(ask({ standalone })), ["eu-eea-law"], standalone);
    }
  });

  test("an EFTA Court or CJEU case number is enough on its own", () => {
    // The planner extracts these reliably even when the sentence around them
    // says nothing about the EEA — which was the failure the research loop was
    // built for in the first place.
    assert.deepEqual(
      fields(ask({ decisionQueries: ["E-5/21"] })),
      ["eu-eea-law"]
    );
    assert.deepEqual(fields(ask({ concepts: ["C-6/64"] })), ["eu-eea-law"]);
  });

  test("the planner's own reading counts, and so does the ESB scope", () => {
    // sourceCategories is the planner saying the question needs EU material,
    // which is a better judgment than any word list; the wide act scope is only
    // ever switched on to ask whether something is in the Agreement at all.
    assert.deepEqual(fields(ask({ sourceCategories: ["eu"] })), ["eu-eea-law"]);
    assert.deepEqual(fields(ask({}, "eu")), ["eu-eea-law"]);
  });
});

describe("the EU/EEA field guidance", () => {
  const guidance = EU_EEA?.guidance ?? "";

  test("keeps the Icelandic Agreement canonical and the three rows one provision", () => {
    // The corpus holds the Agreement three times. Treating the copies as three
    // authorities inflates the source set behind an answer that rests on one
    // Article, and the reader cannot see that it happened.
    assert.match(guidance, /three rows/);
    assert.match(guidance, /Icelandic Agreement is the canonical text/);
    assert.match(guidance, /Deduplicate by Article or Protocol provision/);
    assert.match(guidance, /annex to lög nr\. 2\/1993/);
  });

  test("makes incorporation the first question, through the Joint Committee source", () => {
    assert.match(guidance, /eea-joint-committee/);
    assert.match(guidance, /adaptations/);
  });

  test("names the authorities a State-liability question is not researched without", () => {
    for (const authority of ["E-9/97", "Hrd. 236/1999", "E-5/21", "Hrd. 50/2025"]) {
      assert.ok(guidance.includes(authority), `${authority} is missing`);
    }
  });

  test("names the Icelandic line on conflict and bókun 35", () => {
    for (const authority of ["Hrd. 477/2002", "Hrd. 220/2005", "Hrd. 274/2006", "Hrd. 24/2023"]) {
      assert.ok(guidance.includes(authority), `${authority} is missing`);
    }
    assert.match(guidance, /bókun 35/);
  });

  test("does not restate what the general method already says", () => {
    // A field section earns its tokens by saying what no general method could
    // know. Repeating the general rules costs a round's worth of prompt and
    // moves emphasis off the specialist point that is the only reason it is here.
    assert.doesNotMatch(guidance, /research_complete/);
    assert.doesNotMatch(guidance, /read_decision|read_provision/);
    assert.doesNotMatch(guidance, /find_citing_cases|cases_citing_provision/);
    assert.doesNotMatch(guidance, /haestirettur|landsrettur|heradsdomar/);
    assert.doesNotMatch(guidance, /Nothing you have not opened/);
  });

  test("does not put back the general tracing of advisory opinions", () => {
    // The skill document requires specific pairs — E-9/97 with Hrd. 236/1999,
    // E-5/21 with Hrd. 50/2025 — and deliberately does not require every EFTA
    // Court advisory opinion to be chased into the national proceedings that
    // followed it. "Follow what you find" in the general method covers the rest.
    assert.doesNotMatch(
      guidance,
      /advisory opinions?[^.]*(?:since|subsequent|afterwards|national proceedings)/i
    );
  });
});

describe("the field registry", () => {
  test("every field names a document that exists", () => {
    // The documents are the source of truth and they will be revised. A key
    // pointing at a path that no longer exists is a distillation nobody can
    // check against the thing it was distilled from.
    for (const skill of RESEARCH_SKILLS) {
      assert.ok(existsSync(join(process.cwd(), skill.doc)), `${skill.key}: ${skill.doc} is missing`);
    }
  });

  test("a section is rendered under its own heading", () => {
    const [section] = researchSkillSections(ask({ sourceCategories: ["eu"] }));
    assert.ok(section?.startsWith(EU_EEA?.heading ?? "—"));
  });
});

describe("the composed system prompt", () => {
  test("puts field guidance after the general method and before the hard rules", () => {
    // Order is meaning here: a field adds method, and must not read as though it
    // could loosen what counts as a source or let the loop finish early.
    const prompt = researchSystem(ask({ standalone: "Er tilskipunin tekin upp í EES-samninginn?" }));
    const method = prompt.indexOf("HOW AN ICELANDIC LAWYER WORKS THIS");
    const field = prompt.indexOf(EU_EEA?.heading ?? "—");
    const rules = prompt.indexOf("THE ONE HARD RULE");
    assert.ok(method >= 0 && field > method && rules > field, `${method} ${field} ${rules}`);
  });

  test("a domestic question still gets the whole general prompt", () => {
    const prompt = researchSystem(ask({}));
    assert.doesNotMatch(prompt, /EU AND EEA LAW/);
    assert.match(prompt, /Nothing you have not opened can be cited/);
    assert.match(prompt, /You MUST call research_complete/);
    assert.match(prompt, /HOW AN ICELANDIC LAWYER WORKS THIS/);
  });
});
