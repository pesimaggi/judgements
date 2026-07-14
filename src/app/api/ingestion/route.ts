import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/** Ingestion status per court: last runs, doc counts, errors. */
export async function GET() {
  const sources = await prisma.source.findMany({ orderBy: { name: "asc" } });
  const counts = await prisma.document.groupBy({ by: ["source"], _count: { _all: true } });
  const runs = await prisma.ingestionRun.findMany({
    orderBy: { startedAt: "desc" },
    take: 50,
  });

  const status = sources.map((s) => ({
    key: s.key,
    name: s.name,
    officialBaseUrl: s.officialBaseUrl,
    enabled: s.enabled,
    lastIngestedAt: s.lastIngestedAt,
    documentCount: counts.find((c) => c.source === s.key)?._count._all ?? 0,
    recentRuns: runs.filter((r) => r.sourceKey === "icelandic-courts").slice(0, 5),
  }));

  return NextResponse.json({ status });
}
