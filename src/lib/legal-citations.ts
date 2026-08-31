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

// ---------------------------------------------------------------------------
// Extraction — the deterministic pass the citation job runs over the corpus.
// ---------------------------------------------------------------------------

/**
 * Replaces the non-breaking space variants Lagasafn and the courts' PDFs are
 * full of, one character for one character so that every offset produced by
 * the patterns below still indexes into the caller's original text.
 */
export function normalizeSpacesPreservingOffsets(text: string): string {
  return text.replace(/[   ]/g, " ");
}

/** An act reference: "lög nr. 91/1991", "almennra hegningarlaga nr. 19/1940". */
export interface ActCitation {
  actNumber: number;
  year: number;
  /** Offset of the whole citation in the source text. */
  index: number;
  length: number;
  /**
   * The compound short name used, lowercased ("hegningarlaga"), where the
   * citation used one rather than a bare "laga". This is where Act.aliases
   * comes from — acts are cited by names their official titles do not
   * contain ("vaxtalaga" for "Lög um vexti og verðtryggingu").
   */
  alias: string | null;
}

/** A provision reference: "1. mgr. 175. gr. laga nr. 91/1991". */
export interface ProvisionCitation extends ActCitation {
  articleNumber: number;
  articleLetter: string | null;
  paragraphNumber: number | null;
  pointNumber: number | null;
  /** The citation exactly as written. */
  text: string;
}

/**
 * "N. gr." with an optional single-letter suffix that stands as its own word.
 *
 * The suffix may carry its own period — Lagasafn prints the article as "7. gr.
 * a." and judgments cite it the same way, which is the *usual* form rather
 * than an edge case. It is consumed here so that the act reference following
 * it is still adjacent; without that, every lettered provision cited in the
 * ordinary way failed to extract and no case was ever linked to one.
 *
 * The letter still has to stand as its own word. `(?![\p{L}])` is what stops
 * "57. gr. laga nr. 46/1980" reading as article 57 letter "l": the period is
 * optional, so on that input the guard sees the "a" of "laga" and the whole
 * suffix group backtracks away.
 */
const ARTICLE = String.raw`(\d+)\.\s*gr\.(?:\s*([a-záðéíóúýþæö])\.?(?![\p{L}]))?`;
/** The qualifiers that may precede it, outermost first. */
const ARTICLE_PREFIX =
  String.raw`(?:(\d+)\.\s*tölul\.\s*)?(?:(\d+)\.\s*málsl\.\s*)?(?:(\d+)\.\s*mgr\.\s*)?`;

const ACT_CITATION_RE = new RegExp(
  String.raw`(?:^|[^\p{L}])(${ACT_STEM}|l\.)${ACT_NAME_TAIL}\s*,?\s*(?:nr\.\s*)?(\d{1,3})\s*\/\s*(\d{4})`,
  "giu"
);

/**
 * A provision reference immediately followed by the act it belongs to. This
 * is the high-precision case: article and act are adjacent, so no inference
 * is involved.
 */
const PROVISION_CITATION_RE = new RegExp(
  String.raw`${ARTICLE_PREFIX}${ARTICLE}\s*,?\s*(?:sbr\.\s*)?` +
    String.raw`(?:${ACT_STEM}|l\.)${ACT_NAME_TAIL}\s*,?\s*(?:nr\.\s*)?(\d{1,3})\s*\/\s*(\d{4})`,
  "giu"
);

/** The word carrying the "lög" stem, for alias harvesting. */
function aliasFrom(stem: string): string | null {
  const word = stem.trim().toLowerCase().split(/\s+/).pop() ?? "";
  // A bare "laga"/"lögum"/"l." names no act and is useless as an alias.
  if (/^(lög|lögum|laga|laganna|lögunum|lögin|l\.)$/.test(word)) return null;
  return /(?:lög|lögum|laga|laganna|lögunum|lögin)$/.test(word) ? word : null;
}

/** Every act reference in the text, in document order. */
export function extractActCitations(text: string): ActCitation[] {
  const out: ActCitation[] = [];
  for (const m of text.matchAll(ACT_CITATION_RE)) {
    // The leading [^\p{L}] guard is part of the match; skip past it so the
    // offset points at the citation itself.
    const lead = m[0].length - m[0].trimStart().length;
    const offset = m.index + (m[0].startsWith(m[1]) ? 0 : 1) + lead;
    out.push({
      actNumber: Number(m[2]),
      year: Number(m[3]),
      index: offset,
      length: m[0].length,
      alias: aliasFrom(m[1]),
    });
  }
  return out;
}

/** Every provision reference that names its own act, in document order. */
export function extractProvisionCitations(text: string): ProvisionCitation[] {
  const out: ProvisionCitation[] = [];
  for (const m of text.matchAll(PROVISION_CITATION_RE)) {
    out.push({
      pointNumber: m[1] ? Number(m[1]) : null,
      paragraphNumber: m[3] ? Number(m[3]) : null,
      articleNumber: Number(m[4]),
      articleLetter: m[5] ? m[5].toLowerCase() : null,
      actNumber: Number(m[6]),
      year: Number(m[7]),
      index: m.index,
      length: m[0].length,
      alias: null,
      // Judgment text wraps mid-citation often enough that the raw match
      // carries line breaks; the stored citation is display copy, so it is
      // collapsed to one line. Offsets are unaffected — they index the source.
      text: m[0].replace(/\s+/g, " ").trim(),
    });
  }
  return out;
}

/**
 * Abbreviations that end in a period without ending a sentence. Without these
 * an excerpt cut at the first ". " lands mid-citation — "1. mgr. 175. gr.
 * laga nr." — which is precisely the passage the excerpt exists to show.
 */
const ABBREVIATIONS = new Set([
  "gr", "mgr", "nr", "sbr", "tölul", "málsl", "skv", "bls", "kt", "dags",
  "o.fl", "m.a", "þ.e", "þ.á.m", "s.s", "hf", "ehf", "ohf", "sf", "slf",
  "millj", "þús", "kr", "sk", "tbl", "árg", "útg", "ath", "jan", "feb",
  "mars", "apr", "maí", "júní", "júlí", "ág", "sept", "okt", "nóv", "des",
]);

/** Whether the period at `i` genuinely ends a sentence. */
function isSentenceEnd(text: string, i: number): boolean {
  if (text[i] !== ".") return false;
  const before = text.slice(Math.max(0, i - 12), i);
  const word = /([\p{L}.]+)$/u.exec(before)?.[1]?.toLowerCase();
  if (word && ABBREVIATIONS.has(word)) return false;
  // "1." / "175." are ordinals inside a citation, not sentence ends.
  if (/\d$/.test(before)) return false;
  const after = text.slice(i + 1, i + 3);
  return /^\s/.test(after);
}

/**
 * The sentence containing `index`, for the "why did this case match" excerpt.
 * Bounded so that a judgment without usable punctuation cannot yield a
 * paragraph-long excerpt.
 */
export function sentenceAround(text: string, index: number, maxChars = 400): string {
  let start = index;
  const floor = Math.max(0, index - maxChars);
  while (start > floor) {
    if (isSentenceEnd(text, start - 1)) break;
    start--;
  }
  let end = index;
  const ceil = Math.min(text.length, index + maxChars);
  while (end < ceil) {
    if (isSentenceEnd(text, end)) {
      end++;
      break;
    }
    end++;
  }
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}
