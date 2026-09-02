"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ScopeToggle, useActScope } from "./ScopeToggle";

export interface LegalSelection {
  kind: "act" | "provision";
  id: string;
  actId: string;
  label: string;
  sublabel: string;
  /** Route to the act reader, for "open the text" alongside the case list. */
  path: string;
}

interface Suggestion extends LegalSelection {}

interface TagCount {
  tag: string;
  count: number;
}

interface Props {
  legal: LegalSelection[];
  onLegalChange: (selections: LegalSelection[]) => void;
  tags: string[];
  onTagsChange: (tags: string[]) => void;
}

/**
 * "Specific search" — narrowing the case results to a piece of legislation or
 * a subject tag, alongside the keyword box rather than instead of it.
 *
 * The act box takes the citation as it would be written. Typing "lög um
 * aðbúnað og hollustuhætti" suggests the act, and the results become the
 * judgments citing it; typing "57. gr. a. laga um aðbúnað og hollustuhætti"
 * suggests that article, and the results narrow to the judgments citing it
 * specifically. This replaces a two-step act-then-article picker that made
 * the common case — "show me the cases about this provision" — take several
 * interactions and end up on the act text rather than on the cases.
 *
 * Selecting from either box filters the results directly; neither navigates
 * away. Selections accumulate and combine as AND — two tags mean the
 * judgments carrying both, two provisions the judgments citing both — since
 * adding a second condition is a request to narrow, not to widen.
 */
export function SpecificSearch({ legal, onLegalChange, tags: activeTags, onTagsChange }: Props) {
  const [legalQuery, setLegalQuery] = useState("");
  // How much of the EU library the act box offers. Remembered across visits —
  // see useActScope().
  const [scope, setScope] = useActScope();
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [needsAct, setNeedsAct] = useState(false);
  const [legalLoading, setLegalLoading] = useState(false);

  const [tagQuery, setTagQuery] = useState("");
  const [tags, setTags] = useState<TagCount[]>([]);
  const [tagOpen, setTagOpen] = useState(false);

  // Guards against a slower earlier response overwriting a later one — the
  // same hazard the main search guards against.
  const legalRequest = useRef(0);
  const tagRequest = useRef(0);

  useEffect(() => {
    const q = legalQuery.trim();
    if (q.length < 2) {
      setSuggestions([]);
      setNeedsAct(false);
      return;
    }
    const id = ++legalRequest.current;
    setLegalLoading(true);
    const timer = setTimeout(() => {
      fetch(`/api/lookup?q=${encodeURIComponent(q)}&scope=${scope}`)
        .then((r) => r.json())
        .then((d) => {
          if (id !== legalRequest.current) return;
          const hits: Suggestion[] = d.suggestions ?? [];
          const chosen = new Set(legal.map((l) => `${l.kind}-${l.id}`));
          const offered = (hits.length ? hits : (d.fallbackActs ?? [])).filter(
            (s: Suggestion) => !chosen.has(`${s.kind}-${s.id}`)
          );
          setSuggestions(offered);
          setNeedsAct(Boolean(d.needsAct));
        })
        .catch(() => id === legalRequest.current && setSuggestions([]))
        .finally(() => id === legalRequest.current && setLegalLoading(false));
    }, 180);
    return () => clearTimeout(timer);
  }, [legalQuery, legal, scope]);

  useEffect(() => {
    if (!tagOpen) return;
    const id = ++tagRequest.current;
    const timer = setTimeout(() => {
      fetch(`/api/tags?q=${encodeURIComponent(tagQuery.trim())}`)
        .then((r) => r.json())
        .then((d) => {
          if (id !== tagRequest.current) return;
          setTags((d.tags ?? []).filter((t: TagCount) => !activeTags.includes(t.tag)));
        })
        .catch(() => id === tagRequest.current && setTags([]));
    }, 150);
    return () => clearTimeout(timer);
  }, [tagQuery, tagOpen, activeTags]);

  return (
    <section className="rounded-lg border border-line bg-white p-4">
      <h2 className="text-sm font-semibold">Specific search</h2>
      <p className="mt-0.5 text-xs text-inkSoft">
        Narrow the results to acts, provisions or subjects. Adding more
        narrows further — results must match every one.
      </p>

      {/* ---- Act / provision ---------------------------------------- */}
      <div className="mt-3">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="legal-lookup" className="text-xs font-medium text-inkSoft">
            Lög eða ákvæði
          </label>
          <ScopeToggle scope={scope} onChange={setScope} />
        </div>
        <p className="mt-0.5 text-[11px] text-inkSoft">
          {scope === "eea"
            ? "Íslensk lög og ESB-gerðir sem geta haft EES-þýðingu."
            : "Íslensk lög og allar ESB-gerðir, líka óinnleiddar."}
        </p>

        {legal.length > 0 && (
          <ul className="mt-1 space-y-1">
            {legal.map((l) => (
              <li key={`${l.kind}-${l.id}`} className="rounded border border-line bg-paper px-2 py-1.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <span className="block text-sm leading-snug">{l.label}</span>
                    <span className="block text-[11px] text-inkSoft">{l.sublabel}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => onLegalChange(legal.filter((x) => x.id !== l.id))}
                    className="shrink-0 text-xs text-accent hover:underline"
                    aria-label={`Fjarlægja ${l.label}`}
                  >
                    ✕
                  </button>
                </div>
                <Link href={l.path} className="mt-1 inline-block text-[11px] text-accent hover:underline">
                  Lesa lagatextann →
                </Link>
              </li>
            ))}
          </ul>
        )}

        <input
          id="legal-lookup"
          value={legalQuery}
          onChange={(e) => setLegalQuery(e.target.value)}
          placeholder={
            legal.length
              ? "Bæta við lögum eða ákvæði…"
              : "t.d. „lög um aðbúnað“, „57. gr. a. laga um aðbúnað“ eða „gdpr“"
          }
          autoComplete="off"
          lang="is"
          className="mt-1 w-full rounded border border-line px-2 py-1.5 text-sm outline-none focus:border-ink"
        />
        {needsAct ? (
          <p className="mt-2 text-xs text-inkSoft">Bættu við heiti laganna.</p>
        ) : legalLoading && suggestions.length === 0 ? (
          <p className="mt-2 text-xs text-inkSoft">Leita…</p>
        ) : suggestions.length > 0 ? (
          <ul className="mt-2 max-h-72 space-y-1 overflow-y-auto">
            {suggestions.map((s) => (
              <li key={`${s.kind}-${s.id}`}>
                <button
                  type="button"
                  onClick={() => {
                    onLegalChange([...legal, s]);
                    setLegalQuery("");
                    setSuggestions([]);
                  }}
                  className="w-full rounded border border-line px-2 py-1.5 text-left hover:border-ink"
                >
                  <span className="block text-sm leading-snug">{s.label}</span>
                  <span className="block text-[11px] text-inkSoft">{s.sublabel}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : legalQuery.trim().length >= 2 ? (
          <p className="mt-2 text-xs text-inkSoft">Ekkert fannst.</p>
        ) : null}
        <Link href="/log" className="mt-2 inline-block text-xs text-accent hover:underline">
          Skoða öll lög →
        </Link>
      </div>

      {/* ---- Subject tag --------------------------------------------- */}
      <div className="mt-4 border-t border-line pt-3">
        <label htmlFor="tag-lookup" className="text-xs font-medium text-inkSoft">
          Efnisorð
        </label>

        {activeTags.length > 0 && (
          <ul className="mt-1 flex flex-wrap gap-1">
            {activeTags.map((t) => (
              <li key={t}>
                <button
                  type="button"
                  onClick={() => onTagsChange(activeTags.filter((x) => x !== t))}
                  className="rounded-full bg-accentSoft px-2 py-0.5 text-xs font-medium text-accent hover:opacity-80"
                  aria-label={`Fjarlægja ${t}`}
                >
                  {t} ✕
                </button>
              </li>
            ))}
          </ul>
        )}

        <input
          id="tag-lookup"
          value={tagQuery}
          onChange={(e) => setTagQuery(e.target.value)}
          onFocus={() => setTagOpen(true)}
          placeholder={
            activeTags.length ? "Bæta við efnisorði…" : "t.d. „gæsluvarðhald“ eða „skaðabætur“"
          }
          autoComplete="off"
          lang="is"
          className="mt-1 w-full rounded border border-line px-2 py-1.5 text-sm outline-none focus:border-ink"
        />
        {tagOpen && tags.length > 0 && (
          <ul className="mt-2 flex max-h-56 flex-wrap gap-1 overflow-y-auto">
            {tags.map((t) => (
              <li key={t.tag}>
                <button
                  type="button"
                  onClick={() => {
                    onTagsChange([...activeTags, t.tag]);
                    setTagQuery("");
                  }}
                  className="rounded-full border border-line px-2 py-0.5 text-xs hover:border-ink"
                >
                  {t.tag}
                  <span className="ml-1 text-inkSoft">{t.count}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {tagOpen && tags.length === 0 && tagQuery.trim() && (
          <p className="mt-2 text-xs text-inkSoft">Ekkert efnisorð fannst.</p>
        )}
      </div>

    </section>
  );
}
