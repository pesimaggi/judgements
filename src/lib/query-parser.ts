/**
 * Parses the user's query into a form usable by the search providers.
 *
 * Supported syntax:
 *   - plain words              → all must match (AND semantics)
 *   - "exact phrase"           → phrase match
 *   - AND / OR / NOT keywords  → boolean search
 *   - case numbers             → detected and matched against case_number
 *     (e.g. E-2/24, 12595/2024, 22/2023)
 *
 * Icelandic characters (á ð é í ó ú ý þ æ ö) pass through untouched.
 */

export interface ParsedQuery {
  raw: string;
  /** Query rewritten to PostgreSQL websearch_to_tsquery syntax. */
  websearch: string;
  /** Detected case-number tokens, e.g. ["E-2/24"]. */
  caseNumbers: string[];
  /** True when the whole query looks like a single case-number lookup. */
  isCaseNumberLookup: boolean;
}

const CASE_NUMBER_RE = /\b([A-Za-zÞÆÖÁÐÉÍÓÚÝþæöáðéíóúý]{1,3}-?\d{1,5}\/\d{2,4}|\d{1,6}\/\d{4})\b/g;

export function parseQuery(raw: string): ParsedQuery {
  const trimmed = raw.trim();
  const caseNumbers = Array.from(trimmed.matchAll(CASE_NUMBER_RE), (m) => m[1]);
  const isCaseNumberLookup =
    caseNumbers.length === 1 && trimmed.replace(CASE_NUMBER_RE, "").trim() === "";

  // websearch_to_tsquery natively supports: implicit AND, "phrases", OR, -negation.
  // Translate explicit boolean keywords into that syntax.
  const websearch = trimmed
    .replace(/\s+AND\s+/g, " ")
    .replace(/\s+NOT\s+/g, " -")
    // OR is passed through — websearch_to_tsquery understands uppercase OR.
    .replace(/\s+or\s+/g, " OR ");

  return { raw: trimmed, websearch, caseNumbers, isCaseNumberLookup };
}
