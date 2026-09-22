"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { SourceDef } from "@/lib/sources";
import { SOURCE_TREE, groupKeys, type SourceGroup, type SourceSubGroup } from "@/lib/source-tree";
import { SearchIcon } from "./icons";

interface Props {
  sources: SourceDef[];
  selected: Set<string>;
  onToggleSource: (key: string) => void;
  onSetSources: (keys: string[], on: boolean) => void;
  /** Replace the whole selection with these — the "aðeins" affordance. */
  onOnlySources: (keys: string[]) => void;
}

/**
 * Heimildir — which of the 57 sources the search runs over.
 *
 * A flat list of 57 checkboxes was unusable in both directions: it buried the
 * courts under forty appeal boards, and it made "everything administrative"
 * a forty-click operation. So the panel is the hierarchy in
 * lib/source-tree.ts, collapsed to five rows, each of which can be ticked
 * whole. Nothing about the query changes — the search still receives a flat
 * list of source keys.
 *
 * Search inside the panel is not a nicety: with the tree collapsed, a source
 * whose group you cannot guess is unreachable. Matching therefore looks
 * *inside* collapsed groups and opens them.
 *
 * Two intents, two controls. The checkbox adds and removes, as a checkbox
 * must. "Aðeins" replaces the selection outright, because the common request
 * — "just the Supreme Court" — is otherwise four unticks, and doing it by
 * unticking is precisely what makes a checkbox feel like it did the opposite
 * of what was asked.
 */
export function SourcePanel({
  sources,
  selected,
  onToggleSource,
  onSetSources,
  onOnlySources,
}: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  // The panel only auto-opens once, when the source list first arrives.
  // After that the open/closed state is the reader's: a group that reopened
  // itself every time a box was ticked would fight whoever is using it.
  const seeded = useRef(false);

  const byKey = useMemo(() => new Map(sources.map((s) => [s.key, s])), [sources]);
  const available = useMemo(() => new Set(sources.map((s) => s.key)), [sources]);
  const allKeys = useMemo(() => sources.map((s) => s.key), [sources]);
  const allChosen = allKeys.length > 0 && allKeys.every((k) => selected.has(k));

  useEffect(() => {
    if (seeded.current || sources.length === 0) return;
    seeded.current = true;
    // A filter you cannot see is a filter you will forget you set — so a
    // group holding part of the selection opens itself. "Everything is
    // ticked" is the default rather than a filter, and opening all five
    // groups for it would put the wall straight back.
    const everything = sources.every((s) => selected.has(s.key));
    if (selected.size === 0 || everything) return;
    const open = new Set<string>();
    for (const group of SOURCE_TREE) {
      if (groupKeys(group).some((k) => selected.has(k))) open.add(group.id);
      for (const sub of group.subGroups ?? []) {
        if (sub.keys.some((k) => selected.has(k))) open.add(sub.id);
      }
    }
    setExpanded(open);
  }, [sources, selected]);

  const toggleExpanded = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const needle = query.trim().toLowerCase();
  const matches = (key: string) => (byKey.get(key)?.name ?? key).toLowerCase().includes(needle);

  /** The keys a group or subgroup shows for the current search. */
  const visibleKeys = (keys: string[], containerName: string) => {
    const live = keys.filter((k) => available.has(k));
    if (!needle) return live;
    // A group whose own name matches shows everything under it: someone
    // typing "dómstólar" means the category, not one court in it.
    if (containerName.toLowerCase().includes(needle)) return live;
    return live.filter(matches);
  };

  const selectedCount = selected.size === 0 ? allKeys.length : selected.size;

  return (
    <section className="rounded-[3px] border border-line bg-white">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 pb-2 pt-[11px]">
        <h2 className="font-heading text-[15px] font-medium text-ink">Heimildir</h2>
        <span className="text-[11px] text-textMuted">
          {allChosen || selected.size === 0
            ? `Allar ${allKeys.length}`
            : `${selectedCount} valdar`}
        </span>
      </div>

      <div className="px-3 pb-2 pt-2.5">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-2 top-[7px] h-3.5 w-3.5 text-textMuted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Leita að heimild"
            aria-label="Leita að heimild"
            lang="is"
            className="w-full rounded-[3px] border border-lineStrong py-[5px] pl-7 pr-2 text-[12.5px] text-text placeholder:text-textMuted"
          />
        </div>
      </div>

      <label className="flex cursor-pointer items-center gap-2.5 border-t border-lineSoft px-3 py-2 text-[13px] text-ink">
        <Checkbox
          checked={allChosen}
          indeterminate={!allChosen && selected.size > 0}
          onChange={() => onSetSources(allKeys, !allChosen)}
        />
        Allar heimildir
        <span className="ml-auto text-[11px] text-textMuted">{allKeys.length}</span>
      </label>

      <div className="max-h-[540px] overflow-y-auto">
        {SOURCE_TREE.map((group) => (
          <Group
            key={group.id}
            group={group}
            byKey={byKey}
            available={available}
            selected={selected}
            expanded={expanded}
            onToggleExpanded={toggleExpanded}
            onToggleSource={onToggleSource}
            onSetSources={onSetSources}
            onOnlySources={onOnlySources}
            needle={needle}
            visibleKeys={visibleKeys}
          />
        ))}
      </div>
    </section>
  );
}

interface GroupProps {
  group: SourceGroup;
  byKey: Map<string, SourceDef>;
  available: Set<string>;
  selected: Set<string>;
  expanded: Set<string>;
  onToggleExpanded: (id: string) => void;
  onToggleSource: (key: string) => void;
  onSetSources: (keys: string[], on: boolean) => void;
  onOnlySources: (keys: string[]) => void;
  needle: string;
  visibleKeys: (keys: string[], containerName: string) => string[];
}

function Group({
  group,
  byKey,
  available,
  selected,
  expanded,
  onToggleExpanded,
  onToggleSource,
  onSetSources,
  onOnlySources,
  needle,
  visibleKeys,
}: GroupProps) {
  const keys = groupKeys(group).filter((k) => available.has(k));
  if (keys.length === 0) return null;

  const directVisible = visibleKeys(group.keys, group.name);
  const subGroups = (group.subGroups ?? []).filter(
    (sub) =>
      group.name.toLowerCase().includes(needle) ||
      sub.name.toLowerCase().includes(needle) ||
      visibleKeys(sub.keys, sub.name).length > 0
  );
  // A search that matches nothing in this group hides the group entirely,
  // rather than leaving a row that opens onto nothing.
  if (needle && directVisible.length === 0 && subGroups.length === 0) return null;

  const chosen = keys.filter((k) => selected.has(k)).length;
  const all = chosen === keys.length;
  const open = needle ? true : expanded.has(group.id);
  // Moss marks the administrative family wherever it appears — here, and on
  // the Útdráttur control. One family, one colour.
  const admin = group.id === "stjornsysla";

  return (
    <div className="group/row border-t border-lineSoft">
      <div
        className="flex items-center gap-2.5 py-2 pl-2.5 pr-3"
        style={{
          borderLeft: `3px solid ${chosen > 0 ? (admin ? "#5B7A5E" : "#0F2A44") : "transparent"}`,
          background: chosen > 0 ? "#E1E8F0" : undefined,
        }}
      >
        <Checkbox
          checked={all}
          indeterminate={chosen > 0 && !all}
          onChange={() => onSetSources(keys, !all)}
          label={`Velja allar heimildir í flokknum ${group.name}`}
        />
        <button
          type="button"
          onClick={() => onToggleExpanded(group.id)}
          aria-expanded={open}
          className="flex flex-1 items-center gap-2 text-left"
        >
          <span className="flex-1 text-[13px] font-medium text-text">{group.name}</span>
          <span className="text-[11px] text-textMuted">
            {chosen > 0 ? `${chosen}/${keys.length}` : keys.length}
          </span>
          <Caret open={open} />
        </button>
        <OnlyButton name={group.name} onClick={() => onOnlySources(keys)} />
      </div>

      {open && (
        <div className="flex flex-col gap-0.5 py-[3px] pl-8 pr-3 pb-2">
          {directVisible.map((key) => (
            <SourceCheckbox
              key={key}
              name={byKey.get(key)?.name ?? key}
              checked={selected.has(key)}
              onChange={() => onToggleSource(key)}
              onOnly={() => onOnlySources([key])}
              needle={needle}
            />
          ))}

          {subGroups.length > 0 && (
            <div className="mt-1.5 flex flex-col gap-px border-t border-lineSoft pt-1.5">
              {subGroups.map((sub) => (
                <SubGroup
                  key={sub.id}
                  sub={sub}
                  byKey={byKey}
                  available={available}
                  selected={selected}
                  open={needle ? true : expanded.has(sub.id)}
                  onToggleExpanded={onToggleExpanded}
                  onToggleSource={onToggleSource}
                  onSetSources={onSetSources}
                  onOnlySources={onOnlySources}
                  needle={needle}
                  visible={visibleKeys(sub.keys, sub.name)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SubGroup({
  sub,
  byKey,
  available,
  selected,
  open,
  onToggleExpanded,
  onToggleSource,
  onSetSources,
  onOnlySources,
  needle,
  visible,
}: {
  sub: SourceSubGroup;
  byKey: Map<string, SourceDef>;
  available: Set<string>;
  selected: Set<string>;
  open: boolean;
  onToggleExpanded: (id: string) => void;
  onToggleSource: (key: string) => void;
  onSetSources: (keys: string[], on: boolean) => void;
  onOnlySources: (keys: string[]) => void;
  needle: string;
  visible: string[];
}) {
  const keys = sub.keys.filter((k) => available.has(k));
  if (keys.length === 0) return null;
  const chosen = keys.filter((k) => selected.has(k)).length;
  const all = chosen === keys.length;

  return (
    <div className="group/row">
      <div className="flex items-center gap-2 py-[3px] text-xs text-textMuted">
        <Checkbox
          checked={all}
          indeterminate={chosen > 0 && !all}
          onChange={() => onSetSources(keys, !all)}
          label={`Velja allar heimildir í flokknum ${sub.name}`}
          small
        />
        <button
          type="button"
          onClick={() => onToggleExpanded(sub.id)}
          aria-expanded={open}
          className="flex flex-1 items-center gap-2 text-left"
        >
          <span className="flex-1">{sub.name}</span>
          <span>{chosen > 0 ? `${chosen}/${keys.length}` : keys.length}</span>
          <Caret open={open} />
        </button>
        <OnlyButton name={sub.name} onClick={() => onOnlySources(keys)} />
      </div>
      {open && (
        <div className="flex flex-col gap-0.5 pb-1.5 pl-[22px]">
          {visible.map((key) => (
            <SourceCheckbox
              key={key}
              name={byKey.get(key)?.name ?? key}
              checked={selected.has(key)}
              onChange={() => onToggleSource(key)}
              onOnly={() => onOnlySources([key])}
              needle={needle}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SourceCheckbox({
  name,
  checked,
  onChange,
  onOnly,
  needle,
}: {
  name: string;
  checked: boolean;
  onChange: () => void;
  onOnly: () => void;
  needle: string;
}) {
  return (
    <div className="group/row flex items-start gap-2.5">
      <label className="flex flex-1 cursor-pointer items-start gap-2.5 py-0.5 text-[12.5px] leading-[1.35] text-inkSoft">
        <Checkbox checked={checked} onChange={onChange} small className="mt-0.5" />
        <span>
          <Highlighted text={name} needle={needle} />
        </span>
      </label>
      <OnlyButton name={name} onClick={onOnly} />
    </div>
  );
}

/**
 * "Only this one." Hidden until the row is hovered or the button is focused,
 * because it is the second thing anyone wants from a row and showing 57 of
 * them at rest would be its own wall.
 */
function OnlyButton({ name, onClick }: { name: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`Leita aðeins í ${name}`}
      aria-label={`Leita aðeins í ${name}`}
      className="mt-0.5 shrink-0 text-[11px] text-textMuted opacity-0 transition-opacity hover:text-ink focus:opacity-100 group-hover/row:opacity-100"
    >
      aðeins
    </button>
  );
}

/**
 * The matched part of a source's name, marked.
 *
 * Without it, a search that reveals a source three levels down leaves the
 * reader to work out which of forty similar names it matched on — the
 * institution names here differ by one word in the middle.
 */
function Highlighted({ text, needle }: { text: string; needle: string }) {
  if (!needle) return <>{text}</>;
  const at = text.toLowerCase().indexOf(needle);
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark>{text.slice(at, at + needle.length)}</mark>
      {text.slice(at + needle.length)}
    </>
  );
}

function Caret({ open }: { open: boolean }) {
  return (
    <span aria-hidden className={`text-[10px] text-textMuted ${open ? "" : "-rotate-90"}`}>
      ▾
    </span>
  );
}

/**
 * A checkbox that can be indeterminate — the state a partly-chosen group is
 * actually in. `indeterminate` is a DOM property with no HTML attribute, so
 * it has to be set through a ref; rendering a checked box for "3 of 20" would
 * be a lie the reader acts on.
 */
function Checkbox({
  checked,
  indeterminate = false,
  onChange,
  label,
  small = false,
  className = "",
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  label?: string;
  small?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={onChange}
      aria-label={label}
      className={`${small ? "h-[13px] w-[13px]" : "h-3.5 w-3.5"} shrink-0 accent-ink ${className}`}
    />
  );
}
