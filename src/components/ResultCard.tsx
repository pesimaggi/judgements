"use client";
import Link from "next/link";
import type { SearchHit } from "@/lib/types";
import { SnippetHtml } from "./HighlightedText";

export function ResultCard({ hit, query }: { hit: SearchHit; query: string }) {
  const dateStr = hit.date
    ? new Date(hit.date).toLocaleDateString("is-IS", { day: "numeric", month: "short", year: "numeric" })
    : hit.year ? String(hit.year) : "—";

  return (
    <article className="rounded-lg border border-line bg-white p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-inkSoft">
        {hit.caseNumber && (
          <span className="rounded bg-paper px-1.5 py-0.5 font-mono text-[11px] font-semibold text-ink">
            {hit.caseNumber}
          </span>
        )}
        <span className="font-medium text-ink">{hit.court}</span>
        <span>{dateStr}</span>
        {hit.isSample && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">
            Sample data
          </span>
        )}
      </div>

      <h3 className="mt-1.5 font-serif text-lg font-semibold leading-snug">
        <Link href={`/document/${hit.id}?q=${encodeURIComponent(query)}`} className="hover:underline">
          {hit.caseName ?? hit.title}
        </Link>
      </h3>
      {hit.caseName && hit.caseName !== hit.title && (
        <p className="text-sm text-inkSoft">{hit.title}</p>
      )}

      {hit.snippet && (
        <p className="mt-2 text-sm leading-relaxed text-inkSoft">
          <SnippetHtml html={hit.snippet} /> …
        </p>
      )}

      {hit.subjectTags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {hit.subjectTags.map((t) => (
            <Link
              key={t}
              href={`/?tag=${encodeURIComponent(t)}`}
              className="rounded-full bg-paper px-2 py-0.5 text-[11px] text-inkSoft hover:bg-line hover:text-ink"
              title={`Show other cases tagged "${t}"`}
            >
              {t}
            </Link>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        <Link
          href={`/document/${hit.id}?q=${encodeURIComponent(query)}`}
          className="rounded bg-ink px-2.5 py-1 text-xs font-medium text-white hover:bg-inkSoft"
        >
          Open full text
        </Link>
        <a href={hit.officialUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-accent hover:underline">
          Official source ↗
        </a>
        {hit.pdfUrl && (
          <a href={hit.pdfUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-inkSoft hover:underline">
            PDF ↗
          </a>
        )}
      </div>
    </article>
  );
}
