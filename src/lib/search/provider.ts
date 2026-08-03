import type {
  SearchRequest,
  SearchHit,
  ActSearchRequest,
  ActHit,
  ProvisionSearchRequest,
  ProvisionHit,
} from "../types";

export interface ProviderResult {
  total: number;
  /** True when `total` is a capped lower bound rather than the exact count. */
  totalIsCapped?: boolean;
  hits: SearchHit[];
}

export interface ProvisionProviderResult {
  total: number;
  hits: ProvisionHit[];
}

export interface SearchProvider {
  /**
   * Runs a search restricted to the given court source keys. The caller
   * (the API route) is responsible for enforcing that `req.sources` is
   * non-empty.
   */
  search(req: SearchRequest): Promise<ProviderResult>;

  /**
   * Looks up acts for the specific-search panel's type-ahead, by title, by
   * one of the short names harvested from the corpus ("vaxtalög"), or by
   * citation number ("91/1991").
   */
  searchActs(req: ActSearchRequest): Promise<ActHit[]>;

  /**
   * Searches provisions, optionally within one act. Provisions go through the
   * provider abstraction rather than a separate query path, so switching
   * SEARCH_PROVIDER switches every kind of search this app does, not just the
   * judgment one.
   */
  searchProvisions(req: ProvisionSearchRequest): Promise<ProvisionProviderResult>;
}
