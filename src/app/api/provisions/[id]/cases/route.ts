import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 15;

/**
 * The judgments citing one provision — what the act reader's badge expands
 * into.
 *
 * Paginated over *judgments*, not over links. A judgment commonly cites the
 * same provision several times (a court awarding costs will invoke 130. gr.
 * einkamálalaga in the reasoning and again in the operative part), and each
 * occurrence is its own CaseProvisionLink row so that every citing passage is
 * kept. Listing those rows directly showed the same case repeatedly and made
 * "6 judgments" mean "6 citations" — so a provision cited five times by one
 * judgment and once by another read as six separate cases.
 *
 * Each judgment therefore appears once, carrying all of its citing passages.
 * The excerpts are the point of the feature: they show *why* a case matched
 * rather than only that it did.
 */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get("page")) || 1);

  const provision = await prisma.provision.findUnique({
    where: { id: params.id },
    include: { act: true },
  });
  if (!provision) return NextResponse.json({ error: "Provision not found." }, { status: 404 });

  const where = { provisionLinks: { some: { provisionId: provision.id } } };

  const [documents, total, citationCount] = await Promise.all([
    prisma.document.findMany({
      where,
      select: {
        id: true, court: true, caseNumber: true, caseName: true,
        title: true, date: true, year: true, officialUrl: true,
        provisionLinks: {
          where: { provisionId: provision.id },
          orderBy: { charOffset: "asc" },
          select: {
            id: true, matchType: true, citationText: true,
            excerpt: true, charOffset: true, paragraphNumber: true,
          },
        },
      },
      orderBy: [{ date: "desc" }, { caseNumber: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.document.count({ where }),
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
    /** Judgments citing this provision — what the badge counts. */
    total,
    /** Individual citing passages across those judgments; always >= total. */
    citationCount,
    page,
    pageSize: PAGE_SIZE,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    cases: documents.map((d) => {
      const { provisionLinks, ...document } = d;
      return { document, citations: collapseByExcerpt(provisionLinks) };
    }),
  });
}

interface LinkRow {
  id: string;
  matchType: string;
  citationText: string;
  excerpt: string;
  charOffset: number;
  paragraphNumber: number | null;
}

/**
 * Merges citations that quote the same sentence.
 *
 * A single sentence often names the provision twice — "…á grundvelli c-liðar
 * 1. mgr. 95. gr. laga nr. 88/2008 … skv. 1. mgr. 95. gr. laga nr. 88/2008 um
 * meðferð sakamála" — which is two genuine citations but one passage. Listing
 * both printed the identical excerpt twice under the same judgment, which
 * reads as a bug even though the underlying links are correct.
 *
 * The links themselves are untouched; this only affects presentation, and the
 * response still reports the true citationCount alongside.
 */
function collapseByExcerpt(links: LinkRow[]): (LinkRow & { occurrences: number })[] {
  const byExcerpt = new Map<string, LinkRow & { occurrences: number }>();
  for (const l of links) {
    // Fall back to the offset as the key when there is no excerpt, so
    // excerpt-less links are never merged into one another.
    const key = l.excerpt.trim() || `@${l.charOffset}`;
    const seen = byExcerpt.get(key);
    if (seen) seen.occurrences++;
    else byExcerpt.set(key, { ...l, occurrences: 1 });
  }
  return Array.from(byExcerpt.values());
}
