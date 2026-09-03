"use client";
import { useEffect, useState } from "react";

export type ActScope = "eea" | "eu";

const STORAGE_KEY = "logbrunnur.actScope";

/**
 * The EEA / EU choice, remembered across pages and visits.
 *
 * It is a research posture rather than a filter you set per query: someone
 * working on Icelandic law wants the EEA-scoped library every time they open
 * the app, and someone comparing against an EU act that was never taken into
 * the Agreement wants the whole thing every time. Asking again on every page
 * would make the wide setting invisible from the page that needs it.
 */
export function useActScope(): [ActScope, (scope: ActScope) => void] {
  const [scope, setScope] = useState<ActScope>("eea");

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === "eu" || stored === "eea") setScope(stored);
    } catch {
      // A browser with storage disabled still gets the default.
    }
  }, []);

  const choose = (next: ActScope) => {
    setScope(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Not remembering the choice is survivable; failing to apply it is not.
    }
  };

  return [scope, choose];
}

interface Props {
  scope: ActScope;
  onChange: (scope: ActScope) => void;
  /** Numbers to show behind each option, where the page knows them. */
  counts?: { eea?: number; eu?: number };
  className?: string;
}

/**
 * The scope control: how much of the EU library an act lookup may see.
 *
 * Two states, not a checkbox, because they are two ways of working rather than
 * a setting and its absence — and because "EES" is the answer to a different
 * question from "ESB", not a narrower version of the same one:
 *
 *   EES — Icelandic law, and the EU acts that may be part of EEA law: the ones
 *     marked "(Text with EEA relevance)" and the ones a decision of the EEA
 *     Joint Committee names. What is binding, or plausibly binding, here.
 *   ESB — the whole EU library. What you want precisely when an act has *not*
 *     been incorporated and you need to say so.
 *
 * Icelandic law is in both: the toggle never hides lög nr. 91/1991.
 */
export function ScopeToggle({ scope, onChange, counts, className = "" }: Props) {
  const options: { value: ActScope; label: string; title: string; count?: number }[] = [
    {
      value: "eea",
      label: "EES",
      title: "Íslensk lög og þær ESB-gerðir sem geta haft EES-þýðingu",
      count: counts?.eea,
    },
    {
      value: "eu",
      label: "ESB",
      title: "Allar gerðir ESB — líka þær sem hafa ekki verið teknar upp í EES-samninginn",
      count: counts?.eu,
    },
  ];

  return (
    <div className={`inline-flex overflow-hidden rounded-lg border border-line ${className}`}>
      {options.map((option) => {
        const active = option.value === scope;
        return (
          <button
            key={option.value}
            type="button"
            title={option.title}
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={`px-3 py-1 text-xs font-medium transition-colors ${
              active ? "bg-ink text-white" : "bg-white text-inkSoft hover:bg-paper"
            }`}
          >
            {option.label}
            {option.count !== undefined && (
              <span className={`ml-1 ${active ? "text-white/70" : "text-inkSoft/70"}`}>
                {option.count.toLocaleString("is-IS")}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
