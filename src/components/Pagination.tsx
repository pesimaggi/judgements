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
    "rounded-[3px] border border-line px-[11px] py-[5px] text-xs text-inkSoft transition-colors hover:border-ink hover:text-ink disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-line disabled:hover:text-inkSoft";

  return (
    <nav
      className="flex flex-wrap items-center justify-center gap-1.5 p-4"
      aria-label="Síður niðurstaðna"
    >
      <button
        type="button"
        onClick={() => onPageChange(page - 1)}
        disabled={disabled || page <= 1}
        className={arrowClass}
      >
        ← Fyrri
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
            aria-label={`Síða ${item}`}
            className={
              item === page
                ? "min-w-[30px] rounded-[3px] border border-ink bg-ink px-[9px] py-[5px] text-xs font-semibold text-white"
                : "min-w-[30px] rounded-[3px] border border-line px-[9px] py-[5px] text-xs text-inkSoft transition-colors hover:border-ink hover:text-ink disabled:cursor-not-allowed"
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
        Næsta →
      </button>
    </nav>
  );
}
