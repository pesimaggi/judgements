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
  isSample: boolean;
}

export interface SearchResponse {
  total: number;
  page: number;
  pageSize: number;
  hits: SearchHit[];
}
