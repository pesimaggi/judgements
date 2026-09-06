/**
 * The measurements, as pure functions over an answer and its sources.
 *
 * Kept apart from the runner so they can be unit-tested without a fixture
 * file, a database or a model — which is the only way a metric is worth
 * trusting. A scoring function with a bug reports an improvement that is not
 * there, and nothing downstream would ever notice.
 */
import {
  citedNumbers,
  statesLegalProposition,
  authorityIdentifiers,
  stripMarkup,
  isQualified,
} from "@/lib/ask/citations";
import { splitSentences } from "@/lib/judgment-text";
import type { AskSource } from "@/lib/ask/types";

/** Case- and space-insensitive containment, for matching an identifier. */
function contains(haystack: string, needle: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  return norm(haystack).includes(norm(needle));
}

/** Everything about a source an identifier could plausibly be matched against. */
function sourceText(source: AskSource): string {
  return [source.title, source.subtitle, source.path, source.authority ?? ""].join(" ");
}

/**
 * How many of the sources the fixture expected actually came back.
 *
 * Retrieval recall, at the level the reader cares about: not "was the document
 * in the index" but "did the answer have it in front of it".
 */
export function retrievalRecall(
  sources: AskSource[],
  expected: string[] = []
): { found: string[]; missing: string[]; recall: number } {
  if (expected.length === 0) return { found: [], missing: [], recall: 1 };
  const found: string[] = [];
  const missing: string[] = [];
  for (const id of expected) {
    if (sources.some((s) => contains(sourceText(s), id))) found.push(id);
    else missing.push(id);
  }
  return { found, missing, recall: found.length / expected.length };
}

/** Sources the fixture said must not be cited, that were. */
export function forbiddenCited(sources: AskSource[], forbidden: string[] = []): string[] {
  return forbidden.filter((id) =>
    sources.some((s) => s.cited && contains(sourceText(s), id))
  );
}

/**
 * Citation validity: every `[n]` in the answer points at a source that exists.
 *
 * A failure here should be impossible after `validateCitations` — which is
 * exactly why it is measured. If this is ever below 1, either the validation
 * did not run or something got past it.
 */
export function citationValidity(
  answer: string,
  sources: AskSource[]
): { cited: number[]; invalid: number[]; validity: number } {
  const valid = new Set(sources.map((s) => s.n));
  const cited = citedNumbers(answer);
  const invalid = cited.filter((n) => !valid.has(n));
  return { cited, invalid, validity: cited.length === 0 ? 1 : 1 - invalid.length / cited.length };
}

/**
 * Claim support: of the sentences that state a rule, how many carry a citation.
 *
 * Not a measure of whether the citation is *right* — that needs either the
 * model verifier or a lawyer. It is a measure of whether the answer is the
 * shape this feature requires, and it catches the common failure where the
 * first paragraph summarises the law with no citation at all.
 */
export function claimSupport(answer: string): {
  claims: number;
  supported: number;
  uncited: string[];
  support: number;
} {
  const uncited: string[] = [];
  let claims = 0;
  let supported = 0;

  for (const line of answer.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("## ")) continue;
    const blockCites = citedNumbers(line);
    for (const sentence of splitSentences(trimmed)) {
      const text = stripMarkup(sentence);
      if (!statesLegalProposition(text)) continue;
      claims += 1;
      // A citation anywhere in the paragraph counts: putting one citation at
      // the end of a two-sentence paragraph is ordinary legal writing.
      if (blockCites.length > 0) supported += 1;
      else uncited.push(text);
    }
  }

  return { claims, supported, uncited, support: claims === 0 ? 1 : supported / claims };
}

/**
 * Authority identifiers in the answer that appear in none of the sources.
 *
 * This is the invented-citation check, and it is the single most important
 * number in the report. "5. gr." in an answer whose sources are 3., 8. and 12.
 * gr. is a fabricated article number, and it reads exactly like a real one.
 */
export function inventedAuthorities(
  answer: string,
  sources: AskSource[],
  evidence: string[] = []
): string[] {
  const corpus = [...sources.map(sourceText), ...evidence].join("\n");
  return authorityIdentifiers(withoutQualifiedClaims(answer)).filter((id) => !contains(corpus, id));
}

/**
 * The answer with every disclaimed sentence removed.
 *
 * A sentence the pipeline qualified has been handled — an article number
 * inside one marked "óstaðfest" is explicitly not being asserted, and counting
 * it as an invented citation would score the fix as the failure it fixed. The
 * qualifier is appended after the sentence's full stop, so it becomes a
 * sentence of its own and the one before it has to go with it.
 */
export function withoutQualifiedClaims(answer: string): string {
  const kept: string[] = [];
  for (const line of answer.split("\n")) {
    const sentences = splitSentences(line.trim());
    sentences.forEach((sentence, i) => {
      const next = sentences[i + 1]?.trim() ?? "";
      if (isQualified(sentence)) return;
      if (next.startsWith("(") && isQualified(next)) return;
      kept.push(sentence);
    });
  }
  return kept.join(" ");
}

/**
 * Which language the answer is actually in.
 *
 * By alphabet, which for this pair is decisive: the Icelandic letters do not
 * appear in English text, and an Icelandic answer of more than a sentence
 * always contains several.
 */
export function detectLanguage(answer: string): "is" | "en" {
  const icelandic = (answer.match(/[áðéíóúýþæöÁÐÉÍÓÚÝÞÆÖ]/g) ?? []).length;
  return icelandic >= 3 ? "is" : "en";
}

/** Substrings the fixture required, and which of them are missing. */
export function missingPoints(answer: string, required: string[] = []): string[] {
  return required.filter((point) => !contains(answer, point));
}

/** Substrings the fixture prohibited, and which of them appeared anyway. */
export function prohibitedPresent(answer: string, prohibited: string[] = []): string[] {
  return prohibited.filter((phrase) => contains(answer, phrase));
}

/**
 * Whether the answer states the historical-law limitation.
 *
 * Matched on the vocabulary the limitation is written in rather than on the
 * exact sentence, because the model restates it in its own words — which it is
 * asked to do, and which is the point of putting it in the context rather than
 * appending it to the answer.
 */
export function statesHistoricalLimitation(answer: string): boolean {
  return /(gildandi (texta|útgáf)|eldri útgáf|brottfelld|eins og (hún|það|hann) hljóðaði|current consolidated|earlier version|as it (then )?stood|repealed)/i.test(
    answer
  );
}

export function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}
