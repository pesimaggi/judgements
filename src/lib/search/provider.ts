import type { SearchRequest, SearchHit } from "../types";

export interface ProviderResult {
  total: number;
  hits: SearchHit[];
}

export interface SearchProvider {
  /**
   * Runs a search restricted to the given court source keys. The caller
   * (the API route) is responsible for enforcing that `req.sources` is
   * non-empty.
   */
  search(req: SearchRequest): Promise<ProviderResult>;
}
