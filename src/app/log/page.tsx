"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

interface ActListItem {
  id: string;
  actNumber: number;
  year: number;
  title: string;
  citation: string;
  path: string;
  aliases: string[];
  provisionCount: number;
  citingCases: number;
  currentVersionUrl: string;
}

type Sort = "title" | "number" | "cases" | "provisions";

const SORT_LABELS: { value: Sort; label: string }[] = [
  { value: "title", label: "Heiti (A–Ö)" },
  { value: "number", label: "Nýjust fyrst" },
  { value: "cases", label: "Flestar úrlausnir" },
  { value: "provisions", label: "Flestar greinar" },
];

/**
 * The act catalogue — every act ingested from Lagasafn.
 *
 * The whole list is fetched once (it is ~900 rows of metadata, not text) and
 * filtered in the browser, so typing is instant and does not put a query per
 * keystroke on the database. Sorting is server-side, because "most cited"
 * needs the counts computed across the full corpus rather than the page.
 */
export default function ActIndexPage() {
  const [acts, setActs] = useState<ActListItem[]>([]);
  const [totals, setTotals] = useState({ acts: 0, provisions: 0, linkedProvisions: 0 });
  const [sort, setSort] = useState<Sort>("title");
  const [citedOnly, setCitedOnly] = useState(false);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ sort, pageSize: "1000" });
    if (citedOnly) params.set("cited", "1");
    fetch(`/api/acts?${params}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setActs(d.acts);
        setTotals(d.totals);
        setError("");
      })
      .catch(() => setError("Could not load the list of acts."))
      .finally(() => setLoading(false));
  }, [sort, citedOnly]);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return acts;
    return acts.filter(
      (a) =>
        a.title.toLowerCase().includes(q) ||
        a.citation.includes(q) ||
        `${a.actNumber}/${a.year}`.includes(q) ||
        a.aliases.some((alias) => alias.includes(q))
    );
  }, [acts, filter]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <Link href="/" className="text-xs text-inkSoft hover:underline">
        ← Search
      </Link>

      <header className="mt-2">
        <h1 className="font-serif text-2xl font-semibold">Lög</h1>
        <p className="mt-1 text-sm text-inkSoft">
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
          {totals.acts > 0 && (
            <>
              {totals.acts.toLocaleString("is-IS")} lög ·{" "}
              {totals.provisions.toLocaleString("is-IS")} greinar ·{" "}
              {totals.linkedProvisions.toLocaleString("is-IS")} greinar sem úrlausnir vísa til.
            </>
          )}
        </p>
      </header>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label htmlFor="act-filter" className="text-xs font-medium text-inkSoft">
            Leita
          </label>
          <input
            id="act-filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Heiti, stuttnefni („vaxtalög“) eða númer („38/2001“)"
            className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-ink"
            lang="is"
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
          Aðeins lög sem úrlausnir vísa til
        </label>
      </div>

      <p className="mt-2 text-xs text-inkSoft">
        {loading
          ? "Sæki lög…"
          : `${visible.length.toLocaleString("is-IS")}${
              filter.trim() ? ` af ${acts.length.toLocaleString("is-IS")}` : ""
            } lög`}
      </p>

      {error && <p className="mt-3 text-sm text-accent">{error}</p>}

      <ul className="mt-3 divide-y divide-line overflow-hidden rounded-lg border border-line bg-white">
        {visible.map((a) => (
          <li key={a.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5">
            <Link
              href={a.path}
              className="min-w-0 flex-1 font-serif text-[15px] leading-snug hover:underline"
            >
              {a.title}
            </Link>
            <span className="font-mono text-[11px] text-inkSoft">{a.citation}</span>
            <span className="shrink-0 text-[11px] text-inkSoft">
              {a.provisionCount > 0
                ? `${a.provisionCount} gr.`
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

      {!loading && visible.length === 0 && !error && (
        <p className="mt-3 text-sm text-inkSoft">Engin lög fundust.</p>
      )}

      <p className="mt-4 text-center text-[11px] text-inkSoft">
        Unofficial reproduction of the consolidated text. Always verify against the official source.
      </p>
    </main>
  );
}
