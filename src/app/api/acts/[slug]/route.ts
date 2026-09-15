import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { actCitation, actDisplayTitle, actPath, parseActRef } from "@/lib/acts";
import { parseFerillUrl } from "@/lib/lagasafn";

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
  const ref = parseActRef(params.slug);
  if (!ref) {
    return NextResponse.json({ error: "Malformed act reference." }, { status: 400 });
  }

  // "38-2001" is an Icelandic act, "32016R0679" an EU one — one route, two
  // corpora, because they are one table and one reader. See parseActRef().
  const act = await prisma.act.findUnique({
    where:
      ref.jurisdiction === "eu"
        ? { celex: ref.celex }
        : {
            jurisdiction_docType_actNumber_year: {
              jurisdiction: "is",
              // From the slug: "38-2001" is an act, "rg-300-2020" a
              // regulation. Pinning "act" here served a regulation's URL the
              // act of the same number, silently.
              docType: ref.docType,
              actNumber: ref.actNumber,
              year: ref.year,
            },
          },
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

  // ---- Lagastoð, both directions ----------------------------------------
  //
  // For an act: the regulations made under it, with the articles each names.
  // For a regulation: the acts it says it is made under. One table serves
  // both, which is why it has a nullable provision rather than two tables —
  // see RegulationBasis in prisma/schema.prisma.
  const isRegulation = act.jurisdiction === "is" && act.docType === "regulation";

  const regulationsUnder = isRegulation
    ? []
    : await prisma.regulationBasis.findMany({
        where: { actId: act.id },
        select: {
          provisionId: true,
          citationText: true,
          regulation: {
            select: { id: true, actNumber: true, year: true, title: true, status: true },
          },
          provision: { select: { displayLabel: true, anchor: true } },
        },
      });

  // Grouped by regulation rather than returned flat: a regulation naming four
  // articles is one regulation, and a list that repeated it four times would
  // read as four.
  const byRegulation = new Map<
    string,
    {
      actNumber: number;
      year: number;
      title: string;
      status: string;
      citation: string;
      path: string;
      /** The articles of *this* act it names, as the act prints them. */
      articles: { label: string; anchor: string }[];
      /** True when it names the act without naming an article. */
      wholeAct: boolean;
    }
  >();
  for (const row of regulationsUnder) {
    const r = row.regulation;
    let entry = byRegulation.get(r.id);
    if (!entry) {
      entry = {
        actNumber: r.actNumber,
        year: r.year,
        title: r.title,
        status: r.status,
        citation: actCitation({
          jurisdiction: "is",
          docType: "regulation",
          citation: null,
          actNumber: r.actNumber,
          year: r.year,
        }),
        path: actPath({
          jurisdiction: "is",
          docType: "regulation",
          celex: null,
          actNumber: r.actNumber,
          year: r.year,
        }),
        articles: [],
        wholeAct: false,
      };
      byRegulation.set(r.id, entry);
    }
    if (row.provision) {
      entry.articles.push({ label: row.provision.displayLabel, anchor: row.provision.anchor });
    } else {
      entry.wholeAct = true;
    }
  }
  const regulations = [...byRegulation.values()].sort(
    (a, b) => b.year - a.year || b.actNumber - a.actNumber
  );

  /** Per-provision count, for the badge each article carries. */
  const regulationCountBy = new Map<string, number>();
  for (const row of regulationsUnder) {
    if (!row.provisionId) continue;
    regulationCountBy.set(row.provisionId, (regulationCountBy.get(row.provisionId) ?? 0) + 1);
  }

  const statutoryBasis = isRegulation
    ? await prisma.regulationBasis.findMany({
        where: { regulationId: act.id },
        orderBy: { charOffset: "asc" },
        select: {
          citationText: true,
          excerpt: true,
          act: { select: { actNumber: true, year: true, title: true } },
          provision: { select: { displayLabel: true, anchor: true } },
        },
      })
    : [];

  return NextResponse.json({
    act: {
      id: act.id,
      jurisdiction: act.jurisdiction,
      actNumber: act.actNumber,
      year: act.year,
      title: actDisplayTitle(act),
      /** The full official title, which for an EU act repeats the citation. */
      officialTitle: act.title,
      citation: actCitation(act),
      path: actPath(act),
      currentVersionUrl: act.currentVersionUrl,
      codexVersion: act.codexVersion,
      // The act's own page on the parliamentary record, and the bill it was
      // passed from. Icelandic acts only, and null on the acts that predate
      // the record — the reader renders neither link unless it has one.
      ferillUrl: act.ferillUrl,
      billUrl: act.billUrl,
      /**
       * The þing and mál numbers out of the ferill link, so the reader can
       * name the case ("115. löggjafarþing, mál 71") instead of offering a
       * bare link. Parsed here rather than in the page: the parser lives in
       * the Lagasafn module, which pulls in cheerio, and that has no business
       * in a client bundle.
       */
      ferill: act.ferillUrl ? parseFerillUrl(act.ferillUrl) : null,
      aliases: act.aliases,
      actCaseCount,
      // EU acts. Null or empty throughout on the Icelandic side, which is
      // what the reader keys its EEA panel off.
      celex: act.celex,
      docType: act.docType,
      status: act.status,
      eeaRelevant: act.eeaRelevant,
      eeaIncorporatedBy: act.eeaIncorporatedBy,
      entryIntoForce: act.entryIntoForce,
      endOfValidity: act.endOfValidity,
      textCelex: act.textCelex,
      textStatus: act.textStatus,
      // Icelandic regulations. Null throughout on every other row.
      ministry: act.ministry,
      publishedDate: act.publishedDate,
      lastAmendDate: act.lastAmendDate,
      // `?? []` for the same reason Provision.footnotes has it: Prisma types a
      // scalar list as non-null but leaves the column nullable, so a row that
      // predates the column — or one written while the column existed without
      // its default — reads back as null under a `string[]` type.
      amendedBy: act.amendedBy ?? [],
      subjectChapters: act.subjectChapters ?? [],
      originalDocUrl: act.originalDocUrl,
      /**
       * "structured" or "heuristic" — whether the articles below come from
       * markup reglugerd.is wrote, or from a guess at where the articles are
       * in a Word conversion. The reader says so, because a reader who cannot
       * tell will assume the first.
       */
      structureSource: act.structureSource,
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
      // `?? []` because the column is nullable in Postgres — Prisma declares
      // scalar lists non-null in TypeScript but does not enforce it in the
      // schema, and the reader calls .length on this.
      footnotes: p.footnotes ?? [],
      paragraphs: p.paragraphs.map((par) => ({ number: par.number, anchor: par.anchor, text: par.text })),
      caseCount: countBy.get(p.id) ?? 0,
      /** Regulations made under this specific article. */
      regulationCount: regulationCountBy.get(p.id) ?? 0,
    })),
    /** Acts only: the regulations made under this act. */
    regulations,
    /**
     * Regulations only: what this regulation says it is made under, grouped by
     * act. One row per article is the right shape to store and the wrong one
     * to read — four rows naming lög nr. 60/2007 would print the act's name
     * four times over.
     */
    statutoryBasis: groupBasisByAct(statutoryBasis),
  });
}

/** Collapses one row per article into one entry per act. See its caller. */
function groupBasisByAct(
  rows: {
    citationText: string;
    excerpt: string;
    act: { actNumber: number; year: number; title: string };
    provision: { displayLabel: string; anchor: string } | null;
  }[]
) {
  const byAct = new Map<
    string,
    {
      actNumber: number;
      year: number;
      title: string;
      citation: string;
      path: string;
      articles: { label: string; anchor: string }[];
      citationText: string;
      excerpt: string;
    }
  >();
  for (const r of rows) {
    const key = `${r.act.actNumber}/${r.act.year}`;
    let entry = byAct.get(key);
    if (!entry) {
      entry = {
        actNumber: r.act.actNumber,
        year: r.act.year,
        title: r.act.title,
        citation: actCitation({
          jurisdiction: "is",
          docType: "act",
          citation: null,
          actNumber: r.act.actNumber,
          year: r.act.year,
        }),
        path: actPath({
          jurisdiction: "is",
          docType: "act",
          celex: null,
          actNumber: r.act.actNumber,
          year: r.act.year,
        }),
        articles: [],
        citationText: r.citationText,
        excerpt: r.excerpt,
      };
      byAct.set(key, entry);
    }
    if (r.provision) {
      entry.articles.push({ label: r.provision.displayLabel, anchor: r.provision.anchor });
    }
  }
  return [...byAct.values()];
}
