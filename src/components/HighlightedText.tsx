"use client";
import { extractHighlightTerms, escapeRegExp } from "@/lib/highlight";

/** Highlights query terms in plain text (no HTML injection — pure React nodes). */
export function HighlightedText({ text, query }: { text: string; query: string }) {
  const terms = extractHighlightTerms(query);
  if (terms.length === 0) return <>{text}</>;
  const pattern = `(${terms.map(escapeRegExp).join("|")})`;
  const splitRe = new RegExp(pattern, "giu");
  const testRe = new RegExp(`^${pattern}$`, "iu"); // fresh, non-global — avoids lastIndex state bugs
  const parts = text.split(splitRe);
  return (
    <>
      {parts.map((p, i) =>
        testRe.test(p) ? <mark key={i}>{p}</mark> : <span key={i}>{p}</span>
      )}
    </>
  );
}

/**
 * Renders a snippet produced by the search engine that already contains
 * <mark> tags (from ts_headline / Meilisearch). Only <mark> is allowed
 * through; everything else is escaped.
 */
export function SnippetHtml({ html }: { html: string }) {
  const escaped = html
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/&lt;mark&gt;/g, "<mark>")
    .replace(/&lt;\/mark&gt;/g, "</mark>");
  return <span dangerouslySetInnerHTML={{ __html: escaped }} />;
}
