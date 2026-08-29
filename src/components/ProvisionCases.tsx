"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

interface Citation {
  id: string;
  matchType: string;
  citationText: string;
  excerpt: string;
  charOffset: number;
  paragraphNumber: number | null;
  /** How many citations quote this same passage — see collapseByExcerpt(). */
  occurrences: number;
}

interface CaseRow {
  document: {
    id: string;
    court: string;
    caseNumber: string | null;
    caseName: string | null;
    title: string;
    date: string | null;
    year: number | null;
  };
  /** The distinct passages in which this judgment cites the provision. */
  citations: Citation[];
}

/**
 * The judgments citing one provision, loaded on demand when the reader opens
 * a provision's badge.
 *
 * One card per judgment, listing each place it cites the provision. A
 * judgment commonly cites the same provision more than once, and showing one
 * card per citation made a provision cited five times by one case look like
 * five separate cases.
 *
 * Each citation keeps the sentence it was found in. That is the point of the
 * feature — a bare list of case numbers tells a reader nothing about whether
 * a judgment is worth opening, whereas the citing sentence usually does.
 */
export function ProvisionCases({ provisionId }: { provisionId: string }) {
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [total, setTotal] = useState(0);
  const [citationCount, setCitationCount] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/provisions/${provisionId}/cases?page=${page}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.error) throw new Error(d.error);
        setCases(d.cases);
        setTotal(d.total);
        setCitationCount(d.citationCount ?? d.total);
        setTotalPages(d.totalPages);
      })
      .catch(() => !cancelled && setError("Could not load the cases for this provision."))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [provisionId, page]);

  if (loading && cases.length === 0) {
    return <p className="mt-2 text-xs text-inkSoft">Loading cases…</p>;
  }
  if (error) return <p className="mt-2 text-xs text-accent">{error}</p>;

  return (
    <div className="mt-2 space-y-2">
      {citationCount > total && (
        <p className="text-[11px] text-inkSoft">
          {total} {total === 1 ? "úrlausn" : "úrlausnir"} · {citationCount} tilvísanir alls
        </p>
      )}

      {cases.map((c) => {
        const dateStr = c.document.date
          ? new Date(c.document.date).toLocaleDateString("is-IS", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })
          : c.document.year
            ? String(c.document.year)
            : "—";
        return (
          <article key={c.document.id} className="rounded border border-line bg-paper p-3">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[11px] text-inkSoft">
              {c.document.caseNumber && (
                <span className="rounded bg-white px-1.5 py-0.5 font-mono font-semibold text-ink">
                  {c.document.caseNumber}
                </span>
              )}
              <span className="font-medium text-ink">{c.document.court}</span>
              <span>{dateStr}</span>
              {(() => {
                const n = c.citations.reduce((sum, cit) => sum + cit.occurrences, 0);
                return n > 1 ? (
                  <span className="rounded bg-white px-1.5 py-0.5">{n} tilvísanir</span>
                ) : null;
              })()}
            </div>
            <h4 className="mt-1 font-serif text-[15px] font-semibold leading-snug">
              <Link
                href={`/document/${c.document.id}?q=${encodeURIComponent(
                  c.citations[0]?.citationText ?? ""
                )}`}
                className="hover:underline"
              >
                {c.document.caseName ?? c.document.title}
              </Link>
            </h4>

            <ul className="mt-1 space-y-1.5">
              {c.citations.map((cit) => (
                <li key={cit.id} className="border-l-2 border-line pl-2">
                  <span className="block font-mono text-[10px] text-inkSoft">
                    {cit.citationText}
                    {cit.occurrences > 1 && ` ×${cit.occurrences}`}
                  </span>
                  {cit.excerpt && (
                    <span className="block text-[13px] leading-relaxed text-inkSoft">
                      …{cit.excerpt}…
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </article>
        );
      })}

      {totalPages > 1 && (
        <div className="flex items-center gap-2 text-xs">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded border border-line px-2 py-1 disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-inkSoft">
            Page {page} of {totalPages} · {total} {total === 1 ? "úrlausn" : "úrlausnir"}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="rounded border border-line px-2 py-1 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
