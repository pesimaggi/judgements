import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ALL_SOURCES } from "@/lib/sources";

// Hits the database on every request; must not be statically prerendered at build time.
export const dynamic = "force-dynamic";

/** Ingestion status per source: last runs, document counts, errors. */
export async function GET() {
  const [rows, counts, runs] = await Promise.all([
    prisma.source.findMany(),
    prisma.document.groupBy({ by: ["source"], _count: { _all: true } }),
    prisma.ingestionRun.findMany({ orderBy: { startedAt: "desc" }, take: 200 }),
  ]);

  // Driven by the registry rather than the Source table, so a source that has
  // never been ingested (and so has no row yet) still appears, with zeroes.
  const status = ALL_SOURCES.map((def) => {
    const row = rows.find((r) => r.key === def.key);
    return {
      key: def.key,
      name: def.name,
      group: def.group,
      status: def.status,
      officialBaseUrl: def.officialBaseUrl,
      adapterKey: def.adapterKey,
      enabled: row?.enabled ?? true,
      lastIngestedAt: row?.lastIngestedAt ?? null,
      totalAvailable: row?.totalAvailable && row.totalAvailable > 0 ? row.totalAvailable : null,
      documentCount: counts.find((c) => c.source === def.key)?._count._all ?? 0,
      // IngestionRun rows are keyed by *adapter*, not by source, so a source
      // has to match on its adapter. This used to be hardcoded to
      // "icelandic-courts", which showed every source the Icelandic runs.
      recentRuns: runs.filter((r) => r.sourceKey === def.adapterKey).slice(0, 5),
    };
  });

  return NextResponse.json({ status });
}
