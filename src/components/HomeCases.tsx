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

/**
 * The same white panel the results sit in, so the front page and a result
 * page are one surface rather than two — the rows inside carry their own
 * dividers and need a frame around them.
 */
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[3px] border border-line bg-white">
      <div className="border-b border-line px-5 py-3 text-[11px] uppercase tracking-[.1em] text-textMuted">
        {title}
      </div>
      {children}
    </section>
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
          Sæki úrlausnir…
        </span>
        <HomeCasesSkeleton />
      </>
    );
  }

  // `newest` is guarded rather than trusted: a failed request resolves to
  // whatever JSON the route produced for its error, and a front page that
  // throws on a 500 from one widget is worse than one without the widget.
  if (!data || (!data.featured && !data.newest?.length)) {
    return (
      <div className="rounded-[3px] border border-dashed border-line p-10 text-center text-sm text-textMuted">
        <p className="font-heading text-lg text-ink">Ekkert er leitað sjálfgefið.</p>
        <p className="mt-1">
          Leitaðu að orðum, orðasamböndum, málsnúmeri eða aðilum — eða veldu heimildir til
          vinstri og þrengdu leitina.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[18px]">
      {data.featured && (
        <Panel title="Úrlausn dagsins">
          <ResultCard hit={data.featured} query="" />
        </Panel>
      )}
      {data.newest?.length > 0 && (
        <Panel title="Nýjast í safninu">
          {data.newest.map((h) => (
            <ResultCard key={h.id} hit={h} query="" />
          ))}
        </Panel>
      )}
    </div>
  );
}
