"use client";
import { useMemo } from "react";
import { parseJudgmentText } from "@/lib/judgment-text";
import { HighlightedText } from "./HighlightedText";

/**
 * Renders a judgment as structured prose — headings, paragraphs, numbered
 * clauses and quoted passages — instead of dumping the stored text into a
 * single pre-wrapped block. See lib/judgment-text.ts for how the structure is
 * recovered from what ingestion actually stored.
 */
export function JudgmentText({ text, query }: { text: string; query: string }) {
  const blocks = useMemo(() => parseJudgmentText(text), [text]);

  if (blocks.length === 0) {
    return <p className="text-sm text-inkSoft">This document has no extracted text.</p>;
  }

  return (
    <div className="doc-body">
      {blocks.map((block, i) => {
        switch (block.kind) {
          case "heading":
            return (
              <h2 key={i} className="doc-heading">
                <HighlightedText text={block.text} query={query} />
              </h2>
            );
          case "list-item":
            return (
              <p key={i} className="doc-item">
                <span className="doc-item-marker">{block.marker}</span>
                <HighlightedText text={block.text} query={query} />
              </p>
            );
          case "quote":
            return (
              <blockquote key={i} className="doc-quote">
                <HighlightedText text={block.text} query={query} />
              </blockquote>
            );
          default:
            return (
              <p key={i}>
                <HighlightedText text={block.text} query={query} />
              </p>
            );
        }
      })}
    </div>
  );
}
