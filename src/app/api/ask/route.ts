import { NextResponse } from "next/server";
import { isAskEnabled, AskRefusal } from "@/lib/ask/llm";
import { planQuery } from "@/lib/ask/plan";
import { retrieve } from "@/lib/ask/retrieve";
import { answer } from "@/lib/ask/answer";
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

function clientKey(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}

/**
 * The well.
 *
 * Plan, retrieve, answer — three stages, described in lib/ask. The route
 * itself only validates, limits, and translates failures into something the
 * bucket can carry back up.
 */
export async function POST(req: Request) {
  if (!isAskEnabled()) {
    return NextResponse.json(
      { error: "The well is dry: no ANTHROPIC_API_KEY is configured on this deployment." },
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

  if (rateLimited(clientKey(req))) {
    return NextResponse.json(
      { error: "That is a lot of questions at once. Give the well a few minutes." },
      { status: 429 }
    );
  }

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
    const plan = await planQuery(question, history);
    const retrieval = await retrieve(plan);
    const result = await answer(plan, retrieval, history);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof AskRefusal) {
      return NextResponse.json({ error: e.message }, { status: 422 });
    }
    console.error("Ask failed:", e);
    return NextResponse.json(
      { error: "The well could not answer that. Try again in a moment." },
      { status: 500 }
    );
  }
}
