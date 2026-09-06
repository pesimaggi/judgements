/**
 * The shapes the well (the "ask" feature) passes between its stages — plan,
 * retrieve, rank, answer, verify — and out to the browser.
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
 * The families of material the plan can ask for. Not the same thing as a
 * source key — a plan says "this is a question about legislation and the
 * administrative boards", and retrieval decides which of the fifty source keys
 * that means.
 */
export type AskSourceCategory =
  | "legislation"
  | "decisions"
  | "administrative"
  | "eu"
  | "commentary";

export const ASK_SOURCE_CATEGORIES: AskSourceCategory[] = [
  "legislation",
  "decisions",
  "administrative",
  "eu",
  "commentary",
];

/**
 * What the planning stage turns a question into.
 *
 * The corpus is Icelandic (and, for the EU acts, English); the question may be
 * in either. So the plan's job is to produce the words the *corpus* uses, not
 * the words the question used — "how do I become an Icelandic citizen" has to
 * come out as `ríkisborgararéttur`, `veiting ríkisborgararéttar`, or the
 * search finds nothing at all.
 *
 * It is also, now, a plan for *several* searches rather than one. The fields
 * below are separated because they are searched differently: a quoted phrase
 * has to match as a phrase, a case number has to match exactly, and a concept
 * is one of several alternative names for the same subject. Folding all of
 * them into one OR query — which is what `terms` was — means the case number
 * competes with the synonyms and usually loses.
 */
export interface QueryPlan {
  /**
   * The flat term list, kept for the callers and tests that predate the split.
   * Derived from `concepts` and `phrases` when the model gives those instead.
   */
  terms: string[];
  /** Acts the question is probably about, named as they would be cited. */
  actQueries: string[];
  /** Specific provisions named or implied: "5. gr. laga nr. 100/1952". */
  provisionQueries: string[];
  /** The legal concepts, in the corpus's own language. */
  concepts: string[];
  /** Phrases that must match as phrases — a term of art, or a user's quote. */
  phrases: string[];
  /** Decisions named in the question: case numbers, case names. */
  decisionQueries: string[];
  /** Which families of material the question calls for. */
  sourceCategories: AskSourceCategory[];
  /** A date or year the *user* supplied, ISO-ish, or null. Never invented. */
  date: string | null;
  /**
   * True when answering properly would need the law as it stood at some past
   * time. The corpus holds current consolidated legislation only, so this is
   * a limitation to carry into the answer, not a retrieval mode.
   */
  historical: boolean;
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

/**
 * What kind of thing a numbered source is.
 *
 * The four are kept apart because they carry different weight: legislation is
 * the law, a decision is a court applying it, an opinion is a body's view of
 * it, and commentary is somebody's argument about it. A model handed all four
 * without labels will cite the fourth as if it were the first.
 */
export type AskSourceKind = "act" | "provision" | "decision" | "opinion" | "commentary";

/** How much weight the institution behind a source carries. */
export type AskAuthorityTier =
  | "supreme" // Hæstiréttur, CJEU
  | "appellate" // Landsréttur, EFTA Court, General Court
  | "first-instance" // héraðsdómar, Félagsdómur
  | "administrative" // úrskurðarnefndir, yfirskattanefnd, ESA
  | "oversight" // Umboðsmaður Alþingis
  | "commentary" // journals
  | "legislation";

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
  /** The court, board or institution behind it, where there is one. */
  authority?: string;
  /** Which tier that institution sits in. */
  tier?: AskAuthorityTier;
  /** ISO date, where the source has one. */
  date?: string;
  /** "is" | "eu" — which corpus it came from. */
  jurisdiction?: string;
  /**
   * The passage this source was selected for, so the UI can show the evidence
   * under the citation rather than making the reader open the document to find
   * out why it is here.
   */
  excerpt?: string;
  /** The deterministic ranking score, for the eval harness and for debugging. */
  score?: number;
}

/** What a citation check found wrong, and what was done about it. */
export interface AskValidationIssue {
  kind:
    | "nonexistent-citation"
    | "uncited-claim"
    | "unsupported-claim"
    | "contradicted-claim"
    | "partially-supported-claim";
  /** The citation number at fault, where the issue is about one. */
  n?: number;
  /** The sentence at fault, trimmed. Kept for the response, never logged. */
  claim?: string;
  /** "removed" | "qualified" | "flagged" — what the pipeline did with it. */
  action: "removed" | "qualified" | "flagged";
}

export interface AskResponse {
  answer: string;
  sources: AskSource[];
  /** The question as the planner restated it — shown when it differs. */
  standalone?: string;
  /** Which language the answer came back in, for the UI's own labels. */
  language: "is" | "en";
  /**
   * True when the well declined to answer from what it found — a question that
   * is not legal, or a search that came back empty. Measured by the eval
   * harness, because abstaining at the right moment is a feature.
   */
  abstained?: boolean;
  /**
   * Limitations that the answer itself states, carried out separately so the
   * UI can show them and the eval harness can check them. Today the only one
   * is the historical-law limitation.
   */
  limitations?: string[];
  /** What deterministic (and, when on, model-assisted) validation found. */
  issues?: AskValidationIssue[];
  /**
   * An opaque id shared with the metrics line for this request. It is what a
   * feedback submission refers to, and it carries nothing about the question.
   */
  requestId?: string;
}
