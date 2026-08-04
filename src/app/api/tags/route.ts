import { NextResponse } from "next/server";
import { searchTags } from "@/lib/tags";

export const dynamic = "force-dynamic";

/**
 * Subject-tag type-ahead. `?q=gæslu` → the tags a judgment can carry, with
 * how many judgments carry each, most-used first. An empty query returns the
 * most common tags, which is a useful starting point rather than a blank box.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  const limit = Math.min(30, Math.max(1, Number(searchParams.get("limit")) || 12));

  try {
    return NextResponse.json({ tags: await searchTags(q, limit) });
  } catch (e) {
    console.error("Tag lookup failed:", e);
    return NextResponse.json({ error: "Tag lookup failed." }, { status: 500 });
  }
}
