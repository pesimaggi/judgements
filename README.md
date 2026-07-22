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
npm run ingest -- --adapter=icelandic-courts
# or, to bound how much a single run pulls (20 cases/page):
INGEST_MAX_PAGES=2 npm run ingest -- --adapter=icelandic-courts
```

Each run records indexed/skipped/error counts in `IngestionRun`, visible at `/admin/ingestion`. Politeness settings (`INGEST_DELAY_MS`, `INGEST_USER_AGENT`) live in `.env`.

**How it works:** island.is's public GraphQL API (`https://island.is/api/graphql`) has introspection disabled in production, so the schema couldn't be discovered by asking the API itself. Instead it was reconstructed from island.is/domar's own live search requests: the list comes from the `webVerdicts` query (confirmed to return the full archive — 40k+ judgments — when searched with an empty term, 20 per page). The case detail pages have no separate API call for the full text; each judgment is embedded as a base64-encoded PDF inside the page's own `__NEXT_DATA__` payload and rendered client-side with pdf.js, so the adapter fetches the detail page directly and extracts the PDF text itself (`pdf-parse`) rather than needing another query.

**Scale note:** the full archive is 40k+ judgments — far more than a single run (or a Railway pre-deploy step) should attempt at once. Ingest in bounded batches via `INGEST_MAX_PAGES`, increasing the page offset over repeated runs, rather than raising the cap to cover everything in one pass.

## Deploying to Railway

1. Deploy the repo as a Railway service (New Project → Deploy from GitHub repo) and add a PostgreSQL database in the same project.
2. On the app service, go to **Variables** → **Add Reference Variable** → select the Postgres service's `DATABASE_URL`.
3. The repo's `railway.json` already sets the **Pre-Deploy Command** to `npm run db:deploy && npm run db:seed`, so this runs automatically on every deploy — entirely from the Railway website, no CLI required. It runs `prisma db push` (creates/updates tables from `schema.prisma`), the search setup script (`pg_trgm`/`unaccent` extensions, the full-text search function, and the trigram indexes), then seeds the four `[SAMPLE]` judgments — all against the linked `DATABASE_URL`, with no `psql` binary required. `db:seed` upserts by key, so re-running it on every deploy is harmless and never duplicates data. (If you'd rather manage this from the dashboard instead, remove `deploy.preDeployCommand` from `railway.json` and set the same command under **Settings** → **Deploy** → **Pre-Deploy Command**.)
4. Deploy. `npm install` will also run `prisma generate` automatically (via `postinstall`) before `next build`, so the Prisma Client exists at build time.
5. To pull in real judgments instead of/alongside the samples, you'll need the Railway CLI for the one-off ingestion commands (see "Running ingestion" below) — that step can't be done from the website alone since it requires reading command output interactively.

Note: this repo uses `prisma db push` rather than `prisma migrate`, so there's no `prisma/migrations` folder — `npm run db:deploy` (not `prisma migrate deploy`) is the correct pre-deploy command here. If you later want real migration history for a production database, run `npx prisma migrate dev --name init` locally once, commit the generated `prisma/migrations` folder, and switch the pre-deploy command to `npx prisma migrate deploy && npm run db:setup-search`.

## Legal note

This tool searches and links to public judgments. It always displays the official island.is URL, does not present itself as an official publisher, and displays on every page: *"This is an unofficial research tool. Always verify text against the official source."*
