"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WellScene, type WellPhase } from "./WellScene";
import { WellReader } from "./WellReader";
import { markCitedIn, parseAnswer, type InlineSpan } from "@/lib/ask/render";
import { FEEDBACK_KINDS, FEEDBACK_LABELS, type FeedbackKind } from "@/lib/ask/feedback";
import { readAskEvents } from "@/lib/ask/sse";
import type { AskSource, AskTurn } from "@/lib/ask/types";

/**
 * The well: ask a question, watch it drop in, watch the law come back out.
 *
 * A deliberately different way in to the same corpus the rest of the app
 * searches. The search box answers "what documents match these words"; this
 * answers "what does the law say about this", which is the question somebody
 * who does not know the law yet actually has — and it is only worth offering
 * because every sentence of the answer is pinned to a provision or a decision
 * this database holds, and every one of those is a click away.
 *
 * IT OPENS AS A SPLIT SCREEN, and that is the layout the feature needed all
 * along. The conversation is one half; the law the well found is the other,
 * standing open beside it rather than folded into a list under each answer.
 * The reason is what the panel is *for*: an answer here is only as good as the
 * sources under it, and reading a judgment's own summary next to the sentence
 * that cites it is the actual work. In a 27rem box in the corner there was
 * room for the prose and no room for the evidence, so the evidence was a
 * collapsed list nobody opened.
 *
 * Under 60rem there is no room for two panes, so it becomes two tabs over one
 * — the same two panels, one at a time.
 */

/** How long the slip of paper takes to fall. Matches well-note-drop. */
const DROP_MS = 720;
/**
 * The floor on how long the loading state is shown. Without it a fast answer
 * flashes the artefacts for 200ms, which reads as a glitch rather than as the
 * well working.
 */
const MIN_LOAD_MS = 900;
/** The scene's own resize, from .well-stage in globals.css. */
const SCENE_TRANSITION_MS = 320;

interface Message {
  role: "user" | "assistant";
  content: string;
  sources?: AskSource[];
  /** The id the answer came back with, which feedback is attached to. */
  requestId?: string;
  language?: "is" | "en";
  /** True when this turn is the well reporting that it could not answer. */
  failed?: boolean;
}

const EXAMPLES = [
  "Hvernig sæki ég um íslenskan ríkisborgararétt?",
  "Hvenær má beita gæsluvarðhaldi?",
  "Hvaða reglur gilda um uppsögn ráðningarsamnings?",
];

export function WellChat({ enabled }: { enabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [phase, setPhase] = useState<WellPhase>("idle");
  const [messages, setMessages] = useState<Message[]>([]);
  const [falling, setFalling] = useState("");
  /** Which pane is showing, when the screen is too narrow for both. */
  const [pane, setPane] = useState<"chat" | "sources">("chat");
  /**
   * The corpus terms the planner chose, shown while the well is working.
   *
   * The first thing that can be shown at all, and the most reassuring: it says
   * the question was understood, and in what words the law is about to be
   * searched for. It arrives a second or two in, against an answer that can
   * take a minute.
   */
  const [terms, setTerms] = useState<string[]>([]);
  /**
   * The source open in the right-hand pane, if any.
   *
   * Null is the list of everything the search found; a source here replaces it
   * with the document itself. Reading a judgment beside the sentence that
   * cites it is the actual work, and it used to mean navigating away from the
   * conversation to do it. See components/WellReader.tsx.
   */
  const [reading, setReading] = useState<AskSource | null>(null);

  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const busy = phase === "dropping" || phase === "loading";

  /**
   * Opens a source in the reading pane.
   *
   * Below 60rem there is no second pane to open it into, so the panes are
   * tabs and this switches to the one the document is about to appear in —
   * otherwise the click does something invisible.
   */
  const openSource = useCallback((source: AskSource) => {
    setReading(source);
    setPane("sources");
  }, []);

  /** The sources panel follows the most recent answer that had any. */
  const latest = useMemo(
    () => [...messages].reverse().find((m) => m.role === "assistant" && (m.sources?.length ?? 0) > 0),
    [messages]
  );

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    const transcript = transcriptRef.current;
    if (!transcript) return;

    const toBottom = () =>
      transcript.scrollTo({ top: transcript.scrollHeight, behavior: "smooth" });

    // An answer is read from its first line, so a new one is scrolled to its
    // top rather than to the bottom of the panel — which would open every
    // answer at its own last sentence. While the well is working there is
    // nothing to read yet, and the bottom is where the action is.
    if (phase !== "answered") {
      toBottom();
      return;
    }

    // Deferred past the scene's own height transition: the well shrinks by a
    // hundred pixels at exactly this moment, and anchoring before it has
    // finished lands a hundred pixels into the answer.
    const timer = setTimeout(() => {
      const answers = transcript.querySelectorAll<HTMLElement>("[data-answer]");
      const newest = answers[answers.length - 1];
      if (!newest) return toBottom();
      // Measured against the scroll container rather than read off offsetTop,
      // which is relative to the positioned panel and so carries the header's
      // height with it.
      const delta =
        newest.getBoundingClientRect().top - transcript.getBoundingClientRect().top;
      transcript.scrollTo({ top: transcript.scrollTop + delta - 12, behavior: "smooth" });
    }, SCENE_TRANSITION_MS + 40);

    return () => clearTimeout(timer);
  }, [messages, phase]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const ask = useCallback(
    async (question: string) => {
      const trimmed = question.trim();
      if (!trimmed || busy) return;

      // Somebody who has switched motion off should not be made to wait for
      // an animation they will not see.
      const still =
        typeof window !== "undefined" &&
        window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

      setInput("");
      setFalling(trimmed);
      setPhase("dropping");
      setPane("chat");
      setTerms([]);
      // The open document belongs to the answer being replaced. Leaving it up
      // beside a new question is showing the law for the previous one.
      setReading(null);

      // Sent while the paper is still in the air: the animation is there to
      // cover the wait, not to add to it. Events that arrive during the fall
      // wait in the socket until the read loop below starts, so the drop is
      // never cut short by a fast first stage.
      const history: AskTurn[] = messages.map((m) => ({ role: m.role, content: m.content }));
      const request = fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ question: trimmed, history, stream: true }),
      });

      await wait(still ? 0 : DROP_MS);
      // The question joins the transcript when it lands, not when it is typed.
      setMessages((prev) => [...prev, { role: "user", content: trimmed }]);
      setFalling("");
      setPhase("loading");

      const startedAt = Date.now();
      let revealed = false;
      /**
       * The answer's language, known from the plan.
       *
       * Carried on the turn as soon as it is created so the feedback panel is
       * labelled in the right language even if the request fails before the
       * final `answer` event supplies it again.
       */
      let language: "is" | "en" = "is";
      /**
       * Moves off the loading scene, but never sooner than MIN_LOAD_MS.
       *
       * Streaming made the floor matter more, not less: the first line can now
       * arrive in a couple of hundred milliseconds, and without this the well's
       * artefacts would appear and vanish, which reads as a glitch rather than
       * as the well working.
       */
      const reveal = () => {
        if (revealed) return;
        revealed = true;
        const left = (still ? 0 : MIN_LOAD_MS) - (Date.now() - startedAt);
        if (left > 0) window.setTimeout(() => setPhase("answered"), left);
        else setPhase("answered");
      };

      /** Rewrites the assistant turn being streamed into, creating it if needed. */
      const update = (change: (m: Message) => Message) =>
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "assistant") {
            return [...prev.slice(0, -1), change(last)];
          }
          return [...prev, change({ role: "assistant", content: "" })];
        });

      try {
        const response = await request;
        if (!response.ok) {
          // Validation, rate limiting and a well with no key configured all
          // answer before the stream opens, as ordinary JSON with a status.
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error ?? "Brunnurinn gat ekki svarað þessu.");
        }

        await readAskEvents(response, (event) => {
          switch (event.type) {
            case "plan":
              setTerms(event.terms);
              language = event.language;
              break;
            case "sources":
              // Creates the assistant turn, which is what fills the sources
              // pane — the law stands open beside the answer before a word of
              // the answer has been written.
              update((m) => ({ ...m, sources: event.sources, language }));
              break;
            case "line": {
              reveal();
              update((m) => {
                const content = m.content ? `${m.content}\n${event.text}` : event.text;
                // Re-marked on every line so a source moves into "cited" as
                // the sentence citing it is written, rather than jumping there
                // when the final event arrives.
                return { ...m, content, sources: markCitedIn(content, m.sources ?? []) };
              });
              break;
            }
            case "answer":
              // Supersedes what was streamed. Normally identical; the optional
              // verifier can qualify a line already on screen, and an
              // abstention never streamed at all.
              update((m) => ({
                ...m,
                content: event.response.answer,
                sources: event.response.sources,
                requestId: event.response.requestId,
                language: event.response.language,
              }));
              break;
            case "error":
              update((m) => ({ ...m, content: event.message, failed: true }));
              break;
          }
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : "Brunnurinn gat ekki svarað þessu.";
        // Replaces a half-written answer rather than appending to it: a
        // truncated argument with an error under it is worse than the error.
        update((m) => ({ ...m, content: message, sources: m.sources ?? [], failed: true }));
      } finally {
        reveal();
        setPhase("answered");
      }
    },
    [busy, messages]
  );

  if (!enabled) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-40 flex items-center gap-2.5 rounded-full border border-line bg-white py-2 pl-2 pr-4 shadow-lg shadow-ink/10 transition hover:-translate-y-0.5 hover:shadow-xl"
        aria-label="Spyrja brunninn"
      >
        <WellMark />
        <span className="font-serif text-sm font-semibold text-ink">Spyrja brunninn</span>
      </button>
    );
  }

  const sources = latest?.sources ?? [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Brunnurinn"
    >
      <div className="well-panel flex h-full w-full max-w-6xl flex-col overflow-hidden bg-white shadow-2xl shadow-ink/20 sm:h-[min(52rem,calc(100vh-2rem))] sm:rounded-xl sm:border sm:border-line">
        <header className="flex shrink-0 items-center justify-between border-b border-line px-4 py-2.5">
          <div className="flex items-center gap-2.5">
            <WellMark />
            <div>
              <p className="font-serif text-sm font-semibold text-ink">Brunnurinn</p>
              <p className="text-[11px] text-inkSoft">
                Svör byggð á lögum og úrlausnum úr safninu
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {/* Below 60rem the two panes become two tabs over one. */}
            <div className="mr-1 flex rounded-md border border-line p-0.5 lg:hidden">
              <PaneTab active={pane === "chat"} onClick={() => setPane("chat")}>
                Samtal
              </PaneTab>
              <PaneTab active={pane === "sources"} onClick={() => setPane("sources")}>
                Heimildir{sources.length > 0 ? ` (${sources.length})` : ""}
              </PaneTab>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded p-1.5 text-inkSoft transition hover:bg-paper hover:text-ink"
              aria-label="Loka"
            >
              <svg
                viewBox="0 0 16 16"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
              >
                <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          {/* ---- the conversation ------------------------------------- */}
          <section
            className={`flex min-h-0 min-w-0 flex-1 flex-col lg:flex lg:basis-1/2 ${
              pane === "chat" ? "flex" : "hidden"
            }`}
          >
            <div ref={transcriptRef} className="min-h-0 flex-1 overflow-y-auto">
              {/* Full size while the well is working — the drop and the
                  artefacts are the whole point of the wait — and shrunk once
                  there is an answer, which is then the thing worth the room. */}
              <WellScene
                phase={phase}
                question={falling}
                compact={phase === "answered" && messages.length > 0}
              />

              {/* What the well is doing, while it does it.
                  The planner's terms are the first thing that exists — a
                  second or two in, against an answer that can take a minute —
                  and they are worth showing because they say the question was
                  understood and name the words the law is being searched for.
                  Under them, the count of sources the search brought back;
                  those are already standing open in the other pane by the time
                  this appears. */}
              {phase === "loading" && terms.length > 0 && (
                <div className="px-4 pb-3">
                  <div className="mx-auto max-w-[30rem] rounded-md border border-line bg-paper/60 px-3 py-2">
                    <p className="text-[11px] uppercase tracking-wide text-inkSoft">
                      Leitað í safninu
                    </p>
                    <p className="mt-1 flex flex-wrap gap-1.5">
                      {terms.slice(0, 6).map((term) => (
                        <span
                          key={term}
                          className="rounded bg-white px-1.5 py-0.5 text-[12px] text-ink shadow-sm"
                        >
                          {term}
                        </span>
                      ))}
                    </p>
                    {sources.length > 0 && (
                      <p className="mt-1.5 text-[11px] text-inkSoft">
                        {sources.length === 1
                          ? "1 heimild fundin"
                          : `${sources.length} heimildir fundnar`}{" "}
                        — sjá hægra megin
                      </p>
                    )}
                  </div>
                </div>
              )}

              {messages.length === 0 && phase === "idle" && (
                <div className="px-4 pb-4 text-center">
                  <p className="mx-auto max-w-[22rem] text-[13px] leading-relaxed text-inkSoft">
                    Spyrðu um íslenskan rétt. Brunnurinn leitar í lögum, EES- og ESB-gerðum,
                    dómum, úrskurðum og álitum — og vísar í hvert ákvæði sem svarið byggir á.
                    Heimildirnar standa opnar hægra megin.
                  </p>
                  <div className="mx-auto mt-3 flex max-w-[26rem] flex-col gap-1.5">
                    {EXAMPLES.map((example) => (
                      <button
                        key={example}
                        type="button"
                        onClick={() => void ask(example)}
                        className="rounded-md border border-line px-3 py-1.5 text-left text-[12px] text-inkSoft transition hover:border-ink/30 hover:bg-paper hover:text-ink"
                      >
                        {example}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.length > 0 && (
                <div className="space-y-4 px-4 pb-4">
                  {messages.map((message, i) =>
                    message.role === "user" ? (
                      <p
                        key={i}
                        className="ml-auto w-fit max-w-[85%] rounded-lg rounded-br-sm bg-ink px-3 py-2 text-[13px] leading-relaxed text-white"
                      >
                        {message.content}
                      </p>
                    ) : (
                      <Answer
                        key={i}
                        message={message}
                        onShowSources={() => setPane("sources")}
                        onOpen={openSource}
                      />
                    )
                  )}
                </div>
              )}

              {phase === "loading" && (
                <p className="pb-4 text-center text-[12px] text-inkSoft">
                  Sæki lögin úr brunninum …
                </p>
              )}
            </div>

            <form
              className="shrink-0 border-t border-line p-3"
              onSubmit={(e) => {
                e.preventDefault();
                void ask(input);
              }}
            >
              <div className="flex items-end gap-2">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void ask(input);
                    }
                  }}
                  rows={2}
                  maxLength={600}
                  disabled={busy}
                  placeholder="Spyrðu brunninn …"
                  className="min-h-[3rem] flex-1 resize-none rounded-md border border-line bg-paper px-3 py-2 text-[13px] leading-relaxed text-ink placeholder:text-inkSoft/70 focus-visible:border-ink/30 disabled:opacity-60"
                />
                <button
                  type="submit"
                  disabled={busy || input.trim().length < 3}
                  className="rounded-md bg-accent px-3 py-2.5 text-[13px] font-medium text-white transition hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busy ? "…" : "Sleppa ofan í"}
                </button>
              </div>
              <p className="mt-2 text-[10px] leading-snug text-inkSoft">
                Óopinbert hjálpartæki. Svarið er samantekt úr safninu, ekki lögfræðiráðgjöf —
                staðfestu alltaf textann hjá upphaflegri heimild.
              </p>
            </form>
          </section>

          {/* ---- what the well found, or the one being read ------------- */}
          <aside
            className={`min-h-0 min-w-0 flex-1 flex-col border-line bg-paper/40 lg:flex lg:basis-1/2 lg:border-l ${
              pane === "sources" ? "flex" : "hidden"
            }`}
          >
            {reading ? (
              <WellReader source={reading} onBack={() => setReading(null)} />
            ) : (
              <SourcePanel sources={sources} busy={busy} onOpen={openSource} />
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}

function PaneTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded px-2.5 py-1 text-[11px] font-medium transition ${
        active ? "bg-ink text-white" : "text-inkSoft hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * The other half of the screen: everything the well brought up, whether the
 * answer cited it or not.
 *
 * Cited first, because those are the ones the argument rests on, and the rest
 * under a heading of their own — being able to see what the search found and
 * the answer did not use is worth something, and is also the fastest way to
 * spot that the well found the right provision and then wrote around it.
 */
function SourcePanel({
  sources,
  busy,
  onOpen,
}: {
  sources: AskSource[];
  busy: boolean;
  onOpen: (source: AskSource) => void;
}) {
  const cited = sources.filter((s) => s.cited);
  const rest = sources.filter((s) => !s.cited);

  if (sources.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-center">
        <p className="max-w-[18rem] text-[12px] leading-relaxed text-inkSoft">
          {busy
            ? "Leita í lögum, dómum, úrskurðum og álitum …"
            : "Hér birtast lögin og úrlausnirnar sem svarið byggir á — hver heimild með þeim texta sem hún er valin fyrir."}
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <SourceGroup
        title={`Vitnað til (${cited.length})`}
        note="Heimildirnar sem svarið byggir beinlínis á."
        sources={cited}
        onOpen={onOpen}
      />
      {rest.length > 0 && (
        <SourceGroup
          title={`Kom líka upp (${rest.length})`}
          note="Fannst í leitinni en er ekki vitnað til í svarinu."
          sources={rest}
          muted
          onOpen={onOpen}
        />
      )}
    </div>
  );
}

function SourceGroup({
  title,
  note,
  sources,
  muted,
  onOpen,
}: {
  title: string;
  note: string;
  sources: AskSource[];
  muted?: boolean;
  onOpen: (source: AskSource) => void;
}) {
  if (sources.length === 0) return null;
  return (
    <section className={muted ? "mt-5" : ""}>
      <h3 className="font-sans text-[11px] font-semibold uppercase tracking-wide text-inkSoft">
        {title}
      </h3>
      <p className="mt-0.5 text-[11px] text-inkSoft/80">{note}</p>
      <ul className="mt-2 space-y-2">
        {sources.map((source) => (
          <li key={source.n}>
            <SourceCard source={source} muted={muted} onOpen={onOpen} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The Icelandic label for what a source is — the distinction that matters. */
const KIND_LABEL: Record<AskSource["kind"], string> = {
  act: "Lög",
  provision: "Lagaákvæði",
  decision: "Úrlausn",
  opinion: "Álit",
  commentary: "Fræðiskrif",
};

/**
 * One source, with the passage it was selected for.
 *
 * The excerpt is the point of the panel. A reader cannot check a citation from
 * a title, and asking them to open the judgment to find out why it is here is
 * asking them not to check at all.
 */
function SourceCard({
  source,
  muted,
  onOpen,
}: {
  source: AskSource;
  muted?: boolean;
  onOpen: (source: AskSource) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className={`rounded-lg border bg-white p-2.5 transition ${
        muted ? "border-line/60" : "border-line"
      }`}
    >
      <div className="flex gap-2">
        <span className="mt-px shrink-0 font-sans text-[10px] font-semibold text-accent">
          [{source.n}]
        </span>
        <div className="min-w-0 flex-1">
          <OpenSource source={source} onOpen={onOpen} className="block text-left hover:underline">
            <span className="block text-[12px] font-medium leading-snug text-ink">
              {source.title}
            </span>
          </OpenSource>
          <span className="mt-0.5 block text-[11px] leading-snug text-inkSoft">
            {source.subtitle}
          </span>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className="rounded bg-paper px-1.5 py-px text-[10px] text-inkSoft">
              {KIND_LABEL[source.kind]}
            </span>
            {source.kind === "commentary" && (
              <span className="rounded bg-accentSoft px-1.5 py-px text-[10px] text-accent">
                ekki gildandi réttur
              </span>
            )}
            {source.excerpt && (
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="text-[10px] text-inkSoft underline underline-offset-2 hover:text-ink"
                aria-expanded={open}
              >
                {open ? "Fela brotið" : "Sýna brotið"}
              </button>
            )}
            <OpenSource
              source={source}
              onOpen={onOpen}
              className="text-[10px] font-medium text-accent underline underline-offset-2"
            >
              Lesa hér
            </OpenSource>
          </div>
        </div>
      </div>

      {open && source.excerpt && (
        <p className="mt-2 whitespace-pre-line border-l-2 border-line pl-2.5 text-[11px] leading-relaxed text-inkSoft">
          {source.excerpt}
        </p>
      )}
    </div>
  );
}

/** One answer: the prose, then a way to say what was wrong with it. */
function Answer({
  message,
  onShowSources,
  onOpen,
}: {
  message: Message;
  onShowSources: () => void;
  onOpen: (source: AskSource) => void;
}) {
  const blocks = parseAnswer(message.content);
  const sources = message.sources ?? [];
  const byNumber = new Map(sources.map((s) => [s.n, s]));

  return (
    <div className="well-rise" data-answer>
      <div
        className={`space-y-2.5 text-[13px] leading-relaxed ${
          message.failed ? "text-accent" : "text-ink"
        }`}
      >
        {blocks.map((block, i) => {
          if (block.kind === "heading") {
            return (
              <h4
                key={i}
                className="pt-1 font-sans text-[11px] font-semibold uppercase tracking-wide text-inkSoft"
              >
                <Spans spans={block.spans} sources={byNumber} onOpen={onOpen} />
              </h4>
            );
          }
          if (block.kind === "list") {
            return (
              <ul key={i} className="list-disc space-y-1 pl-4 marker:text-line">
                {block.items.map((item, j) => (
                  <li key={j}>
                    <Spans spans={item} sources={byNumber} onOpen={onOpen} />
                  </li>
                ))}
              </ul>
            );
          }
          return (
            <p key={i}>
              <Spans spans={block.spans} sources={byNumber} onOpen={onOpen} />
            </p>
          );
        })}
      </div>

      {sources.length > 0 && (
        <button
          type="button"
          onClick={onShowSources}
          className="mt-2.5 text-[11px] text-inkSoft underline underline-offset-2 hover:text-ink lg:hidden"
        >
          Sjá {sources.length} heimildir
        </button>
      )}

      {message.requestId && !message.failed && (
        <Feedback message={message} />
      )}
    </div>
  );
}

/**
 * Saying what was wrong with an answer.
 *
 * Seven buttons rather than a thumb, because the seven are the seven things
 * that actually go wrong with a retrieval-grounded legal answer and each one
 * points at a different stage: a wrong source is ranking, a missing one is
 * retrieval, a citation that does not support the claim is the answer stage.
 * A thumbs-down would tell us none of that.
 *
 * The question is not sent. What goes with the report is the shape of the
 * answer — which button, how many sources, which provider — and the id of the
 * request, which carries nothing about what was asked. See lib/ask/feedback.ts.
 */
function Feedback({ message }: { message: Message }) {
  const [sent, setSent] = useState<FeedbackKind | null>(null);
  const [open, setOpen] = useState(false);
  const language = message.language ?? "is";

  const send = async (kind: FeedbackKind) => {
    setSent(kind);
    setOpen(false);
    try {
      await fetch("/api/ask/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: message.requestId,
          kind,
          language,
          sources: message.sources?.length ?? 0,
          cited: message.sources?.filter((s) => s.cited).length ?? 0,
        }),
      });
    } catch {
      // A lost report is not worth an error in front of somebody who was
      // doing us a favour by sending it.
    }
  };

  if (sent) {
    return (
      <p className="mt-2.5 text-[11px] text-inkSoft">
        Takk — skráð sem „{FEEDBACK_LABELS[sent][language]}“. Spurningin þín fylgdi ekki með.
      </p>
    );
  }

  return (
    <div className="mt-2.5 border-t border-line/70 pt-2">
      {!open ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void send("helpful")}
            className="rounded-md border border-line px-2 py-1 text-[11px] text-inkSoft transition hover:border-ink/30 hover:text-ink"
          >
            {FEEDBACK_LABELS.helpful[language]}
          </button>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="text-[11px] text-inkSoft underline underline-offset-2 hover:text-ink"
          >
            Eitthvað að svarinu?
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {FEEDBACK_KINDS.filter((k) => k !== "helpful").map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => void send(kind)}
              className="rounded-md border border-line px-2 py-1 text-[11px] text-inkSoft transition hover:border-accent/40 hover:text-accent"
            >
              {FEEDBACK_LABELS[kind][language]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * A source is either somewhere in this app — the act reader, the document
 * page — or, for a journal article, at the journal that published it. The
 * second kind opens in a new tab and says so, the way the result cards do.
 */
function OpenSource({
  source,
  onOpen,
  className,
  children,
}: {
  source: AskSource;
  onOpen: (source: AskSource) => void;
  className?: string;
  children: React.ReactNode;
}) {
  // A journal article is read at the journal that published it: its text is
  // indexed here for searching and never sent out, so there is nothing for the
  // reading pane to show and the link has to leave.
  if (/^https?:/.test(source.path)) {
    return (
      <a href={source.path} target="_blank" rel="noopener noreferrer" className={className}>
        {children}
      </a>
    );
  }
  return (
    <button type="button" onClick={() => onOpen(source)} className={className}>
      {children}
    </button>
  );
}

function Spans({
  spans,
  sources,
  onOpen,
}: {
  spans: InlineSpan[];
  sources: Map<number, AskSource>;
  onOpen: (source: AskSource) => void;
}) {
  return (
    <>
      {spans.map((span, i) => {
        if (span.kind === "bold")
          return (
            <strong key={i} className="font-semibold">
              {span.text}
            </strong>
          );
        if (span.kind === "text") return <span key={i}>{span.text}</span>;

        const source = sources.get(span.n);
        // A citation the answer made up, pointing at no source we returned.
        // Validation removes these before the answer is rendered; if one ever
        // reaches here it is shown as written rather than silently dropped,
        // because it is evidence that something upstream failed.
        if (!source) return (
          <span key={i} className="text-inkSoft">
            [{span.n}]
          </span>
        );
        // The shortest path from "it says this" to "does it though": the chip
        // opens the source it points at in the pane beside the sentence.
        return (
          <OpenSource
            key={i}
            source={source}
            onOpen={onOpen}
            className="ml-0.5 rounded bg-accentSoft px-1 align-super text-[9px] font-semibold text-accent hover:underline"
          >
            <span title={`Lesa: ${source.title} — ${source.subtitle}`}>{span.n}</span>
          </OpenSource>
        );
      })}
    </>
  );
}

/** The launcher's mark: the same well, small enough to be a logo. */
function WellMark() {
  return (
    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-paper">
      <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
        <path d="M12 2 L21 6 L19.6 7.4 L12 4 L4.4 7.4 L3 6 Z" fill="#8C1D2F" />
        <rect x="5.6" y="7" width="1.8" height="7" rx="0.6" fill="#8A7053" />
        <rect x="16.6" y="7" width="1.8" height="7" rx="0.6" fill="#8A7053" />
        <path d="M4 13.5 Q4 20 6 21.5 L18 21.5 Q20 20 20 13.5 Z" fill="#C7D0DF" />
        <ellipse cx="12" cy="13.5" rx="8" ry="2.4" fill="#D5DCE7" />
        <ellipse cx="12" cy="13.6" rx="6.2" ry="1.7" fill="#16233B" />
        <path d="M5 17 H19" stroke="#16233B" strokeOpacity="0.15" strokeWidth="0.8" />
      </svg>
    </span>
  );
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
