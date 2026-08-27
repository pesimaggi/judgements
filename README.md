# Lögbrunnur

An MVP search engine for **Icelandic court judgments only** — Hæstiréttur Íslands, Landsréttur, and Héraðsdómar — sourced from island.is's public GraphQL API.

> **Disclaimer shown throughout the app:** This is an unofficial research tool. Always verify text against the official source.

This is a deliberately narrowed build: no ombudsman opinions, no administrative boards, no CJEU. Just the three Icelandic courts published at [island.is/domar](https://island.is/domar), searched properly.

## What's in the MVP

- **Search UI** — main search bar, left-side panel with the three courts as opt-in checkboxes, filters (date range, year, sort), result cards with highlighted snippets, and paginated results (15 per page).
- **Strict opt-in courts** — nothing is selected when the app opens, the Search button is disabled until at least one court is ticked, selected courts are shown as removable chips above the results, and the API itself returns `400 Select one or more courts to search.` if called without sources.
- **Case summaries** — where a judgment carries its own `Útdráttur` section, result cards offer it behind a disclosure arrow, so you can read the court's own summary without opening the full text.
- **Full document page** — structured metadata, the judgment typeset as readable prose (headings, paragraphs, numbered clauses, quoted passages) with highlighted hits, search-within-document, copyable citation, official-source link, related cases via case-number citation extraction.
- **Icelandic acts (lög)** — the in-force text of Icelandic law from [Lagasafn](https://www.althingi.is/lagas/), parsed into chapters (kaflar), provisions (greinar) and paragraphs (málsgreinar), with an act reader at `/log/{actNumber}-{year}`.
- **Provision-level case linking** — each provision shows how many judgments cite it ("12 dómar vísa til þessa ákvæðis"), expanding to the citing cases with the sentence the citation was found in, so you can see *why* a case matched before opening it.
- **Act catalogue** — `/log` lists every ingested act with its provision count and how many judgments cite it, searchable by title, short name or number, and sortable by most-cited.
- **Specific search** — alongside the keyword search, two live lookups that narrow the results, each accepting several selections that combine as AND: an act/provision box that takes the citation as it is written ("lög um aðbúnað og hollustuhætti" finds the cases about the act; "57. gr. a. laga um aðbúnað og hollustuhætti" narrows to the cases citing that article), and a subject-tag box. Acts match on title, citation number, or the short names judgments actually use — "vaxtalög" finds lög nr. 38/2001.
- **Database schema** (Prisma/PostgreSQL) — `Document`, `Source`, `IngestionRun`, `Act`, `Chapter`, `Provision`, `ProvisionParagraph`, `CaseProvisionLink`, `CaseActLink`.
- **Search** — PostgreSQL full-text search (default, zero extra infrastructure) with a provider abstraction; a Meilisearch provider is included and can be switched on with one env var. Ranking reads a materialized `search_vector` column, so a broad query over thousands of hits stays in the low hundreds of milliseconds.
- **Ingestion adapters** — `icelandic-courts` (island.is's public GraphQL API) runs weekly and pulls only what's new; `lagasafn` ingests every in-force act; `citations` links judgments to the provisions they cite; `efta-court` ingests the EFTA Court case register (see below).
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

## Ingestion cadence

The Icelandic archive is backfilled, so the scheduled ingest service
(`railway.ingest.json`) now runs **weekly** in incremental mode:

```
INGEST_MODE=recent INGEST_MAX_PAGES=40 npm run ingest -- --adapter=icelandic-courts
```

`INGEST_MODE=recent` walks island.is's newest-first feed and stops once it has
seen `INGEST_STOP_AFTER_KNOWN` (default 40) consecutive cases it already holds.
Cases already stored are skipped *before* their detail page is fetched, which
is the rate-limited, expensive part — so a week with nothing new costs a couple
of list queries and no document fetches at all.

The trade-off: a judgment that is amended after we stored it won't be noticed.
Set `INGEST_RECHECK_KNOWN=1` to re-fetch and re-hash known cases, or run a
backfill sweep, which always compares text hashes.

The backfill sweeps are still there for a fresh database or a gap:

```
npm run ingest -- --adapter=icelandic-courts                  # year-chunked, all courts
INGEST_COURT=Hæstiréttur npm run ingest -- --adapter=icelandic-courts
```

Both resume from `IngestCursor`, so repeated runs continue where they stopped.

## Sources

`src/lib/sources.ts` is the registry. Each source is `live` (ingested and
offered in the search UI) or `pilot` (adapter still being built — a valid
source key for ingestion and the API, but hidden from the UI so nobody ticks a
court that would return nothing).

| Source | Status | Language stored |
|---|---|---|
| Hæstiréttur Íslands, Landsréttur, Héraðsdómar | live | Icelandic |
| EFTA Court | live | English |

### EFTA Court

The EFTA Court's working language is English, and most decisions are also
published in the language of the request (Icelandic, Norwegian, German, …). We
store **only English**; `officialUrl` points at the case page — the page
carrying every language version — so "Official source ↗" lands somewhere the
reader can switch language, the same way it does for island.is.

`src/ingestion/adapters/efta-court.ts` walks `cases-sitemap.xml` (461 cases at
the time of writing) and parses each case page for its number, parties,
status, procedure, subjects, EFTA Court Reports citation, the Court's own
"About this case" note, and the list of published documents. Case *slugs* are
not usable as identifiers — the site mixes `/cases/e-03-15/`,
`/cases/case-e-13-19/`, `/cases/e-0920/` and `/cases/e-2224/` — so the case
number is always read off the page.

**What is stored, and the robots.txt question.** The Court publishes each
decision as a PDF per language, and eftacourt.int's robots.txt disallows
`/download/` and `/wp-content/uploads/` for every user agent — which is exactly
where those PDFs live. So by default this adapter ingests the case **record**
(metadata, subjects, the Court's summary, and the documents as links) and does
not fetch the PDFs. That gives a complete, searchable EFTA case register
without crawling a path the Court has asked crawlers to stay out of, but it is
not full judgment text.

`EFTA_FETCH_DOCUMENTS=1` additionally downloads the English decision PDF per
case and appends its text, giving true full-text search. It is off by default
deliberately — turn it on only with the Court's agreement, or on your own
considered reading of that robots.txt.

```
INGEST_PROBE=1 npm run ingest -- --adapter=efta-court   # what the site serves now
npm run ingest -- --adapter=efta-court                  # the whole register
```

Runs are incremental: a case page is only re-fetched when the sitemap's
`lastmod` is newer than the last time we stored it, so pending cases still
refresh as their court diary moves. `INGEST_FULL=1` forces a full re-walk.

## Search syntax

| Input | Behaviour |
|---|---|
| `orlofsréttur launþega` | all words must appear (AND) |
| `"frjálsri för launþega"` | exact phrase |
| `uppsögn OR riftun` | boolean OR |
| `uppsögn NOT sjómenn` | exclusion |
| `22/2023`, `E-3210/2025` | case-number lookup (exact + fuzzy) |

Alongside the keyword box, the specific-search panel narrows the same result set by citation or subject. Selections accumulate and are **conjunctive**: two tags return the judgments carrying both, two provisions the judgments citing both. Adding a condition is a request to narrow, not to widen. Picking acts or provisions adds `actIds`/`provisionIds` to the search request; the Postgres provider applies one `EXISTS` subquery per selection so they combine as AND (and `EXISTS` rather than a join, so a judgment citing a provision five times still counts once). Tags ride on one `@>` array-containment condition, which already means "carries every one of these". The Meilisearch provider resolves matching document ids from Postgres first, since citation links are not in its index — that path is capped by `MEILI_CITATION_ID_CAP`.

Icelandic characters (á ð é í ó ú ý þ æ ö) are preserved exactly — the Postgres provider uses the `simple` text-search configuration plus `pg_trgm` trigram similarity for fuzzy matching of variants.

Results are paginated 15 to a page. Counting stops at 10,000, so very broad queries report "10,000+" rather than paying for an exact count nobody reads.

## How search stays fast

`prisma/sql/setup-search.sql` adds a `search_vector` column to `Document`, kept current by a trigger, plus a GIN index on it. Relevance ranking (`ts_rank`) reads that stored vector; before it existed, ranking had to rebuild each document's vector from its full text on every query, which is what made broad searches slow. The other pieces:

- the result count runs as its own capped query, in parallel with the page of rows, so it never pays for ranking;
- `ts_headline` (snippet generation) runs *outside* the paginated subquery, so it only touches the rows actually returned;
- the fuzzy fallback uses `pg_trgm`'s `%` operator, which the trigram indexes serve, instead of a `similarity()` call that forced a sequential scan — and it only runs when the indexed search found nothing.

If you change `document_search_vector()`, stored vectors are not updated retroactively: run `UPDATE "Document" SET search_vector = NULL;` and then `npm run db:setup-search` to rebuild them.

## How judgments are made readable

island.is serves older cases as scanned PDFs and newer ones as a rich-text tree, and neither survives extraction as readable prose: PDF text arrives broken at the page's line width, rich text as one line per block with no spacing. `src/lib/judgment-text.ts` handles both — it reflows wrapped lines into paragraphs, rejoins words hyphenated across a line break, drops stranded page numbers, and recognises headings (`Dómsorð`, `Niðurstaða`, roman-numeral sections) and numbered clauses so the document page can typeset them. Judgments ingested before this existed are stored as one run-together blob; those are re-split at render time from sentence and section boundaries, so no re-ingestion is needed.

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
    log/page.tsx                 act catalogue — every ingested act
    log/[slug]/page.tsx          act reader — /log/91-1991
    api/acts/route.ts            GET — act type-ahead (?q=) and catalogue (no q)
    api/acts/[slug]/route.ts     GET — one act with its provisions + badge counts
    api/provisions/route.ts      GET — provision search, optionally within one act
    api/provisions/[id]/cases    GET — judgments citing one provision, with excerpts
    api/lookup/route.ts          GET — act/provision type-ahead, parses "57. gr. a. laga um …"
    api/tags/route.ts            GET — subject-tag type-ahead over a cached vocabulary
  lib/
    sources.ts                   source registry: the three courts + EFTA Court
    query-parser.ts              phrases / boolean / case-number detection
    judgment-text.ts             reflows extracted text into readable blocks
    acts.ts                      act catalogue listing with per-act counts
    provision-query.ts           splits "57. gr. a. laga um …" into article + act
    tags.ts                      cached subject-tag vocabulary
    lagasafn.ts                  Lagasafn HTML → chapters/provisions/paragraphs
    legal-citations.ts           recognises act/regulation citations in judgment text
    search/                      provider abstraction: postgres (default) + meilisearch
    citation.ts, highlight.ts
  ingestion/
    adapter.ts                   adapter interface, polite fetch, save/upsert
    run.ts                       CLI runner, records IngestionRun rows
    adapters/
      icelandic-courts.ts        GraphQL + embedded PDF/rich text; weekly incremental
      lagasafn.ts                in-force Icelandic acts; incremental by codex version
      efta-court.ts              EFTA Court case register, via cases-sitemap.xml
    citations.ts                 judgments → provisions; incremental by text hash
prisma/
  schema.prisma
  sql/setup-search.sql           FTS function, search_vector column + trigger, GIN/trigram indexes
  seed.ts                        courts + [SAMPLE] judgments
```

Every judgment is normalized into one shape (`src/lib/types.ts`), preserving the official island.is URL for every document and never fabricating missing metadata — absent fields stay null.

## Running ingestion

```bash
# what the weekly scheduled job runs — newest cases only, stops when caught up:
INGEST_MODE=recent npm run ingest -- --adapter=icelandic-courts
# backfill sweep, bounded (10 cases/page):
INGEST_MAX_PAGES=2 npm run ingest -- --adapter=icelandic-courts
# backfill one court at a time (exact values: "Hæstiréttur", "Landsréttur", a "Héraðsdómur ..." string):
INGEST_COURT=Hæstiréttur npm run ingest -- --adapter=icelandic-courts

# ingest every in-force Icelandic act (~900) from Lagasafn:
npm run ingest -- --adapter=lagasafn
# link judgments to the provisions they cite — run after either of the above:
npm run ingest -- --adapter=citations
```

| Variable | Applies to | Meaning |
|---|---|---|
| `INGEST_MODE=recent` | icelandic-courts | Newest-first incremental sweep instead of a backfill |
| `INGEST_STOP_AFTER_KNOWN` | recent mode | Consecutive already-stored cases before stopping (default 40) |
| `INGEST_RECHECK_KNOWN=1` | recent mode | Re-fetch known cases so amendments are picked up |
| `INGEST_MAX_PAGES` | both sweeps | List pages per run (10 cases each) |
| `INGEST_COURT` | backfill | Restrict to one court |
| `INGEST_PROBE=1` | efta-court | Report what eftacourt.int serves, ingest nothing |
| `EFTA_FETCH_DOCUMENTS=1` | efta-court | Also fetch decision PDFs — see the robots.txt note above |
| `EFTA_CASES_SITEMAP` | efta-court | Override the case sitemap URL |
| `INGEST_MAX_CASES` | efta-court | Cases per run (default 1000) |
| `INGEST_FULL=1` | efta-court | Ignore `lastmod` and re-walk every case |
| `LAGASAFN_MAX_ACTS` | lagasafn | Acts fetched per run; the rest resume next run |
| `LAGASAFN_ONLY` | lagasafn | Ingest a single act, e.g. `91/1991` — bypasses the cursor |
| `LAGASAFN_FORCE=1` | lagasafn | Re-parse and rewrite even when nothing has changed. Needed after any change to the parser: a normal run short-circuits on the codex version before the parser ever runs, so a fix would not reach acts already stored |
| `CITATION_MAX_DOCS` | citations | Judgments scanned per run |
| `CITATION_BATCH_SIZE` | citations | Judgments held in memory at once (default 50) |

Each run records indexed/skipped/error counts in `IngestionRun`, visible at `/admin/ingestion`. Politeness settings (`INGEST_DELAY_MS`, `INGEST_USER_AGENT`) live in `.env`.

**How it works:** island.is's public GraphQL API (`https://island.is/api/graphql`) has introspection disabled in production, so the schema couldn't be discovered by asking the API itself. Instead it was reconstructed from island.is/domar's own live search requests: the list comes from the `webVerdicts` query (confirmed to return the full archive — 40k+ judgments — when searched with an empty term, 10 per page). The case detail pages have no separate API call for the full text; each judgment is embedded either as a base64-encoded PDF (older, scanned cases) or a Contentful-style rich-text document (newer cases) inside the page's own `__NEXT_DATA__` payload, so the adapter fetches the detail page directly and extracts the text itself (`pdf-parse`, or a rich-text tree walk) rather than needing another query.

### Acts and citation links

`lagasafn` reads the in-force index at `/lagasafn/nuna/` — authoritative about what is currently in force, and one request rather than a crawl — then fetches each act's own `/lagas/nuna/{year}{nr}.html` page. That page is the canonical permalink the app stores and links to, and it is served as UTF-8 (the bulk zip is ISO-8859-1; `decodeHtml()` honours whichever encoding a response actually declares rather than assuming).

Lagasafn's markup carries stable anchors — `id="G7A"` for "7. gr. a", `id="G7AM1"` for its first paragraph — so provisions parse cleanly and can deep-link into the official text. Provisions are matched on `(actId, anchor)` and updated in place rather than deleted and recreated, because `CaseProvisionLink` cascades from `Provision`: a delete-and-reinsert would discard every judgment link on the act each time Lagasafn published a routine amendment.

Repeat runs are cheap. An act whose stored codex version still matches the index's is skipped without being fetched, so a run against an unchanged Lagasafn release makes a single request in total.

`citations` links judgments to provisions where the article and its act appear together in the text ("1. mgr. 175. gr. laga nr. 91/1991"), storing the citing sentence and its offset so the UI can show why a case matched and jump to the passage. It is incremental on `Document.citationScanHash` vs `Document.textHash`, so it rescans only judgments whose text changed. Ingesting a previously unknown act clears that watermark automatically, because a new act is a link target nothing has been compared against and no judgment's text has changed to trigger a rescan on its own. To force a full rescan by hand:

```sql
UPDATE "Document" SET citation_scan_hash = NULL;
```

Bare references ("skv. 5. gr." with the act named earlier in the judgment) are deliberately *not* resolved: measured over the corpus, carrying the last-named act forward is reliable only within a few hundred characters and wrong more often than not beyond that. `CaseProvisionLink.matchType` exists so such links can be added later as a separately-trustable class. See `docs/phase-0-acts-provisions.md`.

**Scale note:** the full archive is 40k+ judgments — far more than a single run should attempt at once. `INGEST_MAX_PAGES` bounds how much a run pulls; the adapter persists a resume cursor per court filter (the `IngestCursor` table) after every page, so repeated runs — including a scheduled job that knows nothing about previous runs — automatically continue from wherever the last one left off, no manually-advancing page offset required.

## Deploying to Railway

This repo runs as **two Railway services** from the same GitHub repo: the always-on website, and a scheduled job that backfills the judgment archive in the background.

### Website service

1. Deploy the repo as a Railway service (New Project → Deploy from GitHub repo) and add a PostgreSQL database in the same project.
2. On the app service, go to **Variables** → **Add Reference Variable** → select the Postgres service's `DATABASE_URL`.
3. The repo's `railway.json` already sets the **Pre-Deploy Command** to `npm run db:deploy`, so this runs automatically on every deploy — entirely from the Railway website, no CLI required. It runs `prisma db push` (creates/updates tables from `schema.prisma`) and the search setup script (`pg_trgm`/`unaccent` extensions, the full-text search function, the `search_vector` column and its trigger, and the GIN/trigram indexes) against the linked `DATABASE_URL`, with no `psql` binary required. The first deploy after the `search_vector` column was introduced backfills it for every existing row, so expect that one pre-deploy run to take noticeably longer than usual. (If you'd rather manage this from the dashboard instead, remove `deploy.preDeployCommand` from `railway.json` and set the same command under **Settings** → **Deploy** → **Pre-Deploy Command**.)
4. Deploy. `npm install` will also run `prisma generate` automatically (via `postinstall`) before `next build`, so the Prisma Client exists at build time.

### Ingestion service (scheduled)

Ingestion used to run as part of the website's pre-deploy step, but a 200-page batch takes ~50 minutes — turning every ordinary code deploy into a long wait, and risking the site briefly going down for an unrelated reason. It's now a separate service that runs on a timer instead:

1. In the same Railway project, **New Service** → **GitHub Repo** → select this same repo.
2. In that service's **Settings** → **Config-as-code**, set the **Config File Path** to `railway.ingest.json` (instead of the default `railway.json`) — this is what makes it a distinct scheduled job rather than another copy of the website.
3. Give it the same `DATABASE_URL` reference variable as the website service (and `SEARCH_PROVIDER`/Meilisearch variables too, if you're using Meilisearch instead of the default Postgres full-text search).
4. `railway.ingest.json` sets `deploy.cronSchedule` to `0 6 * * 1` (Mondays 06:00 UTC) and a start command that chains the three adapters: new judgments (`INGEST_MODE=recent`), then acts (`lagasafn`), then `citations` to link whatever arrived. Railway spins up a container on that schedule, runs it to completion, then stops it until the next firing — no always-on dyno needed for this service.

   The acts step is deliberately left unbounded so that the first firing loads the whole corpus (~900 acts, ~22 minutes at the default delay) rather than splitting it across firings. Splitting it would be worse than slow: `citations` runs in the same firing, so acts arriving in a *later* firing would find every judgment already marked as scanned and would never be linked to. `LAGASAFN_MAX_ACTS` still exists for bounding a manual run.

   After that first firing the step is nearly free: an act whose codex version still matches the index's is skipped without being fetched, so an unchanged Lagasafn release costs one request. The citations step only rescans judgments whose text changed, so a quiet week does almost nothing. The exception is deliberate: when `lagasafn` ingests an act the database has never held, it clears the citation watermark, so the citations step in the same firing re-links the whole corpus against it. Without that, a late-arriving act would never be linked to anything — the judgments' text has not changed, so they would never be rescanned.
5. No manual redeploys needed after this. Progress is visible at `/admin/ingestion` on the website.

This used to fire every 2 hours to backfill 2000 cases a run; with the archive backfilled, a weekly incremental run is all that's needed, and a week with nothing new does almost no work. If you ever need to backfill again — a fresh database, or a gap — drop `INGEST_MODE=recent` from the start command and raise `INGEST_MAX_PAGES`; the `IngestCursor` table means each firing continues where the last one stopped.

Note: this repo uses `prisma db push` rather than `prisma migrate`, so there's no `prisma/migrations` folder — `npm run db:deploy` (not `prisma migrate deploy`) is the correct pre-deploy command here. If you later want real migration history for a production database, run `npx prisma migrate dev --name init` locally once, commit the generated `prisma/migrations` folder, and switch the pre-deploy command to `npx prisma migrate deploy && npm run db:setup-search`.

## Legal note

This tool searches and links to public judgments. It always displays the official island.is URL, does not present itself as an official publisher, and displays on every page: *"This is an unofficial research tool. Always verify text against the official source."*
