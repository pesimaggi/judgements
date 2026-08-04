import { NextResponse } from "next/server";
import { getSearchProvider } from "@/lib/search";
import { SOURCE_KEYS } from "@/lib/sources";
import type { SearchRequest } from "@/lib/types";

export const dynamic = "force-dynamic";

const DEFAULT_PAGE_SIZE = 15;
const MAX_PAGE_SIZE = 50;

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

  const page = Math.max(1, Math.floor(Number(body.page) || 1));
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Math.floor(Number(body.pageSize) || DEFAULT_PAGE_SIZE))
  );

  const provider = getSearchProvider();

  try {
    const tag = typeof body.tag === "string" && body.tag.trim() ? body.tag.trim() : undefined;
    // Ids come from the lookup endpoint; passed through as opaque strings and
    // parameterised by the provider, never interpolated into SQL.
    const actId = typeof body.actId === "string" && body.actId ? body.actId : undefined;
    const provisionId =
      typeof body.provisionId === "string" && body.provisionId ? body.provisionId : undefined;
    const r = await provider.search({
      ...body,
      sources,
      tag,
      // A provision is a narrower statement of the same intent as its act, so
      // the act filter is dropped when both arrive rather than intersected.
      actId: provisionId ? undefined : actId,
      provisionId,
      page,
      pageSize,
    });
    return NextResponse.json({
      total: r.total,
      totalIsCapped: r.totalIsCapped ?? false,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(r.total / pageSize)),
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
