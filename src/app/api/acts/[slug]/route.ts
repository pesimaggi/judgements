import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { actCitation, actDisplayTitle, actPath, actTreaty, parseActRef } from "@/lib/acts";
import { parseFerillUrl } from "@/lib/lagasafn";
import { treatyAnnexedTo, treatyPath } from "@/lib/treaties";

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

  const include = {
    chapters: { orderBy: { ordering: "asc" } },
    provisions: {
      orderBy: { ordering: "asc" },
      include: { paragraphs: { orderBy: { ordering: "asc" } } },
    },
  } as const;

  // "38-2001" is an Icelandic act, "32016R0679" an EU one, "ees" a treaty —
  // one route, three corpora, because they are one table and one reader. See
  // parseActRef().
  //
  // A treaty is the one of the three that can be asked for in a language.
  // `?lang=` picks the text; anything but a text this instrument actually has
  // falls back to the one that governs here rather than 404-ing, because a
  // link to `/log/tfeu?lang=is` is a reader asking for something that does not
  // exist, and the answer to that is the treaty, not an error.
  const requested = new URL(_req.url).searchParams.get("lang");
  const act =
    ref.jurisdiction === "treaty"
      ? ((await prisma.act.findFirst({
          where: {
            jurisdiction: "treaty",
            textGroup: ref.treaty.slug,
            ...(requested === "is" || requested === "en" ? { language: requested } : {}),
          },
          // The governing text first, so a fallback lands on it.
          orderBy: [{ isCanonical: "desc" }],
          include,
        })) ??
        (await prisma.act.findFirst({
          where: { jurisdiction: "treaty", textGroup: ref.treaty.slug },
          orderBy: [{ isCanonical: "desc" }],
          include,
        })))
      : await prisma.act.findUnique({
          where:
            ref.jurisdiction === "eu"
              ? { celex: ref.celex }
              : {
                  jurisdiction_docType_actNumber_year_language: {
                    jurisdiction: "is",
                    // From the slug: "38-2001" is an act, "rg-300-2020" a
                    // regulation. Pinning "act" here served a regulation's URL
                    // the act of the same number, silently.
                    docType: ref.docType,
                    actNumber: ref.actNumber,
                    year: ref.year,
                    language: "is",
                  },
                },
          include,
        });
  if (!act) return NextResponse.json({ error: "Act not found." }, { status: 404 });

  // The instrument's other texts, for the reader's language control. A query
  // rather than the registry, because what matters is which texts have actually
  // been ingested: offering English before the English text is stored would be
  // a control that leads to an empty page.
  const otherTexts = act.textGroup
    ? (
        await prisma.act.findMany({
          where: { textGroup: act.textGroup, id: { not: act.id } },
          select: { language: true, isCanonical: true },
        })
      ).map((other) => ({
        language: other.language,
        isCanonical: other.isCanonical,
        path: `${actPath(act)}?lang=${other.language}`,
      }))
    : [];

  // How the treaty reaches Icelandic law: the line that explains why an
  // international agreement is in a library of Icelandic law, and it is a
  // different line for each of the three. The main part of the EEA Agreement was
  // enacted here; Iceland is a party to the Surveillance and Court Agreement
  // without its text having been enacted, which is where the EFTA Court's
  // jurisdiction over Iceland comes from; the EU treaties bind Iceland not at
  // all. Saying any of the three where another is true would be a statement
  // about Icelandic law that is simply wrong.
  const treaty = actTreaty(act);
  const status = treaty?.icelandicStatus;
  const icelandicLaw =
    status && status.kind !== "not-a-party"
      ? {
          kind: status.kind,
          article: status.article,
          citation: actCitation({
            jurisdiction: "is",
            docType: "act",
            citation: null,
            actNumber: status.actNumber,
            year: status.year,
          }),
          path: actPath({
            jurisdiction: "is",
            docType: "act",
            celex: null,
            actNumber: status.actNumber,
            year: status.year,
          }),
          // Which fylgiskjal prints the text, where one does.
          annex: treaty?.icelandicText?.annex ?? null,
        }
      : status
        ? { kind: status.kind, article: null, citation: null, path: null, annex: null }
        : null;

  // The other direction: an act that prints a treaty as a fylgiskjal. The
  // reader shows the annexed text where it is printed — some readers get to the
  // Agreement through the act that enacted it, and 129 articles with a "go
  // elsewhere" notice instead of the text would be the worst of both — and
  // links to the treaty's own page, which is where its article numbers are
  // searchable and where the judgments citing them are counted.
  const annexedTreaty =
    act.jurisdiction === "is" && act.docType === "act"
      ? treatyAnnexedTo(act.actNumber, act.year)
      : null;

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
      // ---- One instrument, more than one text --------------------------------
      /** Language of the text below (ISO 639-1). */
      language: act.language,
      /** The instrument, where this is one text of it: the registry slug. */
      textGroup: act.textGroup,
      /** Its other stored texts, for the reader's language control. */
      otherTexts,
      /** How this treaty reaches Icelandic law, and under which act. */
      icelandicLaw,
      /** The treaty this act prints as a fylgiskjal, if any. */
      annexedTreaty: annexedTreaty
        ? {
            slug: annexedTreaty.slug,
            title: annexedTreaty.titleIs,
            citation: annexedTreaty.citationIs,
            annex: annexedTreaty.icelandicText?.annex ?? null,
            path: treatyPath(annexedTreaty.slug),
          }
        : null,
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
