import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { SOURCES } from "@/lib/sources";

// Hits the database on every request; must not be statically prerendered at build time.
export const dynamic = "force-dynamic";

/**
 * Public ingestion-progress summary for the front page: overall, then one
 * entry per source, grouped the way the source panel groups them.
 *
 * Driven by the registry in src/lib/sources.ts rather than by the Source
 * table. `db:deploy` does not run the seed, so a source added since the last
 * seed may have no row yet — reading the table directly meant a newly added
 * source was simply invisible here until someone remembered to seed.
 */
export async function GET() {
  const [rows, counts] = await Promise.all([
    prisma.source.findMany(),
    prisma.document.groupBy({ by: ["source"], _count: { _all: true } }),
  ]);

  const sources = SOURCES.map((def) => {
    const row = rows.find((r) => r.key === def.key);
    // 0 means "we could not determine it" — see syncAvailableTotals — and a
    // zero denominator is what rendered the "6,321 / 0" bar.
    const total = row?.totalAvailable && row.totalAvailable > 0 ? row.totalAvailable : null;
    return {
      key: def.key,
      name: def.name,
      group: def.group,
      ingested: counts.find((c) => c.source === def.key)?._count._all ?? 0,
      total,
      lastIngestedAt: row?.lastIngestedAt ?? null,
    };
  });

  const groups = Array.from(new Set(sources.map((s) => s.group))).map((name) => {
    const members = sources.filter((s) => s.group === name);
    return {
      name,
      ingested: members.reduce((sum, s) => sum + s.ingested, 0),
      // A group total is only meaningful when every source in it knows its own.
      total: members.every((s) => s.total != null)
        ? members.reduce((sum, s) => sum + (s.total ?? 0), 0)
        : null,
      sources: members,
    };
  });

  const ingested = sources.reduce((sum, s) => sum + s.ingested, 0);
  const total = sources.every((s) => s.total != null)
    ? sources.reduce((sum, s) => sum + (s.total ?? 0), 0)
    : null;

  return NextResponse.json({ ingested, total, groups, courts: sources });
}
