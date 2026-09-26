"use client";
import { useEffect, useState } from "react";

/** Which text of an instrument the reader is showing. */
export type TextLanguage = "is" | "en";

const STORAGE_KEY = "logbrunnur.textLanguage";

/**
 * The language the reader last chose, remembered across pages and visits.
 *
 * Remembered for the reason ScopeToggle's scope is: it is a way of working
 * rather than a per-page setting. Someone reading the EEA Agreement against the
 * EFTA Court's English reasoning wants English on every article they open, and
 * being asked again on each one would make the choice feel like a mistake.
 *
 * It is a preference, not an instruction: an instrument with no text in the
 * remembered language shows the one it has, and the control is not offered at
 * all where there is only one. See the reader.
 */
export function useTextLanguage(): [TextLanguage | null, (language: TextLanguage) => void] {
  // Null until the stored value has been read, so the first render does not
  // claim a language the reader did not choose.
  const [language, setLanguage] = useState<TextLanguage | null>(null);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === "is" || stored === "en") setLanguage(stored);
    } catch {
      // A browser with storage disabled still gets the governing text.
    }
  }, []);

  const choose = (next: TextLanguage) => {
    setLanguage(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Not remembering the choice is survivable; failing to apply it is not.
    }
  };

  return [language, choose];
}

const LABELS: Record<TextLanguage, { label: string; title: string }> = {
  is: {
    label: "ÍSL",
    title: "Íslenski textinn — sá sem hefur lagagildi hér á landi",
  },
  en: {
    label: "ENG",
    title: "Enski textinn — sá sem dómstólar EFTA og ESB vitna til",
  },
};

interface Props {
  /** The languages this instrument actually has stored. */
  available: TextLanguage[];
  current: TextLanguage;
  onChange: (language: TextLanguage) => void;
  /** Show both texts side by side instead of one. */
  parallel: boolean;
  onParallelChange: (parallel: boolean) => void;
  className?: string;
}

/**
 * Which authentic text of a treaty to read, and whether to read them together.
 *
 * Two texts of a treaty are not an original and a translation: Article 129 of
 * the EEA Agreement makes every language version equally authentic, and 2. gr.
 * laga nr. 2/1993 gives the Icelandic one the force of law here. So this is not
 * a "translate" button — it is a choice between two statements of the same rule,
 * which is why the third state exists. Reading them in parallel is what a lawyer
 * arguing from an EFTA Court judgment in English about a right in Icelandic
 * actually needs, and neither single-language view can serve it.
 */
export function TextLanguageToggle({
  available,
  current,
  onChange,
  parallel,
  onParallelChange,
  className = "",
}: Props) {
  if (available.length < 2) return null;
  return (
    <div className={`inline-flex overflow-hidden rounded-lg border border-line ${className}`}>
      {available.map((language) => {
        const active = !parallel && language === current;
        return (
          <button
            key={language}
            type="button"
            title={LABELS[language].title}
            aria-pressed={active}
            onClick={() => {
              onParallelChange(false);
              onChange(language);
            }}
            className={`px-2.5 py-1 text-xs font-medium transition-colors ${
              active ? "bg-ink text-white" : "bg-white text-inkSoft hover:bg-paper"
            }`}
          >
            {LABELS[language].label}
          </button>
        );
      })}
      <button
        type="button"
        title="Báða textana hlið við hlið, grein fyrir grein"
        aria-pressed={parallel}
        onClick={() => onParallelChange(!parallel)}
        className={`border-l border-line px-2.5 py-1 text-xs font-medium transition-colors ${
          parallel ? "bg-ink text-white" : "bg-white text-inkSoft hover:bg-paper"
        }`}
      >
        Samhliða
      </button>
    </div>
  );
}
