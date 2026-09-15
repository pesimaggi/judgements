/**
 * Lagastoð — the statutory basis a regulation states for itself.
 *
 * Every Icelandic regulation says, usually in its last article, which act it
 * is made under and often which articles of it:
 *
 *   "Reglugerð þessi, sem sett er samkvæmt 7., 15. gr. a, 15. gr. b og
 *    20. gr. laga nr. 60/2007 um Vatnajökulsþjóðgarð, öðlast þegar gildi."
 *
 * That sentence is the link between the two corpora this app holds. Extracted,
 * it lets the reader of lög nr. 60/2007 see the regulations made under it —
 * article by article — which is the thing that stops the regulation corpus
 * being a second silo beside the acts.
 *
 * ── Why this is not extractProvisionCitations ──────────────────────────────
 *
 * The general provision extractor in legal-citations.ts requires the article
 * and its act to be adjacent, which is right for judgments and wrong here: a
 * lagastoð clause routinely enumerates several articles that share one
 * trailing "gr." and one act reference. On the sentence above it would find
 * article 20 and miss 7, 15 a and 15 b — three quarters of the answer.
 *
 * ── Why the anchor is so narrow ────────────────────────────────────────────
 *
 * Measured over 84 regulations on 2026-09-15, a window around any act citation
 * near the words "sett", "stoð" or "heimild" produced false positives at a
 * rate that would make the feature a liability rather than a gap:
 *
 *   "…kröfunum sem settar eru fram í 2. tölul. 1. mgr. 82. gr. laga um
 *    fjármálafyrirtæki, nr. 161/2002…"       — a cross-reference, not a basis
 *   "Gjaldskrár … skal sett samkvæmt 17. gr. raforkulaga nr. 65/2003"
 *                                            — a basis, but for the tariff
 *   "…sbr. 47. gr. laga nr. 90/2003, um tekjuskatt."
 *                                            — an ordinary citation
 *
 * All three say "sett" or cite an act near words about authority. What tells
 * the real clause apart is its *subject*: this regulation. So the anchor is
 * the subject — "Reglugerð þessi", "Reglugerðin", "Reglur þessar" — followed
 * closely by "sett". A missed lagastoð is a regulation that shows no enabling
 * act; a false one asserts that an act authorises something it does not.
 */
import { sentenceAround } from "./legal-citations";

export interface LagastodArticle {
  /** 15 in "15. gr. a". */
  number: number;
  /** "a" in "15. gr. a", where the act carries lettered articles. */
  letter: string | null;
  /** As written in the clause — "15. gr. a", or a bare "7." in a list. */
  label: string;
}

export interface LagastodCitation {
  actNumber: number;
  year: number;
  /**
   * The articles of that act named as the basis, in the order written. Empty
   * when the clause names the act alone — "sett með heimild í lögum nr.
   * 100/1992 um vog, mál og faggildingu" — which is common and is a complete
   * statement of basis, not a failed parse.
   */
  articles: LagastodArticle[];
  /** The basis as written, for display: "7., 15. gr. a … laga nr. 60/2007". */
  citationText: string;
  /** The sentence it was found in, for the "why" the UI shows. */
  excerpt: string;
  /** Offset of the act reference in the source text. */
  index: number;
}

/**
 * The subject of a lagastoð clause, followed by the verb.
 *
 * Both orders occur — "Reglugerð þessi er sett…" and "Reglugerð þessi, sem
 * sett er…" — so the run between them is allowed to be anything, and long
 * enough for the subject a municipal byelaw puts in it: "Reglugerð þessi, sem
 * samin er og samþykkt af hreppsnefnd Tálknafjarðarhrepps, staðfestist hér
 * með samkvæmt vatnalögum…". "staðfestist" is that form's verb, and "Reglur
 * þessar eru settar" covers the instruments published as *reglur*.
 */
const ANCHOR_RE =
  /(?:reglugerð(?:in|\s+þessi)|reglur\s+þessar|gjaldskrá\s+þessi)[\s\S]{0,80}?\b(?:sett(?:ar)?|staðfestist|staðfest)\b/giu;

/**
 * An act reference, with as much of its name as is written around the number.
 *
 * Both orders occur and both have to be read: "laga um opinber innkaup nr.
 * 120/2016" puts the name before the number, "laga nr. 87/2004, um olíugjald"
 * after it. Only the number is used; the name is matched so that it is
 * consumed rather than left to be mistaken for the next article run.
 */
const ACT_STEM = String.raw`(?:\p{L}*lög|\p{L}*lögum|\p{L}*laga|\p{L}*laganna)`;
const ACT_NAME = String.raw`(?:\s+um\s+(?:[\p{L}]+[\s,.-]*){1,8}?)?`;

/**
 * Icelandic month names, as much of each as is ever written. Required rather
 * than allowing any word, so that "laga nr. 30 3. gr. 2005" cannot be read as
 * a date.
 */
const MONTH = String.raw`(?:jan|feb|mar|apr|ma[íi]|j[úu]n|j[úu]l|[áa]g[úu]?|sep|okt|n[óo]v|des)\p{L}*`;

const ACT_REF_RE = new RegExp(
  ACT_STEM +
    ACT_NAME +
    String.raw`\s*,?\s*(?:nr\.\s*)?(?:` +
    // Modern: "nr. 60/2007".
    String.raw`(\d{1,3})\s*\/\s*(\d{4})` +
    String.raw`|` +
    // Pre-1990: the act is named by number and date of assent — "laga nr. 49
    // 17. maí 2005", "nr. 32 frá 11. maí 2005", "nr. 69, 28. maí 1984". Nine
    // of the twelve regulations whose basis was missed in the first
    // measurement used this form, and it is the same act: the year of the
    // date is the year of the number.
    String.raw`(\d{1,3})\s*,?\s*(?:frá\s+)?\d{1,2}\.\s*` +
    MONTH +
    String.raw`\.?\s+(\d{4})` +
    String.raw`)`,
  "giu"
);

/**
 * Qualifiers that precede an article and are not one. Stripped before the
 * articles are read, so "4. mgr. 4. gr." yields article 4 rather than
 * articles 4 and 4.
 *
 * The leading run matters: a qualifier is routinely enumerated, and only its
 * last member carries the word. In "3. og 4. mgr. 99. gr. laga nr. 161/2002"
 * the "3." belongs to "mgr." just as much as the "4." does, and blanking only
 * the second left a phantom article 3 on the act.
 */
const QUALIFIER_RE =
  /(?:\d{1,3}\.\s*(?:og|eða|,)\s*)*\d{1,3}\.\s*(?:mgr|tölul|málsl|liður|liðar)\.?/giu;

/**
 * One item in an article run: a number, optionally with "gr." and a letter.
 *
 * The bare form is what makes an enumeration work — in "7., 15. gr. a … og
 * 20. gr." only the last item carries "gr.", and the rest inherit it.
 */
const ARTICLE_ITEM_RE = /(\d{1,3})\.(?:\s*gr\.)?(?:\s*([a-záðéíóúýþæö])\.?(?![\p{L}]))?/giu;

/** Abbreviations that end in a period without ending a sentence. */
const ABBREVIATIONS = new Set([
  "gr", "mgr", "nr", "sbr", "tölul", "málsl", "skv", "o.fl", "m.a", "þ.e",
  "þ.á.m", "s.s", "sk", "ath",
]);

/** Where the sentence starting at `from` ends. */
function sentenceEnd(text: string, from: number, maxChars = 600): number {
  const limit = Math.min(text.length, from + maxChars);
  for (let i = from; i < limit; i++) {
    if (text[i] !== ".") continue;
    const before = text.slice(Math.max(0, i - 12), i);
    // "175." is an ordinal inside a citation, not a sentence end.
    if (/\d$/.test(before)) continue;
    const word = /([\p{L}.]+)$/u.exec(before)?.[1]?.toLowerCase();
    if (word && ABBREVIATIONS.has(word)) continue;
    // A single letter before the period is an article suffix — "59. gr. a." —
    // not the end of a sentence. Without this the clause is cut between the
    // article and the act it belongs to, which is the whole citation.
    if (word && word.length === 1) continue;
    if (/^\s/.test(text.slice(i + 1, i + 2))) return i + 1;
  }
  return limit;
}

/**
 * The articles named in the run of text leading up to an act reference.
 *
 * A run has to contain "gr." somewhere for anything to be read from it: that
 * is what says the numbers in it are articles at all. Without the test,
 * "sett með heimild í lögum nr. 100/1992" contributes nothing — correctly —
 * but a clause mentioning a year or a count would contribute a spurious
 * article number.
 */
export function articlesInRun(run: string): LagastodArticle[] {
  if (!/\bgr\./i.test(run)) return [];
  // Qualifiers are blanked rather than removed, so that what remains keeps
  // its spacing and two adjacent numbers cannot be joined into a third.
  const cleaned = run.replace(QUALIFIER_RE, (m) => " ".repeat(m.length));
  const out: LagastodArticle[] = [];
  const seen = new Set<string>();
  for (const m of cleaned.matchAll(ARTICLE_ITEM_RE)) {
    const letter = m[2] ? m[2].toLowerCase() : null;
    const key = `${m[1]}|${letter ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ number: Number(m[1]), letter, label: m[0].trim() });
  }
  return out;
}

/**
 * Every statutory basis a regulation's text states for itself.
 *
 * More than one is normal: "sem sett er samkvæmt 4. gr. hafnalaga nr. 61/2003
 * og 17. gr. laga nr. 41/2003 um siglingavernd" is two acts, each with its own
 * article, and both are the basis. Each act reference therefore takes the run
 * of text since the previous one, which is what keeps article 4 with the
 * harbours act and article 17 with the maritime security act instead of
 * giving both to whichever came last.
 */
export function extractLagastod(text: string): LagastodCitation[] {
  const out: LagastodCitation[] = [];
  const seen = new Set<string>();

  ANCHOR_RE.lastIndex = 0;
  for (const anchor of text.matchAll(ANCHOR_RE)) {
    const clauseStart = anchor.index + anchor[0].length;
    const clauseEnd = sentenceEnd(text, clauseStart);
    const clause = text.slice(clauseStart, clauseEnd);

    let runStart = 0;
    ACT_REF_RE.lastIndex = 0;
    for (const act of clause.matchAll(ACT_REF_RE)) {
      // One branch or the other matched: "nr. 60/2007" fills the first pair,
      // "nr. 49 17. maí 2005" the second.
      const actNumber = Number(act[1] ?? act[3]);
      const year = Number(act[2] ?? act[4]);
      const run = clause.slice(runStart, act.index);
      runStart = act.index + act[0].length;

      const key = `${actNumber}/${year}`;
      // The same basis is often stated twice — once in a heading article and
      // once in the gildistaka article. One link, from the first statement.
      if (seen.has(key)) continue;
      seen.add(key);

      const articles = articlesInRun(run);
      const index = clauseStart + act.index;
      out.push({
        actNumber,
        year,
        articles,
        // Composed from what was actually attributed to this act, not sliced
        // out of the clause. Where several acts are named in one sentence the
        // run before each one opens with the *previous* act's trailing name —
        // "…, um matvæli, 29. gr. laga nr. 25/1993" — and slicing it printed a
        // citation pairing one act's name with another's number.
        citationText: [articles.map((a) => a.label).join(", "), act[0].trim()]
          .filter(Boolean)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim(),
        excerpt: sentenceAround(text, index),
        index,
      });
    }
  }
  return out;
}
