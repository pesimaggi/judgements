import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 15;

/**
 * The judgments citing one provision — what the act reader's badge expands
 * into, and what "see all cases for this provision" links to.
 *
 * Each row carries the excerpt captured when the link was made, so the list
 * shows *why* the case matched rather than just that it did.
 */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get("page")) || 1);

  const provision = await prisma.provision.findUnique({
    where: { id: params.id },
    include: { act: true },
  });
  if (!provision) return NextResponse.json({ error: "Provision not found." }, { status: 404 });

  const [links, total] = await Promise.all([
    prisma.caseProvisionLink.findMany({
      where: { provisionId: provision.id },
      include: {
        document: {
          select: {
            id: true, court: true, caseNumber: true, caseName: true,
            title: true, date: true, year: true, officialUrl: true,
          },
        },
      },
      orderBy: [{ document: { date: "desc" } }, { charOffset: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.caseProvisionLink.count({ where: { provisionId: provision.id } }),
  ]);

  return NextResponse.json({
    provision: {
      id: provision.id,
      displayLabel: provision.displayLabel,
      heading: provision.heading,
      actNumber: provision.act.actNumber,
      year: provision.act.year,
      actTitle: provision.act.title,
    },
    total,
    page,
    pageSize: PAGE_SIZE,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    cases: links.map((l) => ({
      linkId: l.id,
      matchType: l.matchType,
      citationText: l.citationText,
      excerpt: l.excerpt,
      charOffset: l.charOffset,
      paragraphNumber: l.paragraphNumber,
      document: l.document,
    })),
  });
}
