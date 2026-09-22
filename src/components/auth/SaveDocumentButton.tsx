"use client";
import { FolderIcon } from "../icons";
import { useAppAuth } from "./AuthProvider";
export function SaveDocumentButton({ documentId }: { documentId: string }) {
  const auth = useAppAuth();
  const saved = auth.items.some(item => item.documentId === documentId);
  return <button type="button" aria-pressed={saved} disabled={auth.busy}
    onClick={() => saved ? void auth.remove(documentId) : auth.run({ type: "save-document", documentId })}
    title={saved ? "Fjarlægja úr vistuðum úrlausnum" : "Vista úrlausn"}
    className="inline-flex items-center justify-center gap-[7px] rounded-[3px] border border-lineStrong px-2.5 py-1.5 text-[11.5px] font-medium text-inkSoft hover:bg-glacier hover:text-ink disabled:opacity-60">
    <FolderIcon className="h-[13px] w-[13px]" />{saved ? "Vistað" : "Vista"}
  </button>;
}
