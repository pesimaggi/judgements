import { NextResponse } from "next/server";
import { getSearchProvider } from "@/lib/search";
import { parseActScope } from "@/lib/acts";

export const dynamic = "force-dynamic";

/**
 * Provision search, through the same SearchProvider abstraction judgments go
 * through. `?actId=…` scopes it to one act, which is what the provision
 * picker in the specific-search panel uses.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const query = (searchParams.get("q") ?? "").trim();
  const actId = searchParams.get("actId") ?? undefined;
  const scope = parseActScope(searchParams.get("scope"));
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(searchParams.get("pageSize")) || 20));

  // Without an act to scope to, an empty query would mean "every provision of
  // every act", which is neither useful nor cheap.
  if (!query && !actId) return NextResponse.json({ total: 0, page, pageSize, hits: [] });

  try {
    const r = await getSearchProvider().searchProvisions({ query, actId, page, pageSize, scope });
    return NextResponse.json({ total: r.total, page, pageSize, hits: r.hits });
  } catch (e) {
    console.error("Provision search failed:", e);
    return NextResponse.json(
      { error: "Provision search failed. If this is a fresh install, run: npm run db:setup-search" },
      { status: 500 }
    );
  }
}
