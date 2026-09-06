/**
 * What a reader can tell us about an answer, and what we are allowed to keep.
 *
 * The seven kinds below are the seven things that actually go wrong with a
 * retrieval-grounded legal answer, and each one points at a different stage:
 * "wrong source" and "missing source" are retrieval and ranking, "citation
 * does not support" is the answer stage or the verifier, "missed exception" is
 * usually truncation, "too vague" is effort, "incorrect conclusion" is the one
 * that needs a lawyer to look at it. A single thumbs-down would tell us none of
 * that.
 *
 * The privacy rule is in the Prisma model and enforced here: submitting
 * feedback stores the *shape* of the answer and the button that was pressed.
 * The question is stored only when the reader explicitly asks for it to be.
 */

export const FEEDBACK_KINDS = [
  "helpful",
  "wrong-source",
  "missing-source",
  "citation-unsupported",
  "missed-exception",
  "too-vague",
  "incorrect-conclusion",
] as const;

export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

export function isFeedbackKind(value: unknown): value is FeedbackKind {
  return typeof value === "string" && (FEEDBACK_KINDS as readonly string[]).includes(value);
}

/** The labels the panel shows, in both languages the well answers in. */
export const FEEDBACK_LABELS: Record<FeedbackKind, { is: string; en: string }> = {
  helpful: { is: "Gagnlegt", en: "Helpful" },
  "wrong-source": { is: "Röng heimild", en: "Wrong source" },
  "missing-source": { is: "Vantar heimild", en: "Important source missing" },
  "citation-unsupported": {
    is: "Tilvísun styður ekki fullyrðinguna",
    en: "Citation does not support the claim",
  },
  "missed-exception": { is: "Undantekning vantar", en: "Missed an exception" },
  "too-vague": { is: "Of almennt", en: "Too vague" },
  "incorrect-conclusion": { is: "Röng niðurstaða", en: "Incorrect conclusion" },
};

/** Free text is capped: a report, not a document. */
export const MAX_NOTE_CHARS = 500;

export interface FeedbackSubmission {
  requestId: string;
  kind: FeedbackKind;
  sourceN?: number;
  language?: string;
  provider?: string;
  model?: string;
  effort?: string;
  sources?: number;
  cited?: number;
  /** Only present when the reader ticked the box. */
  question?: string;
  note?: string;
}

/**
 * Narrows an untrusted body to a submission, dropping everything it does not
 * recognise. In particular, `question` survives only when `shareQuestion` is
 * explicitly true — a client that sends the question without asking for it to
 * be kept does not get it kept.
 */
export function parseFeedback(input: unknown): FeedbackSubmission | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;

  const requestId = typeof raw.requestId === "string" ? raw.requestId.trim() : "";
  if (!requestId || requestId.length > 100) return null;
  if (!isFeedbackKind(raw.kind)) return null;

  const shareQuestion = raw.shareQuestion === true;
  const text = (value: unknown, max: number): string | undefined => {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed ? trimmed.slice(0, max) : undefined;
  };
  const int = (value: unknown, min: number, max: number): number | undefined => {
    const n = Number(value);
    if (!Number.isInteger(n) || n < min || n > max) return undefined;
    return n;
  };

  return {
    requestId,
    kind: raw.kind,
    sourceN: int(raw.sourceN, 1, 99),
    language: raw.language === "en" ? "en" : raw.language === "is" ? "is" : undefined,
    provider: text(raw.provider, 40),
    model: text(raw.model, 80),
    effort: text(raw.effort, 20),
    sources: int(raw.sources, 0, 99),
    cited: int(raw.cited, 0, 99),
    question: shareQuestion ? text(raw.question, 600) : undefined,
    note: text(raw.note, MAX_NOTE_CHARS),
  };
}
