/**
 * References to EU acts, extracted from the text of a decision of the EEA
 * Joint Committee.
 *
 * WHY. An act being marked "(Text with EEA relevance)" is the Commission's
 * view that it *ought* to be taken into the EEA Agreement. What actually takes
 * it in is a decision of the Joint Committee, and the app already holds those
 * decisions in full. So the acts a JCD names are the acts that were actually
 * incorporated — a fact this database can establish from what it already
 * stores, without going back to EEA-Lex, and the one that matters most to a
 * reader in Reykjavík: an EU act incorporated into the EEA Agreement is part
 * of the law Iceland has undertaken to apply.
 *
 * It also fills the gap the marker leaves. The relevance line only became
 * standard practice in the 1990s, so a directive of 1989 that the EEA
 * Agreement carries from the start states nothing at all — and a search
 * limited to marked acts would silently miss it.
 *
 * WHAT A JCD LOOKS LIKE. Every one of them amends an Annex by inserting or
 * replacing a point, and prints the act it is inserting in the Official
 * Journal's own two-part form — the CELEX-like reference, then the citation:
 *
 *   "The following point shall be inserted after point 5e of Annex XI:
 *    '5f. 32016 R 0679: Regulation (EU) 2016/679 of the European Parliament
 *    and of the Council of 27 April 2016 on the protection of natural
 *    persons … (OJ L 119, 4.5.2016, p. 1).'"
 *
 * Both halves are read, because neither is always present: the older
 * decisions often carry only the citation, and an act named in passing
 * ("as amended by Regulation (EU) No 517/2014") carries no CELEX either.
 */

/** One reference to an EU act, as written. */
export interface EuActRef {
  /** "R" | "L" | "D" — regulation, directive, decision. */
  letter: "R" | "L" | "D";
  /** The year in the reference. */
  year: number;
  /** The number in the reference, as cited. */
  number: number;
  /**
   * The CELEX the reference states outright, where it states one. A citation
   * alone does not give one: the CELEX sequence number is not always the
   * number an act is cited by (CELEX 32016D0002 is cited "Decision (EU)
   * 2016/245"), so it cannot be composed from a citation without guessing.
   */
  celex: string | null;
}

/**
 * The OJ's reference form: "32016 R 0679", "31989 L 0665", or unspaced.
 * Sector 3 only — sector 2 is the Joint Committee's own decisions, and a JCD
 * amending an earlier JCD must not be read as incorporating an act.
 */
const CELEX_REF_RE = /\b3(\d{4})\s?([RLD])\s?(\d{4})\b/g;

/**
 * The citation form. The kind carries the adopting body where the text gives
 * one ("Commission Implementing Regulation (EU) 2015/2447"), so only the last
 * word of the kind is matched; the treaty family in brackets is optional
 * because a directive's is printed at the end instead ("Directive
 * 2000/31/EC").
 */
const CITATION_RE =
  /\b(Regulation|Directive|Decision)\s+(?:\((?:EU|EC|EEC|Euratom)[^)]*\)\s*)?(?:No\.?\s*)?(\d{1,4})\/(\d{1,4})(\/(?:EU|EC|EEC|Euratom))?/gi;

const LETTER_FOR = { regulation: "R", directive: "L", decision: "D" } as const;

/**
 * Reads "N/M" the way the Official Journal writes it.
 *
 * Both orders are in use and both are still cited daily: a regulation used to
 * be numbered "No 1/2003" (number first) and a directive "2000/31/EC" (year
 * first), and since 2015 everything is "2016/679" — year first. A four-digit
 * number in the plausible range of years is therefore read as the year, in
 * whichever half it appears.
 */
function readNumberPair(
  first: number,
  second: number,
  trailingFamily: boolean
): { year: number; number: number } | null {
  const isYear = (n: number) => n >= 1952 && n <= 2099;
  if (isYear(first) && !isYear(second)) return { year: first, number: second };
  if (isYear(second)) return { year: second, number: first };
  // "Directive 95/46/EC", "Directive 89/665/EEC": the year is written with two
  // digits and the treaty family trails the whole citation, which is the form
  // that says the year comes first. 52 is the EEC's founding year and the
  // point either side of which a two-digit year can only mean one century.
  if (trailingFamily && first < 100) {
    return { year: first >= 52 ? 1900 + first : 2000 + first, number: second };
  }
  return null;
}

/**
 * Every EU act referred to in one decision's text, de-duplicated.
 *
 * Deliberately permissive about *which* references it returns: an act named
 * only as the one being amended is still an act the EEA Agreement carries, so
 * there is no attempt here to tell the subject of the decision from its
 * context. What keeps that honest is the other side of the match — a
 * reference is only ever recorded against an act this database already holds,
 * so a mis-read reference resolves to nothing rather than to the wrong act.
 */
export function extractEuActRefs(text: string): EuActRef[] {
  const byKey = new Map<string, EuActRef>();
  const add = (ref: EuActRef) => {
    const key = ref.celex ?? `${ref.letter}:${ref.year}:${ref.number}`;
    if (!byKey.has(key)) byKey.set(key, ref);
  };

  for (const m of text.matchAll(CELEX_REF_RE)) {
    const letter = m[2].toUpperCase() as EuActRef["letter"];
    add({
      letter,
      year: Number(m[1]),
      number: Number(m[3]),
      celex: `3${m[1]}${letter}${m[3]}`,
    });
  }

  // The CELEX references are read first, so a citation that repeats one of
  // them — which is how the OJ writes an annex point, reference then citation
  // — adds nothing. Without this the same act comes back twice, once under
  // each key, and would be counted twice everywhere the refs are used.
  const named = new Set(
    Array.from(byKey.values(), (ref) => `${ref.letter}:${ref.year}:${ref.number}`)
  );
  for (const m of text.matchAll(CITATION_RE)) {
    const letter = LETTER_FOR[m[1].toLowerCase() as keyof typeof LETTER_FOR];
    const pair = readNumberPair(Number(m[2]), Number(m[3]), Boolean(m[4]));
    if (!pair) continue;
    if (named.has(`${letter}:${pair.year}:${pair.number}`)) continue;
    add({ letter, year: pair.year, number: pair.number, celex: null });
  }

  return Array.from(byKey.values());
}

/**
 * The keys one reference can match a stored act on.
 *
 * An act is looked up by CELEX where the reference gives one, and otherwise
 * by family, year and number — which has to be tried against both numbers an
 * act carries, because the number an act is cited by and the number in its
 * CELEX are the same for almost every act and different for a few.
 */
export function refLookupKeys(ref: EuActRef): string[] {
  const keys = [`${ref.letter}:${ref.year}:${ref.number}`];
  if (ref.celex) keys.unshift(ref.celex);
  return keys;
}

/**
 * The decision's own number — "154/2018" — read off its title.
 *
 * A JCD carries two numbers and only this one is ever cited: EUR-Lex files
 * the decision by its place in the Official Journal ("22018D1022"), and the
 * title is the only place the Committee's own numbering appears.
 *
 * The shape of the rule is set by what the corpus actually contains, measured
 * over all 6,784 decisions EUR-Lex lists:
 *
 *  - "Decision" must be singular. The plural opens the "Decisions of the EEA
 *    Joint Committee for which the constitutional requirements … have been
 *    fulfilled" notices, which are announcements *about* decisions and carry
 *    no number of their own — reading one as a decision would file a notice
 *    under a real decision's number.
 *  - The Committee's name is skipped over rather than matched, because
 *    EUR-Lex misspells it: "Decision of the EEA joint committe No 139/2006"
 *    and "the EEA joJint Committee No 254/2021" are both real, and both are
 *    real decisions that a stricter rule silently drops.
 *  - The number may be preceded by an Official Journal filing prefix
 *    ("2004/69/: Decision of the EEA Joint Committee No 69/2004 …"), so the
 *    match is not anchored to the start of the title.
 */
const DECISION_NUMBER_RE =
  /\bDecision(?!s)\b[^.]{0,60}?\bNo\.?\s*(\d{1,3}\s*\/\s*\d{2,4})/i;

export function decisionNumberFromTitle(title: string): string | null {
  const number = DECISION_NUMBER_RE.exec(title)?.[1];
  return number ? number.replace(/\s+/g, "") : null;
}

/**
 * Orders decision numbers the way the Committee adopted them: by year, then
 * by number within the year.
 *
 * Sorting them as strings puts "120/2006" before "91/2000", which reads as
 * nonsense wherever a list of them is printed — the numbering restarts every
 * year and the year is the second half. The early decisions are numbered with
 * a two-digit year ("7/94"), so the year is expanded before comparing.
 */
export function compareDecisionNumbers(a: string, b: string): number {
  const parse = (value: string): [number, number] => {
    const m = /^(\d{1,3})\/(\d{2,4})$/.exec(value);
    if (!m) return [Number.MAX_SAFE_INTEGER, 0];
    const raw = Number(m[2]);
    const year = m[2].length === 4 ? raw : raw >= 90 ? 1900 + raw : 2000 + raw;
    return [year, Number(m[1])];
  };
  const [yearA, numberA] = parse(a);
  const [yearB, numberB] = parse(b);
  return yearA - yearB || numberA - numberB || a.localeCompare(b);
}
