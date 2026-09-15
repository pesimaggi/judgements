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
  /** Lagasafn's own footnotes, marker included: "1) L. 74/2022, 2. gr.". */
  footnotes: string[];
  paragraphs: Paragraph[];
  caseCount: number;
  /** Regulations made under this specific article. */
  regulationCount: number;
}

/** A regulation made under the act being read. */
interface RegulationUnder {
  actNumber: number;
  year: number;
  title: string;
  status: string;
  citation: string;
  path: string;
  /** The articles of this act it names, as the act prints them. */
  articles: { label: string; anchor: string }[];
  /** True when it names the act without naming an article. */
  wholeAct: boolean;
}

/** An act a regulation says it is made under, with the articles it names. */
interface StatutoryBasis {
  citation: string;
  title: string;
  path: string;
  articles: { label: string; anchor: string }[];
  citationText: string;
  excerpt: string;
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
  /** Icelandic acts only; null for the acts older than Alþingi's record. */
  ferillUrl: string | null;
  billUrl: string | null;
  /** Parsed out of ferillUrl by the API — "115. löggjafarþing, mál 71". */
  ferill: { parliament: number; caseNumber: number } | null;
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
  // Icelandic regulations.
  ministry: string | null;
  publishedDate: string | null;
  lastAmendDate: string | null;
  amendedBy: string[];
  subjectChapters: string[];
  originalDocUrl: string | null;
  /** "structured" | "heuristic" — how much the article divisions can be trusted. */
  structureSource: string | null;
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
/** "2020-04-04T00:00:00.000Z" → "4. apríl 2020", the way a date is written here. */
function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("is-IS", { day: "numeric", month: "long", year: "numeric" });
}

function caseBadgeLabel(n: number): string {
  return n === 1 ? "1 úrlausn vísar til þessa ákvæðis" : `${n} úrlausnir vísa til þessa ákvæðis`;
}

export default function ActPage({ params }: { params: { slug: string } }) {
  const [act, setAct] = useState<Act | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [provisions, setProvisions] = useState<Provision[]>([]);
  const [regulations, setRegulations] = useState<RegulationUnder[]>([]);
  const [basis, setBasis] = useState<StatutoryBasis[]>([]);
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
        setRegulations(d.regulations ?? []);
        setBasis(d.statutoryBasis ?? []);
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
  const isRegulation = act?.jurisdiction === "is" && act?.docType === "regulation";

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
            {isEu
              ? "Official text on EUR-Lex ↗"
              : isRegulation
                ? "Reglugerðin á reglugerd.is ↗"
                : "Official text on althingi.is ↗"}
          </a>
        </div>

        {/* ---- Where the act came from ------------------------------ */}
        {(act.ferillUrl || act.billUrl) && (
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-inkSoft">
            <span>Lögskýringargögn:</span>
            {act.billUrl && (
              <a
                href={act.billUrl}
                target="_blank"
                rel="noreferrer"
                className="text-accent hover:underline"
              >
                Frumvarpið og greinargerðin ↗
              </a>
            )}
            {act.ferillUrl && (
              <a
                href={act.ferillUrl}
                target="_blank"
                rel="noreferrer"
                className="text-accent hover:underline"
              >
                Ferill málsins á Alþingi
                {act.ferill
                  ? ` (${act.ferill.parliament}. löggjafarþing, mál ${act.ferill.caseNumber})`
                  : ""}{" "}
                ↗
              </a>
            )}
          </div>
        )}

        {/* ---- What this regulation is, and how well we read it ------ */}
        {isRegulation && (
          <div className="mt-3 rounded border border-line bg-paper px-3 py-2 text-xs text-inkSoft">
            <p>
              {act.ministry ? <span className="text-ink">{act.ministry}</span> : "Reglugerð"}
              {act.publishedDate && ` · birt ${formatDate(act.publishedDate)}`}
              {act.status === "repealed" ? (
                <span className="ml-1 font-medium text-ink">· fallin úr gildi</span>
              ) : (
                act.entryIntoForce && ` · tók gildi ${formatDate(act.entryIntoForce)}`
              )}
              {act.amendedBy.length > 0 &&
                ` · ${act.amendedBy.length} breytingareglugerð${
                  act.amendedBy.length === 1 ? "" : "ir"
                } komnar inn í textann`}
            </p>
            {act.subjectChapters.length > 0 && (
              <p className="mt-1">Efnisflokkur: {act.subjectChapters.join(", ")}</p>
            )}
            {act.originalDocUrl && (
              <p className="mt-1">
                <a
                  href={act.originalDocUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent hover:underline"
                >
                  Frumtextinn í Stjórnartíðindum (PDF) ↗
                </a>
              </p>
            )}
            {/*
              The one thing a reader cannot see for themselves. About three
              quarters of the register was converted from Word and carries no
              markup saying where an article begins; for those the divisions
              below were worked out from which paragraphs are centred, which is
              a typesetting choice and not something the publisher asserted.
              Saying so is the difference between showing a parse and passing
              one off as the source's own structure.
            */}
            {basis.length > 0 && (
              <p className="mt-1">
                <span className="text-ink">Sett samkvæmt:</span>{" "}
                {basis.map((b, i) => (
                  <span key={b.path}>
                    {i > 0 && "; "}
                    {b.articles.map((a, j) => (
                      <span key={a.anchor}>
                        {j > 0 && ", "}
                        <Link href={`${b.path}#${a.anchor}`} className="text-accent hover:underline">
                          {a.label}
                        </Link>
                      </span>
                    ))}
                    {b.articles.length > 0 && " "}
                    <Link href={b.path} className="text-accent hover:underline">
                      {b.citation}
                    </Link>
                  </span>
                ))}
              </p>
            )}
            {act.structureSource === "heuristic" && (
              <p className="mt-1">
                <span className="font-medium text-ink">Greinaskipting er lesin úr uppsetningu.</span>{" "}
                Þessi reglugerð er birt án merkinga um greinaskil, svo skiptingin hér að neðan er
                ályktun en ekki uppsetning útgefanda. Textinn sjálfur er óbreyttur.
              </p>
            )}
          </div>
        )}

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
          ) : isRegulation ? (
            <>
              Unofficial reproduction of the consolidated text as reglugerd.is publishes it. The
              authoritative text is the one Stjórnartíðindi published. Always verify against the
              official source.
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

      {/*
        ---- Regulations made under this act -------------------------------
        Grouped by regulation and showing which of this act's articles each
        one names, because "reglugerð nr. 300/2020, undir 7. gr." is the
        question a reader of an enabling provision actually has. Taken from
        each regulation's own lagastoð clause — see src/lib/lagastod.ts — so
        it is what the regulation asserts about itself, not an inference.
      */}
      {regulations.length > 0 && (
        <section className="mt-4 rounded-lg border border-line bg-white p-5">
          <h2 className="font-serif text-base font-semibold">
            {regulations.length === 1
              ? "Ein reglugerð er sett samkvæmt þessum lögum"
              : `${regulations.length} reglugerðir eru settar samkvæmt þessum lögum`}
          </h2>
          <p className="mt-1 text-[11px] text-inkSoft">
            Samkvæmt því sem reglugerðirnar sjálfar segja um lagastoð sína.
          </p>
          <ul className="mt-3 space-y-2">
            {regulations.map((r) => (
              <li key={r.path} className="text-sm">
                <Link href={r.path} className="text-accent hover:underline">
                  {r.citation}
                </Link>{" "}
                <span className="text-ink">{r.title.replace(/\.$/, "")}</span>
                {r.status === "repealed" && (
                  <span className="ml-1 text-xs text-inkSoft">(fallin úr gildi)</span>
                )}
                {r.articles.length > 0 && (
                  <span className="ml-1 text-xs text-inkSoft">
                    —{" "}
                    {r.articles.map((a, i) => (
                      <span key={a.anchor}>
                        {i > 0 && ", "}
                        <a href={`#${a.anchor}`} className="hover:underline">
                          {a.label}
                        </a>
                      </span>
                    ))}
                  </span>
                )}
                {r.articles.length === 0 && r.wholeAct && (
                  <span className="ml-1 text-xs text-inkSoft">— laganna í heild</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

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
              {act.textStatus === "fetch-failed" ? " (EUR-Lex would not serve it)" : ""}
              {act.textStatus === "too-large"
                ? " — EUR-Lex publishes it at a size this library does not hold, which for an act" +
                  " of mostly tabular annexes runs to hundreds of megabytes"
                : ""}. Use the official link above.
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
                          {isEu
                            ? "eur-lex.europa.eu ↗"
                            : isRegulation
                              ? "reglugerd.is ↗"
                              : "althingi.is ↗"}
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

                      {/*
                        Lagasafn's own footnotes, as it prints them. Almost
                        always "which act amended this article, and in which of
                        its own articles" — the thread from a provision back to
                        the bill that wrote it — but sometimes the regulations
                        set under the article instead, so they are shown as
                        written rather than relabelled as amendments.
                      */}
                      {p.footnotes.length > 0 && (
                        <ul className="mt-3 border-t border-line pt-2 text-[11px] leading-relaxed text-inkSoft">
                          {p.footnotes.map((note, i) => (
                            <li key={i}>{note}</li>
                          ))}
                        </ul>
                      )}

                      {p.regulationCount > 0 && (
                        <p className="mt-3 text-[11px] text-inkSoft">
                          {p.regulationCount === 1
                            ? "Ein reglugerð er sett samkvæmt þessu ákvæði"
                            : `${p.regulationCount} reglugerðir eru settar samkvæmt þessu ákvæði`}{" "}
                          — sjá listann efst á síðunni.
                        </p>
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
