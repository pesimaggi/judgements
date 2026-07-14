/** Builds a copyable citation string for a document. */
export function buildCitation(doc: {
  court?: string | null;
  caseNumber?: string | null;
  caseName?: string | null;
  title: string;
  date?: string | Date | null;
  officialUrl: string;
}): string {
  const d = doc.date ? new Date(doc.date) : null;
  const dateStr = d
    ? d.toLocaleDateString("is-IS", { day: "numeric", month: "long", year: "numeric" })
    : "";
  const name = doc.caseName ?? doc.title;
  const parts = [
    [doc.court, dateStr].filter(Boolean).join(" "),
    doc.caseNumber ? `mál nr. ${doc.caseNumber}` : "",
    name,
  ].filter(Boolean);
  return `${parts.join(", ")} — ${doc.officialUrl}`;
}
