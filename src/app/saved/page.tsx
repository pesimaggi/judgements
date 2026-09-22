"use client";
import Link from "next/link";
import { useAppAuth } from "@/components/auth/AuthProvider";
import { SaveDocumentButton } from "@/components/auth/SaveDocumentButton";
export default function SavedPage() {
  const auth = useAppAuth();
  return <main className="mx-auto max-w-4xl px-4 py-8">
    <h1 className="font-heading text-2xl text-ink">Vistaðar úrlausnir</h1>
    {!auth.signedIn ? <div className="mt-4 text-sm">
      <p>Skráðu þig inn til að sjá vistaðar úrlausnir á öllum tækjum.</p>
      <button className="mt-3 rounded-[3px] bg-ink px-4 py-2 text-white" onClick={auth.signIn}>Skrá inn</button>
    </div> : <div className="mt-4">
      {auth.itemsLoading && <p role="status">Sæki vistaðar úrlausnir…</p>}
      {auth.itemsError && <p role="alert">{auth.itemsError} <button className="underline" onClick={() => void auth.reload()}>Reyna aftur</button></p>}
      {!auth.itemsLoading && !auth.itemsError && !auth.items.length && <p className="text-sm text-textMuted">Engar úrlausnir vistaðar. Veldu „Vista“ við úrlausn í leitinni.</p>}
      {auth.items.map(({ document }) => <article key={document.id} className="flex items-center justify-between gap-4 border-b border-line py-4">
        <div><p className="text-xs text-textMuted">{document.court} · {document.caseNumber}</p>
          <Link href={`/document/${document.id}`} className="font-heading text-lg text-ink hover:underline">{document.caseName ?? document.title}</Link></div>
        <SaveDocumentButton documentId={document.id} />
      </article>)}
    </div>}
    <Link href="/" className="mt-6 inline-block text-sm text-inkSoft underline">Til baka í leit</Link>
  </main>;
}
