"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ProvisionCases } from "@/components/ProvisionCases";
import { eeaTag } from "@/lib/eea-tag";

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
  /** "is" — an Icelandic act; "eu" — an EU regulation, directive or decision. */
  jurisdiction: string;
  actNumber: number;
  year: number;
  title: string;
  citation: string;
  currentVersionUrl: string;
  codexVersion: string | null;
  aliases: string[];
  actCaseCount: number;
  // EU acts only.
  celex: string | null;
  docType: string;
  status: string;
  eeaRelevant: boolean;
  eeaIncorporatedBy: string[];
  entryIntoForce: string | null;
  endOfValidity: string | null;
  textCelex: string | null;
  textStatus: string | null;
}

/**
 * "12 úrlausnir vísa til þessa ákvæðis" — Icelandic pluralisation is 1 vs many.
 *
 * "Úrlausn", not "dómur". Most of what cites a provision here is not a
 * judgment: the app holds six courts and forty úrskurðarnefndir, and the
 * boards outnumber the courts by an order of magnitude. "Úrlausn" is the term
 * that covers a dómur and an úrskurður alike, so the count says something true
 * whatever the reader clicks through to. (Feminine: *ein úrlausn vísar*,
 * *tvær úrlausnir vísa*.)
 */
function caseBadgeLabel(n: number): string {
  return n === 1 ? "1 úrlausn vísar til þessa ákvæðis" : `${n} úrlausnir vísa til þessa ákvæðis`;
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

  const isEu = act?.jurisdiction === "eu";

  // Deliberately not the sum of the per-provision counts: those are distinct
  // judgments *per provision*, so a judgment citing three provisions of this
  // act would be counted three times. act.actCaseCount is the distinct count
  // across the whole act, computed server-side.
  const provisionsWithCases = provisions.filter((p) => p.caseCount > 0).length;

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
      <nav className="flex items-center gap-3 text-xs text-inkSoft">
        <Link href="/" className="hover:underline">
          ← Search
        </Link>
        <span aria-hidden="true">·</span>
        <Link href="/log" className="hover:underline">
          {isEu ? "Allar gerðir" : "Öll lög"}
        </Link>
      </nav>

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
          <span>
            {act.actCaseCount} {act.actCaseCount === 1 ? "úrlausn vísar" : "úrlausnir vísa"}{" "}
            {isEu ? "til gerðarinnar" : "til laganna"}
            {provisionsWithCases > 0 ? ` · ${provisionsWithCases} greinar með tilvísunum` : ""}
          </span>
          <a
            href={act.currentVersionUrl}
            target="_blank"
            rel="noreferrer"
            className="text-accent hover:underline"
          >
            {isEu ? "Official text on EUR-Lex ↗" : "Official text on althingi.is ↗"}
          </a>
        </div>

        {/* ---- Where this act stands in EEA law ---------------------- */}
        {isEu && (
          <div className="mt-3 rounded border border-line bg-paper px-3 py-2 text-xs text-inkSoft">
            {act.eeaIncorporatedBy.length > 0 ? (
              <p>
                <span className="font-medium text-ink">Tekin upp í EES-samninginn</span> —{" "}
                {eeaTag(act)?.detail}{" "}
                <Link href={`/?q=${encodeURIComponent(act.eeaIncorporatedBy[0])}`} className="text-accent hover:underline">
                  Leita að ákvörðuninni →
                </Link>
              </p>
            ) : act.eeaRelevant ? (
              <p>
                <span className="font-medium text-ink">Merkt „Text with EEA relevance“</span> — ESB
                telur gerðina eiga erindi í EES-samninginn. {eeaTag(act)?.detail} Það þarf ekki að
                þýða að hún hafi ekki verið tekin upp.
              </p>
            ) : (
              <p>
                <span className="font-medium text-ink">Engin EES-merking</span> — hvorki merkt með
                EES-þýðingu í EUR-Lex né nefnd í ákvörðun sameiginlegu EES-nefndarinnar sem safnið
                heldur. Gerðin er hér vegna ESB-stillingarinnar, ekki af því að hún bindi Ísland.
              </p>
            )}
            {act.status === "no_longer_in_force" && (
              <p className="mt-1">Fallin úr gildi samkvæmt EUR-Lex.</p>
            )}
          </div>
        )}

        <p className="mt-3 text-[11px] text-inkSoft">
          {isEu ? (
            <>
              Unofficial reproduction of the text EUR-Lex publishes
              {act.textCelex && act.textCelex !== act.celex
                ? ` (consolidated version ${act.textCelex})`
                : act.celex
                  ? ` (${act.celex})`
                  : ""}
              . Always verify against the official source.
            </>
          ) : (
            <>
              Unofficial reproduction of the consolidated text
              {act.codexVersion ? ` (Lagasafn ${act.codexVersion})` : ""}. Always verify against the
              official source.
            </>
          )}
        </p>
      </header>

      {provisions.length === 0 ? (
        <p className="mt-4 rounded-lg border border-line bg-white p-5 text-sm text-inkSoft">
          {!isEu ? (
            <>
              Lagasafn does not publish the text of this act online — only its title and metadata.
              Use the official link above.
            </>
          ) : act.textStatus === "pending" ? (
            <>
              The text of this act has not been fetched yet — only its EUR-Lex record. The EU
              library is ingested EEA-first and act by act; use the official link above meanwhile.
            </>
          ) : (
            <>
              The published text of this act could not be read into articles
              {act.textStatus === "fetch-failed" ? " (EUR-Lex would not serve it)" : ""}. Use the
              official link above.
            </>
          )}
        </p>
      ) : (
        <>
          <div className="mt-4">
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={
                isEu
                  ? "Leita innan gerðarinnar — t.d. „Article 6“ eða „consent“"
                  : "Leita innan laganna — t.d. „130. gr.“ eða „málskostnaður“"
              }
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
                          {isEu ? "eur-lex.europa.eu ↗" : "althingi.is ↗"}
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
                        <p className="mt-3 text-xs text-inkSoft">Engar úrlausnir vísa til þessa ákvæðis.</p>
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
