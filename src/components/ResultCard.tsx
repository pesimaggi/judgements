"use client";
import Link from "next/link";
import type { SearchHit } from "@/lib/types";
import { isScholarship } from "@/lib/sources";
import { SnippetHtml } from "./HighlightedText";

export function ResultCard({ hit, query }: { hit: SearchHit; query: string }) {
  const dateStr = hit.date
    ? new Date(hit.date).toLocaleDateString("is-IS", { day: "numeric", month: "short", year: "numeric" })
    : hit.year ? String(hit.year) : "—";

  // A journal article is its author's work, not a public record, so the card
  // leads to the journal that published it rather than to our copy. The copy
  // is what made the article findable in the first place; it is not ours to
  // put on a page of our own. Judgments keep the in-app reader.
  const scholarship = isScholarship(hit.source);
  const openHref = scholarship
    ? hit.officialUrl
    : `/document/${hit.id}?q=${encodeURIComponent(query)}`;

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
        {/*
          This result did not match what was typed — it was reached by
          near-match on the case number, title or party name. Worth saying out
          loud: for a case number a near-match is a *different case*, and
          without the mark it sits at the top of the page looking like the
          answer. `title` carries the longer explanation on hover.
        */}
        {hit.isFuzzy && (
          <span
            className="rounded bg-sky-100 px-1.5 py-0.5 text-[11px] font-medium text-sky-800"
            title="Fannst ekki nákvæmlega eins og leitað var að — þetta er svipuð niðurstaða. Athugaðu málsnúmerið."
          >
            Svipuð niðurstaða
          </span>
        )}
      </div>

      <h3 className="mt-1.5 font-serif text-lg font-semibold leading-snug">
        {scholarship ? (
          <a href={openHref} target="_blank" rel="noopener noreferrer" className="hover:underline">
            {hit.caseName ?? hit.title} <span className="text-sm font-normal text-inkSoft">↗</span>
          </a>
        ) : (
          <Link href={openHref} className="hover:underline">
            {hit.caseName ?? hit.title}
          </Link>
        )}
      </h3>
      {hit.caseName && hit.caseName !== hit.title && (
        <p className="text-sm text-inkSoft">{hit.title}</p>
      )}

      {hit.snippet && (
        <p className="mt-2 text-sm leading-relaxed text-inkSoft">
          <SnippetHtml html={hit.snippet} /> …
        </p>
      )}

      {hit.summary && (
        <details className="group mt-2">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-xs font-medium text-accent hover:underline [&::-webkit-details-marker]:hidden">
            <span className="transition-transform group-open:rotate-90" aria-hidden="true">▸</span>
            Útdráttur
            <span className="font-normal text-inkSoft">(summary)</span>
          </summary>
          <div className="mt-2 border-l-2 border-line pl-3 font-serif text-[15px] leading-relaxed text-ink">
            {hit.summary.split("\n\n").map((paragraph, i) => (
              <p key={i} className="mb-2 last:mb-0">
                {paragraph}
              </p>
            ))}
          </div>
        </details>
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
        {scholarship ? (
          <a
            href={openHref}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded bg-ink px-2.5 py-1 text-xs font-medium text-white hover:bg-inkSoft"
          >
            Read at publisher ↗
          </a>
        ) : (
          <>
            <Link
              href={openHref}
              className="rounded bg-ink px-2.5 py-1 text-xs font-medium text-white hover:bg-inkSoft"
            >
              Open full text
            </Link>
            <a href={hit.officialUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-accent hover:underline">
              Official source ↗
            </a>
          </>
        )}
        {/*
          No direct PDF link for an article. The file is the journal's own, but
          linking it lands the reader on a bare document instead of the page
          the journal publishes it on — the byline, the licence terms, the
          issue it belongs to. One route in, and it is theirs.
        */}
        {hit.pdfUrl && !scholarship && (
          <a href={hit.pdfUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-inkSoft hover:underline">
            PDF ↗
          </a>
        )}
      </div>
    </article>
  );
}
