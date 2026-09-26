/**
 * The founding treaties, as a hand-written registry.
 *
 * Four instruments, and they are a corpus of their own — `jurisdiction =
 * "treaty"` — for the reason the EU acts are one: a question about Icelandic law
 * runs into them constantly, and they are neither lög nor gerðir.
 *
 * They stand in three different relations to Icelandic law, and the difference is
 * the point of `icelandicStatus`: the main part of the EEA Agreement was enacted
 * here and is not foreign law at all; the Surveillance and Court Agreement binds
 * Iceland as a party without having been enacted, which is where the EFTA Court's
 * jurisdiction comes from; the EU treaties bind Iceland not at all and are held
 * because the two courts read EEA provisions against them.
 *
 * WHY A REGISTRY AND NOT A SWEEP. There are four of them, they change once a
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
 * WHAT "ICELANDIC" MEANS HERE, THREE TIMES OVER. `titleIs` is what to call the
 * instrument in an Icelandic interface, and every treaty has one.
 * `icelandicStatus` is how it binds Iceland. `icelandicText` is where an
 * authentic Icelandic text comes from, and only the EEA Agreement has one here —
 * Article 129 of the Agreement makes every language version equally authentic,
 * and Alþingi prints the Icelandic one because 2. gr. laga nr. 2/1993 enacted it.
 *
 * The three are genuinely independent, which is why they are three fields rather
 * than one enum: the Surveillance and Court Agreement binds Iceland *and* is held
 * in English only, and the TEU has an Icelandic name and neither of the other
 * two. The last of them is the whole of the language question — the reader offers
 * ÍSL/ENG where two authentic texts are stored, and English alone where one is.
 */

/**
 * Where the English text comes from.
 *
 * Two kinds, because the EU publishes its treaties and EFTA publishes its own:
 *
 *   "cellar"   — the Publications Office's content API, by CELEX, the way every
 *     EU act in this library arrives.
 *   "efta-pdf" — a PDF on efta.int. EFTA is not the Publications Office and has
 *     no equivalent API: the consolidated Surveillance and Court Agreement is a
 *     thirteen-page PDF and that is the whole of what is on offer. It is a real
 *     digital PDF rather than a scan, so `pdfText()` reads it, and the parse is
 *     then a text parse rather than an HTML one — see src/lib/treaty-text.ts.
 */
export type EnglishTextSource =
  | { kind: "cellar"; celex: string }
  | { kind: "efta-pdf"; url: string };

/**
 * How the treaty reaches Icelandic law.
 *
 * A different question from which texts this app holds, and the one an Icelandic
 * reader actually has about an international agreement in a library of Icelandic
 * law. Three answers, and the difference between the second and the third is the
 * kind of thing a legal research tool has no business getting wrong:
 *
 *   "force-of-law" — the text itself was enacted here. Only the main part of the
 *     EEA Agreement, by 2. gr. laga nr. 2/1993, which is why it is the one treaty
 *     whose Icelandic text Alþingi maintains.
 *   "ratified"     — Iceland is a party and the agreement binds the State in
 *     international law, but its text has not been given the force of law here.
 *     The Surveillance and Court Agreement: 1. gr. laga nr. 2/1993 authorised
 *     ratification, and 2. gr. deliberately did not extend lagagildi to it.
 *   "not-a-party"  — the EU treaties. They bind Iceland not at all, and are held
 *     because EFTA Court and CJEU reasoning reads EEA provisions against them.
 */
export type IcelandicStatus =
  | {
      kind: "force-of-law";
      actNumber: number;
      year: number;
      /** The article that enacted it: "2. gr." */
      article: string;
    }
  | {
      kind: "ratified";
      actNumber: number;
      year: number;
      /** The article that authorised ratification: "1. gr." */
      article: string;
    }
  | { kind: "not-a-party" };

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
  /** Where the English text comes from. */
  englishText: EnglishTextSource;
  /** How the treaty binds Iceland, if at all. */
  icelandicStatus: IcelandicStatus;
  /**
   * Where the authentic Icelandic text comes from, or null if this app holds
   * none.
   *
   * Not the same as `icelandicStatus`, and the Surveillance and Court Agreement
   * is why the two are separate fields: Article 53(1) of it says the Agreement
   * was authenticated in Icelandic as well as English, and Iceland is a party —
   * but nobody publishes that Icelandic text where this app can reach it, and
   * Alþingi has no reason to maintain it because it was never enacted here. So
   * the treaty binds Iceland and is nonetheless held in English only, which is a
   * state the EU treaties do not have and the EEA Agreement does not either.
   */
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
    englishText: { kind: "cellar", celex: "21994A0103(01)" },
    // 2. gr. laga nr. 2/1993: "Meginmál EES-samningsins skal hafa lagagildi hér
    // á landi. […] eru prentuð sem fylgiskjöl I–IV með lögum þessum."
    icelandicStatus: { kind: "force-of-law", actNumber: 2, year: 1993, article: "2. gr." },
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
    englishText: { kind: "cellar", celex: "12016M/TXT" },
    icelandicStatus: { kind: "not-a-party" },
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
    englishText: { kind: "cellar", celex: "12016E/TXT" },
    icelandicStatus: { kind: "not-a-party" },
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
  {
    slug: "sca",
    ordinal: 4,
    // Porto, 2 May 1992, alongside the EEA Agreement itself. The text held is
    // EFTA's consolidated version, which carries the Adjusting Protocol and the
    // twenty-odd later amendments in its own footnotes.
    year: 1992,
    titleIs: "Samningur milli EFTA-ríkjanna um stofnun eftirlitsstofnunar og dómstóls",
    titleEn:
      "Agreement between the EFTA States on the establishment of a Surveillance Authority and a Court of Justice",
    citationIs: "samningurinn um stofnun eftirlitsstofnunar og dómstóls",
    citationEn: "SCA",
    articleSuffixEn: "SCA",
    genitiveIs: "samningsins um stofnun eftirlitsstofnunar og dómstóls",
    aliases: [
      "SCA",
      "Surveillance and Court Agreement",
      "ESA/Court Agreement",
      "eftirlits- og dómstólasamningurinn",
      "Samningur um stofnun eftirlitsstofnunar og dómstóls",
    ],
    // EFTA publishes it, not the Publications Office, and publishes it as a PDF.
    englishText: {
      kind: "efta-pdf",
      url:
        "https://www.efta.int/sites/default/files/documents/legal-texts/" +
        "the-surveillance-and-court-agreement/Surveillance-and-Court-Agreement-consolidated.pdf",
    },
    // Iceland is a party — 1. gr. laga nr. 2/1993 authorised ratification — and
    // 2. gr. of the same act deliberately did not give it lagagildi: only the EEA
    // main text, bókun 1 and two annex points were enacted. So the EFTA Court's
    // jurisdiction over Iceland comes from an agreement that is binding on the
    // State without being part of Icelandic law, and the reader says exactly
    // that rather than reaching for either of the other two stories.
    icelandicStatus: { kind: "ratified", actNumber: 2, year: 1993, article: "1. gr." },
    // Article 53(1) says the Agreement was authenticated in Icelandic too, but
    // nobody publishes that text where this app can reach it. See the field.
    icelandicText: null,
    citedAs: {
      is: [
        "samningsins um stofnun eftirlitsstofnunar og dómstóls",
        "samningnum um stofnun eftirlitsstofnunar og dómstóls",
        "eftirlits- og dómstólasamningsins",
      ],
      en: [
        "SCA",
        "of the SCA",
        "of the Surveillance and Court Agreement",
        "Surveillance and Court Agreement",
        "of the ESA/Court Agreement",
      ],
    },
    mentionedAs: [
      "SCA",
      "Surveillance and Court Agreement",
      "ESA/Court Agreement",
      "eftirlits- og dómstólasamningurinn",
      "eftirlits- og dómstólasamningsins",
      "samningurinn um stofnun eftirlitsstofnunar og dómstóls",
      "samningsins um stofnun eftirlitsstofnunar og dómstóls",
      "samningnum um stofnun eftirlitsstofnunar og dómstóls",
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
