"use client";
import type { SourceDef } from "@/lib/sources";

interface Props {
  sources: SourceDef[];
  selected: Set<string>;
  onToggleSource: (key: string) => void;
  onSetSources: (keys: string[], on: boolean) => void;
}

function Check({ checked, onChange, label }: {
  checked: boolean; onChange: () => void; label: string;
}) {
  return (
    <label className={`flex cursor-pointer items-start gap-2 rounded px-1.5 py-1 text-sm hover:bg-paper ${checked ? "text-ink" : "text-inkSoft"}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="mt-0.5 h-4 w-4 rounded border-line accent-accent"
      />
      <span>{label}</span>
    </label>
  );
}

export function SourcePanel(p: Props) {
  const keys = p.sources.map((s) => s.key);
  const all = keys.length > 0 && keys.every((k) => p.selected.has(k));

  return (
    <aside className="w-full shrink-0 lg:w-72">
      <div className="rounded-lg border border-line bg-white p-3">
        <h3 className="mb-1 border-b border-line pb-1 text-[11px] font-semibold uppercase tracking-wider text-inkSoft">
          Icelandic courts
        </h3>
        {p.sources.map((s) => (
          <Check key={s.key} checked={p.selected.has(s.key)} onChange={() => p.onToggleSource(s.key)} label={s.name} />
        ))}
        <button
          onClick={() => p.onSetSources(keys, !all)}
          className="mt-1 px-1.5 text-xs text-accent hover:underline"
        >
          {all ? "Clear all courts" : "Select all courts"}
        </button>
      </div>
    </aside>
  );
}
