"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ProvisionCases } from "@/components/ProvisionCases";

interface Paragraph {
  number: number;
  anchor: string;
  text: string;
}
interface Provision {
  id: string;
  chapterId: string | null;
  kind: string;
  displayLabel: string;
  heading: string | null;
  anchor: string;
  isRepealed: boolean;
  paragraphs: Paragraph[];
  caseCount: number;
}
interface Chapter {
  id: string;
  label: string;
  title: string | null;
  ordering: number;
}
interface Act {
  id: string;
  actNumber: number;
  year: number;
  title: string;
  citation: string;
  currentVersionUrl: string;
  codexVersion: string | null;
  aliases: string[];
  actCaseCount: number;
}

/** "12 dómar vísa til þessa ákvæðis" — Icelandic pluralisation is 1 vs many. */
function caseBadgeLabel(n: number): string {
  return n === 1 ? "1 dómur vísar til þessa ákvæðis" : `${n} dómar vísa til þessa ákvæðis`;
}

export default function ActPage({ params }: { params: { slug: string } }) {
  const [act, setAct] = useState<Act | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [provisions, setProvisions] = useState<Provision[]>([]);
  const [openProvision, setOpenProvision] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/acts/${params.slug}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setAct(d.act);
        setChapters(d.chapters);
        setProvisions(d.provisions);
      })
      .catch(() => setError("Could not load this act."))
      .finally(() => setLoading(false));
  }, [params.slug]);

  // Opening the page on a provision anchor (from a search result or a
  // citation link) should land on that provision with its cases already open.
  useEffect(() => {
    if (provisions.length === 0) return;
    const anchor = window.location.hash.replace(/^#/, "");
    if (!anchor) return;
    const target = provisions.find((p) => p.anchor === anchor);
    if (target) {
      setOpenProvision(target.id);
      document.getElementById(anchor)?.scrollIntoView({ block: "start" });
    }
  }, [provisions]);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return provisions;
    return provisions.filter(
      (p) =>
        p.displayLabel.toLowerCase().includes(q) ||
        (p.heading ?? "").toLowerCase().includes(q) ||
        p.paragraphs.some((par) => par.text.toLowerCase().includes(q))
    );
  }, [provisions, filter]);

  const byChapter = useMemo(() => {
    const groups: { chapter: Chapter | null; provisions: Provision[] }[] = [];
    for (const p of visible) {
      const last = groups[groups.length - 1];
      if (last && (last.chapter?.id ?? null) === p.chapterId) {
        last.provisions.push(p);
      } else {
        groups.push({ chapter: chapters.find((c) => c.id === p.chapterId) ?? null, provisions: [p] });
      }
    }
    return groups;
  }, [visible, chapters]);

  const totalCases = provisions.reduce((n, p) => n + p.caseCount, 0);

  if (loading) return <main className="mx-auto max-w-4xl px-4 py-8 text-sm text-inkSoft">Loading…</main>;
  if (error || !act) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-8">
        <p className="text-sm text-accent">{error || "Act not found."}</p>
        <Link href="/" className="mt-3 inline-block text-sm text-accent hover:underline">
          ← Back to search
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      <Link href="/" className="text-xs text-inkSoft hover:underline">
        ← Search
      </Link>

      <header className="mt-2 rounded-lg border border-line bg-white p-5">
        <p className="font-mono text-xs text-inkSoft">{act.citation}</p>
        <h1 className="mt-1 font-serif text-2xl font-semibold leading-tight">{act.title}</h1>
        {act.aliases.length > 0 && (
          <p className="mt-1 text-xs text-inkSoft">
            Einnig nefnd: {act.aliases.join(", ")}
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-inkSoft">
          <span>
            {provisions.filter((p) => p.kind === "article").length} greinar
            {chapters.length > 0 ? ` · ${chapters.length} kaflar` : ""}
          </span>
          <span>{totalCases} tilvísanir úr dómum</span>
          <a
            href={act.currentVersionUrl}
            target="_blank"
            rel="noreferrer"
            className="text-accent hover:underline"
          >
            Official text on althingi.is ↗
          </a>
        </div>
        <p className="mt-3 text-[11px] text-inkSoft">
          Unofficial reproduction of the consolidated text
          {act.codexVersion ? ` (Lagasafn ${act.codexVersion})` : ""}. Always verify against the
          official source.
        </p>
      </header>

      {provisions.length === 0 ? (
        <p className="mt-4 rounded-lg border border-line bg-white p-5 text-sm text-inkSoft">
          Lagasafn does not publish the text of this act online — only its title and metadata. Use
          the official link above.
        </p>
      ) : (
        <>
          <div className="mt-4">
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Leita innan laganna — t.d. „130. gr.“ eða „málskostnaður“"
              className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-ink"
            />
            {filter.trim() && (
              <p className="mt-1 text-xs text-inkSoft">
                {visible.length} of {provisions.length} provisions match
              </p>
            )}
          </div>

          <div className="mt-4 space-y-6">
            {byChapter.map((group, gi) => (
              <section key={group.chapter?.id ?? `nochapter-${gi}`}>
                {group.chapter && (
                  <h2 className="border-b border-line pb-1 font-serif text-base font-semibold">
                    {group.chapter.label}
                    {group.chapter.title ? ` ${group.chapter.title}` : ""}
                  </h2>
                )}
                <div className="mt-3 space-y-4">
                  {group.provisions.map((p) => (
                    <article
                      key={p.id}
                      id={p.anchor}
                      className="scroll-mt-4 rounded-lg border border-line bg-white p-4"
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <h3 className="font-serif text-lg font-semibold">
                          {p.displayLabel}
                          {p.heading && (
                            <span className="ml-2 font-sans text-sm font-normal text-inkSoft">
                              {p.heading}
                            </span>
                          )}
                        </h3>
                        <a
                          href={`${act.currentVersionUrl}#${p.anchor}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[11px] text-inkSoft hover:underline"
                        >
                          althingi.is ↗
                        </a>
                      </div>

                      {p.isRepealed ? (
                        <p className="mt-2 text-sm italic text-inkSoft">Fellt brott.</p>
                      ) : (
                        <div className="mt-2 space-y-2 font-serif text-[15px] leading-relaxed text-ink">
                          {p.paragraphs.map((par) => (
                            <p key={par.anchor} id={par.anchor} className="scroll-mt-4">
                              {par.text}
                            </p>
                          ))}
                        </div>
                      )}

                      {p.caseCount > 0 ? (
                        <div className="mt-3">
                          <button
                            type="button"
                            onClick={() => setOpenProvision(openProvision === p.id ? null : p.id)}
                            className="inline-flex items-center gap-1.5 rounded-full bg-accentSoft px-2.5 py-1 text-xs font-medium text-accent hover:underline"
                            aria-expanded={openProvision === p.id}
                          >
                            <span
                              className={`transition-transform ${openProvision === p.id ? "rotate-90" : ""}`}
                              aria-hidden="true"
                            >
                              ▸
                            </span>
                            {caseBadgeLabel(p.caseCount)}
                          </button>
                          {openProvision === p.id && <ProvisionCases provisionId={p.id} />}
                        </div>
                      ) : (
                        <p className="mt-3 text-xs text-inkSoft">Engir dómar vísa til þessa ákvæðis.</p>
                      )}
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
