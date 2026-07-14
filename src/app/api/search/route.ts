import { NextResponse } from "next/server";
import { getSearchProvider } from "@/lib/search";
import { SOURCE_KEYS } from "@/lib/sources";
import type { SearchRequest } from "@/lib/types";

export async function POST(req: Request) {
  let body: SearchRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // Hard rule: no courts selected → no search. All sources are opt-in.
  const sources = (body.sources ?? []).filter((s) => SOURCE_KEYS.has(s));
  if (sources.length === 0) {
    return NextResponse.json(
      { error: "Select one or more courts to search." },
      { status: 400 }
    );
  }
  if (typeof body.query !== "string") {
    return NextResponse.json({ error: "Missing query." }, { status: 400 });
  }

  const provider = getSearchProvider();

  try {
    const r = await provider.search({ ...body, sources });
    return NextResponse.json({
      total: r.total,
      page: body.page ?? 1,
      pageSize: body.pageSize ?? 20,
      hits: r.hits,
    });
  } catch (e) {
    console.error("Search failed:", e);
    return NextResponse.json(
      { error: "Search failed. If this is a fresh install, run: npm run db:setup-search" },
      { status: 500 }
    );
  }
}
