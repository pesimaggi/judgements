import { NextResponse } from "next/server";
import { getSearchProvider } from "@/lib/search";
import { listActs, type ActSort } from "@/lib/acts";

// Hits the database on every request; must not be statically prerendered.
export const dynamic = "force-dynamic";

const SORTS: ActSort[] = ["title", "number", "cases", "provisions"];

/**
 * Two modes on one route, the usual REST split:
 *   ?q=vaxtalög        → search, for the specific-search type-ahead
 *   (no q)             → the act catalogue, paginated, for /log
 *
 * Both answer with `{ acts: [...] }`; the catalogue adds paging and
 * corpus-wide totals.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();

  try {
    if (q) {
      const limit = Math.min(25, Math.max(1, Number(searchParams.get("limit")) || 10));
      const acts = await getSearchProvider().searchActs({ query: q, limit });
      return NextResponse.json({ acts });
    }

    const sortParam = searchParams.get("sort") as ActSort | null;
    const result = await listActs({
      page: Number(searchParams.get("page")) || 1,
      pageSize: Number(searchParams.get("pageSize")) || 100,
      sort: sortParam && SORTS.includes(sortParam) ? sortParam : "title",
      citedOnly: searchParams.get("cited") === "1",
    });
    return NextResponse.json(result);
  } catch (e) {
    console.error("Act lookup failed:", e);
    return NextResponse.json(
      { error: "Act lookup failed. If this is a fresh install, run: npm run db:setup-search" },
      { status: 500 }
    );
  }
}
