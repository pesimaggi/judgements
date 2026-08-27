"use client";
import { useEffect, useState } from "react";

interface Run {
  id: string; startedAt: string; finishedAt: string | null; status: string;
  mode: string | null;
  indexed: number; skipped: number; errors: number; errorSample: string | null;
}
interface Gap {
  source: string; officialUrl: string; court: string | null; caseNumber: string | null;
  reason: string; detail: string | null; attempts: number; lastTriedAt: string;
}
interface SourceStatus {
  key: string; name: string; group: string; status: "live" | "pilot";
  officialBaseUrl: string; adapterKey: string;
  enabled: boolean; lastIngestedAt: string | null;
  totalAvailable: number | null; documentCount: number; recentRuns: Run[];
  gapsByReason: { reason: string; count: number }[];
  gapSamples: Gap[];
}
interface Unmapped {
  total: number; courts: string[]; samples: Gap[];
}

const fmt = (d: string | null) => (d ? new Date(d).toLocaleString("is-IS") : "never");
const nf = (n: number) => n.toLocaleString("is-IS");

export default function IngestionPage() {
  const [status, setStatus] = useState<SourceStatus[]>([]);
  const [unmapped, setUnmapped] = useState<Unmapped | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/ingestion")
      .then((r) => r.json())
      .then((d) => {
        setStatus(d.status);
        setUnmapped(d.unmapped ?? null);
      })
      .catch(() => setError("Failed to load ingestion status."))
      .finally(() => setLoading(false));
  }, []);

  // Grouped the same way the source panel and the front-page progress bars
  // group them, so the three views agree on what belongs together.
  const groups = Array.from(new Set(status.map((s) => s.group)));

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <h1 className="font-serif text-2xl font-semibold">Ingestion status</h1>
      <p className="mt-1 text-sm text-inkSoft">
        One block per source. Run everything with{" "}
        <code className="rounded bg-paper px-1 py-0.5 text-xs">npm run ingest:all</code>, or one
        adapter with{" "}
        <code className="rounded bg-paper px-1 py-0.5 text-xs">
          sh scripts/ingest-all.sh &lt;adapter&gt;
        </code>
      </p>
      {error && <p className="mt-3 text-sm text-accent">{error}</p>}
      {loading && <p className="mt-3 text-sm text-inkSoft">Loading…</p>}

      {/* A court in the feed that maps to no source of ours. Every case from
          it is being dropped, and it belongs to none of the blocks below —
          so it gets its own banner rather than a counter nobody reads. */}
      {unmapped && unmapped.total > 0 && (
        <section className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4">
          <h2 className="text-sm font-semibold text-amber-900">
            {nf(unmapped.total)} case(s) from an unrecognised court
          </h2>
          <p className="mt-1 text-xs text-amber-900">
            These are being dropped because no source covers them. Add the court to{" "}
            <code className="rounded bg-white/60 px-1 py-0.5">courtToSourceKey</code> and{" "}
            <code className="rounded bg-white/60 px-1 py-0.5">COURT_FILTERS</code> in
            the Icelandic adapter, then run{" "}
            <code className="rounded bg-white/60 px-1 py-0.5">
              sh scripts/ingest-all.sh icelandic-retry
            </code>
            .
          </p>
          {unmapped.courts.length > 0 && (
            <p className="mt-2 text-xs text-amber-900">
              Court names seen: {unmapped.courts.join(", ")}
            </p>
          )}
        </section>
      )}

      {groups.map((group) => (
        <section key={group} className="mt-6">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-inkSoft">{group}</h2>
          <div className="mt-2 grid gap-4 md:grid-cols-2">
            {status
              .filter((s) => s.group === group)
              .map((s) => {
                const remaining =
                  s.totalAvailable != null ? s.totalAvailable - s.documentCount : null;
                const gapTotal = s.gapsByReason.reduce((n, g) => n + g.count, 0);
                const unswept = remaining != null ? Math.max(0, remaining - gapTotal) : null;
                return (
                  <section key={s.key} className="rounded-lg border border-line bg-white p-4">
                    <div className="flex items-baseline justify-between gap-2">
                      <h3 className="font-semibold">{s.name}</h3>
                      {s.status === "pilot" && (
                        <span className="rounded bg-paper px-1.5 py-0.5 text-[11px] text-inkSoft">
                          pilot
                        </span>
                      )}
                    </div>
                    <dl className="mt-2 space-y-1 text-sm">
                      <div className="flex justify-between">
                        <dt className="text-inkSoft">Documents indexed</dt>
                        <dd className="font-medium">
                          {nf(s.documentCount)}
                          {s.totalAvailable != null && (
                            <span className="text-inkSoft"> / {nf(s.totalAvailable)}</span>
                          )}
                        </dd>
                      </div>
                      {/* The number that says whether ingestion is actually finished. */}
                      {remaining != null && (
                        <div className="flex justify-between">
                          <dt className="text-inkSoft">Still to ingest</dt>
                          <dd className={remaining > 0 ? "font-medium text-accent" : "text-green-700"}>
                            {remaining > 0 ? nf(remaining) : "none"}
                          </dd>
                        </div>
                      )}
                      {/* How much of that shortfall we can actually name. A
                          case in the ledger is queued for retry; the rest is
                          archive nobody has swept yet. They need different
                          fixes, so they are not shown as one number. */}
                      {gapTotal > 0 && (
                        <div className="flex justify-between gap-4">
                          <dt className="text-inkSoft">Identified gaps</dt>
                          <dd className="text-right">
                            <span className="font-medium text-amber-700">{nf(gapTotal)}</span>
                            <span className="text-inkSoft">
                              {" "}
                              ({s.gapsByReason.map((g) => `${g.reason} ${nf(g.count)}`).join(", ")})
                            </span>
                          </dd>
                        </div>
                      )}
                      {unswept != null && unswept > 0 && (
                        <div className="flex justify-between">
                          <dt className="text-inkSoft">Not yet swept</dt>
                          <dd className="font-medium text-accent">{nf(unswept)}</dd>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <dt className="text-inkSoft">Last successful sync</dt>
                        <dd>{fmt(s.lastIngestedAt)}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-inkSoft">Adapter</dt>
                        <dd><code className="text-xs">{s.adapterKey}</code></dd>
                      </div>
                      <div className="flex justify-between gap-4">
                        <dt className="text-inkSoft">Source URL</dt>
                        <dd className="truncate">
                          <a href={s.officialBaseUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                            {s.officialBaseUrl}
                          </a>
                        </dd>
                      </div>
                    </dl>
                    {s.recentRuns.length > 0 ? (
                      <table className="mt-3 w-full text-xs">
                        <thead className="text-left text-inkSoft">
                          <tr><th className="pb-1">Run</th><th>Mode</th><th>Status</th><th>Indexed</th><th>Skipped</th><th>Errors</th></tr>
                        </thead>
                        <tbody>
                          {s.recentRuns.map((r) => (
                            <tr key={r.id} className="border-t border-line">
                              <td className="py-1">{fmt(r.startedAt)}</td>
                              <td className="text-inkSoft">{r.mode ?? "—"}</td>
                              <td className={r.status === "failed" ? "text-accent" : r.status === "success" ? "text-green-700" : ""}>{r.status}</td>
                              <td>{r.indexed}</td><td>{r.skipped}</td>
                              <td title={r.errorSample ?? undefined}>{r.errors}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <p className="mt-3 text-xs text-inkSoft">No ingestion runs yet.</p>
                    )}
                    {s.gapSamples.length > 0 && (
                      <details className="mt-3">
                        <summary className="cursor-pointer text-xs text-inkSoft">
                          Outstanding cases ({nf(gapTotal)}) — most-attempted first
                        </summary>
                        <ul className="mt-2 space-y-1 text-xs">
                          {s.gapSamples.map((g) => (
                            <li key={g.officialUrl} className="border-t border-line pt-1">
                              <a
                                href={g.officialUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-accent hover:underline"
                              >
                                {g.caseNumber ?? g.officialUrl}
                              </a>
                              <span className="text-inkSoft">
                                {" "}
                                — {g.reason}, {g.attempts}×
                                {g.detail ? ` · ${g.detail}` : ""}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </section>
                );
              })}
          </div>
        </section>
      ))}
    </main>
  );
}
