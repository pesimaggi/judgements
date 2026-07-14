import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

const CASE_NUMBER_RE = /\b([A-Za-zÞÆÖ]{1,3}-?\d{1,5}\/\d{2,4}|\d{1,6}\/\d{4})\b/g;

/** Full judgment + related cases (via case-number citations found in the text). */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const doc = await prisma.document.findUnique({ where: { id: params.id } });
  if (!doc) return NextResponse.json({ error: "Document not found." }, { status: 404 });

  const cited = Array.from(
    new Set(Array.from(doc.fullText.matchAll(CASE_NUMBER_RE), (m) => m[1]))
  ).filter((cn) => cn !== doc.caseNumber).slice(0, 25);

  const related = cited.length
    ? await prisma.document.findMany({
        where: { caseNumber: { in: cited }, id: { not: doc.id } },
        select: { id: true, caseNumber: true, title: true, court: true, date: true },
        take: 10,
      })
    : [];

  return NextResponse.json({ document: doc, related });
}
