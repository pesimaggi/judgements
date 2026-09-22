"use client";
import { useEffect, useRef } from "react";

/**
 * What the well is doing, while it does it.
 *
 * This replaces a drawing of a well with a bucket in it. The illustration was
 * doing a real job — several seconds, or several minutes in deep mode, is a
 * long time in front of a spinner — but it was doing it by being something to
 * watch rather than something to read, and a legal research tool that answers
 * with a cartoon while it works is making a claim about itself that the rest
 * of the interface does not. What is here instead is the same wait, spent on
 * the one thing a reader actually wants during it: what has been established
 * so far, and what the well is looking at now.
 *
 * Four things, in the order they become true:
 *
 *   the rail      which stage the pipeline is in. Three, because three is
 *                 what the pipeline has — planning, retrieval, writing — and
 *                 inventing a fourth to make the bar look busier would be a
 *                 progress bar that lies.
 *   the terms     the corpus words the search is actually running on. The
 *                 first thing that exists, a second or two in, and worth the
 *                 space because it says the question was understood.
 *   the steps     each call the research loop made, with the reason it gave
 *                 before making it.
 *   the thinking  the model's own reasoning, where the provider returns it.
 *
 * The last two are deliberately different things and are kept visually apart.
 * A step's `why` is a sentence written for the reader once a decision is
 * made; the thinking is the deciding, including the readings it discarded.
 * Set in the same type they would read as one voice, and a discarded reading
 * of a statute looks exactly like a statement of one — so the thinking sits
 * under its own heading, in the muted colour, and never in the serif the
 * answer is set in.
 */

export type WellStage = "plan" | "retrieve" | "answer";

/** One call the loop made. Mirrors `ResearchStep` in WellChat. */
export interface ProgressStep {
  name: string;
  detail: string;
  why: string;
}

interface Props {
  /** Which stage is running now. */
  stage: WellStage;
  /** Deep mode reads sources itself; quick mode runs one search. */
  mode: "quick" | "deep";
  /** The corpus terms the planner chose, once it has. */
  terms: string[];
  /** How many sources retrieval settled on, once it has. */
  sourceCount: number;
  /** The research loop's calls, newest last. */
  steps: ProgressStep[];
  /** The model's reasoning, newest last. Empty under OpenAI — see llm.ts. */
  thinking: string[];
}

/**
 * What each research tool is called, to a reader.
 *
 * Lives here rather than in WellChat because this is the panel's own
 * vocabulary — the names are written for somebody watching the search happen,
 * not for the code — and because the finished answer's trail renders the same
 * calls and must call them the same thing. One map, so the live panel and the
 * record under the answer cannot drift apart.
 */
const STEP_LABEL: Record<string, string> = {
  search_decisions: "Leitar í úrlausnum",
  search_provisions: "Leitar í lagaákvæðum",
  find_citing_cases: "Leitar að málum sem vísa til",
  read_decision: "Les úrlausn",
  read_provision: "Les ákvæði",
  list_subject_tags: "Flettir upp efnisorðum",
  cases_citing_provision: "Leitar að dómum um ákvæðið",
  read_act_outline: "Les efnisyfirlit laga",
  research_complete: "Lýkur rannsókn",
};

/** The reader's name for a tool, or the tool's own if it is a new one. */
export function stepLabel(name: string): string {
  return STEP_LABEL[name] ?? name;
}

/**
 * The stages, and what each one is called while it runs.
 *
 * Named for what the well is doing rather than for the code that does it:
 * "Rannsókn" is what the research loop looks like from outside, and a reader
 * watching it should not have to know that the same box is called retrieval
 * in the pipeline.
 */
const STAGES: { key: WellStage; label: string }[] = [
  { key: "plan", label: "Skipulag" },
  { key: "retrieve", label: "Heimildir" },
  { key: "answer", label: "Svar" },
];

export function WellProgress({
  stage,
  mode,
  terms,
  sourceCount,
  steps,
  thinking,
}: Props) {
  const reached = STAGES.findIndex((s) => s.key === stage);

  return (
    <div className="px-4 pb-3 pt-4">
      <div className="mx-auto max-w-[32rem]">
        {/* ---- the rail ----------------------------------------------- */}
        <ol className="flex items-stretch gap-0" aria-label="Framvinda">
          {STAGES.map((s, i) => {
            const done = i < reached;
            const now = i === reached;
            return (
              <li key={s.key} className="flex-1">
                {/* The rule under each stage carries the state, not a dot or a
                    tick: it is the same gold hairline the masthead uses for
                    the page you are on, which is already this app's way of
                    saying "here". */}
                <span
                  className={`block h-px w-full ${
                    done ? "bg-inkSoft" : now ? "bg-gold" : "bg-line"
                  }`}
                />
                <span
                  className={`mt-1.5 block text-[10px] uppercase tracking-[.16em] ${
                    now ? "text-ink" : done ? "text-inkSoft" : "text-textMuted/60"
                  }`}
                >
                  {s.label}
                </span>
                {now && (
                  <span className="mt-0.5 block text-[10px] text-inkSoft">
                    {s.key === "plan"
                      ? "Les spurninguna"
                      : s.key === "retrieve"
                        ? mode === "deep"
                          ? "Les lögin og dómana"
                          : "Leitar í safninu"
                        : "Skrifar svarið"}
                  </span>
                )}
              </li>
            );
          })}
        </ol>

        {/* ---- what has been established so far ------------------------ */}
        {(terms.length > 0 || sourceCount > 0) && (
          <div className="mt-4 border-t border-line pt-3">
            {terms.length > 0 && (
              <>
                <p className="text-[10px] uppercase tracking-[.16em] text-textMuted">
                  Leitarorð
                </p>
                <p className="mt-1.5 flex flex-wrap gap-1.5">
                  {terms.slice(0, 8).map((term) => (
                    <span
                      key={term}
                      className="rounded-sm border border-line bg-paper px-1.5 py-0.5 font-serif text-[12px] text-ink"
                    >
                      {term}
                    </span>
                  ))}
                </p>
              </>
            )}
            {sourceCount > 0 && (
              <p className="mt-2 text-[11px] text-inkSoft">
                {sourceCount} {sourceCount === 1 ? "heimild" : "heimildir"} í hliðarglugganum
              </p>
            )}
          </div>
        )}

        {/* ---- the calls, and the reason given for each ---------------- */}
        {steps.length > 0 && (
          <div className="mt-3 border-t border-line pt-3">
            <p className="text-[10px] uppercase tracking-[.16em] text-textMuted">
              Aðferð
            </p>
            {/* Only the last few while it runs. The reader wants the shape of
                the search, not a log; the whole trail is kept on the answer
                and can be opened there afterwards. */}
            <ul className="mt-1.5 space-y-2">
              {steps.slice(-3).map((step, i) => (
                <li key={i} className="text-[11px] leading-snug">
                  <span className="text-ink">{stepLabel(step.name)}</span>
                  {step.detail && <span className="text-inkSoft"> — {step.detail}</span>}
                  {step.why && (
                    <span className="mt-0.5 block border-l border-line pl-2 text-inkSoft/90">
                      {step.why}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ---- the model reasoning aloud ------------------------------- */}
        {thinking.length > 0 && (
          <div className="mt-3 border-t border-line pt-3">
            <p className="text-[10px] uppercase tracking-[.16em] text-textMuted">
              Umhugsun
            </p>
            <ThinkingWindow text={thinking[thinking.length - 1] ?? ""} />
            <p className="mt-1.5 text-[10px] italic text-textMuted/80">
              Vinnunótur líkansins, ekki svarið — og ekki lögfræðiráðgjöf.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The reasoning as it arrives, in a window that follows it.
 *
 * A fixed height with the scroll pinned to the bottom, rather than a
 * paragraph that grows: a thinking block runs to several hundred words, and
 * letting it set its own height pushes the stage rail and the search terms —
 * the things a reader is actually tracking — off the top of the panel. The
 * newest sentence is the one worth showing, and the rest stays scrollable for
 * anyone who wants to read back.
 *
 * Pinned only while the reader has not taken over. Yanking the view back to
 * the bottom every 80 characters while somebody is reading further up is the
 * behaviour that makes live logs unusable.
 */
function ThinkingWindow({ text }: { text: string }) {
  const box = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  useEffect(() => {
    const el = box.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [text]);

  return (
    <div
      ref={box}
      onScroll={(e) => {
        const el = e.currentTarget;
        // A couple of lines of slack, so a smooth scroll that lands a pixel
        // short does not read as the reader having scrolled away.
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
      }}
      className="mt-1.5 max-h-28 overflow-y-auto whitespace-pre-wrap text-[11px] leading-relaxed text-textMuted"
    >
      {text}
    </div>
  );
}
