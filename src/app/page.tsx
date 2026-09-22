"use client";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { SourcePanel } from "@/components/SourcePanel";
import { SpecificSearch, type LegalSelection } from "@/components/SpecificSearch";
import { ResultCard } from "@/components/ResultCard";
import { Pagination } from "@/components/Pagination";
import { HomeCases } from "@/components/HomeCases";
import { ActResults, type ActSearchHit, type ProvisionSearchHit } from "@/components/ActResults";
import { ChevronDownIcon, FiltersIcon } from "@/components/icons";
import { activeFilterChips } from "@/lib/source-tree";
import type { SourceDef } from "@/lib/sources";
import type { SearchResponse } from "@/lib/types";

const PAGE_SIZE = 15;
/** How many individual source chips the filter bar shows before folding. */
const CHIP_LIMIT = 4;
/** Long enough that ticking four boxes is one search, short enough to feel live. */
const REFILTER_DELAY_MS = 350;

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
  // The query lives in the URL, because the box that sets it is in the
  // masthead and a result page has to be linkable. See components/Masthead.
  const query = searchParams.get("q") ?? "";
  const urlTag = searchParams.get("tag");

  const [sources, setSources] = useState<SourceDef[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set()); // nothing selected = everything

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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // The criteria the current result set was produced from. Paging must reuse
  // these rather than re-reading the form, so that typing a new query and then
  // clicking "page 3" doesn't return page 3 of a different search.
  const criteriaRef = useRef<SearchCriteria | null>(null);
  const resultsTopRef = useRef<HTMLDivElement | null>(null);
  // Guards against an earlier, slower request overwriting a later one.
  const requestIdRef = useRef(0);
  // Read whenever a search is re-run: the handlers need every filter's
  // current value without the effects having to list them as dependencies,
  // which would re-run the search on each keystroke in the year box. Kept in
  // step after each commit; a handler that changes a filter *and* searches in
  // the same tick writes it eagerly, because state has not updated yet at
  // that point.
  const filtersRef = useRef({ selected, activeTags, legal, dateFrom, dateTo, year, sort });
  useEffect(() => {
    filtersRef.current = { selected, activeTags, legal, dateFrom, dateTo, year, sort };
  });

  useEffect(() => {
    fetch("/api/sources")
      .then((r) => r.json())
      .then((d) => setSources(d.sources))
      .catch(() => setError("Ekki tókst að sækja lista yfir heimildir."));
  }, []);

  const allKeys = useMemo(() => sources.map((s) => s.key), [sources]);
  const nameOf = useMemo(() => {
    const names = new Map(sources.map((s) => [s.key, s.name]));
    return (key: string) => names.get(key) ?? key;
  }, [sources]);

  const toggle = (set: Set<string>, v: string) => {
    const next = new Set(set);
    next.has(v) ? next.delete(v) : next.add(v);
    return next;
  };

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
    if (page === 1) void fetchActs(criteria, requestId);
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
    } catch (e: any) {
      if (requestId !== requestIdRef.current) return;
      setError(e.message);
      setResults(null);
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }

  function buildCriteria(opts?: {
    tagsOverride?: string[];
    legalOverride?: LegalSelection[];
  }): SearchCriteria | null {
    const current = filtersRef.current;
    const tags = opts?.tagsOverride ?? current.activeTags;
    const legalFilter = opts?.legalOverride ?? current.legal;
    // Nothing ticked → search every source rather than blocking the search.
    const activeSources = current.selected.size > 0 ? Array.from(current.selected) : allKeys;
    if (activeSources.length === 0) return null; // sources not loaded yet

    return {
      query,
      sources: activeSources,
      dateFrom: current.dateFrom || undefined,
      dateTo: current.dateTo || undefined,
      year: current.year ? Number(current.year) : undefined,
      tags: tags.length ? tags : undefined,
      actIds: legalFilter.filter((l) => l.kind === "act").map((l) => l.id),
      provisionIds: legalFilter.filter((l) => l.kind === "provision").map((l) => l.id),
      sort: current.sort,
    };
  }

  function runSearch(opts?: { tagsOverride?: string[]; legalOverride?: LegalSelection[] }) {
    const criteria = buildCriteria(opts);
    if (!criteria) return;
    criteriaRef.current = criteria;
    fetchPage(criteria, 1);
  }

  /**
   * Picking an act, a provision or a tag runs the search straight away —
   * "show me the cases about this" is the whole point of the panel, so making
   * the user then reach for the search button would be a pointless step. The
   * chosen value is passed explicitly rather than read from state, which has
   * not re-rendered yet at this point.
   */
  function applyLegal(selections: LegalSelection[]) {
    setLegal(selections);
    filtersRef.current = { ...filtersRef.current, legal: selections };
    runSearch({ legalOverride: selections });
  }

  function applyTags(next: string[]) {
    setActiveTags(next);
    filtersRef.current = { ...filtersRef.current, activeTags: next };
    runSearch({ tagsOverride: next });
  }

  function goToPage(page: number) {
    const criteria = criteriaRef.current;
    if (!criteria || !results) return;
    if (page < 1 || page > results.totalPages || page === results.page) return;
    fetchPage(criteria, page);
    resultsTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // What the URL asks for. A query typed in the masthead lands here as ?q=,
  // and a subject tag clicked on a result as ?tag= — the second clears the
  // panel's own tags, because it is a request to see that one subject.
  useEffect(() => {
    if (sources.length === 0) return;
    if (!query && !urlTag) {
      setResults(null);
      setActHits([]);
      setProvisionHits([]);
      setSearchedQuery("");
      criteriaRef.current = null;
      return;
    }
    const tagsOverride = urlTag ? [urlTag] : undefined;
    if (tagsOverride) setActiveTags(tagsOverride);
    const criteria = buildCriteria({ tagsOverride });
    if (!criteria) return;
    criteriaRef.current = criteria;
    fetchPage(criteria, 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, urlTag, sources]);

  // The filter bar and the source panel apply as they are changed: they are
  // in view, and a control that visibly changes nothing until a button
  // elsewhere is pressed reads as broken. Debounced so that ticking four
  // boxes is one search rather than four, and only once a search exists —
  // before that there is nothing to re-run.
  const filterSignature = `${Array.from(selected).sort().join(",")}|${dateFrom}|${dateTo}|${year}|${sort}`;
  const lastSignature = useRef<string | null>(null);
  useEffect(() => {
    if (!criteriaRef.current) {
      lastSignature.current = filterSignature;
      return;
    }
    if (lastSignature.current === filterSignature) return;
    lastSignature.current = filterSignature;
    const timer = setTimeout(() => runSearch(), REFILTER_DELAY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterSignature]);

  function removeTag(tag: string) {
    applyTags(activeTags.filter((t) => t !== tag));
  }

  function setSources_(keys: string[], on: boolean) {
    setSelected((s) => {
      const next = new Set(s);
      // Ticking a group while "nothing means everything" is in force has to
      // start from everything, or the first tick would silently *narrow* to
      // one group without the reader asking for it.
      if (s.size === 0 && !on) allKeys.forEach((k) => next.add(k));
      keys.forEach((k) => (on ? next.add(k) : next.delete(k)));
      return next;
    });
  }

  const sourceChips = useMemo(
    () => activeFilterChips(selected, allKeys, nameOf),
    [selected, allKeys, nameOf]
  );
  const groupChips = sourceChips.filter((c) => c.isGroup);
  const singleChips = sourceChips.filter((c) => !c.isGroup);
  const shownSingles = chipsExpanded ? singleChips : singleChips.slice(0, CHIP_LIMIT);
  const hiddenSingles = chipsExpanded ? [] : singleChips.slice(CHIP_LIMIT);

  const searchingAll = sourceChips.length === 0;
  const dirty =
    !searchingAll ||
    activeTags.length > 0 ||
    legal.length > 0 ||
    Boolean(dateFrom || dateTo || year) ||
    sort !== "relevance";

  const firstOnPage = results ? (results.page - 1) * results.pageSize + 1 : 0;
  const lastOnPage = results ? firstOnPage + results.hits.length - 1 : 0;

  function clearAll() {
    setSelected(new Set());
    setActiveTags([]);
    setLegal([]);
    setDateFrom("");
    setDateTo("");
    setYear("");
    setSort("relevance");
    filtersRef.current = {
      selected: new Set(),
      activeTags: [],
      legal: [],
      dateFrom: "",
      dateTo: "",
      year: "",
      sort: "relevance",
    };
    if (criteriaRef.current) runSearch({ tagsOverride: [], legalOverride: [] });
  }

  const filterStack = (
    <>
      <SourcePanel
        sources={sources}
        selected={selected}
        onToggleSource={(k) =>
          setSelected((s) => (s.size === 0 ? new Set(allKeys.filter((x) => x !== k)) : toggle(s, k)))
        }
        onSetSources={setSources_}
      />
      <SpecificSearch
        legal={legal}
        onLegalChange={applyLegal}
        tags={activeTags}
        onTagsChange={applyTags}
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
          className="w-[110px] border-0 bg-transparent text-[12.5px] text-text outline-none"
        />
      </UnderlineField>
      <UnderlineField label="Til">
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          aria-label="Til dagsetningar"
          className="w-[110px] border-0 bg-transparent text-[12.5px] text-text outline-none"
        />
      </UnderlineField>
      <UnderlineField label="Ár">
        <input
          type="number"
          value={year}
          onChange={(e) => setYear(e.target.value)}
          placeholder="2024"
          aria-label="Ár"
          className="w-[52px] border-0 bg-transparent text-[12.5px] text-text outline-none placeholder:text-textMuted"
        />
      </UnderlineField>
      <UnderlineField label="Raða">
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as typeof sort)}
          aria-label="Raða eftir"
          className="border-0 bg-transparent text-[12.5px] text-text outline-none"
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
      {/* ---- Filter bar ------------------------------------------------ */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-white px-4 py-2.5 text-[12.5px] lg:px-[30px]">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="inline-flex items-center gap-2 rounded-[3px] border border-lineStrong px-2.5 py-1 text-xs text-ink transition-colors hover:bg-glacier lg:hidden"
        >
          <FiltersIcon className="h-3.5 w-3.5 text-inkSoft" />
          Síur
        </button>

        {searchingAll ? (
          <span className="text-textMuted">
            Leitað í öllum heimildum · {allKeys.length || "…"}
          </span>
        ) : (
          <span className="text-[10px] uppercase tracking-[.14em] text-textMuted">Heimildir</span>
        )}

        {groupChips.map((chip) => (
          <FilterPill
            key={chip.label}
            label={chip.label}
            tone="solid"
            onRemove={() => setSources_(chip.keys, false)}
          />
        ))}
        {shownSingles.map((chip) => (
          <FilterPill
            key={chip.keys[0]}
            label={chip.label}
            onRemove={() => setSources_(chip.keys, false)}
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
            onRemove={() => applyLegal(legal.filter((x) => x.id !== l.id))}
          />
        ))}
        {activeTags.map((t) => (
          <FilterPill key={t} label={t} onRemove={() => removeTag(t)} />
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
            onClick={clearAll}
            className="text-xs text-textMuted underline underline-offset-[3px] hover:text-ink"
          >
            Hreinsa allt
          </button>
        )}

        <div className="ml-auto hidden items-center gap-4 text-textMuted lg:flex">
          {dateControls}
        </div>
      </div>

      {/* ---- Body ------------------------------------------------------ */}
      <div className="flex items-start gap-[26px] bg-paper px-4 pb-[26px] pt-[22px] lg:px-[30px]">
        <aside className="hidden w-[262px] shrink-0 flex-col gap-[18px] lg:flex">{filterStack}</aside>

        <section className="min-w-0 flex-1">
          <div ref={resultsTopRef} className="scroll-mt-4" />

          {/* The law itself, above everything: the chips are the state of the
              query; this is its answer. */}
          <ActResults
            acts={actHits}
            provisions={provisionHits}
            onFilterByAct={(act) =>
              applyLegal([
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
              applyLegal([
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

          {error && (
            <div className="mb-3 rounded-[3px] border border-lineStrong bg-white p-3 text-sm text-text">
              {error}
            </div>
          )}

          {!results && !error && <HomeCases />}

          {results && (
            <div className="rounded-[3px] border border-line bg-white">
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-3">
                <p className="text-[12.5px] text-textMuted">
                  {results.total === 0 ? (
                    "Engar úrlausnir"
                  ) : (
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
                  )}
                  {searchedQuery && (
                    <>
                      {" "}
                      fyrir <span className="font-semibold text-text">{searchedQuery}</span>
                    </>
                  )}
                  {legal.length > 0 && (
                    <>
                      {" "}
                      sem vísa í{" "}
                      <span className="font-semibold text-text">
                        {legal.map((l) => l.label).join(" + ")}
                      </span>
                    </>
                  )}
                </p>
                <span className="text-[11px] uppercase tracking-[.1em] text-textMuted">
                  Leitað í {searchedSources.toLocaleString("is-IS")} heimildum
                </span>
              </div>

              <div className={loading ? "opacity-50 transition-opacity" : undefined}>
                {results.hits.map((h) => (
                  <ResultCard key={h.id} hit={h} query={searchedQuery} />
                ))}
                {results.hits.length === 0 && (
                  <p className="px-5 py-6 text-sm text-textMuted">
                    Engar úrlausnir fundust í völdum heimildum. Reyndu færri orð, víðara tímabil
                    eða fleiri heimildir.
                  </p>
                )}
              </div>

              <Pagination
                page={results.page}
                totalPages={results.totalPages}
                disabled={loading}
                onPageChange={goToPage}
              />
            </div>
          )}
        </section>
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
 * A date or sort control: a label and its field over one hairline, with no
 * box. They sit in the filter bar rather than behind a disclosure, where a
 * date range nobody could see was silently narrowing people's results.
 */
function UnderlineField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-baseline gap-[7px] border-b border-lineStrong pb-0.5">
      <span className="text-[11px]">{label}</span>
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
