"use client";
import { useEffect, useMemo, useState } from "react";
import { SourcePanel } from "@/components/SourcePanel";
import { ResultCard } from "@/components/ResultCard";
import type { SourceDef } from "@/lib/sources";
import type { SearchResponse } from "@/lib/types";

export default function SearchPage() {
  const [sources, setSources] = useState<SourceDef[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set()); // nothing selected by default

  const [query, setQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [year, setYear] = useState("");
  const [sort, setSort] = useState<"relevance" | "newest" | "oldest">("relevance");
  const [showFilters, setShowFilters] = useState(false);

  const [results, setResults] = useState<SearchResponse | null>(null);
  const [searchedQuery, setSearchedQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/sources")
      .then((r) => r.json())
      .then((d) => setSources(d.sources))
      .catch(() => setError("Could not load the source list."));
  }, []);

  const canSearch = selected.size > 0;

  const toggle = (set: Set<string>, v: string) => {
    const next = new Set(set);
    next.has(v) ? next.delete(v) : next.add(v);
    return next;
  };

  async function runSearch(page = 1) {
    if (!canSearch) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          sources: Array.from(selected),
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
          year: year ? Number(year) : undefined,
          sort,
          page,
          pageSize: 20,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Search failed.");
      setResults(data);
      setSearchedQuery(query);
    } catch (e: any) {
      setError(e.message);
      setResults(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-5">
      {/* Search bar */}
      <form
        onSubmit={(e) => { e.preventDefault(); runSearch(1); }}
        className="flex flex-col gap-2 sm:flex-row"
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder='Search full text, case number (22/2023, E-3210/2025), party, "exact phrase", AND / OR / NOT…'
          className="w-full rounded-lg border border-line bg-white px-4 py-2.5 text-[15px] placeholder:text-inkSoft/60"
          lang="is"
        />
        <button
          type="submit"
          disabled={!canSearch || loading}
          title={canSearch ? "Search selected courts" : "Select one or more courts to search."}
          className="rounded-lg bg-ink px-6 py-2.5 font-medium text-white transition-colors hover:bg-inkSoft disabled:cursor-not-allowed disabled:bg-line disabled:text-inkSoft"
        >
          {loading ? "Searching…" : "Search"}
        </button>
      </form>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-inkSoft">
        {!canSearch && <span className="font-medium text-accent">Select one or more courts to search.</span>}
        <button onClick={() => setShowFilters(!showFilters)} className="hover:text-ink">
          {showFilters ? "▾ Hide filters" : "▸ Date & sort filters"}
        </button>
      </div>

      {showFilters && (
        <div className="mt-2 flex flex-wrap items-end gap-4 rounded-lg border border-line bg-white p-3 text-sm">
          <label className="flex flex-col gap-1 text-xs text-inkSoft">
            From date
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="rounded border border-line px-2 py-1 text-sm text-ink" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-inkSoft">
            To date
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="rounded border border-line px-2 py-1 text-sm text-ink" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-inkSoft">
            Year
            <input type="number" placeholder="2024" value={year} onChange={(e) => setYear(e.target.value)} className="w-24 rounded border border-line px-2 py-1 text-sm text-ink" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-inkSoft">
            Sort by
            <select value={sort} onChange={(e) => setSort(e.target.value as any)} className="rounded border border-line px-2 py-1 text-sm text-ink">
              <option value="relevance">Relevance</option>
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
            </select>
          </label>
        </div>
      )}

      <div className="mt-4 flex flex-col gap-5 lg:flex-row">
        <SourcePanel
          sources={sources}
          selected={selected}
          onToggleSource={(k) => setSelected((s) => toggle(s, k))}
          onSetSources={(keys, on) =>
            setSelected((s) => {
              const next = new Set(s);
              keys.forEach((k) => (on ? next.add(k) : next.delete(k)));
              return next;
            })
          }
        />

        <section className="min-w-0 flex-1">
          {selected.size > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-inkSoft">Searching:</span>
              {Array.from(selected).map((k) => (
                <button
                  key={k}
                  onClick={() => setSelected((s) => toggle(s, k))}
                  className="rounded-full bg-ink px-2.5 py-0.5 text-xs font-medium text-white hover:opacity-80"
                  title="Remove this court"
                >
                  {sources.find((s) => s.key === k)?.name ?? k} ✕
                </button>
              ))}
              <button onClick={() => setSelected(new Set())} className="text-xs text-accent hover:underline">
                Clear all
              </button>
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-accent/40 bg-accentSoft p-3 text-sm">
              {error}
            </div>
          )}

          {!results && !error && (
            <div className="rounded-lg border border-dashed border-line p-10 text-center text-sm text-inkSoft">
              <p className="font-serif text-lg text-ink">Nothing is searched by default.</p>
              <p className="mt-1">
                Tick the courts you want on the left, then search words,
                phrases, case numbers or parties.
              </p>
            </div>
          )}

          {results && (
            <>
              <p className="mb-2 text-xs text-inkSoft">
                {results.total} result{results.total === 1 ? "" : "s"}
                {searchedQuery && <> for <span className="font-medium text-ink">{searchedQuery}</span></>}
              </p>
              <div className="flex flex-col gap-3">
                {results.hits.map((h) => (
                  <ResultCard key={h.id} hit={h} query={searchedQuery} />
                ))}
                {results.hits.length === 0 && (
                  <p className="rounded-lg border border-line bg-white p-6 text-sm text-inkSoft">
                    No matches in the selected courts. Try fewer words, a broader date range, or additional courts.
                  </p>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
