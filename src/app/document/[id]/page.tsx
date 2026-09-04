"use client";
import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { JudgmentText } from "@/components/JudgmentText";
import { buildCitation } from "@/lib/citation";
import { isScholarship, sourceByKey } from "@/lib/sources";

interface Related {
  id: string; caseNumber: string | null; title: string;
  court: string | null; date: string | null;
}

export default function DocumentPage() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get("q") ?? "";

  const [doc, setDoc] = useState<any>(null);
  const [related, setRelated] = useState<Related[]>([]);
  const [error, setError] = useState("");
  const [innerQuery, setInnerQuery] = useState(initialQuery);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch(`/api/documents/${id}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Failed to load document.");
        setDoc(d.document);
        setRelated(d.related);
      })
      .catch((e) => setError(e.message));
  }, [id]);

  const citation = useMemo(() => (doc ? buildCitation(doc) : ""), [doc]);
  const matchCount = useMemo(() => {
    if (!doc || !innerQuery.trim()) return 0;
    const terms = innerQuery.replace(/"/g, "").trim();
    if (!terms) return 0;
    try {
      return ((doc.fullText ?? "").match(new RegExp(terms.split(/\s+/).join("|"), "giu")) ?? []).length;
    } catch { return 0; }
  }, [doc, innerQuery]);

  if (error) return <main className="mx-auto max-w-4xl p-6 text-sm text-accent">{error}</main>;
  if (!doc) return <main className="mx-auto max-w-4xl p-6 text-sm text-inkSoft">Loading…</main>;

  // For a journal article this page is a catalogue entry, not a reader: the
  // API sends the record and the journal's own abstract, never the text. See
  // "Reading an article" in the README.
  const scholarship = isScholarship(doc.source);
  const publisher = sourceByKey(doc.source)?.name ?? "the publisher";

  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      <Link href="/" className="text-xs text-inkSoft hover:text-ink">← Back to search</Link>

      <header className="mt-2 rounded-lg border border-line bg-white p-4">
        {doc.isSample && (
          <p className="mb-2 rounded bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800">
            Sample document — placeholder content for development, not a real judgment.
          </p>
        )}
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm text-inkSoft">
          {doc.caseNumber && <span className="rounded bg-paper px-2 py-0.5 font-mono text-sm font-semibold text-ink">{doc.caseNumber}</span>}
          <span className="font-medium text-ink">{doc.court}</span>
          {doc.date && <span>{new Date(doc.date).toLocaleDateString("is-IS", { day: "numeric", month: "long", year: "numeric" })}</span>}
          <span className="text-xs uppercase">{doc.language}</span>
        </div>
        <h1 className="mt-2 font-serif text-2xl font-semibold leading-snug">{doc.caseName ?? doc.title}</h1>
        {/*
          The title is printed under the heading only when it says something
          the heading does not. A CJEU judgment's title is its case number and
          its parties ("C-24/26 — Criminal proceedings against …"), and the
          heading is the parties alone with the case number already beside the
          court above, so printing it would repeat the line under itself.
        */}
        {doc.caseName && doc.caseName !== doc.title && !doc.title.endsWith(doc.caseName) && (
          <p className="text-inkSoft">{doc.title}</p>
        )}
        {/*
          A journal article's `parties` is its byline — "Eftir Gunnar Atla
          Gunnarsson, lögmann" — stored as the journal writes it. Labelling
          that "Parties:" would be wrong, and labelling it "Höfundur:" would
          read as a label on a sentence that already names its own author, so
          for scholarship it is printed as written.
        */}
        {doc.parties &&
          (sourceByKey(doc.source)?.kind === "scholarship" ? (
            <p className="mt-1 text-sm text-inkSoft">{doc.parties}</p>
          ) : (
            <p className="mt-1 text-sm text-inkSoft">Parties: {doc.parties}</p>
          ))}
        {doc.subjectTags?.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {doc.subjectTags.map((t: string) => (
              <Link
                key={t}
                href={`/?tag=${encodeURIComponent(t)}`}
                className="rounded-full bg-paper px-2 py-0.5 text-xs text-inkSoft hover:bg-line hover:text-ink"
                title={`Show other cases tagged "${t}"`}
              >
                {t}
              </Link>
            ))}
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          <a href={doc.officialUrl} target="_blank" rel="noopener noreferrer" className="rounded bg-ink px-2.5 py-1 text-xs font-medium text-white hover:bg-inkSoft">
            {scholarship ? "Read at publisher ↗" : "Official source ↗"}
          </a>
          {/* See ResultCard: an article is reached through the journal's page. */}
          {doc.pdfUrl && !scholarship && (
            <a href={doc.pdfUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-accent hover:underline">
              Source document / PDF ↗
            </a>
          )}
          <button
            onClick={() => { navigator.clipboard.writeText(citation); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
            className="rounded border border-line px-2.5 py-1 text-xs text-inkSoft hover:border-ink hover:text-ink"
          >
            {copied ? "Copied" : "Copy citation"}
          </button>
        </div>
        <p className="mt-2 break-all rounded bg-paper px-2 py-1 font-mono text-[11px] text-inkSoft">{citation}</p>
      </header>

      {scholarship ? (
        <article className="mt-4 rounded-lg border border-line bg-white px-6 py-7 sm:px-10">
          {doc.summary && (
            <>
              <h2 className="font-serif text-lg font-semibold">Útdráttur</h2>
              <div className="mt-2 font-serif text-[15px] leading-relaxed">
                {doc.summary.split("\n\n").map((paragraph: string, i: number) => (
                  <p key={i} className="mb-3 last:mb-0">{paragraph}</p>
                ))}
              </div>
            </>
          )}
          <div className={doc.summary ? "mt-6 border-t border-line pt-5" : undefined}>
            <p className="text-sm text-inkSoft">
              Published by {publisher}. The article is its author&apos;s work: indexed here so it
              can be found, and read at the journal that published it.
            </p>
            <a
              href={doc.officialUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-block rounded bg-ink px-3 py-1.5 text-sm font-medium text-white hover:bg-inkSoft"
            >
              Read the article at {publisher} ↗
            </a>
          </div>
        </article>
      ) : (
        <>
          <div className="sticky top-0 z-10 mt-4 flex items-center gap-2 rounded-lg border border-line bg-white p-2">
            <input
              value={innerQuery}
              onChange={(e) => setInnerQuery(e.target.value)}
              placeholder="Search within this document…"
              className="w-full rounded border border-line px-3 py-1.5 text-sm"
              lang="is"
            />
            <span className="whitespace-nowrap text-xs text-inkSoft">
              {innerQuery.trim() ? `${matchCount} hit${matchCount === 1 ? "" : "s"}` : ""}
            </span>
          </div>

          <article className="mt-4 rounded-lg border border-line bg-white px-6 py-7 sm:px-10">
            <JudgmentText text={doc.fullText} query={innerQuery} />
          </article>
        </>
      )}

      {related.length > 0 && (
        <section className="mt-4 rounded-lg border border-line bg-white p-4">
          <h2 className="text-sm font-semibold">Related cases cited in this document</h2>
          <ul className="mt-2 space-y-1.5">
            {related.map((r) => (
              <li key={r.id} className="text-sm">
                <Link href={`/document/${r.id}`} className="text-accent hover:underline">
                  {r.caseNumber ? `${r.caseNumber} — ` : ""}{r.title}
                </Link>
                <span className="text-xs text-inkSoft"> · {r.court ?? ""}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="mt-4 text-center text-[11px] text-inkSoft">
        This is an unofficial research tool. Always verify text against the official source.
      </p>
    </main>
  );
}
