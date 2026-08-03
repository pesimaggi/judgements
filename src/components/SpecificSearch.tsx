"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ActHit, ProvisionHit } from "@/lib/types";

/**
 * "Specific search" — reaching a known provision directly, as opposed to the
 * keyword search this sits alongside.
 *
 * Two steps, because that is how the citation is structured: pick the act,
 * then the article within it. The act step matches titles, the short names
 * harvested from the corpus ("vaxtalög"), and citation numbers ("91/1991");
 * the article step accepts "130", "130. gr.", or words from the provision's
 * heading.
 */
export function SpecificSearch() {
  const router = useRouter();

  const [actQuery, setActQuery] = useState("");
  const [acts, setActs] = useState<ActHit[]>([]);
  const [selectedAct, setSelectedAct] = useState<ActHit | null>(null);
  const [actsLoading, setActsLoading] = useState(false);

  const [provisionQuery, setProvisionQuery] = useState("");
  const [provisions, setProvisions] = useState<ProvisionHit[]>([]);
  const [provisionsLoading, setProvisionsLoading] = useState(false);

  // Guards against a slower earlier response overwriting a later one, the
  // same hazard the main search guards against.
  const actRequest = useRef(0);
  const provisionRequest = useRef(0);

  useEffect(() => {
    const q = actQuery.trim();
    if (selectedAct || q.length < 2) {
      setActs([]);
      return;
    }
    const id = ++actRequest.current;
    setActsLoading(true);
    const timer = setTimeout(() => {
      fetch(`/api/acts?q=${encodeURIComponent(q)}`)
        .then((r) => r.json())
        .then((d) => {
          if (id !== actRequest.current) return;
          setActs(d.acts ?? []);
        })
        .catch(() => id === actRequest.current && setActs([]))
        .finally(() => id === actRequest.current && setActsLoading(false));
    }, 180);
    return () => clearTimeout(timer);
  }, [actQuery, selectedAct]);

  useEffect(() => {
    if (!selectedAct) {
      setProvisions([]);
      return;
    }
    const id = ++provisionRequest.current;
    setProvisionsLoading(true);
    const timer = setTimeout(() => {
      const params = new URLSearchParams({
        actId: selectedAct.id,
        q: provisionQuery.trim(),
        pageSize: "12",
      });
      fetch(`/api/provisions?${params}`)
        .then((r) => r.json())
        .then((d) => {
          if (id !== provisionRequest.current) return;
          setProvisions(d.hits ?? []);
        })
        .catch(() => id === provisionRequest.current && setProvisions([]))
        .finally(() => id === provisionRequest.current && setProvisionsLoading(false));
    }, 180);
    return () => clearTimeout(timer);
  }, [selectedAct, provisionQuery]);

  const reset = () => {
    setSelectedAct(null);
    setActQuery("");
    setProvisionQuery("");
    setProvisions([]);
  };

  return (
    <section className="rounded-lg border border-line bg-white p-4">
      <h2 className="text-sm font-semibold">Specific search</h2>
      <p className="mt-0.5 text-xs text-inkSoft">Go straight to an act or a provision.</p>

      {!selectedAct ? (
        <div className="mt-3">
          <label htmlFor="act-lookup" className="text-xs font-medium text-inkSoft">
            Lög
          </label>
          <input
            id="act-lookup"
            value={actQuery}
            onChange={(e) => setActQuery(e.target.value)}
            placeholder="t.d. „vaxtalög“ eða „38/2001“"
            autoComplete="off"
            className="mt-1 w-full rounded border border-line px-2 py-1.5 text-sm outline-none focus:border-ink"
          />
          {actsLoading && acts.length === 0 && actQuery.trim().length >= 2 && (
            <p className="mt-2 text-xs text-inkSoft">Leita…</p>
          )}
          {acts.length > 0 && (
            <ul className="mt-2 max-h-72 space-y-1 overflow-y-auto">
              {acts.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedAct(a)}
                    className="w-full rounded border border-line px-2 py-1.5 text-left hover:border-ink"
                  >
                    <span className="block text-sm leading-snug">{a.title}</span>
                    <span className="block font-mono text-[11px] text-inkSoft">
                      {a.citation} · {a.provisionCount} greinar
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!actsLoading && actQuery.trim().length >= 2 && acts.length === 0 && (
            <p className="mt-2 text-xs text-inkSoft">Engin lög fundust.</p>
          )}
        </div>
      ) : (
        <div className="mt-3">
          <div className="flex items-start justify-between gap-2 rounded border border-line bg-paper px-2 py-1.5">
            <div>
              <span className="block text-sm leading-snug">{selectedAct.title}</span>
              <span className="block font-mono text-[11px] text-inkSoft">{selectedAct.citation}</span>
            </div>
            <button
              type="button"
              onClick={reset}
              className="shrink-0 text-xs text-accent hover:underline"
            >
              Breyta
            </button>
          </div>

          <button
            type="button"
            onClick={() => router.push(selectedAct.path)}
            className="mt-2 w-full rounded bg-ink px-2 py-1.5 text-xs font-medium text-white hover:opacity-90"
          >
            Opna lögin í heild
          </button>

          <label htmlFor="provision-lookup" className="mt-3 block text-xs font-medium text-inkSoft">
            Grein
          </label>
          <input
            id="provision-lookup"
            value={provisionQuery}
            onChange={(e) => setProvisionQuery(e.target.value)}
            placeholder="t.d. „130“ eða „málskostnaður“"
            autoComplete="off"
            className="mt-1 w-full rounded border border-line px-2 py-1.5 text-sm outline-none focus:border-ink"
          />

          {provisionsLoading && provisions.length === 0 ? (
            <p className="mt-2 text-xs text-inkSoft">Leita…</p>
          ) : provisions.length > 0 ? (
            <ul className="mt-2 max-h-72 space-y-1 overflow-y-auto">
              {provisions.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => router.push(p.path)}
                    className="w-full rounded border border-line px-2 py-1.5 text-left hover:border-ink"
                  >
                    <span className="block text-sm font-medium leading-snug">
                      {p.displayLabel}
                      {p.heading && (
                        <span className="ml-1 font-normal text-inkSoft">{p.heading}</span>
                      )}
                    </span>
                    <span className="block text-[11px] text-inkSoft">
                      {p.caseCount === 1 ? "1 dómur" : `${p.caseCount} dómar`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-inkSoft">Engin grein fannst.</p>
          )}
        </div>
      )}
    </section>
  );
}
