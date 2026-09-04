"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { WellScene, type WellPhase } from "./WellScene";
import { parseAnswer, type InlineSpan } from "@/lib/ask/render";
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
 * The state machine is four phases and lives here rather than in the scene,
 * which only draws. See WellScene.tsx for what each phase looks like.
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

  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const busy = phase === "dropping" || phase === "loading";

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
      const latest = answers[answers.length - 1];
      if (!latest) return toBottom();
      // Measured against the scroll container rather than read off offsetTop,
      // which is relative to the positioned panel and so carries the header's
      // height with it.
      const delta =
        latest.getBoundingClientRect().top - transcript.getBoundingClientRect().top;
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

      // Sent while the paper is still in the air: the animation is there to
      // cover the wait, not to add to it.
      const history: AskTurn[] = messages.map((m) => ({ role: m.role, content: m.content }));
      const request = fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed, history }),
      })
        .then(async (res) => {
          const data = await res.json();
          if (!res.ok) throw new Error(data.error ?? "The well could not answer that.");
          return data as { answer: string; sources: AskSource[] };
        })
        .catch((e: Error) => ({ answer: e.message, sources: [] as AskSource[], failed: true }));

      await wait(still ? 0 : DROP_MS);
      // The question joins the transcript when it lands, not when it is typed.
      setMessages((prev) => [...prev, { role: "user", content: trimmed }]);
      setFalling("");
      setPhase("loading");

      const [result] = await Promise.all([request, wait(still ? 0 : MIN_LOAD_MS)]);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: result.answer,
          sources: result.sources,
          failed: "failed" in result && result.failed === true,
        },
      ]);
      setPhase("answered");
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

  return (
    <div className="well-panel fixed bottom-5 right-5 z-40 flex max-h-[min(44rem,calc(100vh-2.5rem))] w-[min(27rem,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-xl border border-line bg-white shadow-2xl shadow-ink/20">
      <header className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <div>
          <p className="font-serif text-sm font-semibold text-ink">Brunnurinn</p>
          <p className="text-[11px] text-inkSoft">Svör byggð á lögum og úrlausnum úr safninu</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded p-1.5 text-inkSoft transition hover:bg-paper hover:text-ink"
          aria-label="Loka"
        >
          <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
          </svg>
        </button>
      </header>

      <div ref={transcriptRef} className="flex-1 overflow-y-auto">
        {/* Full size while the well is working — the drop and the artefacts
            are the whole point of the wait — and shrunk once there is an
            answer, which is then the thing worth the room. */}
        <WellScene
          phase={phase}
          question={falling}
          compact={phase === "answered" && messages.length > 0}
        />

        {messages.length === 0 && phase === "idle" && (
          <div className="px-4 pb-4 text-center">
            <p className="mx-auto max-w-[16rem] text-[13px] leading-relaxed text-inkSoft">
              Spyrðu um íslenskan rétt. Brunnurinn leitar í lögum, EES- og ESB-gerðum, dómum,
              úrskurðum og álitum — og vísar í hvert ákvæði sem svarið byggir á.
            </p>
            <div className="mt-3 flex flex-col gap-1.5">
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
                <Answer key={i} message={message} />
              )
            )}
          </div>
        )}

        {phase === "loading" && (
          <p className="pb-4 text-center text-[12px] text-inkSoft">Sæki lögin úr brunninum …</p>
        )}
      </div>

      <form
        className="border-t border-line p-3"
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
          Óopinbert hjálpartæki. Svarið er samantekt úr safninu, ekki lögfræðiráðgjöf — staðfestu
          alltaf textann hjá upphaflegri heimild.
        </p>
      </form>
    </div>
  );
}

/** One answer: the prose, then the sources it rests on. */
function Answer({ message }: { message: Message }) {
  const blocks = parseAnswer(message.content);
  const sources = message.sources ?? [];
  const cited = sources.filter((s) => s.cited);
  const rest = sources.filter((s) => !s.cited);
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
              <h4 key={i} className="pt-1 font-sans text-[11px] font-semibold uppercase tracking-wide text-inkSoft">
                <Spans spans={block.spans} sources={byNumber} />
              </h4>
            );
          }
          if (block.kind === "list") {
            return (
              <ul key={i} className="list-disc space-y-1 pl-4 marker:text-line">
                {block.items.map((item, j) => (
                  <li key={j}>
                    <Spans spans={item} sources={byNumber} />
                  </li>
                ))}
              </ul>
            );
          }
          return (
            <p key={i}>
              <Spans spans={block.spans} sources={byNumber} />
            </p>
          );
        })}
      </div>

      {cited.length > 0 && (
        <div className="mt-3 space-y-1.5 border-t border-line pt-3">
          <p className="font-sans text-[11px] font-semibold uppercase tracking-wide text-inkSoft">
            Heimildir
          </p>
          {cited.map((source) => (
            <SourceRow key={source.n} source={source} />
          ))}
        </div>
      )}

      {rest.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[11px] text-inkSoft hover:text-ink">
            {rest.length} til viðbótar komu upp úr brunninum
          </summary>
          <div className="mt-1.5 space-y-1.5">
            {rest.map((source) => (
              <SourceRow key={source.n} source={source} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function SourceRow({ source }: { source: AskSource }) {
  return (
    <SourceLink source={source} className="flex gap-2 rounded-md p-1.5 transition hover:bg-paper">
      <span className="mt-px shrink-0 font-sans text-[10px] font-semibold text-accent">
        [{source.n}]
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[12px] font-medium text-ink">{source.title}</span>
        <span className="block truncate text-[11px] text-inkSoft">{source.subtitle}</span>
      </span>
    </SourceLink>
  );
}

/**
 * A source is either somewhere in this app — the act reader, the document
 * page — or, for a journal article, at the journal that published it. The
 * second kind opens in a new tab and says so, the way the result cards do.
 */
function SourceLink({
  source,
  className,
  children,
}: {
  source: AskSource;
  className?: string;
  children: React.ReactNode;
}) {
  if (/^https?:/.test(source.path)) {
    return (
      <a href={source.path} target="_blank" rel="noopener noreferrer" className={className}>
        {children}
      </a>
    );
  }
  return (
    <Link href={source.path} className={className}>
      {children}
    </Link>
  );
}

function Spans({
  spans,
  sources,
}: {
  spans: InlineSpan[];
  sources: Map<number, AskSource>;
}) {
  return (
    <>
      {spans.map((span, i) => {
        if (span.kind === "bold") return <strong key={i} className="font-semibold">{span.text}</strong>;
        if (span.kind === "text") return <span key={i}>{span.text}</span>;

        const source = sources.get(span.n);
        // A citation the answer made up, pointing at no source we returned.
        // Shown as written rather than silently dropped: it is evidence.
        if (!source) return <span key={i} className="text-inkSoft">[{span.n}]</span>;
        return (
          <SourceLink
            key={i}
            source={source}
            className="ml-0.5 rounded bg-accentSoft px-1 align-super text-[9px] font-semibold text-accent hover:underline"
          >
            <span title={`${source.title} — ${source.subtitle}`}>{span.n}</span>
          </SourceLink>
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
