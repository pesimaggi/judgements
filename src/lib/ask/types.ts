/**
 * The shapes the well (the "ask" feature) passes between its three stages —
 * plan, retrieve, answer — and out to the browser.
 *
 * Kept apart from lib/types.ts because nothing here is a search result. A
 * search returns rows; the well returns an *argument*, and the sources are
 * what the argument is allowed to rest on.
 */

/** One turn of the conversation, as the browser sends it back. */
export interface AskTurn {
  role: "user" | "assistant";
  content: string;
}

export interface AskRequestBody {
  question: string;
  /** Earlier turns, so "and what about the fee?" resolves against them. */
  history?: AskTurn[];
  /** How much of the EU library the act lookups may see. See lib/acts.ts. */
  scope?: "eea" | "eu";
}

/**
 * What the planning stage turns a question into.
 *
 * The corpus is Icelandic (and, for the EU acts, English); the question may be
 * in either. So the plan's job is to produce the words the *corpus* uses, not
 * the words the question used — "how do I become an Icelandic citizen" has to
 * come out as `ríkisborgararéttur`, `veiting ríkisborgararéttar`, or the
 * search finds nothing at all.
 */
export interface QueryPlan {
  /** Terms for the full-text search, in the corpus's own language. */
  terms: string[];
  /** Acts the question is probably about, named as they would be cited. */
  actQueries: string[];
  /** The language the answer must be written in. */
  language: "is" | "en";
  /**
   * False when the question is not a legal question at all ("hvað er klukkan").
   * The well then says so instead of dredging up whatever the search matched.
   */
  legal: boolean;
  /**
   * The question restated as a standalone one, with anything carried over from
   * earlier turns spelled out. This, not the raw question, is what the answer
   * stage is asked.
   */
  standalone: string;
}

/** What kind of thing a numbered source is. */
export type AskSourceKind = "act" | "provision" | "decision";

/**
 * One numbered source: the unit the model is allowed to cite and the unit the
 * reader can click through to. Every source carries a route into this app, so
 * an answer is never a dead end — the point of citing the provision is that
 * you can go and read it.
 */
export interface AskSource {
  /** 1-based; what "[3]" in the answer refers to. */
  n: number;
  kind: AskSourceKind;
  /** "5. gr. laga nr. 100/1952", "Hrd. 22/2023", the act's title. */
  title: string;
  /** Court and date, act title, provision heading — the second line. */
  subtitle: string;
  /** Route within this app: /log/100-1952#G5, /document/{id}. */
  path: string;
  /** The official source, where the reader must go to verify. */
  officialUrl?: string;
  /** True once the answer text actually cites it. */
  cited: boolean;
}

export interface AskResponse {
  answer: string;
  sources: AskSource[];
  /** The question as the planner restated it — shown when it differs. */
  standalone?: string;
  /** Which language the answer came back in, for the UI's own labels. */
  language: "is" | "en";
}
