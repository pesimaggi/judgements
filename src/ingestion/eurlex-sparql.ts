import { decisionNumberFromTitle } from "@/lib/eu-citations";
import { parseCelex } from "@/lib/eur-lex";
import { politeFetchText } from "./adapter";

/**
 * The EUR-Lex query layer: SPARQL against Cellar, the Publications Office's
 * endpoint, and the three questions this app asks it.
 *
 *   catalogueYear()                  — the EU acts of one year in force.
 *   listJointCommitteeDecisions()    — every decision of the EEA Joint
 *                                      Committee that exists.
 *   jointCommitteeActLinks()         — which acts each of those decisions
 *                                      names, which is how an act comes to be
 *                                      tagged as part of EEA law.
 *
 * It lives apart from either adapter because both need it and they are not
 * the same source: the acts are ingested by `eur-lex`, the decisions by
 * `eea-joint-committee`, and the second of those needs EUR-Lex only for the
 * listing it has never had. Keeping the queries here is what stops one adapter
 * importing the other for a query.
 */
const SPARQL_ENDPOINT =
  process.env.EURLEX_SPARQL ?? "https://publications.europa.eu/webapi/rdf/sparql";

/**
 * The families of act ingested, as CELEX type letters, within sector 3 —
 * secondary legislation, and only that.
 *
 * REGULATIONS AND DIRECTIVES. "D" was in this list at first, and it was wrong.
 * A sector-3 decision is overwhelmingly an administrative act addressed to one
 * member state or one undertaking — state aid to an airline, an antigen bank,
 * an ECB internal rule — and there are more of them in force than there are
 * regulations and directives together: of the acts of 2000 and 2016 alone, 737
 * decisions against 725 regulations and 52 directives. They are not the law
 * anyone researches from Reykjavík, and they buried the acts that are.
 *
 * They also made the EEA tag read as nonsense, though not by inventing
 * anything: EUR-Lex genuinely marks "Commission Decision (EU) 2016/1031 … on
 * State aid SA.35956 … (Text with EEA relevance)", so the tag was faithfully
 * repeating the Official Journal. A marker that is true and useless is still
 * useless. Anything stored under the old list is deleted — see purgeUnwanted()
 * in the adapter.
 *
 * The sector matters too. EUR-Lex publishes the decisions of the EEA Joint
 * Committee in sector 2 (Decision No 154/2018 is `22018D1022` there), and this
 * app already holds those as documents from efta.int; widening to sector 2
 * would store every one of them twice. parseCelex refuses every other sector
 * besides, which is a second guard on the same rule.
 */
export const ACT_TYPES = (process.env.EURLEX_TYPES ?? "R,L")
  .split(",")
  .map((t) => t.trim().toUpperCase())
  .filter(Boolean);

const TYPES = ACT_TYPES;

/**
 * A SPARQL result row, flattened to the values we asked for. The endpoint
 * answers in the standard JSON results format; nothing here needs the
 * datatypes back.
 */
type Row = Record<string, string | undefined>;

/**
 * Runs one SPARQL query and returns its rows.
 *
 * Paged by the caller rather than here: what a page means differs between the
 * two queries, and a query that pages itself has to know its own ordering.
 */
async function sparql(query: string): Promise<Row[]> {
  const url = `${SPARQL_ENDPOINT}?query=${encodeURIComponent(query)}&format=${encodeURIComponent(
    "application/sparql-results+json"
  )}`;
  const body = await politeFetchText(url, { Accept: "application/sparql-results+json" });
  let parsed: { results?: { bindings?: Record<string, { value: string }>[] } };
  try {
    parsed = JSON.parse(body);
  } catch {
    // The endpoint answers HTML on an internal error, with a 200. Failing
    // loudly here is the point: a silently empty year would look like a year
    // with nothing in force.
    throw new Error(`SPARQL endpoint returned a non-JSON response (${body.slice(0, 120)}…)`);
  }
  return (parsed.results?.bindings ?? []).map((binding) => {
    const row: Row = {};
    for (const [key, value] of Object.entries(binding)) row[key] = value.value;
    return row;
  });
}

const PAGE_SIZE = 2000;

/** SPARQL prefixes both queries open with. */
const PREFIXES = `PREFIX cdm: <http://publications.europa.eu/ontology/cdm#>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>`;

/** The `VALUES` clause restricting a query to the ingested families. */
function typeValues(): string {
  return TYPES.map((t) => `"${t}"^^xsd:string`).join(" ");
}

/** One act as the catalogue knows it, before its text is read. */
export interface CatalogueEntry {
  celex: string;
  title: string;
  /** Short names EUR-Lex records for the act ("gdpr", "personal data"). */
  aliases: string[];
  /** The number the act is cited by, where EUR-Lex records one. */
  naturalNumber: number | null;
  date: Date | null;
  eeaRelevant: boolean;
  entryIntoForce: Date | null;
  endOfValidity: Date | null;
  /** CELEX of the most recent consolidated version, where there is one. */
  consolidatedCelex: string | null;
}

function toDate(value: string | undefined): Date | null {
  if (!value) return null;
  // EUR-Lex writes an open-ended end of validity as the year 9999.
  if (value.startsWith("9999")) return null;
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Reads the acts of one year in force, in two queries.
 *
 * They are two rather than one because the consolidated versions are a
 * one-to-many join: an act amended thirty times has thirty consolidated
 * versions, and joining them into the metadata query would multiply every
 * act's row by its amendment history. So the metadata is fetched flat, the
 * consolidations are fetched separately, and the latest of each is picked
 * here.
 */
export async function catalogueYear(year: number): Promise<CatalogueEntry[]> {
  const byCelex = new Map<string, CatalogueEntry>();

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const rows = await sparql(`${PREFIXES}
SELECT ?celex ?title ?short ?number ?date ?eea ?eif ?eov WHERE {
  ?w cdm:resource_legal_year "${year}"^^xsd:gYear ;
     cdm:resource_legal_id_sector "3"^^xsd:string ;
     cdm:resource_legal_type ?type ;
     cdm:resource_legal_in-force "true"^^xsd:boolean ;
     cdm:resource_legal_id_celex ?celex .
  VALUES ?type { ${typeValues()} }
  ?e cdm:expression_belongs_to_work ?w ;
     cdm:expression_uses_language <http://publications.europa.eu/resource/authority/language/ENG> ;
     cdm:expression_title ?title .
  OPTIONAL { ?e cdm:expression_title_short ?short }
  OPTIONAL { ?w cdm:resource_legal_number_natural ?number }
  OPTIONAL { ?w cdm:work_date_document ?date }
  OPTIONAL { ?w cdm:resource_legal_eea ?eea }
  OPTIONAL { ?w cdm:resource_legal_date_entry-into-force ?eif }
  OPTIONAL { ?w cdm:resource_legal_date_end-of-validity ?eov }
}
ORDER BY ?celex LIMIT ${PAGE_SIZE} OFFSET ${offset}`);

    for (const row of rows) {
      const celex = parseCelex(row.celex ?? "");
      // Corrigenda and the other suffixed forms are not acts of this library.
      if (!celex || celex.consolidated) continue;
      if (byCelex.has(celex.celex)) continue;
      byCelex.set(celex.celex, {
        celex: celex.celex,
        title: (row.title ?? "").replace(/\s+/g, " ").trim(),
        aliases: (row.short ?? "")
          .split(",")
          .map((alias) => alias.trim().toLowerCase())
          .filter(Boolean),
        naturalNumber: row.number ? Number(row.number) : null,
        date: toDate(row.date),
        // EUR-Lex writes the marker as a boolean, "1" or "0".
        eeaRelevant: row.eea === "1" || row.eea === "true",
        entryIntoForce: toDate(row.eif),
        endOfValidity: toDate(row.eov),
        consolidatedCelex: null,
      });
    }
    if (rows.length < PAGE_SIZE) break;
  }

  // The consolidated versions, newest per act.
  const latest = new Map<string, { celex: string; date: string }>();
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const rows = await sparql(`${PREFIXES}
SELECT ?celex ?consolidated ?date WHERE {
  ?w cdm:resource_legal_year "${year}"^^xsd:gYear ;
     cdm:resource_legal_id_sector "3"^^xsd:string ;
     cdm:resource_legal_type ?type ;
     cdm:resource_legal_in-force "true"^^xsd:boolean ;
     cdm:resource_legal_id_celex ?celex .
  VALUES ?type { ${typeValues()} }
  ?c cdm:act_consolidated_consolidates_resource_legal ?w ;
     cdm:resource_legal_id_celex ?consolidated ;
     cdm:work_date_document ?date .
}
ORDER BY ?celex ?date LIMIT ${PAGE_SIZE} OFFSET ${offset}`);

    for (const row of rows) {
      const celex = (row.celex ?? "").toUpperCase();
      const consolidated = (row.consolidated ?? "").toUpperCase();
      const date = row.date ?? "";
      if (!byCelex.has(celex) || !consolidated || !date) continue;
      // A consolidated version of *another* act also "consolidates" this one
      // when this one amended or repealed it: the consolidated text of
      // Directive 95/46 names the GDPR as one of its sources. Only the act's
      // own consolidation is its in-force text, and that is the one whose
      // CELEX is this act's with a sector 0 and a date — "32016R0679" →
      // "02016R0679-20160504". Anything else here is a different act.
      if (!consolidated.startsWith(`0${celex.slice(1)}-`)) continue;
      const held = latest.get(celex);
      if (!held || held.date < date) latest.set(celex, { celex: consolidated, date });
    }
    if (rows.length < PAGE_SIZE) break;
  }
  for (const [celex, consolidated] of latest) {
    const entry = byCelex.get(celex);
    if (entry) entry.consolidatedCelex = consolidated.celex;
  }

  return Array.from(byCelex.values());
}


// ---------------------------------------------------------------------------
// The EEA Joint Committee
// ---------------------------------------------------------------------------

/**
 * The Committee itself, as the Publications Office names it.
 *
 * This is the precise way to ask for its decisions, and the reason the queries
 * below do not simply take sector 2. Sector 2 holds every international
 * agreement and every joint body's decisions — the EU–Switzerland committee,
 * the association councils, dozens more — and 6,902 of the works in it are the
 * EEA Joint Committee's. Filtering by the authoring body is what separates
 * them; filtering by CELEX shape would not.
 */
const EEA_JOINT_COMMITTEE =
  "<http://publications.europa.eu/resource/authority/corporate-body/CMT_MIX_EEAREA>";

/** One decision of the EEA Joint Committee, as EUR-Lex lists it. */
export interface JcdListing {
  /** "22018D1022" — EUR-Lex's number for it, not the decision's own. */
  celex: string;
  /** "154/2018" — the decision's own number, off its title. */
  number: string;
  title: string;
  date: Date | null;
}

/**
 * Every decision of the EEA Joint Committee EUR-Lex publishes, oldest first.
 *
 * This is the listing the decisions source has never had. It was derived from
 * the EEA-Lex acts register until that was withdrawn, leaving a backlog that
 * was complete on the day it was seeded and could never grow; a source that
 * cannot discover a decision adopted last month is frozen, however full its
 * ledger looks.
 *
 * Note the two numbers. A JCD is cited by its own number — "No 154/2018" — but
 * EUR-Lex files it by its place in the Official Journal, "22018D1022". Only
 * the title states the number anyone would search for, so a decision whose
 * title does not state one is skipped: those are the "Decisions … for which
 * the constitutional requirements have been fulfilled" notices, which are
 * announcements about decisions rather than decisions.
 */
export async function listJointCommitteeDecisions(): Promise<JcdListing[]> {
  const decisions: JcdListing[] = [];
  const seen = new Set<string>();

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const rows = await sparql(`${PREFIXES}
SELECT ?celex ?title ?date WHERE {
  ?w cdm:work_created_by_agent ${EEA_JOINT_COMMITTEE} ;
     cdm:resource_legal_id_sector "2"^^xsd:string ;
     cdm:resource_legal_id_celex ?celex .
  OPTIONAL { ?w cdm:work_date_document ?date }
  ?e cdm:expression_belongs_to_work ?w ;
     cdm:expression_uses_language <http://publications.europa.eu/resource/authority/language/ENG> ;
     cdm:expression_title ?title .
}
ORDER BY ?celex LIMIT ${PAGE_SIZE} OFFSET ${offset}`);

    for (const row of rows) {
      const celex = (row.celex ?? "").toUpperCase();
      const title = (row.title ?? "").replace(/\s+/g, " ").trim();
      const number = decisionNumberFromTitle(title);
      if (!celex || !number || seen.has(number)) continue;
      seen.add(number);
      decisions.push({ celex, number, title, date: toDate(row.date) });
    }
    if (rows.length < PAGE_SIZE) break;
  }

  return decisions;
}

/** One decision naming one act: the cross-reference, as a pair. */
export interface JcdActLink {
  /** The decision's CELEX, to be resolved to its number by the caller. */
  jcdCelex: string;
  /** The act's CELEX, always sector 3. */
  actCelex: string;
}

/**
 * How many decisions one links query asks about at a time.
 *
 * The pairs are asked for by naming the decisions rather than by paging
 * through all ~21,900 of them, because the endpoint refuses a deep OFFSET: a
 * query for this join at OFFSET 10000 answers HTTP 500, and no amount of
 * ordering makes it not. Naming the decisions keeps every query small and
 * needs no offset at all, at the cost of one request per batch — about 34 of
 * them for the whole corpus. 200 CELEX numbers is roughly a 4 KB URL, well
 * inside what the endpoint accepts.
 */
const LINK_BATCH = 200;

/**
 * Every act named by the given decisions.
 *
 * This is the cross-reference that answers "has this been taken into the EEA
 * Agreement", and it beats reading it out of the decisions' text on two
 * counts: it covers every decision that exists rather than the ones whose text
 * we happen to hold, and it is the Publications Office's own record of the
 * relationship rather than our reading of a sentence.
 *
 * It says *named by*, not *inserted by*: a decision that deletes a point names
 * the act it is deleting, and a later decision amending an act names it again.
 * EUR-Lex records both as citations and offers nothing finer, so nothing here
 * pretends to know which. That is the honest signal anyway — an act a decision
 * deletes was incorporated once, and what the tag says is that the Committee
 * has dealt with this act, with the decision numbers to check.
 */
export async function jointCommitteeActLinks(jcdCelexes: string[]): Promise<JcdActLink[]> {
  const links: JcdActLink[] = [];

  for (let i = 0; i < jcdCelexes.length; i += LINK_BATCH) {
    const batch = jcdCelexes.slice(i, i + LINK_BATCH);
    const values = batch.map((celex) => `"${celex}"^^xsd:string`).join(" ");
    const rows = await sparql(`${PREFIXES}
SELECT ?jcd ?act WHERE {
  VALUES ?jcd { ${values} }
  ?w cdm:resource_legal_id_celex ?jcd ;
     cdm:work_cites_work ?cited .
  ?cited cdm:resource_legal_id_celex ?act ;
         cdm:resource_legal_id_sector "3"^^xsd:string .
}`);

    for (const row of rows) {
      const jcdCelex = (row.jcd ?? "").toUpperCase();
      const actCelex = (row.act ?? "").toUpperCase();
      if (jcdCelex && actCelex) links.push({ jcdCelex, actCelex });
    }
  }

  return links;
}

// ---------------------------------------------------------------------------
// Case law
// ---------------------------------------------------------------------------

/** One judgment as EUR-Lex lists it, before its text is read. */
export interface JudgmentListing {
  /** "62015CJ0203". */
  celex: string;
  /** The title EUR-Lex gives it, five fields separated by "#". */
  title: string;
  date: Date | null;
  /** "ECLI:EU:C:2016:970", where one is recorded. */
  ecli: string | null;
}

/**
 * The judgments of one year, for the given CELEX instrument letters.
 *
 * Asked for a year at a time for the same reason the acts are: the endpoint
 * refuses a deep OFFSET, and a year is a page nobody has to invent. About
 * 21,000 judgments of the Court of Justice and 12,000 of the General Court
 * exist in all, so a year is a few hundred rows.
 *
 * A judgment with no English expression is not returned — the Court's working
 * language is French and the older cases were never translated, and a record
 * with no text to search is not worth a row. Titles come back more than once
 * where EUR-Lex holds several; the longest is kept, because the fields this
 * app reads off it (the parties, the referring court, the Court's own index
 * terms) are the ones a shortened title drops.
 */
export async function listJudgments(year: number, letters: string[]): Promise<JudgmentListing[]> {
  const byCelex = new Map<string, JudgmentListing>();
  const pattern = letters.map((l) => l.toUpperCase()).join("|");

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const rows = await sparql(`${PREFIXES}
SELECT ?celex ?title ?date ?ecli WHERE {
  ?w cdm:resource_legal_id_sector "6"^^xsd:string ;
     cdm:work_has_resource-type <http://publications.europa.eu/resource/authority/resource-type/JUDG> ;
     cdm:resource_legal_id_celex ?celex ;
     cdm:work_date_document ?date .
  FILTER(REGEX(STR(?celex), "^6${year}(${pattern})[0-9]{4}$"))
  OPTIONAL { ?w cdm:case-law_ecli ?ecli }
  ?e cdm:expression_belongs_to_work ?w ;
     cdm:expression_uses_language <http://publications.europa.eu/resource/authority/language/ENG> ;
     cdm:expression_title ?title .
}
ORDER BY ?celex LIMIT ${PAGE_SIZE} OFFSET ${offset}`);

    for (const row of rows) {
      const celex = (row.celex ?? "").toUpperCase();
      const title = (row.title ?? "").replace(/\s+/g, " ").trim();
      if (!celex || !title) continue;
      const held = byCelex.get(celex);
      if (held && held.title.length >= title.length) continue;
      byCelex.set(celex, {
        celex,
        title,
        date: toDate(row.date),
        ecli: row.ecli ?? held?.ecli ?? null,
      });
    }
    if (rows.length < PAGE_SIZE) break;
  }

  return Array.from(byCelex.values());
}
