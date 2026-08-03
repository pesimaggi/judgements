"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

interface CaseRow {
  linkId: string;
  citationText: string;
  excerpt: string;
  charOffset: number;
  paragraphNumber: number | null;
  document: {
    id: string;
    court: string;
    caseNumber: string | null;
    caseName: string | null;
    title: string;
    date: string | null;
    year: number | null;
  };
}

/**
 * The judgments citing one provision, loaded on demand when the reader opens
 * a provision's badge.
 *
 * Each row shows the sentence the citation was found in. That is the point of
 * the feature — a bare list of case numbers tells a reader nothing about
 * whether a judgment is worth opening, whereas the citing sentence usually
 * does.
 */
export function ProvisionCases({ provisionId }: { provisionId: string }) {
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [total, setTotal] = useState(0);
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
          <article key={c.linkId} className="rounded border border-line bg-paper p-3">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[11px] text-inkSoft">
              {c.document.caseNumber && (
                <span className="rounded bg-white px-1.5 py-0.5 font-mono font-semibold text-ink">
                  {c.document.caseNumber}
                </span>
              )}
              <span className="font-medium text-ink">{c.document.court}</span>
              <span>{dateStr}</span>
              <span className="font-mono text-[10px] text-inkSoft">{c.citationText}</span>
            </div>
            <h4 className="mt-1 font-serif text-[15px] font-semibold leading-snug">
              <Link
                href={`/document/${c.document.id}?q=${encodeURIComponent(c.citationText)}`}
                className="hover:underline"
              >
                {c.document.caseName ?? c.document.title}
              </Link>
            </h4>
            {c.excerpt && (
              <p className="mt-1 border-l-2 border-line pl-2 text-[13px] leading-relaxed text-inkSoft">
                …{c.excerpt}…
              </p>
            )}
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
            Page {page} of {totalPages} · {total} judgments
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
