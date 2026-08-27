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
   * "decision"    — a ruling in an individual case: a court judgment, or an
   *   ombudsman opinion. These are what the citation job links to provisions
   *   and what the act reader counts as "dómar".
   * "scholarship" — a peer-reviewed article in a legal journal. Searchable
   *   like everything else, but deliberately kept out of the provision
   *   citation job, whose model and UI both say "dómar" — see
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
const OVERSIGHT = "Eftirlit og kærunefndir";
const JOURNALS = "Ritrýnd fræðirit";

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
