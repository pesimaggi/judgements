"use client";
import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { HighlightedText } from "@/components/HighlightedText";
import { buildCitation } from "@/lib/citation";

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
      return (doc.fullText.match(new RegExp(terms.split(/\s+/).join("|"), "giu")) ?? []).length;
    } catch { return 0; }
  }, [doc, innerQuery]);

  if (error) return <main className="mx-auto max-w-4xl p-6 text-sm text-accent">{error}</main>;
  if (!doc) return <main className="mx-auto max-w-4xl p-6 text-sm text-inkSoft">Loading…</main>;

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
        {doc.caseName && doc.caseName !== doc.title && <p className="text-inkSoft">{doc.title}</p>}
        {doc.parties && <p className="mt-1 text-sm text-inkSoft">Parties: {doc.parties}</p>}
        {doc.subjectTags?.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {doc.subjectTags.map((t: string) => (
              <span key={t} className="rounded-full bg-paper px-2 py-0.5 text-xs text-inkSoft">{t}</span>
            ))}
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          <a href={doc.officialUrl} target="_blank" rel="noopener noreferrer" className="rounded bg-ink px-2.5 py-1 text-xs font-medium text-white hover:bg-inkSoft">
            Official source ↗
          </a>
          {doc.pdfUrl && (
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

      <article className="mt-4 rounded-lg border border-line bg-white p-6">
        <div className="doc-text">
          <HighlightedText text={doc.fullText} query={innerQuery} />
        </div>
      </article>

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
