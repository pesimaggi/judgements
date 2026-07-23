import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// Hits the database on every request; must not be statically prerendered at build time.
export const dynamic = "force-dynamic";

/** Public ingestion-progress summary for the front page: overall + per-court. */
export async function GET() {
  const sources = await prisma.source.findMany({ orderBy: { name: "asc" } });
  const counts = await prisma.document.groupBy({ by: ["source"], _count: { _all: true } });

  const courts = sources.map((s) => ({
    key: s.key,
    name: s.name,
    ingested: counts.find((c) => c.source === s.key)?._count._all ?? 0,
    total: s.totalAvailable,
  }));

  const ingested = courts.reduce((sum, c) => sum + c.ingested, 0);
  const total = courts.every((c) => c.total != null)
    ? courts.reduce((sum, c) => sum + (c.total ?? 0), 0)
    : null;

  return NextResponse.json({ ingested, total, courts });
}
