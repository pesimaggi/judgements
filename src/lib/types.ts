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
