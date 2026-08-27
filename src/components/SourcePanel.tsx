"use client";
import { useState } from "react";
import { groupedSources, type SourceDef } from "@/lib/sources";

interface Props {
  sources: SourceDef[];
  selected: Set<string>;
  onToggleSource: (key: string) => void;
  onSetSources: (keys: string[], on: boolean) => void;
}

/**
 * Above this many sources, a group is collapsed until the reader opens it.
 *
 * The panel used to be eight checkboxes and a flat list was right for it.
 * With the 41 úrskurðarnefndir it is not: a list that long buries the courts
 * above it and makes the panel taller than the results beside it. So a big
 * group folds down to one line — its name and how many of it are ticked —
 * and opens on a click. A group with something already ticked opens itself,
 * because a filter you cannot see is a filter you will forget you set.
 */
const COLLAPSE_ABOVE = 8;

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

function Group({ name, sources, selected, onToggleSource, onSetSources, first }: {
  name: string;
  sources: SourceDef[];
  selected: Set<string>;
  onToggleSource: (key: string) => void;
  onSetSources: (keys: string[], on: boolean) => void;
  first: boolean;
}) {
  const keys = sources.map((s) => s.key);
  const chosen = keys.filter((k) => selected.has(k)).length;
  const collapsible = sources.length > COLLAPSE_ABOVE;
  const [open, setOpen] = useState(!collapsible || chosen > 0);
  const allChosen = chosen === keys.length;

  return (
    <div className={first ? undefined : "mt-3"}>
      <h3 className="mb-1 flex items-center justify-between gap-2 border-b border-line pb-1 text-[11px] font-semibold uppercase tracking-wider text-inkSoft">
        {collapsible ? (
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            className="flex flex-1 items-center gap-1.5 text-left uppercase tracking-wider hover:text-ink"
          >
            <span aria-hidden className={`transition-transform ${open ? "rotate-90" : ""}`}>›</span>
            <span>{name}</span>
            <span className="font-normal normal-case tracking-normal text-inkSoft/70">
              {chosen > 0 ? `${chosen}/${sources.length}` : sources.length}
            </span>
          </button>
        ) : (
          <span>{name}</span>
        )}
      </h3>

      {open && (
        <>
          {sources.map((s) => (
            <Check
              key={s.key}
              checked={selected.has(s.key)}
              onChange={() => onToggleSource(s.key)}
              label={s.name}
            />
          ))}
          {collapsible && (
            <button
              type="button"
              onClick={() => onSetSources(keys, !allChosen)}
              className="mt-0.5 px-1.5 text-xs text-accent hover:underline"
            >
              {allChosen ? `Clear ${name}` : `Select all ${sources.length}`}
            </button>
          )}
        </>
      )}
    </div>
  );
}

export function SourcePanel(p: Props) {
  const keys = p.sources.map((s) => s.key);
  const all = keys.length > 0 && keys.every((k) => p.selected.has(k));

  return (
    <aside className="w-full shrink-0 lg:w-72">
      <div className="rounded-lg border border-line bg-white p-3">
        {groupedSources(p.sources).map((g, i) => (
          <Group
            key={g.group}
            name={g.group}
            sources={g.sources}
            selected={p.selected}
            onToggleSource={p.onToggleSource}
            onSetSources={p.onSetSources}
            first={i === 0}
          />
        ))}
        <button
          onClick={() => p.onSetSources(keys, !all)}
          className="mt-1 px-1.5 text-xs text-accent hover:underline"
        >
          {all ? "Clear all" : "Select all"}
        </button>
      </div>
    </aside>
  );
}
