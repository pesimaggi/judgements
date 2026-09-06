/**
 * The fixture format for evaluating the well's *answers*.
 *
 * Deliberately separate from `src/search-eval`, which measures whether the
 * right documents come back for a query. This measures something else: given
 * documents, does the answer stay inside them. The two fail independently —
 * perfect retrieval with an answer that cites source 11 out of ten is a
 * failure of this file's kind, and it is the kind that reaches a reader
 * looking exactly like a correct answer.
 *
 * NOTHING REAL GOES IN A FIXTURE. Every question here is written for the
 * fixture set. No client question, no question anybody actually asked the
 * deployed well, no facts of anybody's case, no names. A question about
 * dismissal without notice is written as a question about the law, never as
 * "my employer did X". This is committed to a public repository.
 */

/** What a fixture asserts about the answer to its question. */
export interface AskFixture {
  id: string;
  /** A short note on what this fixture is holding down. */
  note?: string;
  /** Grouping for the report: "abstention", "citation", "historical", … */
  category: string;
  split?: "development" | "holdout";

  question: string;
  /** The language the answer must come back in. */
  language: "is" | "en";

  /**
   * Identifiers that must appear among the retrieved sources — an act number,
   * a provision label, a case number. Matched as substrings against each
   * source's title, subtitle and path, because the same provision is named
   * three slightly different ways in three places.
   */
  expectSources?: string[];
  /** Identifiers that must NOT be cited. A source that is wrong, not merely absent. */
  forbiddenSources?: string[];
  /** Substrings the answer must contain — the points it has to make. */
  requiredPoints?: string[];
  /** Substrings the answer must not contain — conclusions it must not draw. */
  prohibitedConclusions?: string[];
  /** True when the right answer is to decline: no sources, or not a legal question. */
  expectAbstention?: boolean;
  /** True when the answer has to say that historical law is not held here. */
  expectHistoricalLimitation?: boolean;

  /**
   * The recorded run. Present on every fixture that the offline mode can
   * score: the plan the planner produced, the sources retrieval returned, the
   * context it built, and the answer the model wrote. With these, the whole
   * pipeline after retrieval runs for free and with no network.
   */
  recorded?: RecordedRun;
}

export interface RecordedSource {
  n: number;
  kind: "act" | "provision" | "decision" | "opinion" | "commentary";
  title: string;
  subtitle: string;
  path: string;
  authority?: string;
  date?: string;
  jurisdiction?: string;
  /** The evidence text this source contributed, as the model saw it. */
  evidence?: string;
}

export interface RecordedRun {
  /** The planner's output. Fed to `parsePlan`, so it is validated like a real one. */
  plan: Record<string, unknown>;
  sources: RecordedSource[];
  /** The answer the model wrote for this context. Scored as written. */
  answer: string;
  /** Which provider and model produced it, for the report. */
  provider?: string;
  model?: string;
}

export interface FixtureSet {
  version: number;
  fixtures: AskFixture[];
}
