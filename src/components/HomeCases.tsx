"use client";
import { useEffect, useState } from "react";
import type { SearchHit } from "@/lib/types";
import { ResultCard } from "./ResultCard";

interface HomeCasesData {
  featured: SearchHit | null;
  newest: SearchHit[];
}

/**
 * Stand-in for a result card while the real ones load. Mirrors the card's own
 * shape — border, title line, two lines of body — so the layout does not jump
 * when the data arrives.
 */
function CardSkeleton() {
  return (
    <div className="rounded-lg border border-line bg-white p-4">
      <div className="h-3 w-24 rounded bg-paper" />
      <div className="mt-3 h-4 w-3/4 rounded bg-paper" />
      <div className="mt-2 h-3 w-full rounded bg-paper" />
      <div className="mt-1.5 h-3 w-5/6 rounded bg-paper" />
    </div>
  );
}

function HomeCasesSkeleton() {
  return (
    <div className="flex animate-pulse flex-col gap-5" aria-hidden="true">
      <div>
        <div className="mb-2 h-3 w-28 rounded bg-paper" />
        <CardSkeleton />
      </div>
      <div>
        <div className="mb-2 h-3 w-24 rounded bg-paper" />
        <div className="flex flex-col gap-3">
          {[0, 1, 2, 3].map((i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Front-page widget shown before any search: a random featured case, then the newest arrivals. */
export function HomeCases() {
  const [data, setData] = useState<HomeCasesData | null>(null);
  // Distinct from `data === null`: that is also the state after a failed
  // request, and a permanent skeleton would read as a hung page.
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/cases/home")
      .then((r) => r.json())
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <>
        <span className="sr-only" role="status">
          Loading cases…
        </span>
        <HomeCasesSkeleton />
      </>
    );
  }

  if (!data || (!data.featured && data.newest.length === 0)) {
    return (
      <div className="rounded-lg border border-dashed border-line p-10 text-center text-sm text-inkSoft">
        <p className="font-serif text-lg text-ink">Nothing is searched by default.</p>
        <p className="mt-1">
          Tick the courts you want on the left, then search words, phrases, case numbers or parties.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {data.featured && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-accent">🎲 Featured case</p>
          <ResultCard hit={data.featured} query="" />
        </div>
      )}
      {data.newest.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-inkSoft">Newest cases</p>
          <div className="flex flex-col gap-3">
            {data.newest.map((h) => (
              <ResultCard key={h.id} hit={h} query="" />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
