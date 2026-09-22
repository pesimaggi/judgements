"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { eeaTag } from "@/lib/eea-tag";

export interface LegalSelection {
  kind: "act" | "provision";
  id: string;
  actId: string;
  /** The full citation — "4. gr. laga nr. 19/1940". See /api/lookup. */
  label: string;
  sublabel: string;
  /** Route to the act reader, for "open the text" alongside the case list. */
  path: string;
  /** "is" | "eu" — what the EES tag is drawn from. See lib/eea-tag.ts. */
  jurisdiction?: string;
  eeaRelevant?: boolean;
  eeaIncorporatedBy?: string[];
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
 * "Sérleit" — narrowing the case results to a piece of legislation or a
 * subject tag, alongside the keyword box rather than instead of it.
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
 *
 * The EES/ESB scope toggle used to sit at the top of this panel. It is a
 * research posture rather than a per-query filter, it was set here and then
 * silently applied on a different screen, and the search page has no use for
 * the wide setting: the box now always looks in the default scope, and the
 * toggle belongs to the act catalogue at /log, which is where it stayed.
 */
export function SpecificSearch({ legal, onLegalChange, tags: activeTags, onTagsChange }: Props) {
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
    if (q.length < 2) {
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
  }, [legalQuery, legal]);

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
    <section className="rounded-[3px] border border-line bg-white p-3">
      <h2 className="mb-2.5 font-heading text-[15px] font-medium text-ink">Sérleit</h2>

      {/* ---- Act / provision ---------------------------------------- */}
      <label
        htmlFor="legal-lookup"
        className="mb-1.5 block text-[11px] uppercase tracking-[.08em] text-textMuted"
      >
        Lög eða ákvæði
      </label>

      {legal.length > 0 && (
        <ul className="mb-1.5 flex flex-wrap gap-1.5">
          {legal.map((l) => (
            <li key={`${l.kind}-${l.id}`}>
              <Chip
                label={l.label}
                onRemove={() => onLegalChange(legal.filter((x) => x.id !== l.id))}
                href={l.path}
              />
            </li>
          ))}
        </ul>
      )}

      <input
        id="legal-lookup"
        value={legalQuery}
        onChange={(e) => setLegalQuery(e.target.value)}
        placeholder={
          legal.length ? "Bæta við lögum eða ákvæði…" : "t.d. „13. gr. stjórnsýslulaga“"
        }
        autoComplete="off"
        lang="is"
        className="w-full rounded-[3px] border border-lineStrong px-2 py-1.5 text-[12.5px] text-text outline-none placeholder:text-textMuted focus:border-ink"
      />

      {needsAct ? (
        <p className="mt-1.5 text-[11px] text-textMuted">Bættu við heiti laganna.</p>
      ) : legalLoading && suggestions.length === 0 ? (
        <p className="mt-1.5 text-[11px] text-textMuted">Leita…</p>
      ) : suggestions.length > 0 ? (
        <ul
          className="mt-1 max-h-72 overflow-y-auto rounded-[3px] border border-line bg-white"
          style={{ boxShadow: "0 2px 8px rgba(15,42,68,.08)" }}
        >
          {suggestions.map((s) => (
            <li key={`${s.kind}-${s.id}`} className="border-b border-lineSoft last:border-b-0">
              <button
                type="button"
                onClick={() => {
                  onLegalChange([...legal, s]);
                  setLegalQuery("");
                  setSuggestions([]);
                }}
                className="w-full px-2.5 py-[7px] text-left transition-colors hover:bg-paper"
              >
                <span className="block text-[12.5px] leading-[1.35] text-ink">{s.label}</span>
                <span className="block text-[11px] text-textMuted">
                  {s.sublabel}
                  <EeaTagChip item={s} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : legalQuery.trim().length >= 2 ? (
        <p className="mt-1.5 text-[11px] text-textMuted">Ekkert fannst.</p>
      ) : null}

      <Link href="/log" className="mt-2 inline-block text-[11px] text-inkSoft hover:text-ink hover:underline">
        Skoða öll lög →
      </Link>

      {/* ---- Subject tag --------------------------------------------- */}
      <label
        htmlFor="tag-lookup"
        className="mb-1.5 mt-3.5 block text-[11px] uppercase tracking-[.08em] text-textMuted"
      >
        Efnisorð
      </label>

      {activeTags.length > 0 && (
        <ul className="mb-1.5 flex flex-wrap gap-1.5">
          {activeTags.map((t) => (
            <li key={t}>
              <Chip label={t} onRemove={() => onTagsChange(activeTags.filter((x) => x !== t))} />
            </li>
          ))}
        </ul>
      )}

      <input
        id="tag-lookup"
        value={tagQuery}
        onChange={(e) => setTagQuery(e.target.value)}
        onFocus={() => setTagOpen(true)}
        placeholder={activeTags.length ? "Bæta við efnisorði…" : "t.d. „gæsluvarðhald“"}
        autoComplete="off"
        lang="is"
        className="w-full rounded-[3px] border border-lineStrong px-2 py-1.5 text-[12.5px] text-text outline-none placeholder:text-textMuted focus:border-ink"
      />
      {tagOpen && tags.length > 0 && (
        <ul className="mt-1.5 flex max-h-56 flex-wrap gap-1 overflow-y-auto">
          {tags.map((t) => (
            <li key={t.tag}>
              <button
                type="button"
                onClick={() => {
                  onTagsChange([...activeTags, t.tag]);
                  setTagQuery("");
                }}
                className="rounded-full border border-line px-2.5 py-[3px] text-[11px] text-inkSoft transition-colors hover:border-ink hover:text-ink"
              >
                {t.tag}
                <span className="ml-1 text-textMuted">{t.count}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {tagOpen && tags.length === 0 && tagQuery.trim() && (
        <p className="mt-1.5 text-[11px] text-textMuted">Ekkert efnisorð fannst.</p>
      )}
    </section>
  );
}

/**
 * A chosen filter: a glacier pill carrying the whole citation, with its own
 * remove button. `href` turns the label into a link to the act text, which is
 * the other thing a reader wants from a provision they have just named.
 */
function Chip({
  label,
  onRemove,
  href,
}: {
  label: string;
  onRemove: () => void;
  href?: string;
}) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-glacier py-1 pl-2.5 pr-2 text-[12px] leading-[1.3] text-ink">
      {href ? (
        <Link href={href} className="hover:underline" title="Lesa lagatextann">
          {label}
        </Link>
      ) : (
        label
      )}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Fjarlægja ${label}`}
        className="text-inkSoft transition-colors hover:text-ink"
      >
        ✕
      </button>
    </span>
  );
}

/**
 * The EES tag, inline after an act's citation: two words saying whether a
 * decision of the Joint Committee has taken this act into the EEA Agreement.
 *
 * It belongs here as much as in the catalogue — this box is where an act is
 * actually chosen, and "is this part of EEA law" is the question a reader is
 * answering when they choose one.
 */
function EeaTagChip({ item }: { item: LegalSelection }) {
  const tag = eeaTag(item);
  if (!tag) return null;
  return (
    <span
      title={tag.detail}
      className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] ${
        tag.status === "incorporated"
          ? "bg-glacier font-medium text-ink"
          : "border border-line text-textMuted"
      }`}
    >
      {tag.label}
    </span>
  );
}
