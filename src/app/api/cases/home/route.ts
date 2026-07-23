import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type { Document } from "@prisma/client";

// Hits the database on every request; must not be statically prerendered at build time.
export const dynamic = "force-dynamic";

const NEWEST_COUNT = 8;

function toCard(doc: Document) {
  return {
    id: doc.id,
    source: doc.source,
    court: doc.court,
    caseNumber: doc.caseNumber,
    caseName: doc.caseName,
    title: doc.title,
    date: doc.date ? doc.date.toISOString() : null,
    year: doc.year,
    subjectTags: doc.subjectTags,
    officialUrl: doc.officialUrl,
    pdfUrl: doc.pdfUrl,
    snippet: doc.fullText.slice(0, 220),
    isSample: doc.isSample,
  };
}

/** Front-page widget data: the newest ingested cases plus one random "featured" case. */
export async function GET() {
  const newestDocs = await prisma.document.findMany({
    orderBy: { date: "desc" },
    take: NEWEST_COUNT + 1,
  });

  // Prefer featuring a real (non-sample) document when any exist.
  const realCount = await prisma.document.count({ where: { isSample: false } });
  const where = realCount > 0 ? { isSample: false } : {};
  const poolCount = realCount > 0 ? realCount : await prisma.document.count();

  let featured: Document | null = null;
  if (poolCount > 0) {
    const skip = Math.floor(Math.random() * poolCount);
    featured = await prisma.document.findFirst({ where, skip });
  }

  const newest = newestDocs.filter((d) => d.id !== featured?.id).slice(0, NEWEST_COUNT);

  return NextResponse.json({
    featured: featured ? toCard(featured) : null,
    newest: newest.map(toCard),
  });
}
