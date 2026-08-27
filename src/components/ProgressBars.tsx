"use client";
import { useEffect, useState } from "react";

interface SourceProgress {
  key: string;
  name: string;
  group: string;
  ingested: number;
  total: number | null;
  /** Missing cases the ingester has identified by URL and can retry. */
  knownGaps: number;
  /** Missing cases not accounted for at all — an unswept stretch of archive. */
  unexplained: number | null;
}
interface GroupProgress {
  name: string;
  ingested: number;
  total: number | null;
  knownGaps: number;
  sources: SourceProgress[];
}
interface ProgressData {
  ingested: number;
  total: number | null;
  knownGaps: number;
  groups: GroupProgress[];
}

const nf = (n: number) => n.toLocaleString("is-IS");

function Bar({
  label,
  ingested,
  total,
  knownGaps = 0,
  unexplained = null,
  strong = false,
}: {
  label: string;
  ingested: number;
  total: number | null;
  knownGaps?: number;
  unexplained?: number | null;
  strong?: boolean;
}) {
  // A null total means the source has not told us how much there is to have.
  // Showing a bar against an unknown denominator would invent a percentage,
  // so those render as a plain count with a muted, full-width track instead.
  const pct = total != null && total > 0 ? Math.min(100, (ingested / total) * 100) : null;
  const complete = pct != null && ingested >= total!;

  // The shortfall, split by whether we can name it. A case in the gap ledger
  // is identified and queued for retry; an unexplained one means a stretch of
  // the archive has not been swept yet. Saying which is what turns "99.6%"
  // from a mystery into a to-do list.
  const gapPct = pct != null && total ? Math.min(100 - pct, (knownGaps / total) * 100) : 0;
  const missing = total != null ? Math.max(0, total - ingested) : 0;
  const shortfall: string[] = [];
  if (knownGaps > 0) shortfall.push(`${nf(knownGaps)} identified and queued for retry`);
  if (unexplained != null && unexplained > 0) shortfall.push(`${nf(unexplained)} not yet swept`);

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className={strong ? "font-semibold text-ink" : "font-medium text-ink"}>{label}</span>
        <span className="whitespace-nowrap text-inkSoft">
          {nf(ingested)}
          {total != null && <> / {nf(total)}</>}
          {pct != null && <> · {pct.toFixed(1)}%</>}
        </span>
      </div>
      <div
        className={`mt-1 flex w-full overflow-hidden rounded-full bg-paper ${strong ? "h-2.5" : "h-2"}`}
        title={
          pct == null
            ? "Not yet ingested, or the source does not publish a total"
            : shortfall.length
              ? `${nf(missing)} missing: ${shortfall.join(", ")}`
              : undefined
        }
      >
        <div
          className={`h-full transition-all ${complete ? "bg-green-600" : "bg-accent"}`}
          style={{ width: `${pct ?? 100}%`, opacity: pct == null ? 0.25 : 1 }}
        />
        {/* Identified gaps get their own segment: still missing, but known
            about and retryable, which is a different state from unswept. */}
        {gapPct > 0 && (
          <div className="h-full bg-amber-400 transition-all" style={{ width: `${gapPct}%` }} />
        )}
      </div>
      {shortfall.length > 0 && (
        <div className="mt-1 text-[11px] text-inkSoft">
          {nf(missing)} missing — {shortfall.join(", ")}
        </div>
      )}
    </div>
  );
}

/**
 * Front-page widget: overall ingestion progress, then a bar per source,
 * grouped the way the source panel groups them. Collapsible, because it sits
 * above the case list and had grown past the point of being glanceable.
 */
export function ProgressBars() {
  const [data, setData] = useState<ProgressData | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // Remembered per viewer, so someone who collapses it does not have to
    // collapse it again on every visit. Wrapped because a browser set to
    // block site data throws on access rather than returning null.
    try {
      setOpen(localStorage.getItem("logbrunnur.progress.open") === "1");
    } catch {
      /* keep the default */
    }
    fetch("/api/progress")
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  }, []);

  const toggle = () => {
    setOpen((wasOpen) => {
      const next = !wasOpen;
      try {
        localStorage.setItem("logbrunnur.progress.open", next ? "1" : "0");
      } catch {
        /* the panel still works, it just will not be remembered */
      }
      return next;
    });
  };

  if (!data || data.ingested === 0) return null;

  const pct = data.total != null && data.total > 0 ? (data.ingested / data.total) * 100 : null;

  return (
    <div className="rounded-lg border border-line bg-white">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls="ingestion-progress-detail"
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="text-sm font-semibold text-ink">Ingestion progress</span>
        <span className="flex items-center gap-2 text-xs text-inkSoft">
          <span className="whitespace-nowrap">
            {nf(data.ingested)}
            {data.total != null && <> / {nf(data.total)}</>}
            {pct != null && <> · {pct.toFixed(1)}%</>}
          </span>
          <svg
            viewBox="0 0 20 20"
            aria-hidden="true"
            className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          >
            <path d="M5 7.5 10 12.5 15 7.5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>

      {open && (
        <div id="ingestion-progress-detail" className="border-t border-line px-4 pb-4 pt-3">
          <Bar
            label="All sources"
            ingested={data.ingested}
            total={data.total}
            knownGaps={data.knownGaps}
            strong
          />
          <div className="mt-4 space-y-4">
            {data.groups.map((g) => (
              <div key={g.name}>
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-inkSoft">
                  {g.name}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {g.sources.map((s) => (
                    <Bar
                      key={s.key}
                      label={s.name}
                      ingested={s.ingested}
                      total={s.total}
                      knownGaps={s.knownGaps}
                      unexplained={s.unexplained}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
