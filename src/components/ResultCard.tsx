"use client";
import Link from "next/link";
import type { SearchHit } from "@/lib/types";
import { isScholarship } from "@/lib/sources";
import { SnippetHtml } from "./HighlightedText";
import { SaveDocumentButton } from "./auth/SaveDocumentButton";

/**
 * One result, as a row rather than a card.
 *
 * Fifteen bordered cards on a page read as fifteen separate things to
 * consider; a list of rows reads as one list to scan, which is what a result
 * set is. The row carries what tells two judgments apart — court, case
 * number, title, the matched passage — with the dates and links in a rail on
 * the right, out of the way of the scan but in the same place on every row.
 *
 * The whole row is the link. The title's own link is the real one and it
 * stretches over the row through `after:absolute`, which keeps the HTML
 * valid — an <a> wrapping the tags and the rail's links would not be — and
 * leaves the keyboard with a single sensible tab stop per result.
 */
export function ResultCard({ hit, query }: { hit: SearchHit; query: string }) {
  const dateStr = hit.date
    ? new Date(hit.date).toLocaleDateString("is-IS", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : hit.year
      ? String(hit.year)
      : "—";

  // A journal article is its author's work, not a public record, so the row
  // leads to the journal that published it rather than to our copy. The copy
  // is what made the article findable in the first place; it is not ours to
  // put on a page of our own. Judgments keep the in-app reader.
  const scholarship = isScholarship(hit.source);
  const openHref = scholarship
    ? hit.officialUrl
    : `/document/${hit.id}?q=${encodeURIComponent(query)}`;

  const title = hit.caseName ?? hit.title;

  return (
    <article className="relative flex flex-col gap-4 border-b border-lineSoft px-5 py-[17px] transition-colors hover:bg-paper sm:flex-row sm:gap-6">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 text-[11.5px] text-textMuted">
          <span className="border-l-2 border-gold pl-2 text-[10.5px] font-semibold uppercase tracking-[.09em] text-inkSoft">
            {hit.court}
          </span>
          {hit.caseNumber && (
            <>
              <span aria-hidden className="text-[#A9B9C9]">
                —
              </span>
              <span className="font-serif text-[13px] font-semibold tabular-nums text-ink">
                {hit.caseNumber}
              </span>
            </>
          )}
          {hit.isSample && (
            <span className="rounded-[3px] bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">
              Sýnigögn
            </span>
          )}
          {/*
            This result did not match what was typed — it was reached by
            near-match on the case number, title or party name. Worth saying
            out loud: for a case number a near-match is a *different case*,
            and without the mark it sits at the top of the page looking like
            the answer.
          */}
          {hit.isFuzzy && (
            <span
              className="rounded-[3px] bg-sky-100 px-1.5 py-0.5 text-[11px] font-medium text-sky-800"
              title="Fannst ekki nákvæmlega eins og leitað var að — þetta er svipuð niðurstaða. Athugaðu málsnúmerið."
            >
              Svipuð niðurstaða
            </span>
          )}
        </div>

        <h3 className="mt-[7px] font-heading text-[19px] font-medium leading-[1.3] text-ink">
          {scholarship ? (
            <a
              href={openHref}
              target="_blank"
              rel="noopener noreferrer"
              className="after:absolute after:inset-0 hover:underline"
            >
              {title} <span className="text-sm font-normal text-textMuted">↗</span>
            </a>
          ) : (
            <Link href={openHref} className="after:absolute after:inset-0 hover:underline">
              {title}
            </Link>
          )}
        </h3>
        {hit.caseName && hit.caseName !== hit.title && (
          <p className="mt-0.5 text-[12.5px] text-textMuted">{hit.title}</p>
        )}

        {hit.snippet && (
          <p className="mt-[7px] max-w-[70ch] font-serif text-[14.5px] leading-[1.6] text-text">
            <SnippetHtml html={hit.snippet} /> …
          </p>
        )}

        <div className="relative z-10 mt-[11px] flex flex-wrap items-center gap-2">
          {hit.summary && (
            <details className="group/summary w-full">
              <summary className="inline-flex w-fit cursor-pointer list-none items-center gap-[7px] rounded-[3px] border border-moss bg-mossSoft px-[11px] py-1 text-xs font-medium text-mossText transition-colors hover:bg-[#DCE5DC] [&::-webkit-details-marker]:hidden">
                <span aria-hidden className="text-[9px] group-open/summary:hidden">
                  ▸
                </span>
                <span aria-hidden className="hidden text-[9px] group-open/summary:inline">
                  ▾
                </span>
                Útdráttur dómsins
              </summary>
              <div className="mt-2.5 border-l-2 border-moss bg-[#F6F8F6] px-3.5 py-[11px]">
                <div className="mb-[5px] text-[10px] uppercase tracking-[.12em] text-moss">
                  Útdráttur
                </div>
                {hit.summary.split("\n\n").map((paragraph, i) => (
                  <p
                    key={i}
                    className="mb-2 max-w-[68ch] font-serif text-sm leading-[1.62] text-text last:mb-0"
                  >
                    {paragraph}
                  </p>
                ))}
              </div>
            </details>
          )}

          {hit.subjectTags.map((t) => (
            <Link
              key={t}
              href={`/?tag=${encodeURIComponent(t)}`}
              className="rounded-full bg-[#F1F4F8] px-2.5 py-[3px] text-[11px] text-inkSoft transition-colors hover:bg-glacier hover:text-ink"
              title={`Sýna aðrar úrlausnir merktar „${t}“`}
            >
              {t}
            </Link>
          ))}
        </div>
      </div>

      <div className="relative z-10 flex shrink-0 flex-row flex-wrap items-center gap-x-4 gap-y-2 border-lineSoft sm:w-[176px] sm:flex-col sm:items-stretch sm:border-l sm:pl-5">
        <div className="text-xs text-text">{dateStr}</div>
        {hit.citedProvision && (
          <div className="text-[11.5px] leading-[1.45] text-textMuted">
            Vísar í {hit.citedProvision}
          </div>
        )}
        {!scholarship && <SaveDocumentButton documentId={hit.id} />}
        <a
          href={hit.officialUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] text-textMuted hover:text-ink hover:underline"
        >
          Opinber heimild ↗
        </a>
        {hit.pdfUrl && !scholarship && (
          <a
            href={hit.pdfUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-textMuted hover:text-ink hover:underline"
          >
            PDF ↗
          </a>
        )}
      </div>
    </article>
  );
}
