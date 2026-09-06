/**
 * How hard is this question, decided without asking a model.
 *
 * The well's answer stage is the expensive call, and how hard the model is
 * asked to think on it is the single biggest lever on both latency and cost.
 * Running every question at one fixed effort gets that wrong in both
 * directions: "hvað er stjórnsýslulög" waits for reasoning it does not need,
 * and "does the EEA Agreement change how 5. gr. applies to a contract made in
 * 2009" gets the same budget as the trivial one.
 *
 * Deliberately deterministic and deliberately cheap. A model call to decide
 * how hard to think is a model call, and the signals below are all visible in
 * the question and in what retrieval actually came back with.
 *
 * The classifier never reaches for "high" and above. Those levels exist and
 * are configurable — `ASK_EFFORT_COMPLEX=high` is a decision somebody can make
 * on a dashboard — but nothing here escalates into them on its own: the
 * failure mode of an automatic escalation is a question that quietly costs
 * five times what the last one did.
 */
import { wordAlternation, BEFORE, AFTER } from "../word-boundary";
import type { QueryPlan } from "./types";

/** Why the classifier decided what it decided — logged, and testable. */
export type ComplexitySignal =
  | "multiple-issues"
  | "multiple-acts"
  | "conflicting-sources"
  | "historical-law"
  | "cross-jurisdiction"
  | "decision-comparison"
  | "long-question";

export interface Complexity {
  complex: boolean;
  signals: ComplexitySignal[];
}

/** What the classifier needs to know about what came back from retrieval. */
export interface RetrievalShape {
  /** Distinct acts among the provisions and acts retrieved. */
  distinctActs: number;
  /** Distinct jurisdictions ("is", "eu") among them. */
  jurisdictions: string[];
  /** Decisions retrieved, which is what a comparison would compare. */
  decisions: number;
  /**
   * True when the retrieved sources point in different directions — as far as
   * this can be seen without reading them. See `looksConflicting`.
   */
  conflicting?: boolean;
}

/** Words that join a second, separate legal question to the first. */
const ISSUE_JOINERS = wordAlternation([
  "og\\s+hvað", "og\\s+hvernig", "og\\s+hvenær", "og\\s+hvort", "auk\\s+þess",
  "jafnframt", "einnig\\s+hvort", "and\\s+what", "and\\s+how", "and\\s+whether",
  "as\\s+well\\s+as\\s+whether", "in\\s+addition",
]);

/** A question that asks two courts, two rules or two periods to be compared. */
const COMPARISON = wordAlternation([
  "bera\\s+saman", "samanburð(?:ur|ar|i)?", "munur(?:inn)?\\s+á", "ólíkt", "andstætt",
  "compare", "comparison", "difference\\s+between", "as\\s+opposed\\s+to", "versus",
]);

/** A question that is about the law as it stood, not the law as it stands. */
export const HISTORICAL = wordAlternation([
  "þágildandi", "áður\\s+gildandi", "eldri\\s+lög(?:um|unum)?", "á\\s+þeim\\s+tíma",
  "þá\\s+gildandi", "fyrir\\s+(?:laga)?breytingu(?:na)?", "eins\\s+og\\s+\\S+\\s+hljóðaði",
  "sögulega", "brottfelld(?:um|ra|i)?",
  "historical", "as\\s+it\\s+(?:then\\s+)?stood", "then\\s+in\\s+force", "at\\s+the\\s+time",
  "former\\s+version", "previous\\s+version", "before\\s+the\\s+amendment", "repealed",
]);

/** A question that crosses between Icelandic law and EEA/EU law. */
export const CROSS_JURISDICTION = wordAlternation([
  "ees(?:-\\S+)?", "eea", "esb", "evrópusamband(?:s|ið|inu)?", "European\\s+Union", "EU\\s+law",
  "tilskipun(?:ar|ir|um)?", "directive", "EFTA", "CJEU", "Evrópudómstóll(?:inn)?",
]);

/** Case numbers, for spotting a question that names two decisions. */
const CASE_NUMBER = new RegExp(
  `${BEFORE}[A-Za-zÞÆÖÁÐÉÍÓÚÝþæöáðéíóúý]{0,3}-?\\d{1,5}\\/\\d{2,4}${AFTER}`,
  "gu"
);

/**
 * A question long enough that it is carrying more than one thing. Measured in
 * words rather than characters because Icelandic compounds are long and a
 * forty-character word is still one idea.
 */
const LONG_QUESTION_WORDS = 45;

/**
 * The classification, from the plan and — where it is available — the shape of
 * what retrieval returned.
 *
 * Retrieval is optional so this can be called before it (to decide nothing
 * more than logging) and after it (to choose the answer's effort), which is
 * where it is actually used.
 */
export function classifyComplexity(plan: QueryPlan, retrieval?: RetrievalShape): Complexity {
  const signals: ComplexitySignal[] = [];
  const text = `${plan.standalone} ${plan.concepts.join(" ")}`;

  if (ISSUE_JOINERS.test(plan.standalone) || countQuestions(plan.standalone) > 1) {
    signals.push("multiple-issues");
  }
  if (plan.actQueries.length > 1 || (retrieval?.distinctActs ?? 0) > 2) {
    signals.push("multiple-acts");
  }
  if (retrieval?.conflicting) signals.push("conflicting-sources");
  if (plan.historical || HISTORICAL.test(text)) signals.push("historical-law");
  if (
    CROSS_JURISDICTION.test(text) ||
    (retrieval?.jurisdictions?.length ?? 0) > 1 ||
    plan.sourceCategories.includes("eu")
  ) {
    signals.push("cross-jurisdiction");
  }
  if (
    COMPARISON.test(plan.standalone) ||
    (plan.standalone.match(CASE_NUMBER)?.length ?? 0) > 1 ||
    plan.decisionQueries.length > 1
  ) {
    signals.push("decision-comparison");
  }
  if (wordCount(plan.standalone) > LONG_QUESTION_WORDS) signals.push("long-question");

  // One signal is not complexity. Nearly every question about an Icelandic
  // implementation of a directive trips "cross-jurisdiction", and most of them
  // are still one short answer about one article. Two signals is a question
  // with genuinely more than one thing in it.
  //
  // Except historical law, which on its own changes what the answer has to
  // say — it has to state the limitation, and that is reasoning.
  const complex = signals.length >= 2 || signals.includes("historical-law");
  return { complex, signals };
}

function countQuestions(text: string): number {
  return (text.match(/\?/g) ?? []).length;
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * A rough read on whether the retrieved sources disagree.
 *
 * "Rough" is the honest word: without reading the documents, the visible proxy
 * is that decisions from courts at different levels, or from both an Icelandic
 * court and an EEA/EU one, are in the same result set on the same subject —
 * which is exactly the shape of a question where the answer has to say the
 * sources point in different directions rather than pick one.
 */
export function looksConflicting(sources: { kind: string; authority?: string }[]): boolean {
  const courts = new Set(
    sources.filter((s) => s.kind === "decision" && s.authority).map((s) => s.authority)
  );
  return courts.size >= 3;
}
