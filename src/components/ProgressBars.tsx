"use client";
import { useEffect, useState } from "react";

interface CourtProgress {
  key: string;
  name: string;
  ingested: number;
  total: number | null;
}
interface ProgressData {
  ingested: number;
  total: number | null;
  courts: CourtProgress[];
}

function Bar({ label, ingested, total }: { label: string; ingested: number; total: number | null }) {
  const pct = total ? Math.min(100, (ingested / total) * 100) : null;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-medium text-ink">{label}</span>
        <span className="whitespace-nowrap text-inkSoft">
          {ingested.toLocaleString("is-IS")}
          {total != null && <> / {total.toLocaleString("is-IS")}</>}
          {pct != null && <> · {pct.toFixed(1)}%</>}
        </span>
      </div>
      <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-paper">
        <div
          className="h-full rounded-full bg-accent transition-all"
          style={{ width: `${pct ?? (ingested > 0 ? 100 : 0)}%`, opacity: pct == null ? 0.35 : 1 }}
          title={pct == null ? "Total available unknown yet" : undefined}
        />
      </div>
    </div>
  );
}

/** Front-page widget: overall ingestion progress, then a bar per court. */
export function ProgressBars() {
  const [data, setData] = useState<ProgressData | null>(null);

  useEffect(() => {
    fetch("/api/progress")
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  }, []);

  if (!data || data.ingested === 0) return null;

  return (
    <div className="rounded-lg border border-line bg-white p-4">
      <h2 className="text-sm font-semibold text-ink">Ingestion progress</h2>
      <div className="mt-2">
        <Bar label="All Icelandic courts" ingested={data.ingested} total={data.total} />
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {data.courts.map((c) => (
          <Bar key={c.key} label={c.name} ingested={c.ingested} total={c.total} />
        ))}
      </div>
    </div>
  );
}
