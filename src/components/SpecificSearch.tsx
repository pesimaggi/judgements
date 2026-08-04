"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";

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
  legal: LegalSelection | null;
  onLegalChange: (selection: LegalSelection | null) => void;
  tag: string | null;
  onTagChange: (tag: string | null) => void;
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
 * away.
 */
export function SpecificSearch({ legal, onLegalChange, tag, onTagChange }: Props) {
  const [legalQuery, setLegalQuery] = useState("");
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
    if (legal || q.length < 2) {
      setSuggestions([]);
      setNeedsAct(false);
      return;
    }
    const id = ++legalRequest.current;
    setLegalLoading(true);
    const timer = setTimeout(() => {
      fetch(`/api/lookup?q=${encodeURIComponent(q)}`)
        .then((r) => r.json())
        .then((d) => {
          if (id !== legalRequest.current) return;
          const hits: Suggestion[] = d.suggestions ?? [];
          setSuggestions(hits.length ? hits : (d.fallbackActs ?? []));
          setNeedsAct(Boolean(d.needsAct));
        })
        .catch(() => id === legalRequest.current && setSuggestions([]))
        .finally(() => id === legalRequest.current && setLegalLoading(false));
    }, 180);
    return () => clearTimeout(timer);
  }, [legalQuery, legal]);

  useEffect(() => {
    if (!tagOpen || tag) return;
    const id = ++tagRequest.current;
    const timer = setTimeout(() => {
      fetch(`/api/tags?q=${encodeURIComponent(tagQuery.trim())}`)
        .then((r) => r.json())
        .then((d) => {
          if (id !== tagRequest.current) return;
          setTags(d.tags ?? []);
        })
        .catch(() => id === tagRequest.current && setTags([]));
    }, 150);
    return () => clearTimeout(timer);
  }, [tagQuery, tagOpen, tag]);

  return (
    <section className="rounded-lg border border-line bg-white p-4">
      <h2 className="text-sm font-semibold">Specific search</h2>
      <p className="mt-0.5 text-xs text-inkSoft">
        Narrow the results to an act, a provision, or a subject.
      </p>

      {/* ---- Act / provision ---------------------------------------- */}
      <div className="mt-3">
        <label htmlFor="legal-lookup" className="text-xs font-medium text-inkSoft">
          Lög eða ákvæði
        </label>

        {legal ? (
          <div className="mt-1 rounded border border-line bg-paper px-2 py-1.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <span className="block text-sm leading-snug">{legal.label}</span>
                <span className="block text-[11px] text-inkSoft">{legal.sublabel}</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  onLegalChange(null);
                  setLegalQuery("");
                }}
                className="shrink-0 text-xs text-accent hover:underline"
              >
                Hreinsa
              </button>
            </div>
            <Link
              href={legal.path}
              className="mt-1 inline-block text-[11px] text-accent hover:underline"
            >
              Lesa lagatextann →
            </Link>
          </div>
        ) : (
          <>
            <input
              id="legal-lookup"
              value={legalQuery}
              onChange={(e) => setLegalQuery(e.target.value)}
              placeholder="t.d. „lög um aðbúnað“ eða „57. gr. a. laga um aðbúnað“"
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
                        onLegalChange(s);
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
          </>
        )}
      </div>

      {/* ---- Subject tag --------------------------------------------- */}
      <div className="mt-4 border-t border-line pt-3">
        <label htmlFor="tag-lookup" className="text-xs font-medium text-inkSoft">
          Efnisorð
        </label>

        {tag ? (
          <div className="mt-1 flex items-center justify-between gap-2 rounded border border-line bg-paper px-2 py-1.5">
            <span className="text-sm">{tag}</span>
            <button
              type="button"
              onClick={() => {
                onTagChange(null);
                setTagQuery("");
              }}
              className="shrink-0 text-xs text-accent hover:underline"
            >
              Hreinsa
            </button>
          </div>
        ) : (
          <>
            <input
              id="tag-lookup"
              value={tagQuery}
              onChange={(e) => setTagQuery(e.target.value)}
              onFocus={() => setTagOpen(true)}
              placeholder="t.d. „gæsluvarðhald“ eða „skaðabætur“"
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
                        onTagChange(t.tag);
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
          </>
        )}
      </div>
    </section>
  );
}
