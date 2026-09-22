"use client";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SourcePanel } from "@/components/SourcePanel";
import { SpecificSearch, type LegalSelection } from "@/components/SpecificSearch";
import { ResultCard } from "@/components/ResultCard";
import { Pagination } from "@/components/Pagination";
import { ActResults, type ActSearchHit, type ProvisionSearchHit } from "@/components/ActResults";
import { ChevronDownIcon, FiltersIcon, SearchIcon } from "@/components/icons";
import { activeFilterChips, defaultSourceKeys } from "@/lib/source-tree";
import type { SourceDef } from "@/lib/sources";
import type { SearchResponse } from "@/lib/types";
import { CAPTURE_VIEW_EVENT, currentPath, readContinuation, readView } from "@/lib/auth/continuation";

const PAGE_SIZE = 15;
/** How many individual source chips the filter bar shows before folding. */
const CHIP_LIMIT = 4;
/** Long enough that ticking four boxes is one search, short enough to feel live. */
const REFILTER_DELAY_MS = 300;

/** Everything that defines a result set, frozen when the search is run. */
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

interface SearchView {
  selected: string[]; queryInput: string; dateFrom: string; dateTo: string; year: string;
  sort: SearchCriteria["sort"]; activeTags: string[]; legal: LegalSelection[]; page: number;
}

function SearchPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // The query lives in the URL so a result page can be linked, bookmarked and
  // reloaded; the box below writes to it on submit.
  const query = searchParams.get("q") ?? "";
  const urlTag = searchParams.get("tag");

  const [sources, setSources] = useState<SourceDef[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [queryInput, setQueryInput] = useState(query);

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [year, setYear] = useState("");
  const [sort, setSort] = useState<"relevance" | "newest" | "oldest">("relevance");
  // The specific-search panel's selections. Lists, and conjunctive: adding a
  // second tag or provision narrows rather than widens.
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [legal, setLegal] = useState<LegalSelection[]>([]);

  const [chipsExpanded, setChipsExpanded] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const [results, setResults] = useState<SearchResponse | null>(null);
  // The law itself, when the query names one — shown above the judgments.
  const [actHits, setActHits] = useState<ActSearchHit[]>([]);
  const [provisionHits, setProvisionHits] = useState<ProvisionSearchHit[]>([]);
  const [searchedQuery, setSearchedQuery] = useState("");
  const [searchedSources, setSearchedSources] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // The criteria the current result set was produced from. Paging must reuse
  // these rather than re-reading the form, so that typing a new query and then
  // clicking "page 3" doesn't return page 3 of a different search.
  const criteriaRef = useRef<SearchCriteria | null>(null);
  const resultsTopRef = useRef<HTMLDivElement | null>(null);
  // Guards against an earlier, slower request overwriting a later one.
  const requestIdRef = useRef(0);
  const resumePage = useRef(1);
  const resumeScroll = useRef<number | null>(null);

  // Normally OAuth opens a popup and this component never unmounts. Capture
  // the actual controls as well for a redirect/reload: only q/tag live in the
  // URL, so returning to that URL alone would silently discard all the filters.
  useEffect(() => {
    const capture = (e: Event) => {
      (e as CustomEvent).detail.search = { selected: [...selected], queryInput, dateFrom, dateTo, year,
        sort, activeTags, legal, page: results?.page ?? 1 } satisfies SearchView;
    };
    window.addEventListener(CAPTURE_VIEW_EVENT, capture);
    return () => window.removeEventListener(CAPTURE_VIEW_EVENT, capture);
  }, [selected, queryInput, dateFrom, dateTo, year, sort, activeTags, legal, results?.page]);

  useEffect(() => {
    const restored = readView<SearchView>("search");
    const pending = readContinuation();
    if (pending?.returnTo === currentPath()) resumeScroll.current = pending.scrollY;
    fetch("/api/sources")
      .then((r) => r.json())
      .then((d: { sources: SourceDef[] }) => {
        setSources(d.sources);
        // The courts, until the reader says otherwise. Seeded here rather
        // than in useState because it is the API's list that decides which
        // of the tree's keys actually exist.
        const keys = new Set(d.sources.map(s => s.key));
        if (restored && Array.isArray(restored.selected) && Array.isArray(restored.legal) &&
            Array.isArray(restored.activeTags) && ["relevance", "newest", "oldest"].includes(restored.sort) &&
            [restored.queryInput, restored.dateFrom, restored.dateTo, restored.year].every(v => typeof v === "string")) {
          setSelected(new Set(restored.selected.filter(k => keys.has(k))));
          setQueryInput(restored.queryInput); setDateFrom(restored.dateFrom); setDateTo(restored.dateTo);
          setYear(restored.year); setSort(restored.sort); setActiveTags(restored.activeTags);
          setLegal(restored.legal);
          resumePage.current = Number.isInteger(restored.page) && restored.page > 0 ? restored.page : 1;
        } else setSelected(new Set(defaultSourceKeys(keys)));
      })
      .catch(() => {
        setError("Ekki tókst að sækja lista yfir heimildir.");
        setLoading(false);
      });
  }, []);

  // A tag arrives as /?tag=fasteign from a result row: it replaces the
  // panel's tags, because it is a request to see that one subject.
  useEffect(() => {
    if (urlTag) setActiveTags([urlTag]);
  }, [urlTag]);

  useEffect(() => setQueryInput(query), [query]);

  const allKeys = useMemo(() => sources.map((s) => s.key), [sources]);
  const nameOf = useMemo(() => {
    const names = new Map(sources.map((s) => [s.key, s.name]));
    return (key: string) => names.get(key) ?? key;
  }, [sources]);

  /**
   * The act side of the same query, fetched alongside the judgments.
   *
   * Separate from the case search on purpose: it answers a different question,
   * it must not be able to fail the page, and it has nothing to do with which
   * sources are ticked. A query that names no act returns nothing and the page
   * looks exactly as it did before this existed.
   */
  async function fetchActs(criteria: SearchCriteria, requestId: number) {
    const q = criteria.query.trim();
    // A filtered browse ("show me the cases citing this provision") is not a
    // query naming an act, and neither is an empty box.
    if (q.length < 2) {
      setActHits([]);
      setProvisionHits([]);
      return;
    }
    try {
      const res = await fetch(`/api/search/acts?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (requestId !== requestIdRef.current) return; // superseded
      setActHits(data.acts ?? []);
      setProvisionHits(data.provisions ?? []);
    } catch {
      if (requestId !== requestIdRef.current) return;
      // The judgments are the rest of the answer and are already on their way.
      setActHits([]);
      setProvisionHits([]);
    }
  }

  async function fetchPage(criteria: SearchCriteria, page: number) {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError("");
    // Only on the first page: the act that heads a search stays put while its
    // judgments are paged through, and re-asking for it on page 4 would be a
    // query for an answer already on screen.
    if (page === 1 || resumeScroll.current !== null) void fetchActs(criteria, requestId);
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...criteria, page, pageSize: PAGE_SIZE }),
      });
      const data = await res.json();
      if (requestId !== requestIdRef.current) return; // superseded
      if (!res.ok) throw new Error(data.error ?? "Leitin brást.");
      setResults(data);
      setSearchedQuery(criteria.query);
      // From the criteria, not from `selected`: the panel can be mid-change
      // while these results are on screen, and the line above them has to
      // describe the results, not the selection that will replace them.
      setSearchedSources(criteria.sources.length);
      if (resumeScroll.current !== null) {
        const top = resumeScroll.current;
        resumeScroll.current = null;
        requestAnimationFrame(() => window.scrollTo({ top, behavior: "instant" }));
      }
    } catch (e: any) {
      if (requestId !== requestIdRef.current) return;
      setError(e.message);
      setResults(null);
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }

  /**
   * Every filter on the page, as one string.
   *
   * The search is not something you launch — it is what the controls
   * currently describe, re-run whenever any of them changes. Driving that
   * from one derived key rather than from a handler per control is what
   * keeps "tick a source" and "type a query" on the same path, and it is why
   * the year box can be typed into without firing a search per keystroke.
   */
  const searchKey = JSON.stringify({
    query,
    sources: Array.from(selected).sort(),
    dateFrom,
    dateTo,
    year,
    sort,
    tags: activeTags,
    legal: legal.map((l) => `${l.kind}:${l.id}`),
  });

  useEffect(() => {
    if (sources.length === 0) return; // the source list has not arrived yet
    if (selected.size === 0) {
      // Not an empty search: an empty *selection*, which the API refuses and
      // which the reader has to be told about rather than shown nothing.
      setResults(null);
      setActHits([]);
      setProvisionHits([]);
      criteriaRef.current = null;
      setLoading(false);
      return;
    }
    const criteria: SearchCriteria = {
      query,
      sources: Array.from(selected),
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      year: year ? Number(year) : undefined,
      tags: activeTags.length ? activeTags : undefined,
      actIds: legal.filter((l) => l.kind === "act").map((l) => l.id),
      provisionIds: legal.filter((l) => l.kind === "provision").map((l) => l.id),
      sort,
    };
    criteriaRef.current = criteria;
    setLoading(true);
    const timer = setTimeout(() => {
      const page = resumePage.current;
      resumePage.current = 1;
      void fetchPage(criteria, page);
    }, REFILTER_DELAY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchKey, sources.length]);

  function goToPage(page: number) {
    const criteria = criteriaRef.current;
    if (!criteria || !results) return;
    if (page < 1 || page > results.totalPages || page === results.page) return;
    fetchPage(criteria, page);
    resultsTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function submitQuery(e: React.FormEvent) {
    e.preventDefault();
    const next = queryInput.trim();
    if (!next) {
      // An empty search is usually someone working out what the box is for.
      // Offered once, then never again — a dialog that reappears on every
      // stray Enter is worse than no dialog.
      try {
        if (!localStorage.getItem("logbrunnur.help.seen")) {
          localStorage.setItem("logbrunnur.help.seen", "1");
          window.dispatchEvent(new CustomEvent("logbrunnur:open-help"));
        }
      } catch {
        /* storage blocked — the search below still runs */
      }
    }
    router.push(next ? `/?q=${encodeURIComponent(next)}` : "/");
  }

  /** Ticking a source adds or removes it — the boxes are the search. */
  function toggleSource(key: string) {
    setSelected((s) => {
      const next = new Set(s);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  function setSourceKeys(keys: string[], on: boolean) {
    setSelected((s) => {
      const next = new Set(s);
      keys.forEach((k) => (on ? next.add(k) : next.delete(k)));
      return next;
    });
  }

  /** "Only these" — the one-click version of clearing and ticking one box. */
  function onlySourceKeys(keys: string[]) {
    setSelected(new Set(keys));
  }

  const sourceChips = useMemo(
    () => activeFilterChips(selected, allKeys, nameOf),
    [selected, allKeys, nameOf]
  );
  const groupChips = sourceChips.filter((c) => c.isGroup);
  const singleChips = sourceChips.filter((c) => !c.isGroup);
  const shownSingles = chipsExpanded ? singleChips : singleChips.slice(0, CHIP_LIMIT);
  const hiddenSingles = chipsExpanded ? [] : singleChips.slice(CHIP_LIMIT);

  const everySource = allKeys.length > 0 && selected.size === allKeys.length;
  const dirty =
    activeTags.length > 0 ||
    legal.length > 0 ||
    Boolean(dateFrom || dateTo || year) ||
    sort !== "relevance" ||
    sourceChips.length > 0;

  const firstOnPage = results ? (results.page - 1) * results.pageSize + 1 : 0;
  const lastOnPage = results ? firstOnPage + results.hits.length - 1 : 0;

  function resetFilters() {
    setSelected(new Set(defaultSourceKeys(new Set(allKeys))));
    setActiveTags([]);
    setLegal([]);
    setDateFrom("");
    setDateTo("");
    setYear("");
    setSort("relevance");
  }

  const filterStack = (
    <>
      <SourcePanel
        sources={sources}
        selected={selected}
        onToggleSource={toggleSource}
        onSetSources={setSourceKeys}
        onOnlySources={onlySourceKeys}
      />
      <SpecificSearch
        legal={legal}
        onLegalChange={setLegal}
        tags={activeTags}
        onTagsChange={setActiveTags}
      />
    </>
  );

  const dateControls = (
    <>
      <UnderlineField label="Frá">
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          aria-label="Frá dagsetningu"
          className="w-[118px] border-0 bg-transparent text-[13.5px] text-text outline-none"
        />
      </UnderlineField>
      <UnderlineField label="Til">
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          aria-label="Til dagsetningar"
          className="w-[118px] border-0 bg-transparent text-[13.5px] text-text outline-none"
        />
      </UnderlineField>
      <UnderlineField label="Ár">
        <input
          type="number"
          value={year}
          onChange={(e) => setYear(e.target.value)}
          placeholder="—"
          aria-label="Ár"
          className="w-[56px] border-0 bg-transparent text-[13.5px] text-text outline-none placeholder:text-textMuted"
        />
      </UnderlineField>
      <UnderlineField label="Raða">
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as typeof sort)}
          aria-label="Raða eftir"
          className="border-0 bg-transparent text-[13.5px] text-text outline-none"
        >
          <option value="relevance">Vægi</option>
          <option value="newest">Nýjast fyrst</option>
          <option value="oldest">Elst fyrst</option>
        </select>
      </UnderlineField>
    </>
  );

  return (
    <>
      <div className="bg-paper px-4 pb-[26px] pt-[18px] lg:px-[30px]">
        <div className="flex items-start gap-[26px]">
          <aside className="hidden w-[262px] shrink-0 flex-col gap-[18px] lg:flex">
            {filterStack}
          </aside>

          <section className="min-w-0 flex-1">
            {/* The search box sits level with Heimildir, because the sources
                on the left and the dates on the right are the same act of
                asking as the words typed here. */}
            <form onSubmit={submitQuery} className="flex gap-2.5">
              <div className="relative flex-1">
                <SearchIcon className="pointer-events-none absolute left-3.5 top-[13px] h-[18px] w-[18px] text-textMuted" />
                <input
                  value={queryInput}
                  onChange={(e) => setQueryInput(e.target.value)}
                  aria-label="Leitarorð"
                  placeholder="Leitaðu að úrlausnum, lögum eða málsnúmeri"
                  lang="is"
                  className="w-full rounded-[3px] border border-lineStrong bg-white py-3 pl-11 pr-4 font-serif text-[16px] text-text placeholder:text-textMuted focus:border-ink"
                />
              </div>
              <button
                type="submit"
                className="shrink-0 rounded-[3px] bg-ink px-7 text-[15px] font-medium text-white transition-colors hover:bg-inkSoft"
              >
                Leita
              </button>
              <button
                type="button"
                onClick={() => setDrawerOpen(true)}
                className="inline-flex shrink-0 items-center gap-2 rounded-[3px] border border-lineStrong bg-white px-3.5 text-sm text-ink transition-colors hover:bg-glacier lg:hidden"
              >
                <FiltersIcon className="h-4 w-4 text-inkSoft" />
                Síur
              </button>
            </form>

            <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px]">
              {everySource ? (
                <span className="text-textMuted">
                  Leitað í öllum heimildum · {allKeys.length}
                </span>
              ) : (
                <span className="text-[10px] uppercase tracking-[.14em] text-textMuted">
                  Heimildir
                </span>
              )}

              {groupChips.map((chip) => (
                <FilterPill
                  key={chip.label}
                  label={chip.label}
                  tone="solid"
                  onRemove={() => setSourceKeys(chip.keys, false)}
                />
              ))}
              {shownSingles.map((chip) => (
                <FilterPill
                  key={chip.keys[0]}
                  label={chip.label}
                  onRemove={() => setSourceKeys(chip.keys, false)}
                />
              ))}
              {hiddenSingles.length > 0 && (
                <button
                  type="button"
                  onClick={() => setChipsExpanded(true)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-lineStrong px-3 py-1 text-xs text-inkSoft transition-colors hover:bg-glacier"
                >
                  + {hiddenSingles.length} fleiri
                  <ChevronDownIcon className="h-3 w-3" />
                </button>
              )}
              {chipsExpanded && singleChips.length > CHIP_LIMIT && (
                <button
                  type="button"
                  onClick={() => setChipsExpanded(false)}
                  className="text-xs text-textMuted underline underline-offset-[3px] hover:text-ink"
                >
                  Sýna færri
                </button>
              )}

              {legal.map((l) => (
                <FilterPill
                  key={`${l.kind}-${l.id}`}
                  label={l.label}
                  onRemove={() => setLegal(legal.filter((x) => x.id !== l.id))}
                />
              ))}
              {activeTags.map((t) => (
                <FilterPill
                  key={t}
                  label={t}
                  onRemove={() => setActiveTags(activeTags.filter((x) => x !== t))}
                />
              ))}
              {(dateFrom || dateTo) && (
                <FilterPill
                  label={`${dateFrom || "…"} – ${dateTo || "…"}`}
                  tone="moss"
                  onRemove={() => {
                    setDateFrom("");
                    setDateTo("");
                  }}
                />
              )}
              {year && <FilterPill label={year} tone="moss" onRemove={() => setYear("")} />}

              {dirty && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="text-xs text-textMuted underline underline-offset-[3px] hover:text-ink"
                >
                  Hreinsa allt
                </button>
              )}

              <div className="ml-auto hidden items-center gap-5 text-textMuted lg:flex">
                {dateControls}
              </div>
            </div>

            <div ref={resultsTopRef} className="scroll-mt-4" />

            {/* The law itself, above everything: the chips are the state of
                the query; this is its answer. */}
            <div className="mt-4">
              <ActResults
                acts={actHits}
                provisions={provisionHits}
                onFilterByAct={(act) =>
                  setLegal([
                    ...legal.filter((l) => l.id !== act.id),
                    {
                      kind: "act",
                      id: act.id,
                      actId: act.id,
                      label: act.fullLabel,
                      sublabel: act.citation,
                      path: act.path,
                      jurisdiction: act.jurisdiction,
                      eeaRelevant: act.eeaRelevant,
                      eeaIncorporatedBy: act.eeaIncorporatedBy,
                    },
                  ])
                }
                onFilterByProvision={(provision) =>
                  setLegal([
                    ...legal.filter((l) => l.id !== provision.id),
                    {
                      kind: "provision",
                      id: provision.id,
                      actId: provision.actId,
                      label: provision.fullLabel,
                      sublabel: provision.actTitle,
                      path: provision.path,
                    },
                  ])
                }
              />
            </div>

            {error && (
              <div className="rounded-[3px] border border-lineStrong bg-white p-4 text-sm text-text">
                {error}
              </div>
            )}

            {!error && selected.size === 0 && (
              <div className="rounded-[3px] border border-dashed border-lineStrong bg-white p-10 text-center">
                <p className="font-heading text-lg text-ink">Engin heimild valin.</p>
                <p className="mt-1 text-sm text-textMuted">
                  Veldu að minnsta kosti eina heimild til vinstri — það er hún sem leitað er í.
                </p>
              </div>
            )}

            {!error && selected.size > 0 && (
              <div className="rounded-[3px] border border-line bg-white">
                <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-3">
                  <p className="text-[12.5px] text-textMuted">
                    {loading && !results ? (
                      "Leita…"
                    ) : results && results.total === 0 ? (
                      "Engar úrlausnir"
                    ) : results ? (
                      <>
                        Sýni{" "}
                        <span className="font-semibold text-text">
                          {firstOnPage.toLocaleString("is-IS")}–{lastOnPage.toLocaleString("is-IS")}
                        </span>{" "}
                        af{" "}
                        <span className="font-semibold text-text">
                          {results.total.toLocaleString("is-IS")}
                          {results.totalIsCapped && "+"}
                        </span>{" "}
                        úrlausnum
                      </>
                    ) : null}
                    {results && searchedQuery && (
                      <>
                        {" "}
                        fyrir <span className="font-semibold text-text">{searchedQuery}</span>
                      </>
                    )}
                  </p>
                  {results && (
                    <span className="text-[11px] uppercase tracking-[.1em] text-textMuted">
                      Leitað í {searchedSources.toLocaleString("is-IS")} heimildum
                    </span>
                  )}
                </div>

                {/* One line that says the page is working. It sits on the
                    panel's own edge so it reads as "these results are being
                    replaced" rather than as a page-wide spinner. */}
                {loading && <div className="loading-bar" role="status" aria-label="Leita" />}

                {!results && loading && <ResultSkeleton />}

                {results && (
                  <div className={loading ? "opacity-50 transition-opacity" : undefined}>
                    {results.hits.map((h) => (
                      <ResultCard key={h.id} hit={h} query={searchedQuery} />
                    ))}
                    {results.hits.length === 0 && (
                      <p className="px-5 py-6 text-sm text-textMuted">
                        Engar úrlausnir fundust í völdum heimildum. Reyndu færri orð, víðara
                        tímabil eða fleiri heimildir.
                      </p>
                    )}
                  </div>
                )}

                {results && (
                  <Pagination
                    page={results.page}
                    totalPages={results.totalPages}
                    disabled={loading}
                    onPageChange={goToPage}
                  />
                )}
              </div>
            )}
          </section>
        </div>
      </div>

      {/* ---- Filter drawer, below the sidebar breakpoint ---------------- */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-40 flex justify-end bg-[rgba(15,42,68,.55)] lg:hidden"
          onClick={(e) => e.target === e.currentTarget && setDrawerOpen(false)}
        >
          <div className="flex h-full w-[320px] max-w-full flex-col gap-[18px] overflow-y-auto bg-paper p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-heading text-[15px] font-medium text-ink">Síur</h2>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="text-sm text-textMuted hover:text-ink"
              >
                Loka
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-4 rounded-[3px] border border-line bg-white p-3 text-textMuted">
              {dateControls}
            </div>
            {filterStack}
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Rows in the shape of the results they are standing in for, so the panel
 * does not change height when the real ones arrive.
 */
function ResultSkeleton() {
  return (
    <div aria-hidden className="animate-pulse">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="flex gap-6 border-b border-lineSoft px-5 py-[17px]">
          <div className="flex-1">
            <div className="h-3 w-40 rounded bg-paper" />
            <div className="mt-2.5 h-4 w-3/4 rounded bg-paper" />
            <div className="mt-2.5 h-3 w-full rounded bg-paper" />
            <div className="mt-1.5 h-3 w-5/6 rounded bg-paper" />
          </div>
          <div className="hidden w-[176px] shrink-0 border-l border-lineSoft pl-5 sm:block">
            <div className="h-3 w-24 rounded bg-paper" />
            <div className="mt-2.5 h-3 w-32 rounded bg-paper" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * A date or sort control: a label and its field over one hairline, with no
 * box. They sit beside the search rather than behind a disclosure, where a
 * date range nobody could see was silently narrowing people's results.
 */
function UnderlineField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-baseline gap-2 border-b border-lineStrong pb-1">
      <span className="text-[12px]">{label}</span>
      {children}
    </span>
  );
}

/**
 * One active filter. Navy when it stands for a whole category, glacier for a
 * single source or selection, moss for the date and year — the same three
 * meanings the panel beside it uses.
 */
function FilterPill({
  label,
  onRemove,
  tone = "glacier",
}: {
  label: string;
  onRemove: () => void;
  tone?: "solid" | "glacier" | "moss";
}) {
  const tones = {
    solid: "bg-ink text-white",
    glacier: "bg-glacier text-ink",
    moss: "bg-[#DCE5DC] text-mossText",
  } as const;
  return (
    <span
      className={`inline-flex max-w-full items-center gap-2 rounded-full py-1 pl-3 pr-2 text-xs ${tones[tone]} ${
        tone === "solid" ? "font-medium" : ""
      }`}
    >
      <span className="truncate">{label}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Fjarlægja ${label}`}
        className={tone === "solid" ? "text-[#9BB0C4] hover:text-white" : "text-inkSoft hover:text-ink"}
      >
        ✕
      </button>
    </span>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={null}>
      <SearchPageInner />
    </Suspense>
  );
}
