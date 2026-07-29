import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { SearchHit } from "@/lib/types";

// Hits the database on every request; must not be statically prerendered at build time.
export const dynamic = "force-dynamic";

const NEWEST_COUNT = 8;
const SNIPPET_CHARS = 240;

/**
 * The card columns only — deliberately *not* `SELECT *`. Judgments run to
 * hundreds of kilobytes of full text apiece, and pulling nine complete ones
 * out of TOAST storage just to take the first 240 characters was the slowest
 * part of the front page. `left(full_text, …)` does that slicing in Postgres.
 */
const CARD_COLUMNS = Prisma.sql`
  d.id, d.source, d.court, d.case_number, d.case_name, d.title, d.date, d.year,
  d.subject_tags, d.official_url, d.pdf_url, d.is_sample,
  left(d.full_text, ${SNIPPET_CHARS}::int) AS snippet
`;

function toCard(r: any): SearchHit {
  return {
    id: r.id,
    source: r.source,
    court: r.court,
    caseNumber: r.case_number,
    caseName: r.case_name,
    title: r.title,
    date: r.date ? new Date(r.date).toISOString() : null,
    year: r.year,
    subjectTags: r.subject_tags ?? [],
    officialUrl: r.official_url,
    pdfUrl: r.pdf_url,
    snippet: r.snippet ?? "",
    isSample: r.is_sample,
  };
}

/** Front-page widget data: the newest ingested cases plus one random "featured" case. */
export async function GET() {
  // Prefer featuring a real (non-sample) document when any exist.
  const [{ real, all }] = await prisma.$queryRaw<{ real: number; all: number }[]>(Prisma.sql`
    SELECT count(*) FILTER (WHERE is_sample = false)::int AS real, count(*)::int AS all
    FROM "Document"
  `);
  const realOnly = real > 0;
  const poolCount = realOnly ? real : all;

  const [newestRows, featuredRows] = await Promise.all([
    prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT ${CARD_COLUMNS}
      FROM "Document" d
      ORDER BY d.date DESC NULLS LAST
      LIMIT ${NEWEST_COUNT + 1}
    `),
    poolCount > 0
      ? prisma.$queryRaw<any[]>(Prisma.sql`
          SELECT ${CARD_COLUMNS}
          FROM "Document" d
          WHERE ${realOnly ? Prisma.sql`d.is_sample = false` : Prisma.sql`TRUE`}
          OFFSET ${Math.floor(Math.random() * poolCount)}
          LIMIT 1
        `)
      : Promise.resolve([]),
  ]);

  const featured = featuredRows[0] ? toCard(featuredRows[0]) : null;
  const newest = newestRows
    .filter((d) => d.id !== featured?.id)
    .slice(0, NEWEST_COUNT)
    .map(toCard);

  return NextResponse.json({ featured, newest });
}
