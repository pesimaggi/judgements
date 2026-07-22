import type { IngestionAdapter, IngestContext, IngestStats } from "../adapter";

/**
 * Icelandic courts adapter — island.is/domar (Hæstiréttur, Landsréttur, Héraðsdómar).
 *
 * VERIFIED: island.is is an open-source monorepo (github.com/island-is/island.is,
 * MIT licence, run by Digital Iceland) and exposes a unified GraphQL API that
 * the judgment search UI on https://island.is/domar is built on. This is the
 * structured access path — prefer it over HTML scraping.
 *
 * To avoid hardcoding operation/field names that may drift, this adapter is
 * introspection-first:
 *
 *   npm run ingest -- --adapter=icelandic-courts --dry-run
 *     → runs a GraphQL introspection query against GRAPHQL_ENDPOINT and
 *       prints every Query field whose name matches /verdict|domar|dómur/i,
 *       with its arguments and return type. Use that output to fill in
 *       VERDICT_LIST_QUERY / VERDICT_ITEM_QUERY below, then run for real.
 *
 * Cross-check field names against the monorepo (search the repo for
 * "verdict") before a full sync. Respect the API: keep INGEST_DELAY_MS
 * conservative and identify yourself via INGEST_USER_AGENT.
 */

const GRAPHQL_ENDPOINT = process.env.ISLAND_IS_GRAPHQL ?? "https://island.is/api/graphql";

// Fill these in from the introspection output (dry-run). Left empty on
// purpose — we do not fabricate field names.
const VERDICT_LIST_QUERY = process.env.ISLAND_IS_VERDICT_LIST_QUERY ?? "";
const VERDICT_ITEM_QUERY = process.env.ISLAND_IS_VERDICT_ITEM_QUERY ?? "";

const INTROSPECTION = `
  query IntrospectQueries {
    __schema {
      queryType {
        fields {
          name
          args { name type { name kind ofType { name } } }
          type { name kind ofType { name } }
        }
      }
    }
  }
`;

async function gql(query: string, variables: Record<string, unknown> = {}) {
  const res = await fetch(GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": process.env.INGEST_USER_AGENT ?? "logbrunnur-mvp/0.1",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GraphQL HTTP ${res.status}: ${body.slice(0, 500)}`);
  }
  const json = await res.json();
  if (json.errors) throw new Error(`GraphQL errors: ${JSON.stringify(json.errors).slice(0, 500)}`);
  return json.data;
}

/** Maps island.is court names onto our per-court source keys. */
export function courtToSourceKey(court: string): string | null {
  const c = court.toLowerCase();
  if (c.includes("hæstirétt") || c.includes("haestirett")) return "haestirettur";
  if (c.includes("landsrétt") || c.includes("landsrett")) return "landsrettur";
  if (c.includes("héraðsdóm") || c.includes("heradsdom")) return "heradsdomar";
  return null;
}

export const icelandicCourtsAdapter: IngestionAdapter = {
  key: "icelandic-courts",
  name: "Icelandic courts (island.is/domar, GraphQL)",

  async run(ctx: IngestContext): Promise<IngestStats> {
    const stats: IngestStats = { indexed: 0, skipped: 0, errors: 0 };

    // Step 1 — discovery. Always available; this is what --dry-run is for.
    if (!VERDICT_LIST_QUERY) {
      ctx.log(`No verdict list query configured. Introspecting ${GRAPHQL_ENDPOINT} ...`);
      const data = await gql(INTROSPECTION);
      const fields: any[] = data.__schema.queryType.fields;
      const candidates = fields.filter((f) => /verdict|domar|dómur|domur/i.test(f.name));
      if (candidates.length === 0) {
        ctx.log("No verdict-like Query fields found. Inspect the schema manually (e.g. GraphQL playground or the island.is repo).");
      }
      for (const f of candidates) {
        const args = f.args.map((a: any) => `${a.name}: ${a.type.name ?? a.type.ofType?.name ?? a.type.kind}`).join(", ");
        ctx.log(`Candidate query: ${f.name}(${args}) → ${f.type.name ?? f.type.ofType?.name ?? f.type.kind}`);
      }
      ctx.log("Set ISLAND_IS_VERDICT_LIST_QUERY / ISLAND_IS_VERDICT_ITEM_QUERY (or edit this adapter) using the candidates above, then re-run.");
      return stats; // discovery run: nothing indexed, nothing fabricated
    }

    // Step 2 — real ingestion once the queries are configured.
    // Expected shape (adjust mapping to the actual schema you configured):
    // list query returns items with: id, court, caseNumber, title/caseName,
    // verdictDate, presidentJudge/parties, keywords; item query returns the
    // full text (rich text / html) for one id.
    let page = 1;
    const maxPages = Number(process.env.INGEST_MAX_PAGES ?? 5);
    while (page <= maxPages) {
      let items: any[] = [];
      try {
        const data = await gql(VERDICT_LIST_QUERY, { page });
        // The first array found in the response is treated as the item list.
        const firstArray = (function find(o: any): any[] | null {
          if (Array.isArray(o)) return o;
          if (o && typeof o === "object") {
            for (const v of Object.values(o)) { const r = find(v); if (r) return r; }
          }
          return null;
        })(data);
        items = firstArray ?? [];
      } catch (e) {
        stats.errors++;
        stats.errorSample = String(e);
        break;
      }
      if (items.length === 0) break;

      for (const it of items) {
        try {
          const sourceKey = courtToSourceKey(it.court ?? "");
          if (!sourceKey) { stats.skipped++; continue; }
          let fullText: string = it.verdictHtml ?? it.text ?? "";
          if (!fullText && VERDICT_ITEM_QUERY && it.id) {
            const detail = await gql(VERDICT_ITEM_QUERY, { id: it.id });
            fullText = JSON.stringify(detail).length > 0
              ? (function findString(o: any): string {
                  if (typeof o === "string" && o.length > 500) return o;
                  if (o && typeof o === "object") {
                    for (const v of Object.values(o)) { const r = findString(v); if (r) return r; }
                  }
                  return "";
                })(detail)
              : "";
          }
          if (!fullText) { stats.skipped++; continue; }

          const date = it.verdictDate ? new Date(it.verdictDate) : undefined;
          const result = await ctx.save({
            source: sourceKey,
            court: it.court,
            caseNumber: it.caseNumber ?? undefined,
            caseName: it.title ?? it.caseName ?? undefined,
            title: it.title ?? it.caseNumber ?? "Dómur",
            date,
            language: "is",
            parties: it.parties ?? undefined,
            subjectTags: it.keywords ?? [],
            officialUrl: it.id ? `https://island.is/domar/${it.id}` : "https://island.is/domar",
            fullText: fullText.replace(/<[^>]+>/g, " ").replace(/\s{2,}/g, " ").trim(),
          });
          result === "indexed" ? stats.indexed++ : stats.skipped++;
        } catch (e) {
          stats.errors++;
          stats.errorSample = stats.errorSample ?? String(e);
        }
      }
      page++;
    }
    return stats;
  },
};
