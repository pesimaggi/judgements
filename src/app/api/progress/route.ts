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
    // A totalAvailable of 0 (or less) is a bogus/never-synced value, not a
    // real "nothing available" — treat it the same as unset so the UI never
    // renders e.g. "3800 ingested / 0 available".
    total: s.totalAvailable != null && s.totalAvailable > 0 ? s.totalAvailable : null,
  }));

  const ingested = courts.reduce((sum, c) => sum + c.ingested, 0);
  const total = courts.every((c) => c.total != null)
    ? courts.reduce((sum, c) => sum + (c.total ?? 0), 0)
    : null;

  return NextResponse.json({ ingested, total, courts });
}
