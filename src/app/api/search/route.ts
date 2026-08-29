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

  // Hard rule: no sources selected → no search. All sources are opt-in.
  const sources = (body.sources ?? []).filter((s) => SOURCE_KEYS.has(s));
  if (sources.length === 0) {
    return NextResponse.json(
      { error: "Select one or more sources to search." },
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
    // Every specific-search filter is a list, and every list is conjunctive:
    // adding a second tag or a second provision narrows the result set. The
    // singular `tag` is still accepted, because result cards link to
    // `/?tag=…`; it folds into the list.
    const strings = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : [];

    const tags = strings(body.tags);
    if (typeof body.tag === "string" && body.tag.trim()) tags.push(body.tag.trim());

    // Ids come from the lookup endpoint; carried as opaque strings and
    // parameterised by the provider, never interpolated into SQL.
    const r = await provider.search({
      ...body,
      sources,
      tag: undefined,
      tags: dedupe(tags),
      actIds: dedupe(strings(body.actIds)),
      provisionIds: dedupe(strings(body.provisionIds)),
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

/** Repeats would add redundant conditions without changing the result set. */
function dedupe(values: string[]): string[] {
  return Array.from(new Set(values));
}
