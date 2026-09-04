import { ADR_BOARDS, FELAGSDOMUR_KEY, boardListUrl } from "./adr-boards";

export interface SourceDef {
  key: string;
  name: string;
  officialBaseUrl: string;
  /** Language of the text stored for this source (ISO 639-1). */
  language: string;
  /** Heading this source appears under in the source panel. */
  group: string;
  /**
   * The ingestion adapter that feeds this source (src/ingestion/run.ts's
   * registry key). Several sources can share one adapter, as the Icelandic
   * courts do. Used to show a source the runs that actually produced it —
   * IngestionRun rows are keyed by adapter, not by source.
   */
  adapterKey: string;
  /**
   * "decision"    — a ruling in an individual case: a court judgment, an
   *   úrskurður of an appeal board, an ombudsman opinion. These are what the
   *   citation job links to provisions and what the act reader counts as
   *   "úrlausnir" — the term that covers all three, which "dómar" did not
   *   once the boards were ingested and started outnumbering the courts.
   * "scholarship" — a peer-reviewed article in a legal journal. Searchable
   *   like everything else, but deliberately kept out of the provision
   *   citation job, whose model and UI both say "úrlausnir" — see
   *   src/ingestion/citations.ts.
   */
  kind: "decision" | "scholarship";
  /**
   * "live"  — ingested and searchable; offered in the search UI.
   * "pilot" — the adapter is still being built. Registered here so ingestion,
   *   the search API and the schema all treat the key as legitimate, but kept
   *   out of the UI so nobody ticks a court that would return nothing. Flip to
   *   "live" once it has documents.
   */
  status: "live" | "pilot";
}

const ICELANDIC_COURTS = "Icelandic courts";
const EEA_EFTA = "EEA / EFTA";
const EU_COURTS = "Dómstólar ESB";
const OVERSIGHT = "Eftirlit og kærunefndir";
const JOURNALS = "Ritrýnd fræðirit";
const ADR = "Úrskurðarnefndir og ráðuneyti";

/**
 * The 40 administrative appeal bodies at stjornarradid.is, each its own
 * source so a researcher can tick the one board they mean.
 *
 * Derived from src/lib/adr-boards.ts rather than written out here, because
 * the adapter has to agree with this list exactly — the key it saves under
 * and the key the search UI offers are the same string, and a hand-kept copy
 * of forty-one of anything drifts.
 *
 * They are decisions, not scholarship: rulings in individual cases, which is
 * what the citation job links to provisions. Their officialBaseUrl is the
 * board's filtered listing on the site — most boards have no page of their
 * own, so that listing is the closest thing to a board's home.
 *
 * Félagsdómur is not among them, though it publishes on the same site: it is
 * a court, and it is registered as one below. See FELAGSDOMUR_KEY.
 */
const ADR_SOURCES: SourceDef[] = ADR_BOARDS.map((board) => ({
  key: board.key,
  name: board.name,
  officialBaseUrl: boardListUrl(board),
  language: "is",
  group: ADR,
  adapterKey: "stjornarradid",
  kind: "decision" as const,
  status: "live" as const,
}));

/**
 * Appeal bodies that publish on their own sites rather than through
 * stjornarradid.is.
 *
 * They belong in the same group as the forty above — a researcher looking for
 * planning appeals does not care which server they are on — but they cannot be
 * derived from ADR_BOARDS, because that list is defined by the one thing they
 * do not share: a `Committee=` value on the ministries' site. So each has its
 * own adapter and its own entry here.
 *
 * There are more of these than are listed: Yfirskattanefnd, Óbyggðanefnd,
 * Áfrýjunarnefnd neytendamála, Áfrýjunarnefnd samkeppnismála, the two FME
 * nefndir and several smaller ones all publish for themselves and are not yet
 * ingested. See "Boards that publish elsewhere" in the README.
 */
const EXTERNAL_ADR_SOURCES: SourceDef[] = [
  {
    // Planning, building and environmental appeals — and the largest body in
    // the app after Kærunefnd útlendingamála. About 3,000 rulings back to
    // 1998, published as one HTML index and one page per ruling.
    key: "uua",
    name: "Úrskurðarnefnd umhverfis- og auðlindamála",
    officialBaseUrl: "https://uua.is/listi-yfir-urskurdi",
    language: "is",
    group: ADR,
    adapterKey: "uua",
    kind: "decision",
    status: "live",
  },
  {
    // The commission that decided what is þjóðlenda — public commons — and
    // what is anybody's property, working the country through in twelve svæði
    // from 1998 to its final report in March 2026. Eighty-four rulings, each a
    // PDF of several hundred pages: by a wide margin the longest documents here.
    key: "obyggdanefnd",
    name: "Óbyggðanefnd",
    officialBaseUrl: "https://obyggdanefnd.is/urskurdir/",
    language: "is",
    group: ADR,
    adapterKey: "obyggdanefnd",
    kind: "decision",
    status: "live",
  },
  {
    // Consumer-law appeals: misleading advertising, price marking, unfair
    // commercial practices, product safety. It publishes on the site of the
    // agency whose decisions it reviews rather than through stjornarradid.is.
    key: "afryjunarnefnd-neytendamala",
    name: "Áfrýjunarnefnd neytendamála",
    officialBaseUrl: "https://www.neytendastofa.is/akvardanir/urskurdir-afryjunarnefndar-neyte/",
    language: "is",
    group: ADR,
    adapterKey: "neytendamal",
    kind: "decision",
    status: "live",
  },
];

/** Every source the system knows about, live or not. */
export const ALL_SOURCES: SourceDef[] = [
  {
    key: "haestirettur",
    name: "Hæstiréttur Íslands",
    officialBaseUrl: "https://island.is/domar",
    language: "is",
    group: ICELANDIC_COURTS,
    adapterKey: "icelandic-courts",
    kind: "decision",
    status: "live",
  },
  {
    key: "landsrettur",
    name: "Landsréttur",
    officialBaseUrl: "https://island.is/domar",
    language: "is",
    group: ICELANDIC_COURTS,
    adapterKey: "icelandic-courts",
    kind: "decision",
    status: "live",
  },
  {
    key: "heradsdomar",
    name: "Héraðsdómar",
    officialBaseUrl: "https://island.is/domar",
    language: "is",
    group: ICELANDIC_COURTS,
    adapterKey: "icelandic-courts",
    kind: "decision",
    status: "live",
  },
  {
    // The court that decides whether a concluded case may be reopened. Small
    // (about 100 cases) but it is a distinct court in the island.is feed, and
    // was silently dropped for as long as courtToSourceKey had no branch for
    // it — every one of its cases was counted as "no court match" and skipped.
    key: "endurupptokudomur",
    name: "Endurupptökudómur",
    officialBaseUrl: "https://island.is/domar",
    language: "is",
    group: ICELANDIC_COURTS,
    adapterKey: "icelandic-courts",
    kind: "decision",
    status: "live",
  },
  {
    // Félagsdómur — the labour court, which rules on collective agreements
    // and the legality of industrial action. A court in its own right under
    // lög nr. 80/1938, not one of the úrskurðarnefndir it was grouped with
    // until now, and not in island.is's feed: it publishes for itself.
    //
    // Its archive is split across two sites — felagsdomur.is from case year
    // 2010, stjornarradid.is before that — and the felagsdomur adapter reads
    // both, so this is one source with one checkbox, one record shape and one
    // total. See FELAGSDOMUR_KEY in src/lib/adr-boards.ts.
    key: FELAGSDOMUR_KEY,
    name: "Félagsdómur",
    officialBaseUrl: "https://felagsdomur.is",
    language: "is",
    group: ICELANDIC_COURTS,
    adapterKey: "felagsdomur",
    kind: "decision",
    status: "live",
  },
  {
    // The EFTA Court's working language is English, and some cases are also
    // published in Icelandic and Norwegian. We store the English text and
    // point officialUrl at the case page, where the reader can switch to the
    // other language versions — the same "go to the official source" link the
    // Icelandic courts get.
    key: "eftacourt",
    name: "EFTA Court",
    officialBaseUrl: "https://eftacourt.int",
    language: "en",
    group: EEA_EFTA,
    adapterKey: "efta-court",
    kind: "decision",
    status: "live",
  },
  {
    // The decisions by which EU acts enter the EEA Agreement — one record per
    // decision, carrying the decision's own text: "DECISION OF THE EEA JOINT
    // COMMITTEE No 25/2010 of 12 March 2010 amending Annex II … to the EEA
    // Agreement". A JCD has no page of its own on efta.int; it is published as
    // a PDF per language, so the English PDF is the officialUrl, as the ruling
    // PDF already is for Óbyggðanefnd and for ESA.
    //
    // These used to be derived from a second source, an EEA-Lex register of
    // the EU acts in force, whose factsheets each named the decision that
    // incorporated them. That register was not the right thing to be
    // ingesting and has been withdrawn; the decisions it had already named
    // are carried in the gap ledger instead, and the adapter works that list
    // to the end. It discovers nothing new until EEA-Lex is ingested again —
    // deliberately, and see the adapter's header for why.
    key: "eea-joint-committee",
    name: "Sameiginlega EES-nefndin (EEA Joint Committee)",
    officialBaseUrl:
      "https://www.efta.int/about-efta/legal-documents/adopted-joint-committee-decisions",
    language: "en",
    group: EEA_EFTA,
    adapterKey: "eea-joint-committee",
    kind: "decision",
    status: "live",
  },
  {
    // ESA is the enforcement half of the EEA: it polices whether Iceland,
    // Liechtenstein and Norway actually apply the acts the Joint Committee
    // incorporated. Its public document database is the record of that work —
    // College decisions, letters of formal notice, reasoned opinions, closure
    // decisions, the states' replies — and it is the middle of a chain the app
    // already carries at both ends: incorporation above, and the EFTA Court's
    // judgment when a case gets that far.
    //
    // English is the Authority's working language and what it publishes in; a
    // minority of documents are a state's own reply in its own language, and
    // are stored as published.
    key: "eftasurv",
    name: "EFTA Surveillance Authority",
    officialBaseUrl:
      "https://www.eftasurv.int/esa-at-a-glance/publications/public-access-to-documents/public-documents",
    language: "en",
    group: EEA_EFTA,
    adapterKey: "eftasurv",
    kind: "decision",
    status: "live",
  },
  {
    // The Court of Justice. EEA law is interpreted homogeneously with EU law:
    // the EFTA Court follows this court, Icelandic courts follow both, and a
    // directive incorporated into the EEA Agreement means here what this court
    // says it means. The app carried the directives and the EFTA Court without
    // the half both of them defer to.
    //
    // Judgments only — sector 6 also holds orders and Advocate General
    // opinions, which are procedure and advice rather than the Court speaking.
    key: "cjeu",
    name: "Dómstóll Evrópusambandsins (Court of Justice)",
    officialBaseUrl: "https://curia.europa.eu",
    language: "en",
    group: EU_COURTS,
    adapterKey: "cjeu",
    kind: "decision",
    status: "live",
  },
  {
    // The General Court, which hears the direct actions: competition, state
    // aid, trade marks, sanctions, staff. Its own box rather than a share of
    // the Court of Justice's, so that a search for a preliminary ruling on a
    // directive is not waded through EU trade-mark appeals to reach.
    key: "eu-general-court",
    name: "Almenni dómstóll ESB (General Court)",
    officialBaseUrl: "https://curia.europa.eu",
    language: "en",
    group: EU_COURTS,
    adapterKey: "cjeu",
    kind: "decision",
    status: "live",
  },
  {
    // Not a court: the Ombudsman issues álit (formal opinions) and bréf
    // (letters closing a case). Both are stored, and which one a document is
    // shows as the heading over its body.
    key: "umbodsmadur",
    name: "Umboðsmaður Alþingis",
    officialBaseUrl: "https://umbodsmadur.is",
    language: "is",
    group: OVERSIGHT,
    adapterKey: "umbodsmadur",
    kind: "decision",
    status: "live",
  },
  {
    // A peer-reviewed legal journal out of Reykjavík University's law
    // faculty, published since the end of 2004 and electronic-only since
    // 2024. Ingested from the Prismic API its own site reads from, so the
    // article record (title, author, abstract, keywords, volume) comes as
    // structured data rather than being scraped back out of a page that
    // renders entirely in the browser.
    key: "logretta",
    name: "Tímarit Lögréttu",
    officialBaseUrl: "https://www.timaritlogrettu.is",
    language: "is",
    group: JOURNALS,
    adapterKey: "logretta",
    kind: "scholarship",
    status: "live",
  },
  {
    // Vefrit Úlfljóts — the web journal of Úlfljótur, the law students'
    // journal at the University of Iceland, in print since 1947. Articles are
    // published in full on the web, so this source carries whole articles,
    // not just their abstracts.
    key: "ulfljotur",
    name: "Úlfljótur (vefrit)",
    officialBaseUrl: "https://ulfljotur.com",
    language: "is",
    group: JOURNALS,
    adapterKey: "ulfljotur",
    kind: "scholarship",
    status: "live",
  },
  ...ADR_SOURCES,
  ...EXTERNAL_ADR_SOURCES,
];

/** Sources that are ingested and searchable — what the UI offers. */
export const SOURCES: SourceDef[] = ALL_SOURCES.filter((s) => s.status === "live");

/** Valid source keys, pilots included, so their documents stay queryable. */
export const SOURCE_KEYS = new Set(ALL_SOURCES.map((s) => s.key));

/**
 * Sources whose documents are scholarly articles rather than decisions in a
 * case. Read by the citation job, which links *judgments* to provisions.
 */
export const SCHOLARSHIP_SOURCE_KEYS = ALL_SOURCES.filter((s) => s.kind === "scholarship").map(
  (s) => s.key
);

export function sourceByKey(key: string): SourceDef | undefined {
  return ALL_SOURCES.find((s) => s.key === key);
}

/**
 * True for a source whose documents are somebody's authored work rather than a
 * public record of a decision.
 *
 * The app indexes those in full — that is what makes them findable — but never
 * republishes them: a reader who wants the article is sent to the journal that
 * published it. See "Reading an article" in the README.
 */
export function isScholarship(sourceKey: string): boolean {
  return sourceByKey(sourceKey)?.kind === "scholarship";
}

/** Sources bucketed by group for the source panel, in registry order. */
export function groupedSources(sources: SourceDef[]): { group: string; sources: SourceDef[] }[] {
  const groups: { group: string; sources: SourceDef[] }[] = [];
  for (const source of sources) {
    const existing = groups.find((g) => g.group === source.group);
    if (existing) existing.sources.push(source);
    else groups.push({ group: source.group, sources: [source] });
  }
  return groups;
}
