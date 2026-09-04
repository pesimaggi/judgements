/**
 * The Court of Justice of the European Union, as EUR-Lex publishes it.
 *
 * WHY IT IS HERE. The EEA Agreement is interpreted homogeneously with EU law:
 * the EFTA Court follows the Court of Justice, Icelandic courts follow both,
 * and a directive incorporated into the Agreement means in Iceland what the
 * Court of Justice says it means. A library that carries the directives and
 * the EFTA Court's judgments but not the Court of Justice's is missing the
 * half everything else defers to.
 *
 * WHAT A CELEX SAYS ABOUT A JUDGMENT. Case law is sector 6, and the two
 * letters after the year name the court and the instrument:
 *
 *   62015CJ0203  Court of Justice, judgment      → Case C-203/15
 *   62015TJ0203  General Court, judgment         → Case T-203/15
 *   62015CO0203  Court of Justice, order
 *   62015CC0203  Advocate General's opinion
 *
 * Only judgments are ingested (`CJ`, `TJ`): an order is procedural and an
 * opinion is not the Court speaking. The case number is derived from the
 * CELEX rather than parsed out of prose, because the CELEX is the one place it
 * is stated unambiguously — and the title's own statement of it is sometimes
 * "Joined Cases C-203/15 and C-698/15", which is two.
 */

/** Which court a sector-6 CELEX belongs to, by its instrument letters. */
export const CJEU_COURTS = {
  CJ: {
    /** Source key in src/lib/sources.ts. */
    source: "cjeu",
    name: "Dómstóll Evrópusambandsins (Court of Justice)",
    /** The letter a case number opens with: C-203/15. */
    caseLetter: "C",
  },
  TJ: {
    source: "eu-general-court",
    name: "Almenni dómstóll ESB (General Court)",
    caseLetter: "T",
  },
} as const;

export type CjeuLetters = keyof typeof CJEU_COURTS;

export interface ParsedCaseCelex {
  celex: string;
  year: number;
  letters: CjeuLetters;
  /** 203 in "62015CJ0203". */
  number: number;
  /** "C-203/15" — the case as it is cited. */
  caseNumber: string;
  source: string;
  court: string;
}

const CASE_CELEX_RE = /^6(\d{4})(CJ|TJ)(\d{4})$/;

/**
 * Reads a sector-6 CELEX for a judgment of one of the two courts.
 *
 * Everything else is rejected, including the orders and opinions that share
 * the sector, and including the Civil Service Tribunal's `FJ` — a court that
 * was wound up in 2016 and whose staff-case law nobody researches from here.
 *
 * The case number is composed the way the Court cites it: the year's last two
 * digits, and the sequence number without its leading zeros. "62015CJ0203"
 * is Case C-203/15, which is what a reader will search for.
 */
export function parseCaseCelex(raw: string): ParsedCaseCelex | null {
  const celex = raw.trim().toUpperCase();
  const m = CASE_CELEX_RE.exec(celex);
  if (!m) return null;
  const year = Number(m[1]);
  const letters = m[2] as CjeuLetters;
  const number = Number(m[3]);
  const court = CJEU_COURTS[letters];
  return {
    celex,
    year,
    letters,
    number,
    caseNumber: `${court.caseLetter}-${number}/${String(year).slice(-2)}`,
    source: court.source,
    court: court.name,
  };
}

export interface ParsedCaseTitle {
  /** "Tele2 Sverige AB v Post- och telestyrelsen and Secretary of State …" */
  parties: string | null;
  /** The national court that referred the question, where one did. */
  referredBy: string | null;
  /** The Court's own index terms, split off the keyword run. */
  keywords: string[];
  /** "Joined Cases C-203/15 and C-698/15" — as the title states it. */
  casesAsStated: string | null;
  /** "Judgment of the Court (Grand Chamber) of 21 December 2016" */
  heading: string | null;
}

/**
 * Splits the title EUR-Lex gives a judgment into its parts.
 *
 * The title is five fields with `#` between them, and it is the only place
 * some of them are stated:
 *
 *   Judgment of the Court (Grand Chamber) of 21 December 2016.
 *   #Tele2 Sverige AB v Post- och telestyrelsen and Secretary of State …
 *   #Requests for a preliminary ruling from the Kammarrätten i Stockholm …
 *   #Reference for a preliminary ruling — Electronic communications — …
 *   #Joined Cases C-203/15 and C-698/15.
 *
 * Not every judgment has all five: a direct action has no referring court, and
 * the older judgments often carry only a heading and the parties. So the parts
 * are recognised by shape rather than by position — the referring court's
 * segment says so, the keyword run is the one with the em dashes, and the case
 * segment names a case — and anything unrecognised is left out rather than
 * guessed at.
 *
 * The keywords are the Court's own index terms and become subject tags, which
 * is what makes a judgment findable by what it is about rather than only by
 * the words in it.
 */
export function parseCaseTitle(title: string): ParsedCaseTitle {
  const segments = title
    .split("#")
    .map((part) => part.replace(/\s+/g, " ").trim().replace(/\.$/, ""))
    .filter(Boolean);

  const parsed: ParsedCaseTitle = {
    parties: null,
    referredBy: null,
    keywords: [],
    casesAsStated: null,
    heading: null,
  };

  for (const segment of segments) {
    if (!parsed.heading && /^(Judgment|Order|Opinion|Arrêt)\b/i.test(segment)) {
      parsed.heading = segment;
      continue;
    }
    if (!parsed.casesAsStated && /^(Joined )?Cases?\s+[CTF]-\d/i.test(segment)) {
      parsed.casesAsStated = segment;
      continue;
    }
    if (!parsed.referredBy && /^(Request|Reference)s? for a preliminary ruling from\b/i.test(segment)) {
      parsed.referredBy = segment;
      continue;
    }
    // The keyword run is the one built out of dash-separated terms. Both
    // dashes, because EUR-Lex uses the em dash in some years and the en dash
    // in others — the 2016 judgments use "—" and the 2026 ones "–", and
    // matching only one silently drops every index term of half the corpus.
    // Two or more of them, because a party's name can contain one; the plain
    // hyphen is never a separator here ("Post- och telestyrelsen").
    if (parsed.keywords.length === 0 && (segment.match(/[—–]/g) ?? []).length >= 2) {
      parsed.keywords = segment
        .split(/[—–]/)
        .map((term) => term.trim())
        .filter((term) => term.length > 1 && term.length <= 80);
      continue;
    }
    if (!parsed.parties) parsed.parties = segment;
  }

  return parsed;
}

/** The judgment's page on EUR-Lex — where a reader is sent. */
export function caseLawUrl(celex: string): string {
  return `https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:${encodeURIComponent(celex)}`;
}

/**
 * The title this app stores: the case number, then who it was between.
 *
 * EUR-Lex's own title opens with "Judgment of the Court (Grand Chamber) of 21
 * December 2016", which is true of thousands of judgments and identifies none
 * of them. What a reader scans a result list for is the case number and the
 * parties, in that order.
 */
export function composeCaseTitle(caseNumber: string, parsed: ParsedCaseTitle): string {
  const parties = parsed.parties?.trim();
  return parties ? `${caseNumber} — ${parties}` : caseNumber;
}
