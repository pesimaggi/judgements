"use client";
import { useEffect, useState } from "react";
import type { SearchHit } from "@/lib/types";
import { ResultCard } from "./ResultCard";

interface HomeCasesData {
  featured: SearchHit | null;
  newest: SearchHit[];
}

/** Front-page widget shown before any search: a random featured case, then the newest arrivals. */
export function HomeCases() {
  const [data, setData] = useState<HomeCasesData | null>(null);

  useEffect(() => {
    fetch("/api/cases/home")
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  }, []);

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
