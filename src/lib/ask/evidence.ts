/**
 * Evidence windows: the part of a judgment an answer is actually allowed to
 * rest on.
 *
 * The well used to hand the model a search snippet — twenty-eight words either
 * side of a matched term, chosen by `ts_headline` for looking good on a result
 * card. That is enough to know a judgment is about the right subject and
 * nowhere near enough to say what it held, so an answer built on snippets
 * either says nothing about the case or says something nobody can check.
 *
 * What a judgment is actually worth citing for is in four places, and this
 * module goes and gets all four:
 *
 *   matched     the passage the search matched, with room around it — the
 *               reason this document is here at all.
 *   summary     the court's own útdráttur, where it wrote one. The court's
 *               summary of its own case beats anything we could compose.
 *   reasoning   the "Niðurstaða" section: why it came out the way it did.
 *   holding     "Dómsorð" / "Úrskurðarorð": what was actually ordered.
 *
 * Each is labelled, because the difference between them is the difference
 * between what a party argued, what the court reasoned and what it decided —
 * and a model given four unlabelled paragraphs will happily attribute the
 * first to the last.
 *
 * Nothing here sends a whole judgment. Óbyggðanefnd's rulings run to several
 * hundred pages; the budgets below are what a reader would actually read.
 */
import {
  extractSummary,
  extractReasoning,
  extractHolding,
  splitSentences,
  truncateByParagraph,
} from "../judgment-text";

/** How much text each labelled part of a decision may contribute. */
export interface EvidenceBudget {
  /** Characters of surrounding text around the matched passage, in total. */
  window: number;
  summary: number;
  reasoning: number;
  holding: number;
}

export const DEFAULT_EVIDENCE_BUDGET: EvidenceBudget = {
  window: 1200,
  summary: 1500,
  reasoning: 2000,
  holding: 800,
};

export interface DecisionEvidence {
  /** The matched passage with its surroundings, or the snippet as a fallback. */
  matched: string | null;
  /**
   * True when `matched` was located in the stored text rather than copied from
   * the search snippet — the difference between a real window and a headline
   * fragment.
   */
  matchedInFullText: boolean;
  summary: string | null;
  reasoning: string | null;
  holding: string | null;
}

/** The <mark> tags a search snippet carries are for the page, not the model. */
export function stripMarks(html: string): string {
  return html.replace(/<\/?mark>/g, "").replace(/\s+/g, " ").trim();
}

/** The terms `ts_headline` marked, longest first — what the search matched on. */
export function markedTerms(snippet: string): string[] {
  const terms = Array.from(snippet.matchAll(/<mark>(.*?)<\/mark>/g), (m) => m[1].trim()).filter(
    (t) => t.length > 2
  );
  return Array.from(new Set(terms)).sort((a, b) => b.length - a.length);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Where in the stored text a term occurs, matching across line breaks.
 *
 * Whitespace in the needle is matched as "any run of whitespace" because the
 * two sides disagree about it: the snippet has been collapsed to single
 * spaces, and the stored judgment may still carry the line breaks the PDF put
 * in the middle of the phrase.
 */
function findTerm(text: string, term: string): number {
  const pattern = term.split(/\s+/).map(escapeRe).join("\\s+");
  try {
    return new RegExp(pattern, "iu").exec(text)?.index ?? -1;
  } catch {
    return -1;
  }
}

/**
 * Snaps an offset out to the nearest boundary a reader would recognise: a
 * paragraph break if one is close, otherwise the start of a sentence.
 *
 * Without this the window opens mid-clause, which for legal prose is worse
 * than useless — "…ekki er heimilt að" and "…er heimilt að" are one word apart
 * and opposite.
 */
function snapStart(text: string, at: number): number {
  const paragraph = text.lastIndexOf("\n", at);
  if (paragraph !== -1 && at - paragraph < 400) return paragraph + 1;

  const before = text.slice(Math.max(0, at - 400), at);
  const sentences = splitSentences(before);
  if (sentences.length > 1) return at - sentences[sentences.length - 1].length;
  return Math.max(0, at);
}

function snapEnd(text: string, at: number): number {
  const paragraph = text.indexOf("\n", at);
  if (paragraph !== -1 && paragraph - at < 400) return paragraph;

  const after = text.slice(at, at + 400);
  const sentences = splitSentences(after);
  if (sentences.length > 1) return at + sentences[0].length;
  const stop = after.search(/[.!?…]\s/);
  return stop === -1 ? Math.min(text.length, at) : at + stop + 1;
}

/**
 * The passage around the first term that can be found, with `window`
 * characters of context in total, snapped to boundaries at both ends.
 *
 * Returns null when none of the terms occur in the text — which happens
 * legitimately (the search matched on a stem, or on the title) and is why the
 * caller keeps the snippet as a fallback rather than treating this as a
 * failure.
 */
export function evidenceWindow(
  fullText: string,
  terms: string[],
  window = DEFAULT_EVIDENCE_BUDGET.window
): string | null {
  if (!fullText?.trim() || terms.length === 0) return null;

  for (const term of terms) {
    const at = findTerm(fullText, term);
    if (at === -1) continue;

    const half = Math.floor(window / 2);
    const start = snapStart(fullText, Math.max(0, at - half));
    const end = snapEnd(fullText, Math.min(fullText.length, at + term.length + half));
    const passage = fullText.slice(start, end).replace(/[ \t]+/g, " ").trim();
    if (passage.length >= 40) return truncateByParagraph(passage.split(/\n+/), window);
  }
  return null;
}

export interface DecisionEvidenceInput {
  /** The stored judgment, in full. Never sent on as-is. */
  fullText?: string | null;
  /** The search snippet, which may carry <mark> tags. */
  snippet?: string | null;
  /** The summary the search provider already extracted, where it did. */
  summary?: string | null;
  /** Extra terms to locate, when the snippet carries no marks — the plan's. */
  terms?: string[];
}

/**
 * The four labelled parts, for one decision.
 *
 * Order of preference for the matched passage: the marked terms from the
 * snippet (what the search actually matched), then the plan's own terms, then
 * the snippet itself. The last is what the well used to send and is still
 * better than nothing.
 */
export function buildDecisionEvidence(
  input: DecisionEvidenceInput,
  budget: EvidenceBudget = DEFAULT_EVIDENCE_BUDGET
): DecisionEvidence {
  const fullText = input.fullText ?? "";
  const snippet = input.snippet ?? "";

  const needles = [...markedTerms(snippet), ...(input.terms ?? [])].filter(Boolean);
  const located = fullText ? evidenceWindow(fullText, needles, budget.window) : null;
  const fallback = snippet ? truncateByParagraph([stripMarks(snippet)], budget.window) : "";

  return {
    matched: located || fallback || null,
    matchedInFullText: located !== null,
    summary: pick(input.summary ?? (fullText ? extractSummary(fullText) : null), budget.summary),
    reasoning: fullText ? extractReasoning(fullText, budget.reasoning) : null,
    holding: fullText ? extractHolding(fullText, budget.holding) : null,
  };
}

function pick(text: string | null, max: number): string | null {
  if (!text?.trim()) return null;
  return truncateByParagraph(text.split(/\n+/), max);
}

/**
 * A provision's text, cut at a paragraph boundary rather than a character
 * count.
 *
 * This is the truncation that matters most in the whole feature. A provision is
 * a rule plus its exceptions, and the exceptions are at the end: cutting "…nema
 * þegar" mid-sentence turns a qualified rule into an absolute one, and the
 * model has no way to know it was cut. So whole málsgreinar are dropped, the
 * fact is stated in the text the model sees, and the reader is sent to the full
 * article.
 *
 * `paragraphs` is Lagasafn's own paragraph split where we have it (the
 * ProvisionParagraph rows); the fallback splits the stored body on its line
 * breaks, which is the same division for everything ingested from Lagasafn.
 */
export function provisionEvidence(
  text: string,
  maxChars: number,
  paragraphs?: string[]
): { text: string; truncated: boolean } {
  const units = paragraphs?.length ? paragraphs : text.split(/\n+/);
  const kept = truncateByParagraph(units, maxChars);
  return { text: kept, truncated: kept.includes("[…]") };
}

/**
 * The EFTA Court's records are the case register, not the judgment — unless
 * the ingest was run with EFTA_FETCH_DOCUMENTS=1.
 *
 * The Court publishes each decision as a PDF under /download/, and its
 * robots.txt disallows that path for every user agent, so the adapter stores
 * the case record by default: parties, subject, the Court's own note about the
 * case, and the list of documents it has published. See
 * src/ingestion/adapters/efta-court.ts.
 *
 * This matters here because the difference is invisible to the answer stage. A
 * register entry reads like a short judgment — it has a "Summary" heading and
 * prose under it — so the well was quoting one as though it were the decision
 * and then reporting, accurately but uselessly, that the sources did not show
 * the outcome. Told what it is holding, it can say the useful thing instead:
 * that the decision text is not in this database and where to read it.
 *
 * Separated by length, which is a clean divide rather than a fine judgement: a
 * register entry runs to a couple of thousand characters, and the same record
 * with the decision appended runs to tens of thousands. When the flag is
 * switched on and the corpus re-ingested, this simply stops firing.
 */
const REGISTER_ONLY_MAX_CHARS = 4_000;

export function isRegisterOnly(sourceKey: string, fullText: string | null | undefined): boolean {
  if (sourceKey !== "eftacourt") return false;
  return (fullText?.trim().length ?? 0) < REGISTER_ONLY_MAX_CHARS;
}

/** Characters that have no business in a judgment and can hide text. */
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u200B-\u200F\u2028\u2029\u202A-\u202E\u2066-\u2069]/g;

/**
 * Everything the model is shown about a source is quoted from a document
 * somebody else wrote. This strips the shapes that would let one of those
 * documents give instructions instead of evidence.
 *
 * Not a claim to have solved prompt injection — nothing at this layer is. It
 * removes the specific things that would otherwise be indistinguishable from
 * this app's own framing: our block delimiters, our citation markers, and the
 * role labels an instruction would have to wear to be read as one.
 */
export function sanitizeEvidence(text: string): string {
  return text
    .replace(CONTROL_CHARS, " ")
    // This module's own fences, so a document cannot close the block it is in.
    .replace(/<<<\/?[A-Za-z0-9_ -]{0,40}>>>/g, " ")
    // A bracketed number in source text reads exactly like a citation marker.
    .replace(/\[(\d{1,2})\]/g, "($1)")
    // Role labels and the classic override, at the start of a line.
    .replace(/^[ \t]*(system|assistant|user|developer)[ \t]*:/gim, "$1 —")
    .replace(/ignore\s+(?:all\s+|any\s+)?(?:previous|prior|above|earlier)\s+(?:instructions|rules|prompts?)/gi, "[…]")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
