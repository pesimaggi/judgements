import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { citedCaseNumbers } from "@/lib/legal-citations";

/** Full judgment + related cases (via case-number citations found in the text). */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const doc = await prisma.document.findUnique({ where: { id: params.id } });
  if (!doc) return NextResponse.json({ error: "Document not found." }, { status: 404 });

  // Acts, regulations and cases are all cited as "N/YYYY", so the token alone
  // cannot tell them apart — citedCaseNumbers() masks legislation citations
  // first. Without that, roughly three quarters of the numbers found here were
  // act references, and any case numbered 91/1991 turned up as "related" to
  // the third of the corpus that cites lög nr. 91/1991.
  const cited = citedCaseNumbers(doc.fullText, doc.caseNumber).slice(0, 25);

  const related = cited.length
    ? await prisma.document.findMany({
        where: { caseNumber: { in: cited }, id: { not: doc.id } },
        select: { id: true, caseNumber: true, title: true, court: true, date: true },
        take: 10,
      })
    : [];

  return NextResponse.json({ document: doc, related });
}
