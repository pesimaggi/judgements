import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { isAskEnabled, AskRefusal } from "@/lib/ask/llm";
import { ask } from "@/lib/ask/pipeline";
import { AskEmptyAnswer } from "@/lib/ask/answer";
import { AskTimeout } from "@/lib/ask/timeout";
import type { AskRequestBody, AskTurn } from "@/lib/ask/types";

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
 * The well.
 *
 * Plan, retrieve, rank, answer, validate — the pipeline in lib/ask/pipeline.ts,
 * which is also what the evaluation harness runs. The route itself only
 * validates, limits, and translates failures into something the bucket can
 * carry back up.
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

  try {
    const { response } = await ask(question, history, {
      scope: body.scope === "eu" ? "eu" : "eea",
    });
    return NextResponse.json(response);
  } catch (e) {
    if (e instanceof AskRefusal) {
      return NextResponse.json({ error: e.message }, { status: 422 });
    }
    if (e instanceof AskEmptyAnswer) {
      return NextResponse.json(
        {
          error:
            "The well came back empty — the model returned no answer at all. That is a fault at our end, not a judgement about your question. Try again.",
        },
        { status: 502 }
      );
    }
    if (e instanceof AskTimeout) {
      return NextResponse.json(
        { error: "The well took too long to answer that. Try again, or ask something narrower." },
        { status: 504 }
      );
    }
    // The message is not echoed: it can quote the request, and this is a
    // public endpoint.
    console.error("Ask failed:", e);
    return NextResponse.json(
      { error: "The well could not answer that. Try again in a moment." },
      { status: 500 }
    );
  } finally {
    inFlight.delete(key);
  }
}
