import type { SearchProvider } from "./provider";
import { PostgresSearchProvider } from "./postgres";
import { MeilisearchProvider } from "./meilisearch";

export function getSearchProvider(): SearchProvider {
  if (process.env.SEARCH_PROVIDER === "meilisearch") return new MeilisearchProvider();
  return new PostgresSearchProvider();
}
