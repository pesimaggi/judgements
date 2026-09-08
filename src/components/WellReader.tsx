"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { JudgmentText } from "./JudgmentText";
import { HighlightedText } from "./HighlightedText";
import { buildCitation } from "@/lib/citation";
import type { AskSource } from "@/lib/ask/types";

/**
 * The other half of the well: the source itself, read in place.
 *
 * The split screen used to be the conversation beside a *list* of what the
 * search found — each card with the passage it was selected for, and a link to
 * the document. The link navigated away, which closed the well and lost the
 * conversation, so checking a citation meant choosing between the answer and
 * the evidence. That is precisely the choice a reader should never have to
 * make: an answer here is only as good as the law under it, and the actual
 * work is reading the judgment next to the sentence that cites it.
 *
 * So a source now opens *into* this pane. The answer stays where it is on the
 * left; the judgment, or the provision, fills the right. Clicking a citation
 * chip in the prose does the same thing, which is the shortest path there is
 * from "it says this" to "does it though".
 *
 * Nothing here fetches anything the rest of the app would not. Decisions come
 * from /api/documents/[id] and provisions from /api/acts/[slug] — the same two
 * endpoints the document page and the act reader use, so what is shown here is
 * what those pages show and there is no second copy of the corpus to keep in
 * step.
 */

/** Where a source's `path` points, and therefore what has to be fetched. */
type Target =
  | { type: "document"; id: string }
  | { type: "act"; slug: string; anchor: string | null }
  | { type: "external"; url: string };

export function readerTarget(source: AskSource): Target {
  const path = source.path ?? "";
  // A journal article's path is the journal's own URL: its text is indexed on
  // the server so it can be found and never sent out, here as everywhere else.
  if (/^https?:\/\//.test(path)) return { type: "external", url: path };

  const doc = /^\/document\/(.+)$/.exec(path);
  if (doc) return { type: "document", id: doc[1] };

  const act = /^\/log\/([^#]+)(?:#(.+))?$/.exec(path);
  if (act) return { type: "act", slug: act[1], anchor: act[2] ?? null };

  return { type: "external", url: source.officialUrl ?? path };
}

/**
 * The fields this pane reads off /api/documents/[id]. Narrower than the stored
 * row on purpose: it is the shape `buildCitation` needs plus the text, so the
 * pane cannot quietly start depending on a column the API might stop sending.
 */
interface ReaderDocument {
  id: string;
  title: string;
  officialUrl: string;
  court?: string | null;
  caseNumber?: string | null;
  caseName?: string | null;
  date?: string | null;
  fullText?: string | null;
  isSample?: boolean;
}

interface ReaderAct {
  citation?: string | null;
  title?: string | null;
}

interface Paragraph {
  number: number;
  anchor: string;
  text: string;
}
interface Provision {
  id: string;
  displayLabel: string;
  heading: string | null;
  anchor: string;
  isRepealed: boolean;
  paragraphs: Paragraph[];
  caseCount: number;
}

const KIND_LABEL: Record<AskSource["kind"], string> = {
  act: "Lög",
  provision: "Lagaákvæði",
  decision: "Úrlausn",
  opinion: "Álit",
  commentary: "Fræðiskrif",
};

export function WellReader({ source, onBack }: { source: AskSource; onBack: () => void }) {
  const target = useMemo(() => readerTarget(source), [source]);
  const [doc, setDoc] = useState<ReaderDocument | null>(null);
  const [act, setAct] = useState<ReaderAct | null>(null);
  const [provisions, setProvisions] = useState<Provision[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(target.type !== "external");
  const [find, setFind] = useState("");
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDoc(null);
    setAct(null);
    setProvisions([]);
    setError("");
    setFind("");
    if (target.type === "external") {
      setLoading(false);
      return;
    }
    setLoading(true);

    const url =
      target.type === "document"
        ? `/api/documents/${encodeURIComponent(target.id)}`
        : `/api/acts/${encodeURIComponent(target.slug)}`;

    fetch(url)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Heimildin fannst ekki.");
        if (cancelled) return;
        if (target.type === "document") setDoc(d.document);
        else {
          setAct(d.act);
          setProvisions(d.provisions ?? []);
        }
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [target]);

  // Scrolls the cited article into view once the act has rendered. An act runs
  // to hundreds of provisions and the one that was cited is the only reason
  // this pane is open, so landing anywhere else is landing in the wrong place.
  useEffect(() => {
    if (!anchorRef.current || provisions.length === 0) return;
    anchorRef.current.scrollIntoView({ block: "start" });
  }, [provisions]);

  // Back to the top on every new source; the pane is reused, so without this
  // the second judgment opens at the scroll offset left by the first.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [source.n]);

  const fullText = doc?.fullText ?? "";
  const citation = doc ? buildCitation(doc) : "";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="shrink-0 border-b border-line bg-white px-4 py-2.5">
        <div className="flex items-start gap-2">
          <button
            type="button"
            onClick={onBack}
            className="mt-0.5 shrink-0 rounded border border-line px-1.5 py-0.5 text-[11px] text-inkSoft transition hover:border-ink/30 hover:text-ink"
            aria-label="Til baka í heimildalistann"
          >
            ← Heimildir
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-wide text-inkSoft">
              [{source.n}] {KIND_LABEL[source.kind]}
            </p>
            <p className="truncate font-serif text-[13px] font-semibold text-ink" title={source.title}>
              {source.title}
            </p>
            <p className="truncate text-[11px] text-inkSoft" title={source.subtitle}>
              {source.subtitle}
            </p>
          </div>
        </div>

        {/* Reading within the judgment, the same affordance the document page
            offers — a Niðurstaða can run to twenty pages and the sentence the
            answer rests on is one line of it. */}
        {fullText && (
          <div className="mt-2 flex items-center gap-2">
            <input
              value={find}
              onChange={(e) => setFind(e.target.value)}
              placeholder="Leita í textanum …"
              className="min-w-0 flex-1 rounded border border-line bg-paper px-2 py-1 text-[12px] text-ink placeholder:text-inkSoft/70 focus-visible:border-ink/30"
            />
            {source.officialUrl && (
              <a
                href={source.officialUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 text-[11px] text-inkSoft underline underline-offset-2 hover:text-ink"
              >
                Frumheimild ↗
              </a>
            )}
          </div>
        )}
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {loading && <p className="text-[12px] text-inkSoft">Sæki textann …</p>}
        {error && <p className="text-[12px] text-accent">{error}</p>}

        {target.type === "external" && !loading && (
          <ExternalNotice source={source} url={target.url} />
        )}

        {doc && (
          <>
            {citation && (
              <p className="mb-3 rounded border border-line bg-white px-2.5 py-1.5 text-[11px] text-inkSoft">
                {citation}
              </p>
            )}
            {fullText ? (
              <JudgmentText text={fullText} query={find} />
            ) : (
              // A scholarly source reaches this branch only if one is ever
              // routed here: the API withholds its text by design.
              <ExternalNotice source={source} url={source.officialUrl ?? ""} />
            )}
          </>
        )}

        {act && (
          <>
            <p className="mb-3 text-[11px] text-inkSoft">
              {act.citation ?? ""} — {act.title ?? ""}
            </p>
            <div className="space-y-3">
              {provisions.map((p) => {
                const isTarget =
                  target.type === "act" && target.anchor !== null && p.anchor === target.anchor;
                return (
                  <div
                    key={p.id}
                    ref={isTarget ? anchorRef : undefined}
                    className={`scroll-mt-2 rounded-md border px-3 py-2 ${
                      isTarget ? "border-accent/40 bg-accentSoft/40" : "border-line bg-white"
                    }`}
                  >
                    <p className="font-serif text-[12px] font-semibold text-ink">
                      {p.displayLabel}
                      {p.heading ? <span className="font-normal text-inkSoft"> — {p.heading}</span> : null}
                      {p.isRepealed && (
                        <span className="ml-1.5 text-[10px] uppercase text-accent">brottfallið</span>
                      )}
                    </p>
                    <div className="mt-1 space-y-1.5 text-[12px] leading-relaxed text-ink">
                      {p.paragraphs.map((par) => (
                        <p key={par.anchor}>
                          <HighlightedText text={par.text} query={find} />
                        </p>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * A source this app will not reproduce.
 *
 * Journal articles are indexed in full so they can be found and are read at
 * the journal that published them — the text never leaves the server. Saying
 * so is better than an empty pane that looks broken.
 */
function ExternalNotice({ source, url }: { source: AskSource; url: string }) {
  return (
    <div className="rounded-md border border-line bg-white p-3">
      <p className="text-[12px] leading-relaxed text-inkSoft">
        {source.kind === "commentary"
          ? "Greinin er lesin hjá tímaritinu sem gaf hana út — textinn er skráður hér til leitar en er ekki birtur."
          : "Þessi heimild er lesin hjá upphaflegum útgefanda."}
      </p>
      {source.excerpt && (
        <p className="mt-2 whitespace-pre-line border-l-2 border-line pl-2.5 text-[11px] leading-relaxed text-inkSoft">
          {source.excerpt}
        </p>
      )}
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-block text-[12px] text-accent underline underline-offset-2"
        >
          Opna hjá útgefanda ↗
        </a>
      )}
    </div>
  );
}
