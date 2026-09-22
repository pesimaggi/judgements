"use client";
import { useEffect, useRef } from "react";
import { SignIn } from "@clerk/nextjs";
import type { Continuation } from "@/lib/auth/continuation";

export function AuthDialog({ intent, ready, configured, onClose }: {
  intent: Continuation; ready: boolean; configured: boolean; onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const focus = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    dialog?.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { dialog?.close(); document.body.style.overflow = overflow; focus?.focus({ preventScroll: true }); };
  }, []);
  return (
    <dialog ref={ref} aria-labelledby="auth-title" onCancel={onClose}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-[440px] overflow-y-auto rounded-[3px] border border-line bg-white p-0 text-text shadow-xl backdrop:bg-ink/55">
      <div className="p-5" onClick={e => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 id="auth-title" className="font-heading text-xl text-ink">
            {intent.action?.type === "save-document" ? "Skrá inn til að vista" : "Skrá inn á Lögbrunn"}
          </h2>
          <button autoFocus type="button" onClick={onClose} className="text-sm text-inkSoft hover:text-ink">Loka</button>
        </div>
        {!configured ? <p role="status">Innskráning er ekki tilbúin. Þú getur áfram leitað og lesið allar heimildir.</p>
          : !ready ? <p role="status">Tengi við innskráningu… Ef tengingin næst ekki geturðu lokað og haldið áfram að leita.</p>
          : <SignIn routing="virtual" withSignUp transferable oauthFlow="popup"
              forceRedirectUrl={intent.returnTo} signUpForceRedirectUrl={intent.returnTo}
              fallback={<p role="status">Hleð innskráningu…</p>} />}
      </div>
    </dialog>
  );
}
