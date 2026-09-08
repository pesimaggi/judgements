import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { isAskEnabled, AskRefusal } from "@/lib/ask/llm";
import { ask } from "@/lib/ask/pipeline";
import { AskEmptyAnswer } from "@/lib/ask/answer";
import { AskTimeout } from "@/lib/ask/timeout";
import type { AskEvent, AskRequestBody, AskTurn } from "@/lib/ask/types";

export const dynamic = "force-dynamic";

/** Longer than any real question and short enough not to be a paste of a PDF. */
const MAX_QUESTION_CHARS = 600;
/** Turns carried back into the model — three exchanges of context. */
const MAX_HISTORY_TURNS = 6;
const MAX_HISTORY_CHARS = 2000;

/**
 * Rate limiting, per client address.
 *
 * In memory, so it resets on deploy and is per-instance rather than global.
 * That is enough for what it is for: this endpoint spends money on every
 * call, and an unmetered one on a public page is an invitation. A real limit
 * belongs in front of the app, not here.
 */
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 12;
const seen = new Map<string, number[]>();

function rateLimited(key: string): boolean {
  const now = Date.now();
  const recent = (seen.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) {
    seen.set(key, recent);
    return true;
  }
  recent.push(now);
  seen.set(key, recent);
  // Bounded: without this the map is a slow leak keyed by every address that
  // ever asked anything.
  if (seen.size > 5000) {
    for (const [k, times] of seen) {
      if (times.every((t) => now - t >= WINDOW_MS)) seen.delete(k);
    }
  }
  return false;
}

/**
 * The same question, from the same client, while the first one is still being
 * answered.
 *
 * A double-click on "Sleppa ofan í", or an impatient reload, otherwise buys
 * two full runs of a pipeline that makes two model calls — paid for twice, and
 * the reader sees whichever finishes second. The key is a hash so nothing here
 * holds a question in memory beyond the request that asked it.
 */
const inFlight = new Set<string>();

function submissionKey(client: string, question: string): string {
  return createHash("sha256").update(`${client}\n${question.trim().toLowerCase()}`).digest("hex");
}

function clientKey(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}

/**
 * A pipeline failure, as a status and a sentence.
 *
 * Extracted because there are now two ways out of this route. The JSON path
 * uses the status; the streamed path cannot — by the time anything fails the
 * headers have long since gone — so it sends the same sentence as an `error`
 * event instead. One mapping, so the two cannot drift into telling readers
 * different things about the same fault.
 */
function failure(e: unknown): { status: number; message: string } {
  if (e instanceof AskRefusal) {
    return { status: 422, message: e.message };
  }
  if (e instanceof AskEmptyAnswer) {
    return {
      status: 502,
      message:
        "The well came back empty — the model returned no answer at all. That is a fault at our end, not a judgement about your question. Try again.",
    };
  }
  if (e instanceof AskTimeout) {
    return {
      status: 504,
      message: "The well took too long to answer that. Try again, or ask something narrower.",
    };
  }
  // The message is not echoed: it can quote the request, and this is a public
  // endpoint.
  console.error("Ask failed:", e);
  return { status: 500, message: "The well could not answer that. Try again in a moment." };
}

/**
 * The answer, streamed as Server-Sent Events.
 *
 * Why this exists: a hard question can take the better part of a minute, and
 * the reader used to watch an animation for all of it and then be handed
 * everything at once. Now the planner's search terms appear in a second or
 * two, the law appears as retrieval finds it, and the prose is written in
 * front of them.
 *
 * What is streamed is validated. lib/ask/stream.ts checks the answer a line at
 * a time before it leaves, so a citation to a source that does not exist is
 * deleted before the reader sees it — not deleted a second after they saw it,
 * which is what streaming raw tokens would mean.
 *
 * Failures go *into* the stream as an `error` event. Once the first byte has
 * been written there is no status code left to send, and a stream that simply
 * stops looks to a browser exactly like a network fault.
 */
function streamAnswer(
  question: string,
  history: AskTurn[],
  scope: "eea" | "eu",
  mode: "quick" | "deep" | undefined,
  signal: AbortSignal,
  onDone: () => void
): Response {
  const encoder = new TextEncoder();

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const close = () => {
        if (!open) return;
        open = false;
        try {
          controller.close();
        } catch {
          /* already closed by the client going away */
        }
      };

      const send = (event: AskEvent) => {
        if (!open) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      // A reader who navigates away mid-answer. Nothing further is written;
      // the pipeline runs to completion because it has already been paid for,
      // and its metrics line is still worth having.
      signal.addEventListener("abort", () => {
        open = false;
      });

      // Flushes the headers before the first stage finishes, so the browser
      // opens the stream immediately rather than at the first event. A line
      // beginning with ":" is an SSE comment and is ignored by EventSource.
      controller.enqueue(encoder.encode(": open\n\n"));

      try {
        await ask(question, history, { scope, mode, onEvent: send });
      } catch (e) {
        send({ type: "error", message: failure(e).message });
      } finally {
        onDone();
        close();
      }
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      // no-transform matters as much as no-cache: a proxy that "helpfully"
      // compresses or rewrites the body will buffer it, and a buffered event
      // stream is a slow non-streaming response.
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Tells nginx and the proxies in front of this deployment not to buffer.
      // Without it the whole point of the endpoint can be silently undone by
      // infrastructure nobody is looking at.
      "X-Accel-Buffering": "no",
    },
  });
}

/**
 * The well.
 *
 * Plan, retrieve, rank, answer, validate — the pipeline in lib/ask/pipeline.ts,
 * which is also what the evaluation harness runs. The route itself only
 * validates, limits, and translates failures into something the bucket can
 * carry back up.
 *
 * Answers either as one JSON object or as an event stream. JSON is still the
 * default, so an existing caller sees no change; a client asks for the stream
 * with `stream: true` in the body or an `Accept: text/event-stream` header.
 */
export async function POST(req: Request) {
  if (!isAskEnabled()) {
    return NextResponse.json(
      {
        error:
          "The well is dry: no LLM provider is configured on this deployment. Set OPENAI_API_KEY or ANTHROPIC_API_KEY.",
      },
      { status: 503 }
    );
  }

  let body: AskRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (question.length < 3) {
    return NextResponse.json({ error: "Ask a question first." }, { status: 400 });
  }
  if (question.length > MAX_QUESTION_CHARS) {
    return NextResponse.json(
      { error: `Keep the question under ${MAX_QUESTION_CHARS} characters.` },
      { status: 400 }
    );
  }

  const client = clientKey(req);
  if (rateLimited(client)) {
    return NextResponse.json(
      { error: "That is a lot of questions at once. Give the well a few minutes." },
      { status: 429 }
    );
  }

  const key = submissionKey(client, question);
  if (inFlight.has(key)) {
    return NextResponse.json(
      { error: "That question is already on its way down. Give it a moment." },
      { status: 409 }
    );
  }
  inFlight.add(key);

  const history: AskTurn[] = (Array.isArray(body.history) ? body.history : [])
    .filter(
      (t): t is AskTurn =>
        Boolean(t) &&
        (t.role === "user" || t.role === "assistant") &&
        typeof t.content === "string" &&
        t.content.trim() !== ""
    )
    .slice(-MAX_HISTORY_TURNS)
    .map((t) => ({ role: t.role, content: t.content.slice(0, MAX_HISTORY_CHARS) }));

  const scope = body.scope === "eu" ? "eu" : "eea";
  // Undefined, not a default: with nothing asked for, the deployment's own
  // ASK_RESEARCH setting decides, and the route does not get a vote.
  const mode = body.mode === "deep" ? "deep" : body.mode === "quick" ? "quick" : undefined;
  const wantsStream =
    body.stream === true || (req.headers.get("accept") ?? "").includes("text/event-stream");

  if (wantsStream) {
    // The in-flight key is released by the stream, not here: this function
    // returns as soon as the headers are written, and clearing it now would
    // let a double-click start a second full run of a pipeline that is still
    // paying for the first.
    return streamAnswer(question, history, scope, mode, req.signal, () => inFlight.delete(key));
  }

  try {
    const { response } = await ask(question, history, { scope, mode });
    return NextResponse.json(response);
  } catch (e) {
    const { status, message } = failure(e);
    return NextResponse.json({ error: message }, { status });
  } finally {
    inFlight.delete(key);
  }
}
