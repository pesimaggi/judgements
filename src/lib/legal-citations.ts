/**
 * Recognising references to legislation in Icelandic judgment text.
 *
 * Icelandic acts, regulations and court cases are all cited as `N/YYYY`, so
 * the shape alone cannot tell them apart: "lög nr. 91/1991" and "mál nr.
 * 91/1991" are the same token in different company. Only the words in front
 * of the number distinguish them, which is what the patterns here match.
 *
 * Used to keep act and regulation citations out of the case-number extraction
 * that powers "related cases" on the document page — without this, every
 * judgment citing lög nr. 91/1991 (about a third of the corpus) linked to
 * whichever case happens to be numbered 91/1991.
 *
 * The patterns were validated against a 255-judgment sample of the corpus;
 * see docs/phase-0-acts-provisions.md.
 */

/**
 * The "lög" stem in the declined forms judgments actually use, optionally
 * carrying a compound prefix ("hegningarlaga", "einkamálalaga") and up to
 * three preceding words of the act's name ("almennra hegningarlaga").
 */
const ACT_STEM = String.raw`(?:[\p{L}]+\s+){0,3}[\p{L}]*(?:lög|lögum|laga|laganna|lögunum|lögin)`;

/**
 * The act's name may also sit *between* the stem and the number — "laga um
 * meðferð einkamála nr. 91/1991" — which is how roughly one citation in ten
 * is written.
 *
 * The name run stops at the declined forms that introduce a case reference
 * ("máli", "dómi", …) so that a case number trailing an act reference — "laga
 * um meðferð einkamála í máli nr. 415/2018" — is not swallowed along with it.
 * The genitive "mála" is deliberately allowed through, because it appears in
 * act names themselves ("lög um meðferð opinberra mála").
 */
const CASE_WORD = String.raw`(?:m[áa]l(?:i|inu|um|sins)|d[óo]m(?:i|num|ur|s|num))\b`;
const ACT_NAME_TAIL = String.raw`(?:\s+um\s+(?:(?!${CASE_WORD})[\p{L}]+[\s,.-]*){1,8}?)?`;

/**
 * The constitution carries no "lög" stem, and is cited by name with a varying
 * amount of it spelled out: "stjórnarskrárinnar nr. 33/1944", "stjórnarskrár
 * lýðveldisins Íslands nr. 33/1944", "stjórnarskrár íslenska lýðveldisins nr.
 * 33/1944".
 */
const CONSTITUTION = String.raw`stjórnarskr\p{L}*(?:\s+(?!${CASE_WORD})[\p{L}]+){0,3}?`;

/**
 * Regulations, directives and EU instruments — cited the same way, also not
 * cases. Up to two intervening words and an optional parenthetical cover the
 * European forms: "reglugerð Evrópusambandsins nr. 2024/2642", "ákvörðun
 * ráðsins (SSUÖ) 2024/1484". The run is kept short on purpose, so that a case
 * number some distance downstream is not dragged into the match.
 */
const REGULATION_LEAD =
  String.raw`(?:reglugerð\p{L}*|reglur|reglum|reglna|tilskipun\p{L}*|auglýsing\p{L}*|samþykkt\p{L}*|ákvörðun\p{L}*|rg\.)` +
  String.raw`(?:\s+(?!${CASE_WORD})[\p{L}]+){0,2}?(?:\s*\([\p{L}\d ]{1,14}\))?`;

/**
 * "nr." is optional: judgments write "laga nr. 21/1991" and "laga 21/1991"
 * interchangeably, and the abbreviated "l. 46/1980" / "rg. 1165/2016" forms
 * usually drop it altogether.
 */
const NUMBER = String.raw`\s*,?\s*(?:nr\.\s*)?\d{1,4}\s*\/\s*\d{4}`;

/**
 * A citation to a piece of legislation, number included. Matching through the
 * number is deliberate: the span is what gets masked out before case numbers
 * are extracted.
 */
export const LEGISLATION_CITATION_RE = new RegExp(
  [
    String.raw`${ACT_STEM}${ACT_NAME_TAIL}${NUMBER}`,
    String.raw`${CONSTITUTION}${NUMBER}`,
    String.raw`${REGULATION_LEAD}${ACT_NAME_TAIL}${NUMBER}`,
    // Abbreviated forms: "l. nr. 91/1991", "l. 46/1980", "rg. 1165/2016".
    String.raw`\bl\.${NUMBER}`,
  ].join("|"),
  "giu"
);

/**
 * Blanks out legislation citations, preserving length so that offsets into
 * the original text stay valid. Spaces rather than deletion also stops two
 * previously separated numbers from being joined into a new false match.
 */
export function maskLegislationCitations(text: string): string {
  return text.replace(LEGISLATION_CITATION_RE, (m) => " ".repeat(m.length));
}

/**
 * Case numbers as the courts write them: "E-2/24", "12595/2024", "22/2023".
 * Kept in step with the equivalent pattern in lib/query-parser.ts, which
 * recognises the same tokens when a user types one into the search box.
 */
const CASE_NUMBER_RE = /\b([A-Za-zÞÆÖÁÐÉÍÓÚÝþæöáðéíóúý]{1,3}-?\d{1,5}\/\d{2,4}|\d{1,6}\/\d{4})\b/g;

/**
 * Case numbers cited in a judgment's text, in order of first appearance,
 * with legislation citations excluded and `exclude` (normally the judgment's
 * own case number) removed.
 */
export function citedCaseNumbers(text: string, exclude?: string | null): string[] {
  const masked = maskLegislationCitations(text);
  const seen = new Set<string>();
  for (const m of masked.matchAll(CASE_NUMBER_RE)) {
    if (m[1] !== exclude) seen.add(m[1]);
  }
  return Array.from(seen);
}
