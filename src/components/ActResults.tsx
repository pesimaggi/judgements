"use client";
import Link from "next/link";
import { eeaTag } from "@/lib/eea-tag";

export interface ActSearchHit {
  id: string;
  jurisdiction: string;
  title: string;
  citation: string;
  path: string;
  provisionCount: number;
  citingCases: number;
  eeaRelevant: boolean;
  eeaIncorporatedBy: string[];
  matchedBy: "number" | "alias" | "title" | "weak";
}

export interface ProvisionSearchHit {
  id: string;
  actId: string;
  displayLabel: string;
  heading: string | null;
  snippet: string;
  citation: string;
  actTitle: string;
  path: string;
  caseCount: number;
}

interface Props {
  acts: ActSearchHit[];
  provisions: ProvisionSearchHit[];
  /** Narrows the case results below to the judgments citing this act. */
  onFilterByAct: (act: ActSearchHit) => void;
  onFilterByProvision: (provision: ProvisionSearchHit) => void;
}

function caseLabel(n: number, whole: boolean): string {
  const what = whole ? "til laganna" : "til þessa ákvæðis";
  return n === 1 ? `1 úrlausn vísar ${what}` : `${n} úrlausnir vísa ${what}`;
}

/**
 * The law itself, above the judgments.
 *
 * Someone who types "vaxtalög" or "38/2001" into the main search box is asking
 * for the act, not for the judgments that happen to mention the word — so the
 * act goes first and the case results keep the rest of the page. Where the
 * query named an article ("5. gr. vaxtalaga"), the article heads it instead:
 * that is the thing that was asked for, and the act is one click behind it.
 *
 * Each card offers the two things worth doing next, which are not the same
 * thing: **read the text**, which leaves for the act reader, and **show the
 * judgments citing it**, which stays here and narrows the results below. The
 * second is what turns a lookup into research, and it is why this block filters
 * rather than merely linking.
 *
 * Nothing is shown unless the query genuinely names an act — see
 * lib/act-match.ts — so a search for a subject looks exactly as it did before.
 */
export function ActResults({ acts, provisions, onFilterByAct, onFilterByProvision }: Props) {
  if (acts.length === 0 && provisions.length === 0) return null;

  return (
    <section className="mb-4" aria-label="Lög og gerðir">
      <h2 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-inkSoft">
        {provisions.length > 0 ? "Ákvæðið" : acts.length === 1 ? "Lögin" : "Lög og gerðir"}
      </h2>

      <div className="flex flex-col gap-2">
        {provisions.map((provision) => (
          <article
            key={provision.id}
            className="rounded-lg border border-accent/40 bg-accentSoft/40 p-4"
          >
            <p className="font-mono text-[11px] text-inkSoft">{provision.citation}</p>
            <h3 className="mt-0.5 font-serif text-lg leading-snug">
              <Link href={provision.path} className="hover:underline">
                {provision.displayLabel}
                {provision.heading && (
                  <span className="font-sans text-base font-normal text-inkSoft">
                    {" "}
                    — {provision.heading}
                  </span>
                )}
              </Link>
            </h3>
            <p className="mt-1 line-clamp-3 text-sm text-ink/80">{provision.snippet}</p>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <Link href={provision.path} className="font-medium text-accent hover:underline">
                Lesa ákvæðið →
              </Link>
              {provision.caseCount > 0 && (
                <button
                  type="button"
                  onClick={() => onFilterByProvision(provision)}
                  className="text-accent hover:underline"
                >
                  {caseLabel(provision.caseCount, false)} — sýna þær
                </button>
              )}
              <span className="text-inkSoft">{provision.actTitle}</span>
            </div>
          </article>
        ))}

        {acts.map((act) => {
          const tag = eeaTag(act);
          return (
            <article key={act.id} className="rounded-lg border border-line bg-white p-4">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-mono text-[11px] text-inkSoft">{act.citation}</p>
                {tag && (
                  <span
                    title={tag.detail}
                    className={`rounded-full px-2 py-0.5 text-[10px] ${
                      tag.status === "incorporated"
                        ? "bg-accentSoft font-medium text-accent"
                        : "border border-line text-inkSoft"
                    }`}
                  >
                    {tag.label}
                  </span>
                )}
              </div>
              <h3 className="mt-0.5 font-serif text-lg leading-snug">
                <Link href={act.path} className="hover:underline">
                  {act.title}
                </Link>
              </h3>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-inkSoft">
                <Link href={act.path} className="font-medium text-accent hover:underline">
                  Lesa lagatextann →
                </Link>
                {act.citingCases > 0 ? (
                  <button
                    type="button"
                    onClick={() => onFilterByAct(act)}
                    className="text-accent hover:underline"
                  >
                    {caseLabel(act.citingCases, true)} — sýna þær
                  </button>
                ) : (
                  <span>engin úrlausn vísar til laganna</span>
                )}
                <span>
                  {act.provisionCount > 0 ? `${act.provisionCount} greinar` : "texti ósóttur"}
                </span>
              </div>
            </article>
          );
        })}
      </div>

      <p className="mt-2 text-xs text-inkSoft">Úrlausnir hér fyrir neðan.</p>
    </section>
  );
}
