/**
 * The founding treaties, as a hand-written registry.
 *
 * Three instruments, and they are a corpus of their own — `jurisdiction =
 * "treaty"` — for the reason the EU acts are one: a question about Icelandic law
 * runs into them constantly, and they are neither lög nor gerðir. The EEA
 * Agreement is the one an Icelandic reader needs most: its main text has
 * lagagildi here (2. gr. laga nr. 2/1993), so it is not foreign law at all.
 *
 * WHY A REGISTRY AND NOT A SWEEP. There are three of them, they change once a
 * decade, and everything about how each is named, cited and declined is a fact
 * about that treaty rather than something derivable from its text. The EU act
 * corpus is 33,000 rows and has to be swept; this is a list, in the spirit of
 * `adr-boards.ts` and `cjeu-priority.ts`.
 *
 * WHY THE NUMBER AND YEAR ARE NOT A CITATION. `Act.actNumber` and `Act.year` are
 * not nullable, and a treaty has no number: nobody has ever written "lög nr.
 * 2/1957" meaning the TFEU. So `ordinal` fills the number, is never displayed,
 * and exists only to satisfy the table's uniqueness constraint —
 * `actCitation()` in acts.ts reads `citation` for a treaty and never composes
 * one. `year` is the year the instrument was *signed*, not the year of the
 * consolidated text we store, so that a new consolidation in the Official
 * Journal does not change a row's identity or break its URL. Which
 * consolidation the stored text came from is `Act.textCelex`, as it is for a
 * consolidated EU act.
 *
 * WHAT "ICELANDIC" MEANS HERE, TWICE OVER. `titleIs` is what to call the
 * instrument in an Icelandic interface, and every treaty has one.
 * `icelandicText` is where an *authentic Icelandic text* comes from, and only
 * the EEA Agreement has one — Article 129 of the Agreement makes every language
 * version equally authentic, and Alþingi prints the Icelandic one. Iceland is
 * not a party to the TEU or the TFEU, so any Icelandic version of those is
 * somebody's translation and this app does not hold one. The distinction is the
 * whole of the language question: the reader offers ÍSL/ENG where there are two
 * authentic texts, and English alone where there is one.
 */

/** Where an authentic Icelandic text of a treaty is published. */
export type IcelandicTextSource = {
  /**
   * "lagasafn-annex" — printed as a fylgiskjal to an Icelandic act, which is
   * how a treaty given lagagildi is published here. The act is the legal basis
   * and the text is maintained with the codex, so it is both the authoritative
   * Icelandic text and the one we already fetch daily.
   */
  kind: "lagasafn-annex";
  /** The act it is annexed to: lög nr. 2/1993. */
  actNumber: number;
  year: number;
  /**
   * Which fylgiskjal, as Lagasafn labels it. Roman, because Lagasafn numbers
   * them "Fylgiskjal I.", and matched against the division labels the Lagasafn
   * parser builds.
   */
  annex: string;
  /**
   * The article of that act which gives the treaty the force of law — 2. gr. of
   * lög nr. 2/1993 for the EEA Agreement.
   *
   * The one thing an Icelandic reader most needs to know about a treaty on this
   * page, and the reason the Agreement is not foreign law: it is stated here so
   * the reader can say it with a link rather than leaving the reader to wonder
   * what an international agreement is doing in a library of Icelandic law.
   */
  forceOfLawArticle: string;
};

export interface TreatyDef {
  /** URL slug, registry key and `Act.textGroup`: "ees", "teu", "tfeu". */
  slug: string;
  /** Fills `Act.actNumber`. Never displayed. See the header. */
  ordinal: number;
  /** Year of signature. Fills `Act.year`. Never displayed. */
  year: number;
  /** What to call it in Icelandic. Every treaty has one. */
  titleIs: string;
  /** Its own name, in English. */
  titleEn: string;
  /** How it is cited in Icelandic prose: "EES-samningurinn". */
  citationIs: string;
  /** How it is cited in English: "TFEU". */
  citationEn: string;
  /**
   * What follows an article number in an English citation: "Article 28 EEA",
   * "Article 101 TFEU". Not the same string as `citationEn` for the Agreement,
   * whose name is "EEA Agreement" and whose article citations say "EEA".
   */
  articleSuffixEn: string;
  /**
   * The genitive, for "28. gr. EES-samningsins".
   *
   * Stored rather than derived because Icelandic declension is not a suffix
   * rule, and a provision label is the one place in this app where getting it
   * wrong is visible in every citation.
   */
  genitiveIs: string;
  /**
   * Short names a reader might type, and the citation job might meet. Both
   * languages, because the corpus is both: an Icelandic judgment writes
   * "EES-samningurinn" and an EFTA Court judgment writes "the EEA Agreement".
   */
  aliases: string[];
  /** CELEX of the English text, as Cellar serves it. */
  celexEn: string;
  /** Where the authentic Icelandic text comes from, or null if there is none. */
  icelandicText: IcelandicTextSource | null;
  /**
   * The instrument as a citation names it, after an article number. Regex
   * source, matched case-insensitively, longest first — see
   * treatyArticlePatterns() in legal-citations.ts.
   *
   * Inflected forms are listed out. Icelandic citations decline the instrument
   * ("samkvæmt 31. gr. EES-samningsins", "í EES-samningnum"), and a pattern that
   * only knows the nominative silently links nothing — which is the failure mode
   * this corpus punishes, because a missing link looks exactly like an article
   * nobody has ever cited.
   */
  citedAs: { is: string[]; en: string[] };
  /**
   * The instrument named on its own, with no article — what makes "úrlausnir
   * sem vísa til EES-samningsins" countable.
   *
   * A separate list from `citedAs`, and shorter, because a name that is safe
   * after an article number is not safe by itself. "Article 34 EEA" can only
   * mean the Agreement; a bare "EEA" means the area, the States, EEA law and the
   * Agreement by turns, and in an EFTA Court judgment it appears on every page.
   * Linking on that would say every judgment in the corpus cites the Agreement,
   * which is worse than saying none does: the first is believed.
   */
  mentionedAs: string[];
}

/**
 * The treaties, in the order the catalogue should list them: the one that is
 * Icelandic law first.
 */
export const TREATIES: TreatyDef[] = [
  {
    slug: "ees",
    ordinal: 1,
    // Signed at Porto on 2 May 1992; in force for Iceland from 1 January 1994.
    year: 1992,
    titleIs: "Samningur um Evrópska efnahagssvæðið",
    titleEn: "Agreement on the European Economic Area",
    citationIs: "EES-samningurinn",
    citationEn: "EEA Agreement",
    articleSuffixEn: "EEA",
    genitiveIs: "EES-samningsins",
    aliases: [
      "EES-samningurinn",
      "EES-samningur",
      "EES",
      "EEA Agreement",
      "EEA",
      "Samningur um Evrópska efnahagssvæðið",
    ],
    celexEn: "21994A0103(01)",
    // 2. gr. laga nr. 2/1993: "Meginmál EES-samningsins skal hafa lagagildi hér
    // á landi. […] eru prentuð sem fylgiskjöl I–IV með lögum þessum."
    icelandicText: {
      kind: "lagasafn-annex",
      actNumber: 2,
      year: 1993,
      annex: "I",
      forceOfLawArticle: "2. gr.",
    },
    citedAs: {
      is: [
        "EES-samningsins",
        "EES-samningnum",
        "EES-samningsins um Evrópska efnahagssvæðið",
        "samningsins um Evrópska efnahagssvæðið",
        "samningnum um Evrópska efnahagssvæðið",
      ],
      en: ["EEA", "of the EEA Agreement", "EEA Agreement"],
    },
    mentionedAs: [
      "EES-samningurinn",
      "EES-samningsins",
      "EES-samningnum",
      "EES-samningi",
      "EES-samninginn",
      "samningurinn um Evrópska efnahagssvæðið",
      "samningsins um Evrópska efnahagssvæðið",
      "samningnum um Evrópska efnahagssvæðið",
      "samninginn um Evrópska efnahagssvæðið",
      "EEA Agreement",
      "Agreement on the European Economic Area",
    ],
  },
  {
    slug: "teu",
    ordinal: 2,
    // Maastricht, 7 February 1992. The text stored is the 2016 consolidation.
    year: 1992,
    titleIs: "Sáttmálinn um Evrópusambandið",
    titleEn: "Treaty on European Union",
    citationIs: "sáttmálinn um Evrópusambandið",
    citationEn: "TEU",
    articleSuffixEn: "TEU",
    genitiveIs: "sáttmálans um Evrópusambandið",
    aliases: [
      "TEU",
      "Treaty on European Union",
      "Sáttmálinn um Evrópusambandið",
      "Maastricht",
    ],
    celexEn: "12016M/TXT",
    icelandicText: null,
    citedAs: {
      is: ["sáttmálans um Evrópusambandið", "Evrópusambandssáttmálans"],
      en: ["TEU", "of the TEU", "of the Treaty on European Union", "EU Treaty"],
    },
    mentionedAs: [
      "TEU",
      "Treaty on European Union",
      "sáttmálinn um Evrópusambandið",
      "sáttmálans um Evrópusambandið",
      "sáttmálanum um Evrópusambandið",
    ],
  },
  {
    slug: "tfeu",
    ordinal: 3,
    // Rome, 25 March 1957 — the EEC Treaty, which is the instrument Lisbon
    // renamed and renumbered rather than replaced. The stored text is the 2016
    // consolidation, and its articles carry their pre-Lisbon numbers as
    // headings: "(ex Article 86 TEC)".
    year: 1957,
    titleIs: "Sáttmálinn um starfshætti Evrópusambandsins",
    titleEn: "Treaty on the Functioning of the European Union",
    citationIs: "sáttmálinn um starfshætti Evrópusambandsins",
    citationEn: "TFEU",
    articleSuffixEn: "TFEU",
    genitiveIs: "sáttmálans um starfshætti Evrópusambandsins",
    aliases: [
      "TFEU",
      "Treaty on the Functioning of the European Union",
      "Sáttmálinn um starfshætti Evrópusambandsins",
      "TEC",
      "EC Treaty",
    ],
    celexEn: "12016E/TXT",
    icelandicText: null,
    citedAs: {
      is: [
        "sáttmálans um starfshætti Evrópusambandsins",
        "starfshættasáttmálans",
      ],
      en: [
        "TFEU",
        "of the TFEU",
        "of the Treaty on the Functioning of the European Union",
        "TEC",
        "of the EC Treaty",
      ],
    },
    mentionedAs: [
      "TFEU",
      "Treaty on the Functioning of the European Union",
      "sáttmálinn um starfshætti Evrópusambandsins",
      "sáttmálans um starfshætti Evrópusambandsins",
      "sáttmálanum um starfshætti Evrópusambandsins",
    ],
  },
];

/** The `Act.jurisdiction` and `Act.docType` every treaty row carries. */
export const TREATY_JURISDICTION = "treaty";
export const TREATY_DOC_TYPE = "treaty";

const BY_SLUG = new Map(TREATIES.map((t) => [t.slug, t]));

export function treatyBySlug(slug: string): TreatyDef | null {
  return BY_SLUG.get(slug.trim().toLowerCase()) ?? null;
}

/** The registry entry a stored row belongs to, by its `textGroup`. */
export function treatyForAct(act: { textGroup?: string | null }): TreatyDef | null {
  return act.textGroup ? treatyBySlug(act.textGroup) : null;
}

/**
 * The anchor a treaty article is stored under, in every language.
 *
 * Deliberately ours rather than either source's. EUR-Lex anchors the TFEU's
 * articles `art_28` and Lagasafn anchors the same article of the EEA Agreement
 * `X27`; if the two languages kept their own, `/log/ees#A28` would land
 * somewhere else the moment a reader switched language, and every deep link
 * into a treaty would be language-specific. Built from the article's own number,
 * which both texts agree on by construction — a treaty's language versions are
 * one instrument, numbered once.
 */
export function treatyAnchor(articleNumber: number, articleLetter?: string | null): string {
  return `A${articleNumber}${(articleLetter ?? "").toUpperCase()}`;
}

/** The paragraph anchor under that article: "A28M1", as Lagasafn numbers them. */
export function treatyParagraphAnchor(provisionAnchor: string, number: number): string {
  return `${provisionAnchor}M${number}`;
}

/**
 * The treaty a stored row is, from the two columns every act query already
 * selects.
 *
 * `textGroup` is the proper key and is what `treatyForAct` uses. This exists
 * because not every caller selects it: the well's tool layer, the lookup route
 * and the Meilisearch sync all hand around a narrow act identity of
 * jurisdiction, number and year, and without a fallback a treaty reached through
 * one of them would render a URL like "/log/1-1992", which is a 404.
 *
 * The ordinal and the year are together unique across the registry — the table's
 * own uniqueness constraint is built on them — so this is a lookup and not a
 * guess.
 */
export function treatyByIdentity(actNumber: number, year: number): TreatyDef | null {
  return TREATIES.find((t) => t.ordinal === actNumber && t.year === year) ?? null;
}

/**
 * The treaty whose Icelandic text is annexed to this act, if any.
 *
 * Read in both directions: the treaties adapter uses it to know that lög nr.
 * 2/1993 is where the Icelandic EEA text comes from, and the act reader uses it
 * to offer "Lesa EES-samninginn" beside the fylgiskjal — which is how a reader
 * who navigated to the Agreement through the act that enacted it gets from one
 * to the other.
 */
export function treatyAnnexedTo(actNumber: number, year: number): TreatyDef | null {
  return (
    TREATIES.find(
      (t) =>
        t.icelandicText?.kind === "lagasafn-annex" &&
        t.icelandicText.actNumber === actNumber &&
        t.icelandicText.year === year
    ) ?? null
  );
}

/** The route this app serves a treaty at, e.g. "/log/ees". */
export function treatyPath(slug: string): string {
  return `/log/${slug}`;
}

/**
 * Which language of a treaty is the one this app treats as the instrument.
 *
 * The text that governs where this app is read: Icelandic where there is an
 * authentic Icelandic text, English otherwise. It decides three things — which
 * row the catalogue lists, which row a judgment's citation links to, and which
 * text the well quotes — and they have to be the same row for all three, or an
 * article's citation count is split between two copies of itself.
 */
export function canonicalLanguage(treaty: TreatyDef): "is" | "en" {
  return treaty.icelandicText ? "is" : "en";
}
