import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseFeedback } from "@/lib/ask/feedback";

export const dynamic = "force-dynamic";

/**
 * Rate limiting, per address. Lower than the well's own limit and for a
 * different reason: this endpoint is cheap, but it writes rows, and an
 * unmetered write endpoint on a public page is a way to fill a table.
 */
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 30;
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
 * Feedback on one answer.
 *
 * Takes `{ requestId, kind, sourceN?, note?, shareQuestion?, question? }` and
 * answers 204. The reader is told what was recorded, and the *only* way the
 * question they asked is stored is if they ticked the box that says so — see
 * `parseFeedback`, which drops it otherwise regardless of what the client sent.
 */
export async function POST(req: Request) {
  if (rateLimited(clientKey(req))) {
    return NextResponse.json({ error: "Too much feedback at once." }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const feedback = parseFeedback(body);
  if (!feedback) {
    return NextResponse.json({ error: "Say which answer, and what was wrong with it." }, { status: 400 });
  }

  try {
    await prisma.askFeedback.create({ data: feedback });
  } catch (e) {
    // Losing a piece of feedback is not worth an error in front of somebody
    // who was doing us a favour by sending it.
    console.error("Ask feedback: could not record:", e);
    return NextResponse.json({ error: "Could not record that just now." }, { status: 500 });
  }

  return new NextResponse(null, { status: 204 });
}
