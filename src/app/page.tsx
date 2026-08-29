"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { SourcePanel } from "@/components/SourcePanel";
import { SpecificSearch, type LegalSelection } from "@/components/SpecificSearch";
import { ResultCard } from "@/components/ResultCard";
import { Pagination } from "@/components/Pagination";
import { ProgressBars } from "@/components/ProgressBars";
import { HomeCases } from "@/components/HomeCases";
import type { SourceDef } from "@/lib/sources";
import type { SearchResponse } from "@/lib/types";

const PAGE_SIZE = 15;

/** Everything that defines a result set, frozen at the moment Search is hit. */
interface SearchCriteria {
  query: string;
  sources: string[];
  dateFrom?: string;
  dateTo?: string;
  year?: number;
  /** Subject tags a result must carry — all of them. */
  tags?: string[];
  /** Acts a result must cite — all of them. */
  actIds?: string[];
  /** Provisions a result must cite — all of them. */
  provisionIds?: string[];
  sort: "relevance" | "newest" | "oldest";
}

function SearchPageInner() {
  const searchParams = useSearchParams();

  const [sources, setSources] = useState<SourceDef[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set()); // nothing selected by default

  const [query, setQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [year, setYear] = useState("");
  const [sort, setSort] = useState<"relevance" | "newest" | "oldest">("relevance");
  const [showFilters, setShowFilters] = useState(false);
  // The specific-search panel's selections. Lists, and conjunctive: adding a
  // second tag or provision narrows rather than widens.
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [legal, setLegal] = useState<LegalSelection[]>([]);

  const [results, setResults] = useState<SearchResponse | null>(null);
  const [searchedQuery, setSearchedQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // The criteria the current result set was produced from. Paging must reuse
  // these rather than re-reading the form, so that typing a new query and then
  // clicking "page 3" doesn't return page 3 of a different search.
  const criteriaRef = useRef<SearchCriteria | null>(null);
  const resultsTopRef = useRef<HTMLDivElement | null>(null);
  // Guards against an earlier, slower request overwriting a later one.
  const requestIdRef = useRef(0);

  useEffect(() => {
    fetch("/api/sources")
      .then((r) => r.json())
      .then((d) => setSources(d.sources))
      .catch(() => setError("Could not load the source list."));
  }, []);

  const toggle = (set: Set<string>, v: string) => {
    const next = new Set(set);
    next.has(v) ? next.delete(v) : next.add(v);
    return next;
  };

  async function fetchPage(criteria: SearchCriteria, page: number) {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...criteria, page, pageSize: PAGE_SIZE }),
      });
      const data = await res.json();
      if (requestId !== requestIdRef.current) return; // superseded
      if (!res.ok) throw new Error(data.error ?? "Search failed.");
      setResults(data);
      setSearchedQuery(criteria.query);
    } catch (e: any) {
      if (requestId !== requestIdRef.current) return;
      setError(e.message);
      setResults(null);
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }

  function runSearch(opts?: {
    tagsOverride?: string[];
    sourcesOverride?: string[];
    legalOverride?: LegalSelection[];
  }) {
    const tags = opts?.tagsOverride ?? activeTags;
    const legalFilter = opts?.legalOverride ?? legal;
    // Nothing ticked → search every source rather than blocking the search.
    const activeSources =
      opts?.sourcesOverride ?? (selected.size > 0 ? Array.from(selected) : sources.map((s) => s.key));
    if (activeSources.length === 0) return; // sources not loaded yet

    if (selected.size === 0 && sources.length > 0 && !opts?.sourcesOverride) {
      setSelected(new Set(sources.map((s) => s.key)));
    }

    const criteria: SearchCriteria = {
      query,
      sources: activeSources,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      year: year ? Number(year) : undefined,
      tags: tags.length ? tags : undefined,
      actIds: legalFilter.filter((l) => l.kind === "act").map((l) => l.id),
      provisionIds: legalFilter.filter((l) => l.kind === "provision").map((l) => l.id),
      sort,
    };
    criteriaRef.current = criteria;
    fetchPage(criteria, 1);
  }

  /**
   * Picking an act, a provision or a tag runs the search straight away —
   * "show me the cases about this" is the whole point of the panel, so making
   * the user then reach for the Search button would be a pointless step. The
   * chosen value is passed explicitly rather than read from state, which has
   * not re-rendered yet at this point.
   */
  function applyLegal(selections: LegalSelection[]) {
    setLegal(selections);
    runSearch({ legalOverride: selections });
  }

  function applyTags(next: string[]) {
    setActiveTags(next);
    runSearch({ tagsOverride: next });
  }

  function goToPage(page: number) {
    const criteria = criteriaRef.current;
    if (!criteria || !results) return;
    if (page < 1 || page > results.totalPages || page === results.page) return;
    fetchPage(criteria, page);
    resultsTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // Clicking a tag (e.g. from a result card) lands here as /?tag=fasteign —
  // search every source for that tag immediately, no manual selection needed.
  useEffect(() => {
    const tag = searchParams.get("tag");
    if (!tag || sources.length === 0) return;
    setActiveTags([tag]);
    setQuery("");
    const all = sources.map((s) => s.key);
    setSelected(new Set(all));
    criteriaRef.current = { query: "", sources: all, tags: [tag], sort: "relevance" };
    fetchPage(criteriaRef.current, 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, sources]);

  function removeTag(tag: string) {
    const next = activeTags.filter((t) => t !== tag);
    // Other filters may still be in play; re-run rather than blanking the page.
    if (next.length || legal.length || query.trim()) applyTags(next);
    else {
      setActiveTags(next);
      setResults(null);
      setSearchedQuery("");
      criteriaRef.current = null;
    }
  }

  const firstOnPage = results ? (results.page - 1) * results.pageSize + 1 : 0;
  const lastOnPage = results ? firstOnPage + results.hits.length - 1 : 0;

  return (
    <main className="mx-auto max-w-7xl px-4 py-5">
      <div className="mb-4">
        <ProgressBars />
      </div>

      {/* Search bar */}
      <form
        // Keeps the panel's act/provision and tag filters: they are explicit
        // choices sitting in view, so a keyword search narrows within them
        // rather than silently discarding them.
        onSubmit={(e) => { e.preventDefault(); runSearch(); }}
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
          disabled={loading || sources.length === 0}
          className="rounded-lg bg-ink px-6 py-2.5 font-medium text-white transition-colors hover:bg-inkSoft disabled:cursor-not-allowed disabled:bg-line disabled:text-inkSoft"
        >
          {loading ? "Searching…" : "Search"}
        </button>
      </form>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-inkSoft">
        {selected.size === 0 && <span>No sources ticked — searching will use all of them.</span>}
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
        {/* Sidebar: source selection for keyword search, and — alongside it,
            not replacing it — the act/provision lookup. */}
        <div className="w-full shrink-0 space-y-4 lg:w-72">
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
          <SpecificSearch
            legal={legal}
            onLegalChange={applyLegal}
            tags={activeTags}
            onTagsChange={applyTags}
          />
        </div>

        <section className="min-w-0 flex-1">
          <div ref={resultsTopRef} className="scroll-mt-4" />
          {(selected.size > 0 || activeTags.length > 0 || legal.length > 0) && (
            <div className="mb-3 flex flex-wrap items-center gap-1.5">
              {legal.map((l) => (
                <button
                  key={`${l.kind}-${l.id}`}
                  onClick={() => applyLegal(legal.filter((x) => x.id !== l.id))}
                  className="rounded-full bg-accent px-2.5 py-0.5 text-xs font-medium text-white hover:opacity-80"
                  title="Remove this act/provision filter"
                >
                  {l.kind === "provision" ? l.label : l.sublabel} ✕
                </button>
              ))}
              {activeTags.map((t) => (
                <button
                  key={t}
                  onClick={() => removeTag(t)}
                  className="rounded-full bg-accent px-2.5 py-0.5 text-xs font-medium text-white hover:opacity-80"
                  title="Remove this tag filter"
                >
                  Tag: {t} ✕
                </button>
              ))}
              <span className="text-xs text-inkSoft">Searching:</span>
              {Array.from(selected).map((k) => (
                <button
                  key={k}
                  onClick={() => setSelected((s) => toggle(s, k))}
                  className="rounded-full bg-ink px-2.5 py-0.5 text-xs font-medium text-white hover:opacity-80"
                  title="Remove this source"
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

          {!results && !error && <HomeCases />}

          {results && (
            <>
              <p className="mb-2 text-xs text-inkSoft">
                {results.total === 0 ? (
                  "No results"
                ) : (
                  <>
                    Showing <span className="font-medium text-ink">{firstOnPage.toLocaleString("is-IS")}–{lastOnPage.toLocaleString("is-IS")}</span>{" "}
                    of {results.total.toLocaleString("is-IS")}
                    {results.totalIsCapped && "+"} result{results.total === 1 ? "" : "s"}
                  </>
                )}
                {searchedQuery && <> for <span className="font-medium text-ink">{searchedQuery}</span></>}
                {activeTags.length > 0 && (
                  <> tagged <span className="font-medium text-ink">{activeTags.join(" + ")}</span></>
                )}
                {legal.length > 0 && (
                  <>
                    {" "}citing{" "}
                    <span className="font-medium text-ink">
                      {legal.map((l) => (l.kind === "provision" ? l.label : l.sublabel)).join(" + ")}
                    </span>
                  </>
                )}
              </p>
              <div className={`flex flex-col gap-3 ${loading ? "opacity-50 transition-opacity" : ""}`}>
                {results.hits.map((h) => (
                  <ResultCard key={h.id} hit={h} query={searchedQuery} />
                ))}
                {results.hits.length === 0 && (
                  <p className="rounded-lg border border-line bg-white p-6 text-sm text-inkSoft">
                    No matches in the selected sources. Try fewer words, a broader date range, or additional sources.
                  </p>
                )}
              </div>
              <Pagination
                page={results.page}
                totalPages={results.totalPages}
                disabled={loading}
                onPageChange={goToPage}
              />
            </>
          )}
        </section>
      </div>
    </main>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={null}>
      <SearchPageInner />
    </Suspense>
  );
}
