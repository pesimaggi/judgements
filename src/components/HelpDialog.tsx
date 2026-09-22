"use client";
import { useEffect, useRef } from "react";
import Link from "next/link";
import { CloseIcon } from "./icons";

/**
 * The search syntax, written out.
 *
 * Every one of these works today and none of them is discoverable from the
 * box: a reader who does not know that quotes mean a phrase has no way to
 * find out, and will conclude the search cannot do it. That is the whole
 * reason the dialog exists.
 */
const OPERATIONS: { syntax: string; what: string }[] = [
  { syntax: "andmæli starfsleyfi", what: "Öll orðin þurfa að koma fyrir — bil virkar eins og AND." },
  { syntax: "uppsögn OR riftun", what: "Annað hvort orðið dugar." },
  { syntax: "uppsögn NOT sjómenn", what: "Útilokar úrlausnir sem innihalda seinna orðið." },
  { syntax: "„sönnun um orsakatengsl“", what: "Gæsalappir leita að orðasambandinu orðrétt." },
  { syntax: "22/2023", what: "Málsnúmer — finnur málið sjálft og úrlausnir sem vísa í það." },
  {
    syntax: "13. gr. laga nr. 37/1993",
    what: "Ákvæði — ákvæðið birtist efst og hægt er að þrengja við úrlausnir sem vísa í það.",
  },
  { syntax: "vaxtalög", what: "Heiti eða stuttnefni laga — lögin sjálf birtast yfir úrlausnunum." },
];

const FOCUSABLE =
  'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function HelpDialog({ open, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  // Where focus was before the dialog took it — a reader who opens the dialog
  // from the keyboard and closes it again must land back on the control they
  // opened it with, not at the top of the document.
  const returnTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    returnTo.current = document.activeElement as HTMLElement | null;
    panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      // The trap: a dialog you can Tab out of leaves the reader typing into a
      // search box they cannot see, behind a backdrop that ignores their
      // clicks.
      const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      returnTo.current?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8"
      style={{ background: "rgba(15,42,68,.55)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-title"
        className="w-full max-w-[760px] rounded-[3px] bg-white"
        style={{ boxShadow: "0 18px 48px rgba(15,42,68,.3)" }}
      >
        <div className="flex items-start justify-between gap-5 border-b border-line px-6 pb-4 pt-5">
          <div>
            <div className="text-[10px] uppercase tracking-[.2em] text-gold">Leiðbeiningar</div>
            <h2 id="help-title" className="mt-1.5 font-heading text-[25px] font-medium leading-[1.15] text-ink">
              Að leita í Lögbrunni
            </h2>
            <p className="mt-1.5 max-w-[62ch] font-serif text-sm leading-relaxed text-text">
              Leitin nær yfir dóma, úrskurði, álit og fræðigreinar. Íslensk beygingargreining
              fylgir með: leit að <em>ríkisborgararéttur</em> finnur líka{" "}
              <em>ríkisborgararétti</em> og <em>ríkisborgararéttar</em>.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Loka leiðbeiningum"
            className="shrink-0 rounded-[3px] p-1 text-textMuted transition-colors hover:text-ink"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="flex flex-col border-b border-line md:flex-row">
          <div className="flex-1 px-6 pb-5 pt-[18px]">
            <h3 className="mb-2.5 text-[11px] uppercase tracking-[.12em] text-inkSoft">
              Leitaraðgerðir
            </h3>
            <dl className="flex flex-col gap-2.5">
              {OPERATIONS.map((op) => (
                <div key={op.syntax} className="flex items-baseline gap-3">
                  <dt className="shrink-0">
                    <code className="block min-w-[152px] rounded-[3px] border border-line bg-paper px-2 py-[3px] font-serif text-[12.5px] text-ink">
                      {op.syntax}
                    </code>
                  </dt>
                  <dd className="text-[12.5px] leading-normal text-text">{op.what}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3.5 text-xs leading-[1.55] text-textMuted">
              Aðgerðirnar má sameina:{" "}
              <span className="text-text">„andmælaréttur“ AND starfsleyfi NOT sjómenn</span>. Síur
              fyrir heimildir, dagsetningar og ár vinna alltaf með leitarstrengnum.
            </p>
          </div>

          <div className="shrink-0 border-line bg-paper px-6 pb-5 pt-[18px] md:w-[296px] md:border-l">
            <h3 className="mb-2 text-[11px] uppercase tracking-[.12em] text-inkSoft">
              Brunnurinn AI
            </h3>
            <p className="font-serif text-[13.5px] leading-relaxed text-text">
              Spurðu heilli spurningu — „Hvenær má víkja frá andmælareglu?“ — og Brunnurinn leitar
              sjálfur í lögum, ákvæðum og úrlausnum og svarar í samfelldu máli.
            </p>
            <ul className="mt-3 flex list-disc flex-col gap-1.5 pl-4 text-[12.5px] leading-normal text-text">
              <li>Hver fullyrðing ber tilvísun sem opnar heimildina sjálfa.</li>
              <li>Tilvísanir eru sannreyndar áður en svarið birtist; óstudd atriði eru merkt.</li>
              <li>
                Brunnurinn svarar aðeins út frá því sem leitin skilar — hann er aðstoð, ekki
                lögfræðiráðgjöf.
              </li>
            </ul>
            <button
              type="button"
              onClick={() => {
                onClose();
                // The well is its own launcher in the corner of every page;
                // this asks it to open rather than duplicating it here.
                window.dispatchEvent(new CustomEvent("logbrunnur:open-well"));
              }}
              className="mt-3 inline-block rounded-[3px] border border-ink px-3.5 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-glacier"
            >
              Opna Brunninn AI
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-3.5">
          <span className="text-[11.5px] text-textMuted">
            Óopinbert rannsóknartæki. Staðfestu ávallt texta við opinbera heimild.
          </span>
          <div className="flex items-center gap-3.5">
            <Link href="/admin/ingestion" className="text-xs text-textMuted hover:text-ink">
              Um gagnasafnið
            </Link>
            <button
              type="button"
              onClick={onClose}
              className="rounded-[3px] border border-ink bg-ink px-[18px] py-[7px] text-[12.5px] font-medium text-white transition-colors hover:bg-inkSoft"
            >
              Loka
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
