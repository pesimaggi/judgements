"use client";

/**
 * Builds the page numbers to show: always the first and last page, plus a
 * run of `window` consecutive pages around the current one, with "…" standing
 * in for the gaps. The run keeps its full width at either end of the range —
 * page 1 of 667 offers 1–5, not just 1–3.
 */
export function pageItems(current: number, total: number, window = 5): (number | "gap")[] {
  if (total <= 1) return total === 1 ? [1] : [];

  const start = Math.max(1, Math.min(current - Math.floor(window / 2), total - window + 1));
  const end = Math.min(total, start + window - 1);

  const pages = new Set<number>([1, total]);
  for (let p = start; p <= end; p++) pages.add(p);
  const sorted = Array.from(pages).sort((a, b) => a - b);

  const out: (number | "gap")[] = [];
  let previous = 0;
  for (const p of sorted) {
    if (previous && p - previous > 1) out.push("gap");
    out.push(p);
    previous = p;
  }
  return out;
}

interface Props {
  page: number;
  totalPages: number;
  disabled?: boolean;
  onPageChange: (page: number) => void;
}

export function Pagination({ page, totalPages, disabled, onPageChange }: Props) {
  if (totalPages <= 1) return null;
  const items = pageItems(page, totalPages);

  const arrowClass =
    "rounded border border-line px-2.5 py-1 text-xs text-inkSoft transition-colors hover:border-ink hover:text-ink disabled:cursor-not-allowed disabled:border-line disabled:text-line";

  return (
    <nav className="mt-5 flex flex-wrap items-center justify-center gap-1.5" aria-label="Search result pages">
      <button
        type="button"
        onClick={() => onPageChange(page - 1)}
        disabled={disabled || page <= 1}
        className={arrowClass}
      >
        ← Previous
      </button>

      {items.map((item, i) =>
        item === "gap" ? (
          <span key={`gap-${i}`} className="px-1 text-xs text-inkSoft" aria-hidden="true">
            …
          </span>
        ) : (
          <button
            key={item}
            type="button"
            onClick={() => onPageChange(item)}
            disabled={disabled}
            aria-current={item === page ? "page" : undefined}
            aria-label={`Page ${item}`}
            className={
              item === page
                ? "min-w-[2rem] rounded border border-ink bg-ink px-2 py-1 text-xs font-semibold text-white"
                : "min-w-[2rem] rounded border border-line px-2 py-1 text-xs text-inkSoft transition-colors hover:border-ink hover:text-ink disabled:cursor-not-allowed"
            }
          >
            {item}
          </button>
        )
      )}

      <button
        type="button"
        onClick={() => onPageChange(page + 1)}
        disabled={disabled || page >= totalPages}
        className={arrowClass}
      >
        Next →
      </button>
    </nav>
  );
}
