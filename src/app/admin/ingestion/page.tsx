"use client";
import { useEffect, useState } from "react";

interface Run {
  id: string; startedAt: string; finishedAt: string | null; status: string;
  indexed: number; skipped: number; errors: number; errorSample: string | null;
}
interface SourceStatus {
  key: string; name: string; officialBaseUrl: string;
  enabled: boolean; lastIngestedAt: string | null; documentCount: number; recentRuns: Run[];
}

const fmt = (d: string | null) => (d ? new Date(d).toLocaleString("is-IS") : "never");

export default function IngestionPage() {
  const [status, setStatus] = useState<SourceStatus[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/ingestion")
      .then((r) => r.json())
      .then((d) => setStatus(d.status))
      .catch(() => setError("Failed to load ingestion status."));
  }, []);

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <h1 className="font-serif text-2xl font-semibold">Ingestion status</h1>
      <p className="mt-1 text-sm text-inkSoft">
        One status block per source adapter. Run adapters with{" "}
        <code className="rounded bg-paper px-1 py-0.5 text-xs">npm run ingest -- --adapter=&lt;name&gt;</code>
      </p>
      {error && <p className="mt-3 text-sm text-accent">{error}</p>}

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {status.map((s) => (
          <section key={s.key} className="rounded-lg border border-line bg-white p-4">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="font-semibold">{s.name}</h2>
            </div>
            <dl className="mt-2 space-y-1 text-sm">
              <div className="flex justify-between"><dt className="text-inkSoft">Documents indexed</dt><dd className="font-medium">{s.documentCount}</dd></div>
              <div className="flex justify-between"><dt className="text-inkSoft">Last successful sync</dt><dd>{fmt(s.lastIngestedAt)}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-inkSoft">Source URL</dt>
                <dd className="truncate"><a href={s.officialBaseUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">{s.officialBaseUrl}</a></dd>
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
        ))}
      </div>
    </main>
  );
}
