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

/** Every source the system knows about, live or not. */
export const ALL_SOURCES: SourceDef[] = [
  {
    key: "haestirettur",
    name: "Hæstiréttur Íslands",
    officialBaseUrl: "https://island.is/domar",
    language: "is",
    group: ICELANDIC_COURTS,
    adapterKey: "icelandic-courts",
    status: "live",
  },
  {
    key: "landsrettur",
    name: "Landsréttur",
    officialBaseUrl: "https://island.is/domar",
    language: "is",
    group: ICELANDIC_COURTS,
    adapterKey: "icelandic-courts",
    status: "live",
  },
  {
    key: "heradsdomar",
    name: "Héraðsdómar",
    officialBaseUrl: "https://island.is/domar",
    language: "is",
    group: ICELANDIC_COURTS,
    adapterKey: "icelandic-courts",
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
    status: "live",
  },
];

/** Sources that are ingested and searchable — what the UI offers. */
export const SOURCES: SourceDef[] = ALL_SOURCES.filter((s) => s.status === "live");

/** Valid source keys, pilots included, so their documents stay queryable. */
export const SOURCE_KEYS = new Set(ALL_SOURCES.map((s) => s.key));

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
