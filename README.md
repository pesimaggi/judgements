# Lögbrunnur

An MVP search engine for **Icelandic court judgments only** — Hæstiréttur Íslands, Landsréttur, and Héraðsdómar — sourced from island.is's public GraphQL API.

> **Disclaimer shown throughout the app:** This is an unofficial research tool. Always verify text against the official source.

This is a deliberately narrowed build: no ombudsman opinions, no administrative boards, no EFTA Court, no CJEU. Just the three Icelandic courts published at [island.is/domar](https://island.is/domar), searched properly.

## What's in the MVP

- **Search UI** — main search bar, left-side panel with the three courts as opt-in checkboxes, filters (date range, year, sort), result cards with highlighted snippets.
- **Strict opt-in courts** — nothing is selected when the app opens, the Search button is disabled until at least one court is ticked, selected courts are shown as removable chips above the results, and the API itself returns `400 Select one or more courts to search.` if called without sources.
- **Full document page** — structured metadata, full text with highlighted hits, search-within-document, copyable citation, official-source link, related cases via case-number citation extraction.
- **Database schema** (Prisma/PostgreSQL) — `Document`, `Source`, `IngestionRun`.
- **Search** — PostgreSQL full-text search (default, zero extra infrastructure) with a provider abstraction; a Meilisearch provider is included and can be switched on with one env var.
- **One real ingestion adapter** — `icelandic-courts`, targeting island.is's public GraphQL API (`https://island.is/api/graphql`). It's **introspection-first**: run it with `--dry-run` and it queries the live schema and prints every verdict-related field it finds, so you configure real query names instead of guessing.
- **Seed data** — four sample judgments across the three courts, all clearly flagged `[SAMPLE]` in the UI, so the pipeline can be exercised immediately.

## Quick start

```bash
cp .env.example .env
docker compose up -d db        # PostgreSQL 16 on :5432
npm install
npm run db:push                # create tables
npm run db:setup-search        # FTS + pg_trgm indexes (requires psql on PATH)
npm run db:seed                # courts + sample judgments
npm run dev                    # http://localhost:3000
```

Try it: tick a court or two, then search `stjórnsýsla`, `"sönnun um orsakatengsl"`, `22/2023`, or `uppsögn NOT sjómenn`.

### Optional: Meilisearch instead of Postgres FTS

```bash
docker compose up -d meilisearch
# .env: SEARCH_PROVIDER=meilisearch
```
Meilisearch adds typo tolerance (good for Icelandic spelling variants) out of the box.

## Search syntax

| Input | Behaviour |
|---|---|
| `orlofsréttur launþega` | all words must appear (AND) |
| `"frjálsri för launþega"` | exact phrase |
| `uppsögn OR riftun` | boolean OR |
| `uppsögn NOT sjómenn` | exclusion |
| `22/2023`, `E-3210/2025` | case-number lookup (exact + fuzzy) |

Icelandic characters (á ð é í ó ú ý þ æ ö) are preserved exactly — the Postgres provider uses the `simple` text-search configuration plus `pg_trgm` trigram similarity for fuzzy matching of variants.

## Architecture

```
src/
  app/
    page.tsx                     search UI
    document/[id]/page.tsx       full document view
    admin/ingestion/page.tsx     ingestion status
    api/search/route.ts          POST — refuses empty source list
    api/sources/route.ts         the three court sources
    api/documents/[id]/route.ts  document + related cases
    api/ingestion/route.ts       status feed
  lib/
    sources.ts                   fixed registry: haestirettur, landsrettur, heradsdomar
    query-parser.ts              phrases / boolean / case-number detection
    search/                      provider abstraction: postgres (default) + meilisearch
    citation.ts, highlight.ts
  ingestion/
    adapter.ts                   adapter interface, polite fetch, save/upsert
    run.ts                       CLI runner, records IngestionRun rows
    adapters/
      icelandic-courts.ts        the one real adapter — GraphQL, introspection-first
prisma/
  schema.prisma
  sql/setup-search.sql           FTS function + GIN/trigram indexes
  seed.ts                        courts + [SAMPLE] judgments
```

Every judgment is normalized into one shape (`src/lib/types.ts`), preserving the official island.is URL for every document and never fabricating missing metadata — absent fields stay null.

## Running ingestion

```bash
# Step 1: discover the real GraphQL query names (writes nothing)
npm run ingest -- --adapter=icelandic-courts --dry-run
```

This introspects `https://island.is/api/graphql` and prints every `Query` field whose name matches `verdict|domar|dómur` along with its arguments and return type. There is no hardcoded query — the adapter refuses to guess.

Once you've identified the real query, configure it and re-run:

```bash
# .env
ISLAND_IS_VERDICT_LIST_QUERY="query Verdicts($page: Int) { ... }"
ISLAND_IS_VERDICT_ITEM_QUERY="query Verdict($id: ID!) { ... }"   # optional, if list doesn't include full text
```

```bash
npm run ingest -- --adapter=icelandic-courts
```

Each run records indexed/skipped/error counts in `IngestionRun`, visible at `/admin/ingestion`. Politeness settings (`INGEST_DELAY_MS`, `INGEST_USER_AGENT`) live in `.env`.

**Status:** island.is is an open-source monorepo (github.com/island-is/island.is, MIT licence, run by Digital Iceland) with a real public GraphQL API behind the site — that part is verified. The exact verdict query name was not confirmed from this environment; the `--dry-run` introspection step exists specifically to close that gap without guessing at a schema.

## Deploying to Railway

1. Deploy the repo as a Railway service (New Project → Deploy from GitHub repo) and add a PostgreSQL database in the same project.
2. On the app service, go to **Variables** → **Add Reference Variable** → select the Postgres service's `DATABASE_URL`.
3. The repo's `railway.json` already sets the **Pre-Deploy Command** to `npm run db:deploy`, so this runs automatically on every deploy — no dashboard step required. It runs `prisma db push` (creates/updates tables from `schema.prisma`) followed by the search setup script (`pg_trgm`/`unaccent` extensions, the full-text search function, and the trigram indexes) — both against the linked `DATABASE_URL`, with no `psql` binary required. (If you'd rather manage it from the dashboard instead, remove `deploy.preDeployCommand` from `railway.json` and set the same command under **Settings** → **Deploy** → **Pre-Deploy Command**.)
4. Deploy. `npm install` will also run `prisma generate` automatically (via `postinstall`) before `next build`, so the Prisma Client exists at build time.
5. Optional: seed sample data once via the Railway CLI so you have something to search immediately:
   ```
   railway run npm run db:seed
   ```
   `db:seed` is idempotent (it upserts by key), so re-running it is harmless.

Note: this repo uses `prisma db push` rather than `prisma migrate`, so there's no `prisma/migrations` folder — `npm run db:deploy` (not `prisma migrate deploy`) is the correct pre-deploy command here. If you later want real migration history for a production database, run `npx prisma migrate dev --name init` locally once, commit the generated `prisma/migrations` folder, and switch the pre-deploy command to `npx prisma migrate deploy && npm run db:setup-search`.

## Legal note

This tool searches and links to public judgments. It always displays the official island.is URL, does not present itself as an official publisher, and displays on every page: *"This is an unofficial research tool. Always verify text against the official source."*
