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
  tag?: string; // filter to documents whose subjectTags include this exact tag
  /**
   * Restrict to judgments citing this act — through any of its provisions or
   * by naming the act alone. Set by the act/provision lookup, so that picking
   * "lög um aðbúnað og hollustuhætti" answers with the cases about it.
   */
  actId?: string;
  /** Restrict to judgments citing this specific provision. Narrower than actId. */
  provisionId?: string;
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
