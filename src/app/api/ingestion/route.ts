import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ALL_SOURCES } from "@/lib/sources";
import { UNMAPPED_SOURCE } from "@/ingestion/adapters/icelandic-courts";

// Hits the database on every request; must not be statically prerendered at build time.
export const dynamic = "force-dynamic";

/** Ingestion status per source: last runs, document counts, errors. */
export async function GET() {
  const [rows, counts, runs, gapCounts, gapSamples] = await Promise.all([
    prisma.source.findMany(),
    prisma.document.groupBy({ by: ["source"], _count: { _all: true } }),
    prisma.ingestionRun.findMany({ orderBy: { startedAt: "desc" }, take: 200 }),
    // Outstanding gaps per source and reason: the shortfall, itemised.
    prisma.ingestGap.groupBy({
      by: ["source", "reason"],
      where: { resolvedAt: null },
      _count: { _all: true },
    }),
    // A handful of actual rows per source, so a gap can be opened and looked
    // at rather than only counted. Most-attempted first: a case that has
    // failed repeatedly is the one worth a human's eyes.
    prisma.ingestGap.findMany({
      where: { resolvedAt: null },
      orderBy: { attempts: "desc" },
      take: 200,
      select: {
        source: true, officialUrl: true, court: true, caseNumber: true,
        reason: true, detail: true, attempts: true, lastTriedAt: true,
      },
    }),
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
      gapsByReason: gapCounts
        .filter((g) => g.source === def.key)
        .map((g) => ({ reason: g.reason, count: g._count._all })),
      gapSamples: gapSamples.filter((g) => g.source === def.key).slice(0, 10),
    };
  });

  // Cases whose court the adapter could not map onto any source. These belong
  // to no source block above, so they would otherwise be invisible — which is
  // exactly how Endurupptökudómur stayed missing. Surfaced separately and
  // deliberately loudly: a row here means a court exists that we do not know
  // about, and someone has to add it.
  const unmapped = gapSamples.filter((g) => g.source === UNMAPPED_SOURCE);
  const unmappedTotal = gapCounts
    .filter((g) => g.source === UNMAPPED_SOURCE)
    .reduce((n, g) => n + g._count._all, 0);

  return NextResponse.json({
    status,
    unmapped: { total: unmappedTotal, courts: Array.from(new Set(unmapped.map((g) => g.court ?? "?"))), samples: unmapped.slice(0, 10) },
  });
}
