/**
 * Browsing the ingested act corpus — Icelandic acts from Lagasafn and EU acts
 * from EUR-Lex, in one table and one catalogue.
 *
 * Deliberately a plain query rather than part of the SearchProvider
 * abstraction: listing every act in order is not a search, and routing it
 * through the provider would oblige the Meilisearch implementation to
 * paginate its whole index to answer "what have we got". Searching acts still
 * goes through the provider (searchActs) — this is the catalogue view.
 *
 * THE EEA / EU SCOPE. The EU library is about 33,000 acts, and most of them
 * have never had anything to do with Iceland. So every act query takes a
 * scope:
 *
 *   "eea" (the default) — Icelandic acts, plus the EU acts that may be part of
 *     EEA law: the ones EUR-Lex marks "(Text with EEA relevance)" and the ones
 *     a decision of the EEA Joint Committee names. This is the corpus a
 *     question about Icelandic law is asked against.
 *   "eu" — no limit. Every EU act in the library, incorporated or not, which
 *     is what you want when looking up a regulation precisely *because* it has
 *     not been taken into the Agreement.
 *
 * The scope never hides Icelandic law: it says how much of the EU library
 * comes with it.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { euActPath, euSubjectTitle, parseCelex } from "./eur-lex";
import {
  TREATY_DOC_TYPE,
  TREATY_JURISDICTION,
  treatyByIdentity,
  treatyBySlug,
  treatyPath,
  type TreatyDef,
} from "./treaties";

export type ActSort = "title" | "number" | "cases" | "provisions";

/** How much of the EU library an act query may see. See the header. */
export type ActScope = "eea" | "eu";

/**
 * Which corpus the catalogue is showing.
 *
 * Not the same thing as `Act.jurisdiction`, and that is the point. The table
 * holds three bodies of law under two jurisdiction values: Icelandic acts and
 * Icelandic regulations are both jurisdiction "is", and they are not the same
 * corpus — nobody looking for lög wants reglugerðir mixed in, and "lög nr.
 * 300/2020" is simply the wrong thing to call reglugerð nr. 300/2020.
 *
 *   "is"     — lög. jurisdiction "is", docType "act".
 *   "is-reg" — reglugerðir. jurisdiction "is", docType "regulation".
 *   "eu"     — the EU library, whatever the instrument.
 *   "treaty" — the founding treaties. See src/lib/treaties.ts.
 *   "all"    — no filter.
 */
export type ActCorpus = "is" | "is-reg" | "eu" | "treaty" | "all";


export function parseActScope(value: string | null | undefined): ActScope {
  return value === "eu" ? "eu" : "eea";
}

export function parseActCorpus(value: string | null | undefined): ActCorpus {
  return value === "eu" || value === "all" || value === "is-reg" || value === "treaty"
    ? value
    : "is";
}


/**
 * The SQL an act query must add to stay inside a scope, as a condition on the
 * table alias `a`.
 *
 * "eea" is deliberately generous — a marker *or* a naming by the Joint
 * Committee is enough — because the question the toggle answers is "might this
 * matter here", and an act wrongly kept is a line in a list where an act
 * wrongly dropped is a search that silently fails.
 */
export function scopeFilter(scope: ActScope, alias = "a"): Prisma.Sql {
  if (scope === "eu") return Prisma.sql`TRUE`;
  const table = Prisma.raw(alias);
  // The treaties are in both scopes, and this line is load-bearing in a way
  // nothing else here is: every act lookup, the act type-ahead, provision
  // search and the well's retrieval all reach acts through this function, so a
  // treaty that does not satisfy it is not merely absent from the EES setting —
  // it is invisible to the whole application, which looks exactly like an
  // ingest that silently stored nothing.
  //
  // They belong here even though the TEU and the TFEU are not EEA law: they are
  // the text EFTA Court and CJEU reasoning reads EEA provisions against, so
  // hiding them behind the wide setting would hide them from precisely the
  // people who need them. The EEA Agreement is not even a close call — its main
  // text has lagagildi in Iceland.
  //
  // coalesce, because a scalar list is NULL rather than empty for any row
  // written before the column existed — and `cardinality(NULL) > 0` is NULL,
  // which drops the row from the filter instead of failing the one test.
  return Prisma.sql`(${table}.jurisdiction = 'is'
     OR ${table}.jurisdiction = 'treaty'
     OR ${table}.eea_relevant
     OR coalesce(cardinality(${table}.eea_incorporated_by), 0) > 0)`;
}

/**
 * The SQL that limits an act query to one corpus.
 *
 * This is the one place `doc_type = 'act'` should be written. Before
 * regulations existed, `jurisdiction = 'is'` meant lög and every act query
 * said so inline; now it means lög *or* reglugerðir, and an inline condition
 * left behind is a regulation presented as an act — cited "lög nr. 300/2020",
 * counted in the act catalogue's totals, and offered by the act type-ahead as
 * though a judgment citing that number meant it.
 */
export function corpusFilter(corpus: ActCorpus, alias = "a"): Prisma.Sql {
  const table = Prisma.raw(alias);
  // One instrument, one row. `is_canonical` is false only on a secondary-
  // language text — today the English EEA Agreement — and it is excluded here,
  // in the one function every listing goes through, rather than at each of
  // them. Without it the Agreement's Article 28 appears twice in the catalogue
  // under two labels, with the judgments that cite it split between the copies.
  // The other text is never *listed*; it is reached from the row that owns the
  // instrument, by following `text_group`.
  const canonical = Prisma.sql`${table}.is_canonical`;
  switch (corpus) {
    case "all":
      return canonical;
    case "eu":
      return Prisma.sql`${table}.jurisdiction = 'eu' AND ${canonical}`;
    case "is-reg":
      return Prisma.sql`${table}.jurisdiction = 'is' AND ${table}.doc_type = 'regulation' AND ${canonical}`;
    case "treaty":
      return Prisma.sql`${table}.jurisdiction = 'treaty' AND ${canonical}`;
    case "is":
    default:
      return Prisma.sql`${table}.jurisdiction = 'is' AND ${table}.doc_type = 'act' AND ${canonical}`;
  }
}


/**
 * A row's treaty, where it is one: the registry entry its `textGroup` names.
 *
 * Every treaty-specific display rule goes through this rather than through the
 * stored columns, because what a treaty is called, and how its articles are
 * cited in each language, is a fact about the instrument and not about the row.
 */
export function actTreaty(act: {
  jurisdiction: string;
  textGroup?: string | null;
  actNumber?: number;
  year?: number;
}): TreatyDef | null {
  if (act.jurisdiction !== TREATY_JURISDICTION) return null;
  if (act.textGroup) return treatyBySlug(act.textGroup);
  // Callers that select a narrow act identity and no `text_group` — the well's
  // tools, the lookup route, the Meilisearch sync — still get the right
  // instrument. See treatyByIdentity.
  if (act.actNumber !== undefined && act.year !== undefined) {
    return treatyByIdentity(act.actNumber, act.year);
  }
  return null;
}

/** How an act is cited, given what the row holds. */
export function actCitation(act: {
  jurisdiction: string;
  docType?: string;
  citation: string | null;
  actNumber: number;
  year: number;
  textGroup?: string | null;
  language?: string;
}): string {
  // A treaty has no number, and `actNumber` holds a registry ordinal that must
  // never reach a reader: "lög nr. 3/1957" is not the TFEU. The stored citation
  // is the instrument's own, in the row's language.
  if (act.jurisdiction === TREATY_JURISDICTION) {
    const treaty = actTreaty(act);
    if (treaty) return act.language === "en" ? treaty.citationEn : treaty.citationIs;
    return act.citation ?? "";
  }
  if (act.jurisdiction === "eu") return act.citation ?? `${act.actNumber}/${act.year}`;
  // An Icelandic regulation is cited by the same number-and-year form as an
  // act and is not one; calling it "lög nr. 300/2020" would be a statement
  // about its legal status, not a formatting slip.
  if (act.docType === "regulation") return `reglugerð nr. ${act.actNumber}/${act.year}`;
  return `lög nr. ${act.actNumber}/${act.year}`;
}

/**
 * The act's title as a heading: the subject alone for an EU act, whose
 * official title opens with the citation shown beside it. See euSubjectTitle.
 */
export function actDisplayTitle(act: { jurisdiction: string; title: string }): string {
  // A treaty's stored title is already the instrument's name in the row's
  // language ("Samningur um Evrópska efnahagssvæðið"), with no citation glued to
  // the front of it to strip.
  return act.jurisdiction === "eu" ? euSubjectTitle(act.title) : act.title;
}

/**
 * The act named in full: "Almenn hegningarlög nr. 19/1940".
 *
 * What a chip or a one-line summary has to say. An Icelandic title already
 * carries the word lög or reglugerð, so only the number is added; an EU act's
 * citation is a formula of its own and goes in brackets after the subject.
 */
export function actFullLabel(act: {
  jurisdiction: string;
  docType?: string;
  title: string;
  citation: string | null;
  actNumber: number;
  year: number;
  textGroup?: string | null;
  language?: string;
}): string {
  // The Agreement's name and its citation are the same fact twice
  // ("Samningur um Evrópska efnahagssvæðið (EES-samningurinn)" is a mouthful
  // that tells a reader nothing), so a treaty is labelled by its title alone.
  if (act.jurisdiction === TREATY_JURISDICTION) return actDisplayTitle(act);
  if (act.jurisdiction === "eu") return `${actDisplayTitle(act)} (${actCitation(act)})`;
  return `${act.title} nr. ${act.actNumber}/${act.year}`;
}

/**
 * A provision cited the way a judgment cites it: "4. gr. laga nr. 19/1940".
 *
 * `displayLabel` alone is "4. gr.", which is meaningless away from the act it
 * belongs to — and away from it is exactly where a filter chip and a results
 * summary put it. The genitive is the generic noun's, not the title's: "laga"
 * and "reglugerðar" are the only two forms needed, so the citation is correct
 * Icelandic without anyone having to decline a title the database holds in
 * the nominative.
 */
export function provisionFullLabel(
  displayLabel: string,
  act: {
    jurisdiction: string;
    docType?: string;
    citation: string | null;
    actNumber: number;
    year: number;
    textGroup?: string | null;
    language?: string;
  }
): string {
  // "28. gr. EES-samningsins" and "Article 28 EEA" — each language's own
  // convention, which is also how a judgment in that language writes it, and
  // therefore what the citation patterns in legal-citations.ts look for.
  const treaty = actTreaty(act);
  if (treaty) {
    return act.language === "en"
      ? `${displayLabel} ${treaty.articleSuffixEn}`
      : `${displayLabel} ${treaty.genitiveIs}`;
  }
  if (act.jurisdiction === "eu") return `${displayLabel} ${actCitation(act)}`;
  const kind = act.docType === "regulation" ? "reglugerðar" : "laga";
  return `${displayLabel} ${kind} nr. ${act.actNumber}/${act.year}`;
}

/**
 * The route this app serves an act at.
 *
 * Icelandic acts are "/log/38-2001"; EU acts are "/log/32016R0679". The two
 * forms cannot collide — a CELEX always starts with its sector digit and
 * carries a type letter — so one route serves both, and one act reader renders
 * both.
 */
export function actPath(act: {
  jurisdiction: string;
  docType?: string;
  celex: string | null;
  actNumber: number;
  year: number;
  textGroup?: string | null;
}): string {
  // A treaty is served at its slug — "/log/ees" — and the slug is the same for
  // both of its texts: a URL identifies the instrument, and the language is a
  // way of reading it rather than a different thing to read. Letters cannot
  // collide with "38-2001", "rg-300-2020" or a CELEX.
  if (act.jurisdiction === TREATY_JURISDICTION) {
    const treaty = actTreaty(act);
    if (treaty) return treatyPath(treaty.slug);
  }
  if (act.jurisdiction === "eu" && act.celex) return euActPath(act.celex);
  // Regulations are prefixed because "300-2020" cannot say whether it means
  // lög nr. 300/2020 or reglugerð nr. 300/2020, and both can exist. The route
  // stays /log/ for all of them: it has served EU regulations since
  // /log/32016R0679, so it is the reader for legislation, not a route for lög.
  if (act.jurisdiction === "is" && act.docType === "regulation") {
    return `/log/rg-${act.actNumber}-${act.year}`;
  }
  return `/log/${act.actNumber}-${act.year}`;
}

/** An act reference as it arrives in a URL, resolved to what to look up. */
export type ActRef =
  | { jurisdiction: "is"; docType: "act" | "regulation"; actNumber: number; year: number }
  | { jurisdiction: "eu"; celex: string }
  | { jurisdiction: "treaty"; treaty: TreatyDef };

/**
 * Parses the three forms /log/{slug} takes: "38-2001" for an act,
 * "rg-300-2020" for a regulation, and "32016R0679" for an EU act.
 *
 * The regulation prefix is what keeps the first two apart. A regulation number
 * runs past 1000 in a busy year, so the act form's three-digit limit is not a
 * discriminator and could not be made into one.
 */
export function parseActRef(slug: string): ActRef | null {
  // A treaty first, and by exact match against the registry rather than by
  // shape: the set is three entries long and closed, so there is nothing to
  // pattern-match and no chance of claiming a slug that means something else.
  const treaty = treatyBySlug(slug);
  if (treaty) return { jurisdiction: "treaty", treaty };

  const regulation = /^rg-(\d{1,4})-(\d{4})$/.exec(slug);
  if (regulation) {
    return {
      jurisdiction: "is",
      docType: "regulation",
      actNumber: Number(regulation[1]),
      year: Number(regulation[2]),
    };
  }
  const icelandic = /^(\d{1,3})-(\d{4})$/.exec(slug);
  if (icelandic) {
    return {
      jurisdiction: "is",
      docType: "act",
      actNumber: Number(icelandic[1]),
      year: Number(icelandic[2]),
    };
  }
  const celex = parseCelex(slug);
  if (celex && !celex.consolidated) return { jurisdiction: "eu", celex: celex.celex };
  return null;
}

export interface ActListItem {
  id: string;
  jurisdiction: string;
  /** "act" | "regulation" | "directive" | "decision" | "treaty". */
  docType: string;
  /** Language of this text (ISO 639-1). */
  language: string;
  /** The treaty this is a text of, where it is one: the registry slug. */
  textGroup: string | null;
  actNumber: number;
  year: number;
  title: string;
  citation: string;
  path: string;
  aliases: string[];
  provisionCount: number;
  /** Judgments citing any provision of this act, or the act itself. */
  citingCases: number;
  currentVersionUrl: string;
  /** EU acts: marked "(Text with EEA relevance)". */
  eeaRelevant: boolean;
  /** EU acts: decisions of the EEA Joint Committee that name this act. */
  eeaIncorporatedBy: string[];
  /** "in_force" | "no_longer_in_force". */
  status: string;
  /** EU acts: null until the text pass has read the act. */
  textStatus: string | null;
}

export interface ActListResult {
  acts: ActListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  /** Corpus-wide figures, so the page can say what it is showing. */
  totals: {
    acts: number;
    provisions: number;
    linkedProvisions: number;
    /**
     * Icelandic acts, Icelandic regulations, EU acts, the EEA-scoped subset of
     * the EU ones, and the treaties. The treaty figure counts instruments, not
     * texts: the Agreement is one treaty in two languages.
     */
    icelandic: number;
    regulations: number;
    eu: number;
    euEea: number;
    treaties: number;
  };
}

/**
 * One page of the act catalogue.
 *
 * The counts are computed in the same statement rather than per row: a count
 * query each would be one round trip per act to render one page.
 * `citingCases` counts distinct judgments across both link tables, so an act
 * cited once by article and once bare does not count twice.
 *
 * Filtering by `q` happens here rather than in the browser. It used to be the
 * other way round — the whole list was ~900 rows of metadata and the page
 * filtered them as you typed — but the EU library is tens of thousands of
 * acts, and shipping all of it to filter three of them is not a page, it is a
 * download.
 */
export async function listActs(opts: {
  page?: number;
  pageSize?: number;
  sort?: ActSort;
  /** Show only acts that at least one judgment cites. */
  citedOnly?: boolean;
  /** Which corpus to list. Defaults to lög. */
  corpus?: ActCorpus;
  /** How much of the EU library the listing may see. Defaults to "eea". */
  scope?: ActScope;
  /** Free text over title, citation and short names. */
  q?: string;
}): Promise<ActListResult> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(1000, Math.max(1, opts.pageSize ?? 100));
  const offset = (page - 1) * pageSize;
  const sort: ActSort = opts.sort ?? "title";
  const corpus = opts.corpus ?? "is";
  const scope = opts.scope ?? "eea";

  // Column names as the CTE below exposes them: the `acts a` alias is scoped
  // to the CTE body and is not in scope for the outer SELECT that sorts.
  const order =
    sort === "number"
      ? Prisma.sql`year DESC, act_number DESC`
      : sort === "cases"
        ? Prisma.sql`citing_cases DESC, title ASC`
        : sort === "provisions"
          ? Prisma.sql`provision_count DESC, title ASC`
          : Prisma.sql`title ASC`;

  const where: Prisma.Sql[] = [corpusFilter(corpus), scopeFilter(scope)];
  const q = (opts.q ?? "").trim();
  if (q) {
    const like = `%${q}%`;
    const num = /(\d{1,4})\s*[\/ -]\s*(\d{1,4})/.exec(q);
    const parts: Prisma.Sql[] = [
      Prisma.sql`a.title ILIKE ${like}`,
      Prisma.sql`act_alias_text(a.aliases) ILIKE ${like}`,
      Prisma.sql`coalesce(a.citation, '') ILIKE ${like}`,
      Prisma.sql`coalesce(a.celex, '') ILIKE ${like}`,
    ];
    if (num) {
      // "38/2001" and "2016/679" alike: the number is written first in
      // Icelandic citations and in the older EU ones, and second in the modern
      // EU ones, so both readings are tried.
      const [first, second] = [Number(num[1]), Number(num[2])];
      parts.push(
        Prisma.sql`(a.act_number = ${first} AND a.year = ${second})`,
        Prisma.sql`(a.year = ${first} AND coalesce(a.natural_number, a.act_number) = ${second})`
      );
    }
    where.push(Prisma.sql`(${Prisma.join(parts, " OR ")})`);
  }
  const whereSql = Prisma.sql`WHERE ${Prisma.join(where, " AND ")}`;
  const having = opts.citedOnly ? Prisma.sql`WHERE citing_cases > 0` : Prisma.empty;

  const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
    WITH counted AS (
      SELECT a.id, a.jurisdiction, a.doc_type, a.act_number, a.year, a.title, a.aliases,
             a.current_version_url, a.citation, a.celex, a.eea_relevant,
             a.eea_incorporated_by, a.status, a.text_status,
             a.language, a.text_group,
             (SELECT count(*)::int FROM provisions p
               WHERE p.act_id = a.id AND p.kind = 'article') AS provision_count,
             (SELECT count(DISTINCT d)::int FROM (
                SELECT l.document_id AS d FROM case_provision_links l
                  JOIN provisions p ON p.id = l.provision_id
                 WHERE p.act_id = a.id
                UNION
                SELECT al.document_id FROM case_act_links al WHERE al.act_id = a.id
              ) refs) AS citing_cases
        FROM acts a
        ${whereSql}
    )
    SELECT * FROM counted
    ${having}
    ORDER BY ${order}
    LIMIT ${pageSize} OFFSET ${offset}
  `);

  const [{ total }] = await prisma.$queryRaw<{ total: number }[]>(Prisma.sql`
    SELECT count(*)::int AS total FROM acts a
    ${whereSql}
    ${
      opts.citedOnly
        ? Prisma.sql`AND EXISTS (
            SELECT 1 FROM case_act_links al WHERE al.act_id = a.id
             UNION ALL
            SELECT 1 FROM case_provision_links l
              JOIN provisions p ON p.id = l.provision_id
             WHERE p.act_id = a.id)`
        : Prisma.empty
    }
  `);

  const [totals] = await prisma.$queryRaw<
    {
      acts: number;
      provisions: number;
      linked_provisions: number;
      icelandic: number;
      regulations: number;
      eu: number;
      eu_eea: number;
      treaties: number;
    }[]
  >(Prisma.sql`
    SELECT (SELECT count(*)::int FROM acts) AS acts,
           (SELECT count(*)::int FROM provisions WHERE kind = 'article') AS provisions,
           (SELECT count(DISTINCT provision_id)::int FROM case_provision_links) AS linked_provisions,
           (SELECT count(*)::int FROM acts
             WHERE jurisdiction = 'is' AND doc_type = 'act') AS icelandic,
           (SELECT count(*)::int FROM acts
             WHERE jurisdiction = 'is' AND doc_type = 'regulation') AS regulations,
           (SELECT count(*)::int FROM acts WHERE jurisdiction = 'eu') AS eu,
           (SELECT count(*)::int FROM acts a
             WHERE a.jurisdiction = 'eu'
               AND (a.eea_relevant
                    OR coalesce(cardinality(a.eea_incorporated_by), 0) > 0)) AS eu_eea,
           (SELECT count(*)::int FROM acts
             WHERE jurisdiction = 'treaty' AND is_canonical) AS treaties
  `);

  return {
    acts: rows.map((r) => ({
      id: r.id,
      jurisdiction: r.jurisdiction,
      docType: r.doc_type,
      language: r.language ?? "is",
      textGroup: r.text_group ?? null,
      actNumber: r.act_number,
      year: r.year,
      title: actDisplayTitle({ jurisdiction: r.jurisdiction, title: r.title }),
      citation: actCitation({
        jurisdiction: r.jurisdiction,
        docType: r.doc_type,
        citation: r.citation,
        actNumber: r.act_number,
        year: r.year,
        textGroup: r.text_group ?? null,
        language: r.language ?? "is",
      }),
      path: actPath({
        jurisdiction: r.jurisdiction,
        docType: r.doc_type,
        celex: r.celex,
        actNumber: r.act_number,
        year: r.year,
        textGroup: r.text_group ?? null,
      }),
      aliases: r.aliases ?? [],
      provisionCount: Number(r.provision_count ?? 0),
      citingCases: Number(r.citing_cases ?? 0),
      currentVersionUrl: r.current_version_url,
      eeaRelevant: r.eea_relevant ?? false,
      eeaIncorporatedBy: r.eea_incorporated_by ?? [],
      status: r.status,
      textStatus: r.text_status ?? null,
    })),
    total: Number(total ?? 0),
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(Number(total ?? 0) / pageSize)),
    totals: {
      acts: Number(totals?.acts ?? 0),
      provisions: Number(totals?.provisions ?? 0),
      linkedProvisions: Number(totals?.linked_provisions ?? 0),
      icelandic: Number(totals?.icelandic ?? 0),
      regulations: Number(totals?.regulations ?? 0),
      eu: Number(totals?.eu ?? 0),
      euEea: Number(totals?.eu_eea ?? 0),
      treaties: Number(totals?.treaties ?? 0),
    },
  };
}
