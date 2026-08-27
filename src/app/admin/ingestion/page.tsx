"use client";
import { useEffect, useState } from "react";

interface Run {
  id: string; startedAt: string; finishedAt: string | null; status: string;
  indexed: number; skipped: number; errors: number; errorSample: string | null;
}
interface SourceStatus {
  key: string; name: string; group: string; status: "live" | "pilot";
  officialBaseUrl: string; adapterKey: string;
  enabled: boolean; lastIngestedAt: string | null;
  totalAvailable: number | null; documentCount: number; recentRuns: Run[];
}

const fmt = (d: string | null) => (d ? new Date(d).toLocaleString("is-IS") : "never");
const nf = (n: number) => n.toLocaleString("is-IS");

export default function IngestionPage() {
  const [status, setStatus] = useState<SourceStatus[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/ingestion")
      .then((r) => r.json())
      .then((d) => setStatus(d.status))
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

      {groups.map((group) => (
        <section key={group} className="mt-6">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-inkSoft">{group}</h2>
          <div className="mt-2 grid gap-4 md:grid-cols-2">
            {status
              .filter((s) => s.group === group)
              .map((s) => {
                const remaining =
                  s.totalAvailable != null ? s.totalAvailable - s.documentCount : null;
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
                          <tr><th className="pb-1">Run</th><th>Status</th><th>Indexed</th><th>Skipped</th><th>Errors</th></tr>
                        </thead>
                        <tbody>
                          {s.recentRuns.map((r) => (
                            <tr key={r.id} className="border-t border-line">
                              <td className="py-1">{fmt(r.startedAt)}</td>
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
                  </section>
                );
              })}
          </div>
        </section>
      ))}
    </main>
  );
}
