import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseActSlug } from "@/lib/lagasafn";

export const dynamic = "force-dynamic";

/**
 * One act with its full chapter/provision structure, plus the number of
 * judgments citing each provision — the badge the act reader shows.
 *
 * The counts come back in a single grouped query rather than a count per
 * provision: a large act has several hundred provisions, and a per-provision
 * count would mean several hundred round trips to render one page.
 */
export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  const parsed = parseActSlug(params.slug);
  if (!parsed) {
    return NextResponse.json({ error: "Malformed act reference." }, { status: 400 });
  }

  const act = await prisma.act.findUnique({
    where: { actNumber_year: { actNumber: parsed.actNumber, year: parsed.year } },
    include: {
      chapters: { orderBy: { ordering: "asc" } },
      provisions: {
        orderBy: { ordering: "asc" },
        include: { paragraphs: { orderBy: { ordering: "asc" } } },
      },
    },
  });
  if (!act) return NextResponse.json({ error: "Act not found." }, { status: 404 });

  const counts = await prisma.caseProvisionLink.groupBy({
    by: ["provisionId"],
    where: { provision: { actId: act.id } },
    _count: { _all: true },
  });
  const countBy = new Map(counts.map((c) => [c.provisionId, c._count._all]));

  const actCaseCount = await prisma.caseActLink.count({ where: { actId: act.id } });

  return NextResponse.json({
    act: {
      id: act.id,
      actNumber: act.actNumber,
      year: act.year,
      title: act.title,
      citation: `lög nr. ${act.actNumber}/${act.year}`,
      currentVersionUrl: act.currentVersionUrl,
      codexVersion: act.codexVersion,
      aliases: act.aliases,
      actCaseCount,
    },
    chapters: act.chapters.map((c) => ({
      id: c.id,
      label: c.label,
      title: c.title,
      ordering: c.ordering,
    })),
    provisions: act.provisions.map((p) => ({
      id: p.id,
      chapterId: p.chapterId,
      kind: p.kind,
      displayLabel: p.displayLabel,
      heading: p.heading,
      anchor: p.anchor,
      isRepealed: p.isRepealed,
      paragraphs: p.paragraphs.map((par) => ({ number: par.number, anchor: par.anchor, text: par.text })),
      caseCount: countBy.get(p.id) ?? 0,
    })),
  });
}
