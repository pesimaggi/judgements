import { NextResponse } from "next/server";
import { getSearchProvider } from "@/lib/search";

// Hits the database on every request; must not be statically prerendered.
export const dynamic = "force-dynamic";

/** Act type-ahead for the specific-search panel. `?q=vaxtalög`, `?q=91/1991`. */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  const limit = Math.min(25, Math.max(1, Number(searchParams.get("limit")) || 10));

  if (!q) return NextResponse.json({ acts: [] });

  try {
    const acts = await getSearchProvider().searchActs({ query: q, limit });
    return NextResponse.json({ acts });
  } catch (e) {
    console.error("Act lookup failed:", e);
    return NextResponse.json(
      { error: "Act lookup failed. If this is a fresh install, run: npm run db:setup-search" },
      { status: 500 }
    );
  }
}
