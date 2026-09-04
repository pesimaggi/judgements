"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Pagination } from "@/components/Pagination";
import { ScopeToggle, useActScope } from "@/components/ScopeToggle";
import { eeaTag } from "@/lib/eea-tag";

interface ActListItem {
  id: string;
  jurisdiction: string;
  actNumber: number;
  year: number;
  title: string;
  citation: string;
  path: string;
  aliases: string[];
  provisionCount: number;
  citingCases: number;
  currentVersionUrl: string;
  eeaRelevant: boolean;
  eeaIncorporatedBy: string[];
  status: string;
  textStatus: string | null;
}

type Sort = "title" | "number" | "cases" | "provisions";
type Corpus = "is" | "eu";

const SORT_LABELS: { value: Sort; label: string }[] = [
  { value: "title", label: "Heiti (A–Ö)" },
  { value: "number", label: "Nýjust fyrst" },
  { value: "cases", label: "Flestar úrlausnir" },
  { value: "provisions", label: "Flestar greinar" },
];

const PAGE_SIZE = 100;

/**
 * The act catalogue — Icelandic acts from Lagasafn, and EU acts from EUR-Lex.
 *
 * Two corpora, one page, because they are the same kind of thing and a reader
 * looking for "the rule" should not have to know which of the two libraries it
 * is filed in. What differs is the size: ~900 Icelandic acts against tens of
 * thousands of EU ones, which is why the search box and the paging are
 * server-side. This page used to fetch the whole list once and filter it in
 * the browser; that is a fine trick for 900 rows of metadata and a download
 * for 33,000.
 *
 * The EU tab carries the EEA/ESB scope toggle — see components/ScopeToggle.
 */
export default function ActIndexPage() {
  const [acts, setActs] = useState<ActListItem[]>([]);
  const [totals, setTotals] = useState({
    acts: 0,
    provisions: 0,
    linkedProvisions: 0,
    icelandic: 0,
    eu: 0,
    euEea: 0,
  });
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [corpus, setCorpus] = useState<Corpus>("is");
  const [scope, setScope] = useActScope();
  const [sort, setSort] = useState<Sort>("title");
  const [citedOnly, setCitedOnly] = useState(false);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // A new filter, corpus or scope is a new list; staying on page 7 of it would
  // show an empty page more often than not.
  useEffect(() => {
    setPage(1);
  }, [filter, corpus, scope, sort, citedOnly]);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({
      catalogue: "1",
      sort,
      scope,
      jurisdiction: corpus,
      page: String(page),
      pageSize: String(PAGE_SIZE),
    });
    if (citedOnly) params.set("cited", "1");
    if (filter.trim()) params.set("q", filter.trim());

    // Debounced, because this runs on every keystroke in the search box and
    // each run is a query over the whole corpus.
    const timer = setTimeout(() => {
      fetch(`/api/acts?${params}`)
        .then((r) => r.json())
        .then((d) => {
          if (d.error) throw new Error(d.error);
          setActs(d.acts);
          setTotals(d.totals);
          setTotal(d.total);
          setTotalPages(d.totalPages);
          setError("");
        })
        .catch(() => setError("Could not load the list of acts."))
        .finally(() => setLoading(false));
    }, 200);
    return () => clearTimeout(timer);
  }, [sort, citedOnly, corpus, scope, page, filter]);

  const isEu = corpus === "eu";

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <Link href="/" className="text-xs text-inkSoft hover:underline">
        ← Search
      </Link>

      <header className="mt-2">
        <h1 className="font-serif text-2xl font-semibold">{isEu ? "ESB-gerðir" : "Lög"}</h1>
        <p className="mt-1 text-sm text-inkSoft">
          {isEu ? (
            <>
              EU acts in force — regulations and directives — from{" "}
              <a
                href="https://eur-lex.europa.eu"
                target="_blank"
                rel="noreferrer"
                className="text-accent hover:underline"
              >
                EUR-Lex
              </a>
              , with the articles of each.{" "}
              {totals.eu > 0 && (
                <>
                  {totals.eu.toLocaleString("is-IS")} gerðir ·{" "}
                  {totals.euEea.toLocaleString("is-IS")} með mögulega EES-þýðingu.
                </>
              )}
            </>
          ) : (
            <>
              Every act ingested from{" "}
              <a
                href="https://www.althingi.is/lagas/"
                target="_blank"
                rel="noreferrer"
                className="text-accent hover:underline"
              >
                Lagasafn
              </a>
              , the in-force text of Icelandic law.{" "}
              {totals.icelandic > 0 && (
                <>
                  {totals.icelandic.toLocaleString("is-IS")} lög ·{" "}
                  {totals.provisions.toLocaleString("is-IS")} greinar ·{" "}
                  {totals.linkedProvisions.toLocaleString("is-IS")} greinar sem úrlausnir vísa til.
                </>
              )}
            </>
          )}
        </p>
      </header>

      {/* ---- Which corpus, and how much of it ------------------------ */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="inline-flex overflow-hidden rounded-lg border border-line">
          {([
            { value: "is" as const, label: "Íslensk lög", count: totals.icelandic },
            { value: "eu" as const, label: "ESB-gerðir", count: totals.eu },
          ]).map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => setCorpus(tab.value)}
              aria-pressed={corpus === tab.value}
              className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                corpus === tab.value ? "bg-ink text-white" : "bg-white text-inkSoft hover:bg-paper"
              }`}
            >
              {tab.label}
              {tab.count > 0 && (
                <span className={`ml-1.5 text-[11px] ${corpus === tab.value ? "text-white/70" : "text-inkSoft/70"}`}>
                  {tab.count.toLocaleString("is-IS")}
                </span>
              )}
            </button>
          ))}
        </div>

        {isEu && (
          <div className="flex items-center gap-2">
            <ScopeToggle
              scope={scope}
              onChange={setScope}
              counts={{ eea: totals.euEea, eu: totals.eu }}
            />
            <span className="text-[11px] text-inkSoft">
              {scope === "eea"
                ? "Aðeins gerðir sem geta haft EES-þýðingu."
                : "Allar gerðir, líka þær sem hafa ekki verið teknar upp í EES-samninginn."}
            </span>
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label htmlFor="act-filter" className="text-xs font-medium text-inkSoft">
            Leita
          </label>
          <input
            id="act-filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={
              isEu
                ? "Heiti, stuttnefni („gdpr“), númer („2016/679“) eða CELEX"
                : "Heiti, stuttnefni („vaxtalög“) eða númer („38/2001“)"
            }
            className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-ink"
            lang={isEu ? "en" : "is"}
          />
        </div>
        <div>
          <label htmlFor="act-sort" className="text-xs font-medium text-inkSoft">
            Raða eftir
          </label>
          <select
            id="act-sort"
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            className="mt-1 w-full rounded-lg border border-line bg-white px-2 py-2 text-sm outline-none focus:border-ink sm:w-44"
          >
            {SORT_LABELS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <label className="flex cursor-pointer items-center gap-2 pb-2 text-sm text-inkSoft">
          <input
            type="checkbox"
            checked={citedOnly}
            onChange={(e) => setCitedOnly(e.target.checked)}
            className="h-4 w-4 rounded border-line accent-accent"
          />
          Aðeins þau sem úrlausnir vísa til
        </label>
      </div>

      <p className="mt-2 text-xs text-inkSoft">
        {loading
          ? "Sæki…"
          : `${total.toLocaleString("is-IS")} ${isEu ? "gerðir" : "lög"}${
              totalPages > 1 ? ` · síða ${page} af ${totalPages}` : ""
            }`}
      </p>

      {error && <p className="mt-3 text-sm text-accent">{error}</p>}

      <ul className="mt-3 divide-y divide-line overflow-hidden rounded-lg border border-line bg-white">
        {acts.map((a) => (
          <li key={a.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5">
            <Link
              href={a.path}
              className="min-w-0 flex-1 font-serif text-[15px] leading-snug hover:underline"
            >
              {a.title}
            </Link>
            <span className="font-mono text-[11px] text-inkSoft">{a.citation}</span>
            <EeaBadge act={a} />
            {a.status === "no_longer_in_force" && (
              <span className="shrink-0 text-[10px] text-inkSoft">fallin úr gildi</span>
            )}
            <span className="shrink-0 text-[11px] text-inkSoft">
              {a.provisionCount > 0
                ? `${a.provisionCount} gr.`
                : a.jurisdiction === "eu" && a.textStatus !== "stored"
                  ? "texti ósóttur"
                  : "engin grein birt"}
            </span>
            <span className="w-24 shrink-0 text-right text-[11px]">
              {a.citingCases > 0 ? (
                <span className="rounded-full bg-accentSoft px-2 py-0.5 font-medium text-accent">
                  {a.citingCases} {a.citingCases === 1 ? "úrlausn" : "úrlausnir"}
                </span>
              ) : (
                <span className="text-inkSoft">—</span>
              )}
            </span>
          </li>
        ))}
      </ul>

      {!loading && acts.length === 0 && !error && (
        <p className="mt-3 text-sm text-inkSoft">
          {isEu && scope === "eea"
            ? "Ekkert fannst innan EES. Prófaðu ESB-stillinguna til að leita í öllum gerðum."
            : "Ekkert fannst."}
        </p>
      )}

      <div className="mt-4">
        <Pagination page={page} totalPages={totalPages} disabled={loading} onPageChange={setPage} />
      </div>

      <p className="mt-4 text-center text-[11px] text-inkSoft">
        Unofficial reproduction of the consolidated text. Always verify against the official source.
      </p>
    </main>
  );
}

/**
 * The EES tag, as it appears in a list: two words and a tooltip carrying the
 * decision numbers. Shared with the act reader and the act type-ahead through
 * eeaTag(), so all three make the same claim.
 */
function EeaBadge({ act }: { act: { jurisdiction: string; eeaRelevant: boolean; eeaIncorporatedBy: string[] } }) {
  const tag = eeaTag(act);
  if (!tag) return null;
  return (
    <span
      title={tag.detail}
      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${
        tag.status === "incorporated"
          ? "bg-accentSoft font-medium text-accent"
          : "border border-line text-inkSoft"
      }`}
    >
      {tag.label}
    </span>
  );
}
