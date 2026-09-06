/**
 * Citation validation: the part that does not take the model's word for it.
 *
 * The answer stage asks for a citation on every proposition of law, and asking
 * is most of what works. What it cannot do is *check*, and the two failures it
 * cannot catch are the two that matter:
 *
 *   a citation to a source that does not exist — "[11]" when ten came back,
 *   which reads exactly like a real citation and links nowhere;
 *
 *   a sentence stating a rule with no citation at all, which reads exactly
 *   like the sentences around it that have one.
 *
 * Both are caught here, deterministically, with no second model call. The one
 * rule the fixes obey: **an invalid citation is never turned into a different
 * source.** Renumbering "[11]" to "[1]" would produce a sentence that looks
 * supported and is not, which is worse than the invalid marker it replaced.
 * So an invalid citation is removed, and the sentence it was propping up is
 * qualified or dropped.
 *
 * The optional model-assisted verifier in lib/ask/verify.ts runs *after* this
 * and never instead of it.
 */
import { splitSentences } from "../judgment-text";
import { wordAlternation } from "../word-boundary";
import type { AskSource, AskValidationIssue } from "./types";

/**
 * Citations as the model is told to write them, "[3]", and as it sometimes
 * writes them anyway: "[3, 7]" and "[3; 7]". The same shape lib/ask/render.ts
 * renders, deliberately — a marker one of them accepts and the other does not
 * would be validated and then not rendered, or rendered and never validated.
 */
export const CITATION_RE = /\[(\d{1,2}(?:\s*[,;]\s*\d{1,2})*)\]/g;

/** Every source number the answer cites, in the order it first cites them. */
export function citedNumbers(answer: string): number[] {
  const found: number[] = [];
  for (const match of answer.matchAll(CITATION_RE)) {
    for (const part of match[1].split(/[,;]/)) {
      const n = Number(part.trim());
      if (Number.isInteger(n) && !found.includes(n)) found.push(n);
    }
  }
  return found;
}

/**
 * Sentences that state a rule rather than describe the search.
 *
 * The markers are the normative vocabulary of both languages — the modal verbs
 * legislation is written in, plus the shapes a citation to an instrument takes.
 * Deliberately a recogniser rather than a classifier: a false positive costs a
 * sentence a qualifier it did not need, and a false negative lets an unsupported
 * statement of law through, which is the failure this exists to catch.
 */
const LEGAL_PROPOSITION = wordAlternation([
  // Icelandic. "ber" takes an adverb between it and "að" often enough
  // ("ber ávallt að greiða") that requiring them adjacent misses the
  // commonest way an obligation is written.
  "skal", "skulu", "ber\\s+(?:\\S+\\s+)?að", "á\\s+rétt\\s+á", "eiga\\s+rétt",
  "(?:er|sé|væri|verður)\\s+(?:\\S+\\s+)?(?:heimilt|óheimilt|skylt|bannað|áskilið)",
  "má\\s+(?:ekki|aðeins|því\\s+aðeins)", "verður\\s+að", "kveð(?:a|ur)\\s+á\\s+um",
  "gild(?:a|ir)", "skilyrði", "krefst", "krafist", "óheimilt", "heimilt",
  // English.
  "shall", "must", "may\\s+not", "may\\s+only",
  "(?:is|are)\\s+(?:required|entitled|prohibited|obliged)",
  "requires", "provides\\s+that", "obliges",
]);

/** The shapes an authority identifier takes, in either corpus. */
const AUTHORITY_IDENTIFIER =
  /\b(?:\d{1,3}\.\s*gr\.|\d{1,2}\.\s*mgr\.|lög(?:um|a|unum)?\s+nr\.\s*\d+\/\d{4}|nr\.\s*\d+\/\d{4}|[Aa]rticle\s+\d+|Regulation\s+\(E[UC]\)|Directive\s+\d{4}\/\d+|Hrd\.|Lrd\.)/;

/**
 * True when the sentence asserts something about the law — either in the
 * normative vocabulary, or by naming an instrument, which is a statement about
 * that instrument whatever verb it uses.
 */
export function statesLegalProposition(sentence: string): boolean {
  const text = sentence.trim();
  if (text.length < 25) return false;
  return LEGAL_PROPOSITION.test(text) || AUTHORITY_IDENTIFIER.test(text);
}

/** Authority identifiers named in the text — for "did it invent this one?". */
export function authorityIdentifiers(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/\b(?:lög(?:um|a|unum)?\s+)?nr\.\s*(\d{1,4}\/\d{4})/gi)) {
    found.add(`nr. ${m[1]}`);
  }
  for (const m of text.matchAll(/\b(\d{1,3})\.\s*gr\./g)) found.add(`${m[1]}. gr.`);
  for (const m of text.matchAll(/\bArticle\s+(\d{1,3})\b/gi)) found.add(`Article ${m[1]}`);
  return Array.from(found);
}

/**
 * The answer's non-empty lines: a heading, a paragraph, or one bullet each.
 * The model is told to write in exactly those three shapes (see
 * lib/ask/render.ts), so a line is a block and no parser is needed.
 */
function blocksOf(answer: string): string[] {
  return answer.split("\n").filter((line) => line.trim() !== "");
}

export interface CitationCheck {
  /** The answer with invalid citations removed and unsupported claims marked. */
  answer: string;
  issues: AskValidationIssue[];
  /** The numbers that survived and really exist. */
  cited: number[];
}

/** What a qualified claim is marked with, in the answer's own language. */
export function unsupportedMarker(language: "is" | "en"): string {
  return language === "is"
    ? " (óstaðfest: engin heimild úr safninu styður þessa setningu)"
    : " (unverified: no retrieved source supports this sentence)";
}

/**
 * The words a qualifier is recognised by, in either language.
 *
 * Exported because the evaluation harness has to be able to tell a sentence
 * the pipeline disclaimed from one it let through — an article number inside a
 * sentence marked "óstaðfest" has been handled, and counting it as an invented
 * citation would be counting the fix as the failure.
 */
export const QUALIFIER_MARKERS = ["óstaðfest:", "unverified:", "athugið:", "note:"] as const;

/** True when this sentence or line already carries one of those qualifiers. */
export function isQualified(text: string): boolean {
  const lower = text.toLowerCase();
  return QUALIFIER_MARKERS.some((m) => lower.includes(m));
}

/**
 * The deterministic pass. Always runs, whatever else is switched on.
 *
 * Two changes are made to the text, and only two:
 *
 *  1. A citation to a number no source carries is deleted. Never rewritten.
 *  2. A paragraph that states law and cites nothing gets a visible qualifier,
 *     so the reader is told that this particular sentence is the model's and
 *     not the corpus's.
 *
 * Everything else is reported and left alone: a sentence with no citation of
 * its own inside a paragraph that does cite is flagged for the metrics and the
 * evaluation harness, not rewritten, because "the citation is at the end of
 * the paragraph" is ordinary legal writing rather than a defect.
 */
export function validateCitations(
  answer: string,
  sources: AskSource[],
  language: "is" | "en" = "is"
): CitationCheck {
  const valid = new Set(sources.map((s) => s.n));
  const issues: AskValidationIssue[] = [];
  /** Offsets, in the cleaned text, where a citation was deleted. */
  const strippedAt: number[] = [];

  // ---- 1. citations to sources that do not exist --------------------------
  let shift = 0;
  const cleaned = answer.replace(CITATION_RE, (whole: string, group: string, at: number) => {
    const numbers = group.split(/[,;]/).map((p) => Number(p.trim()));
    const kept = numbers.filter((n) => valid.has(n));
    for (const n of numbers) {
      if (!valid.has(n)) {
        issues.push({ kind: "nonexistent-citation", n, action: "removed" });
      }
    }
    // Never remapped: a marker pointing at a source that was never retrieved
    // is deleted outright, and what it was supporting is dealt with below.
    const replacement = kept.length ? `[${kept.join("][")}]` : "";
    if (kept.length < numbers.length) strippedAt.push(at + shift);
    shift += replacement.length - whole.length;
    return replacement;
  });

  // ---- 2. propositions of law with nothing behind them --------------------
  const out: string[] = [];
  let lineStart = 0;
  for (const line of cleaned.split("\n")) {
    const lineStart2 = lineStart;
    lineStart += line.length + 1;
    const trimmed = line.trim();

    // Headings carry no propositions, and marking one would be noise.
    if (trimmed.startsWith("## ") || !trimmed) {
      out.push(line);
      continue;
    }

    const blockCites = citedNumbers(line);
    const claims = splitSentences(stripMarkup(trimmed)).filter(statesLegalProposition);
    if (claims.length === 0) {
      out.push(line);
      continue;
    }

    if (blockCites.length === 0) {
      for (const claim of claims) {
        issues.push({ kind: "uncited-claim", claim: claim.trim(), action: "qualified" });
      }
      out.push(`${line.replace(/\s+$/, "")}${unsupportedMarker(language)}`);
      continue;
    }

    // The paragraph cites something. A sentence inside it that lost its only
    // citation to the check above is a different case from one that never had
    // one: it was resting on a source that does not exist, so it is qualified
    // in the text rather than merely reported. Everything else is reported and
    // left alone, because "the citation is at the end of the paragraph" is
    // ordinary legal writing rather than a defect.
    let rewritten = line;
    for (const sentence of splitSentences(trimmed)) {
      if (!statesLegalProposition(sentence) || citedNumbers(sentence).length > 0) continue;
      const claim = stripMarkup(sentence).trim();
      const at = lineStart2 + line.indexOf(sentence);
      const lostACitation =
        line.includes(sentence) &&
        strippedAt.some((offset) => offset >= at && offset <= at + sentence.length);

      if (lostACitation && !isQualified(sentence)) {
        const end = rewritten.indexOf(sentence) + sentence.length;
        rewritten = `${rewritten.slice(0, end)}${unsupportedMarker(language)}${rewritten.slice(end)}`;
        issues.push({ kind: "uncited-claim", claim, action: "qualified" });
      } else {
        issues.push({ kind: "uncited-claim", claim, action: "flagged" });
      }
    }
    out.push(rewritten);
  }

  const finalAnswer = tidy(out.join("\n"));
  return { answer: finalAnswer, issues, cited: citedNumbers(finalAnswer) };
}

/** Bold markers and citation markers, removed so a claim reads as prose. */
export function stripMarkup(text: string): string {
  return text.replace(CITATION_RE, "").replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Cleans up after a deletion: a removed citation leaves a space before the
 * full stop, and a sentence that was nothing but a citation leaves a gap.
 */
function tidy(text: string): string {
  return text
    .replace(/[ \t]+([.,;:])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * The claims a verifier would be asked about: a sentence that states law,
 * together with the sources it cites.
 *
 * Only cited claims are returned. An uncited one has no evidence to check
 * against — `validateCitations` has already dealt with it — and sending it to
 * a verifier with the whole context attached is how a verifier ends up
 * inventing the support it was meant to be checking for.
 */
export interface Claim {
  text: string;
  cites: number[];
}

/** What a verifier can say about one claim. */
export type ClaimVerdict = "supported" | "partial" | "unsupported" | "contradicted";

export function extractClaims(answer: string): Claim[] {
  const claims: Claim[] = [];
  for (const block of blocksOf(answer)) {
    const trimmed = block.trim();
    if (!trimmed || trimmed.startsWith("## ")) continue;
    for (const sentence of splitSentences(trimmed)) {
      const cites = citedNumbers(sentence);
      if (cites.length === 0) continue;
      const text = stripMarkup(sentence);
      if (text.length >= 25 && statesLegalProposition(text)) claims.push({ text, cites });
    }
  }
  return claims;
}

/**
 * Applies a verifier's verdicts to the answer.
 *
 * "unsupported" and "contradicted" are qualified in place — the sentence stays
 * visible with its qualifier, rather than vanishing and leaving an argument
 * with a hole in it. "partial" is reported and left alone: partially supported
 * is what most correct legal writing is.
 *
 * Claims are matched back to the answer the same way they were taken out of
 * it — block, then sentence, then `stripMarkup` — so the sentence a verdict
 * lands on is exactly the sentence the verifier was shown, and a claim that no
 * longer matches anything is reported rather than guessed at.
 */
export function applyVerdicts(
  answer: string,
  verdicts: { claim: string; verdict: ClaimVerdict }[],
  language: "is" | "en"
): { answer: string; issues: AskValidationIssue[] } {
  const issues: AskValidationIssue[] = [];
  const wanted = new Map<string, ClaimVerdict>();
  for (const { claim, verdict } of verdicts) {
    if (verdict === "supported") continue;
    if (verdict === "partial") {
      issues.push({ kind: "partially-supported-claim", claim, action: "flagged" });
      continue;
    }
    wanted.set(claim, verdict);
  }
  if (wanted.size === 0) return { answer, issues };

  const applied = new Set<string>();
  const lines = answer.split("\n").map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("## ")) return line;

    let out = line;
    for (const sentence of splitSentences(trimmed)) {
      const claim = stripMarkup(sentence);
      const verdict = wanted.get(claim);
      if (!verdict || applied.has(claim)) continue;

      const at = out.indexOf(sentence);
      if (at === -1) continue;
      const end = at + sentence.length;
      const marker =
        verdict === "contradicted" ? contradictedMarker(language) : unsupportedMarker(language);
      out = `${out.slice(0, end)}${marker}${out.slice(end)}`;
      applied.add(claim);
      issues.push({ kind: verdictKind(verdict), claim, action: "qualified" });
    }
    return out;
  });

  // A claim the verifier returned that no longer matches a sentence — the
  // answer was edited between the two passes, or the verifier paraphrased.
  // Reported, never guessed at: inserting a qualifier in the wrong place is
  // worse than not inserting one.
  for (const [claim, verdict] of wanted) {
    if (!applied.has(claim)) issues.push({ kind: verdictKind(verdict), claim, action: "flagged" });
  }

  return { answer: lines.join("\n"), issues };
}

function verdictKind(verdict: ClaimVerdict): AskValidationIssue["kind"] {
  return verdict === "contradicted" ? "contradicted-claim" : "unsupported-claim";
}

function contradictedMarker(language: "is" | "en"): string {
  return language === "is"
    ? " (athugið: tilvitnuð heimild virðist ganga gegn þessari setningu)"
    : " (note: the cited source appears to contradict this sentence)";
}
