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

  // Distinct judgments per provision, not link rows. There is one link per
  // citing passage, and a judgment routinely cites the same provision more
  // than once, so counting rows made the badge read "6 dómar" where two
  // judgments cited the provision six times between them. Prisma's groupBy
  // cannot express COUNT(DISTINCT …), hence the raw query.
  const counts = await prisma.$queryRaw<{ provision_id: string; judgments: number }[]>`
    SELECT l.provision_id, count(DISTINCT l.document_id)::int AS judgments
      FROM case_provision_links l
      JOIN provisions p ON p.id = l.provision_id
     WHERE p.act_id = ${act.id}
     GROUP BY l.provision_id
  `;
  const countBy = new Map(counts.map((c) => [c.provision_id, Number(c.judgments)]));

  // Judgments citing this act at all — through any of its provisions, or by
  // naming the act with no article. Counted across both link tables so a
  // judgment doing both is one case, not two.
  const [{ judgments: actCaseCount }] = await prisma.$queryRaw<{ judgments: number }[]>`
    SELECT count(DISTINCT d)::int AS judgments FROM (
      SELECT l.document_id AS d
        FROM case_provision_links l
        JOIN provisions p ON p.id = l.provision_id
       WHERE p.act_id = ${act.id}
      UNION
      SELECT al.document_id FROM case_act_links al WHERE al.act_id = ${act.id}
    ) refs
  `;

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
