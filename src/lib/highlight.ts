/** Extracts plain search terms (words + quoted phrases) for client-side highlighting. */
export function extractHighlightTerms(query: string): string[] {
  const terms: string[] = [];
  const phraseRe = /"([^"]+)"/g;
  let rest = query;
  let m: RegExpExecArray | null;
  while ((m = phraseRe.exec(query)) !== null) terms.push(m[1]);
  rest = rest.replace(phraseRe, " ");
  for (const w of rest.split(/\s+/)) {
    const clean = w.replace(/^-/, "").trim();
    if (clean && !["AND", "OR", "NOT"].includes(clean)) terms.push(clean);
  }
  return Array.from(new Set(terms.filter((t) => t.length > 1)));
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
