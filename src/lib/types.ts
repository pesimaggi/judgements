export type DocumentType = "judgment";

/** Common normalized shape the adapter must produce. */
export interface NormalizedDocument {
  source: string; // "haestirettur" | "landsrettur" | "heradsdomar"
  court: string;
  caseNumber?: string;
  caseName?: string;
  title: string;
  date?: Date;
  year?: number;
  language: string;
  parties?: string;
  subjectTags: string[];
  officialUrl: string;
  pdfUrl?: string;
  htmlUrl?: string;
  fullText: string;
  isSample?: boolean;
}

export interface SearchRequest {
  query: string;
  sources: string[]; // court keys — must be non-empty; the API refuses otherwise
  dateFrom?: string; // ISO date
  dateTo?: string;
  year?: number;
  /**
   * Single-tag filter, kept for the `/?tag=…` links on result cards. Folded
   * into `tags` by the API route; providers read `tags`.
   */
  tag?: string;
  /**
   * Subject tags a judgment must carry — *all* of them. Two tags narrow to
   * the judgments about both subjects, which is what someone adding a second
   * tag is asking for; an OR would widen the result set instead.
   */
  tags?: string[];
  /**
   * Acts the judgment must cite, through any of their provisions or by naming
   * the act alone. Also conjunctive: picking two acts asks for the cases that
   * turn on both.
   */
  actIds?: string[];
  /** Provisions the judgment must cite. Conjunctive, like actIds. */
  provisionIds?: string[];
  sort?: "relevance" | "newest" | "oldest";
  page?: number;
  pageSize?: number;
}

export interface SearchHit {
  id: string;
  source: string;
  court: string;
  caseNumber: string | null;
  caseName: string | null;
  title: string;
  date: string | null;
  year: number | null;
  subjectTags: string[];
  officialUrl: string;
  pdfUrl: string | null;
  snippet: string; // may contain <mark> tags
  /**
   * The judgment's own "Útdráttur" section, when it has one — shown as an
   * expandable summary on the result card. Null for documents without one.
   */
  summary: string | null;
  isSample: boolean;
  /**
   * True when this result was reached only by fuzzy matching — a trigram
   * near-match on the case number, title or party name — rather than by the
   * indexed search actually matching what was typed.
   *
   * Surfaced because the two are not equally useful. For a misspelt Icelandic
   * word a near-match is the answer. For a case number it is a *different
   * case*: someone searching "12595/2024" knows exactly what they typed, and
   * silently handing them "456/2024" at the top of the page is a wrong answer
   * wearing the clothes of a right one. Marking it lets the reader tell the
   * two apart without removing the behaviour that helps with typos.
   *
   * Always false from the Meilisearch provider, which applies its own typo
   * tolerance inside the engine and does not report whether a given hit
   * needed it. See lib/search/meilisearch.ts.
   */
  isFuzzy: boolean;
}

export interface SearchResponse {
  total: number;
  /**
   * True when `total` hit the counting cap and is a lower bound ("10,000+")
   * rather than an exact figure. See COUNT_CAP in lib/search/postgres.ts.
   */
  totalIsCapped: boolean;
  page: number;
  pageSize: number;
  /** Number of pages available for `total` at `pageSize`. */
  totalPages: number;
  hits: SearchHit[];
}

/** Act lookup for the "specific search" panel's type-ahead. */
export interface ActSearchRequest {
  /** Free text: an act title, a short name ("vaxtalög"), or "91/1991". */
  query: string;
  limit?: number;
}

export interface ActHit {
  id: string;
  actNumber: number;
  year: number;
  title: string;
  /** "lög nr. 91/1991" — the form the citation is written in. */
  citation: string;
  /** Route to this act's reader view, e.g. "/log/91-1991". */
  path: string;
  provisionCount: number;
}

/** Provision search, scoped to one act or across all of them. */
export interface ProvisionSearchRequest {
  query: string;
  /** Restrict to a single act — what the provision picker uses. */
  actId?: string;
  page?: number;
  pageSize?: number;
}

export interface ProvisionHit {
  id: string;
  actId: string;
  actNumber: number;
  year: number;
  actTitle: string;
  /** "5. gr." / "7. gr. a." */
  displayLabel: string;
  heading: string | null;
  /** Lagasafn anchor, for deep-linking into the official text. */
  anchor: string;
  snippet: string;
  /** Judgments explicitly citing this provision. */
  caseCount: number;
  /** Route to this provision within the act reader. */
  path: string;
}

export interface ProvisionSearchResponse {
  total: number;
  page: number;
  pageSize: number;
  hits: ProvisionHit[];
}
