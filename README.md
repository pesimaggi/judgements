# Lögbrunnur

An MVP search engine for **Icelandic court judgments only** — Hæstiréttur Íslands, Landsréttur, and Héraðsdómar — sourced from island.is's public GraphQL API.

> **Disclaimer shown throughout the app:** This is an unofficial research tool. Always verify text against the official source.

This is a deliberately narrowed build: no CJEU. The three Icelandic courts published at [island.is/domar](https://island.is/domar), searched properly — plus Endurupptökudómur and [Félagsdómur](https://felagsdomur.is/domar-og-urskurdir/), the EFTA Court, Umboðsmaður Alþingis, the 40 administrative appeal boards that publish at [stjornarradid.is](https://www.stjornarradid.is/gogn/urskurdir-og-alit-/), the EEA law in force — the [EEA Joint Committee decisions](https://www.efta.int/eea-lex) that incorporated it and the [EFTA Surveillance Authority](https://www.eftasurv.int/esa-at-a-glance/publications/public-access-to-documents/public-documents) documents enforcing it — and two peer-reviewed Icelandic legal journals for the commentary on them.

## What's in the MVP

- **Search UI** — main search bar, left-side panel with every source as an opt-in checkbox, filters (date range, year, sort), result cards with highlighted snippets, and paginated results (15 per page). Sources are grouped, and a group of more than eight (the 40 úrskurðarnefndir) folds down to one line showing how many of it are ticked, so a long list cannot bury the courts above it. A group with something already ticked opens itself — a filter you cannot see is a filter you will forget you set.
- **Strict opt-in sources** — nothing is selected when the app opens, the Search button is disabled until at least one source is ticked, selected sources are shown as removable chips above the results, and the API itself returns `400 Select one or more sources to search.` if called without sources. The UI says *sources*, not *courts*: the panel is six courts, the Ombudsman, forty appeal boards and two journals, and calling all of that "courts" was wrong on three counts out of four.
- **Case summaries** — where a judgment carries its own `Útdráttur` section, result cards offer it behind a disclosure arrow, so you can read the court's own summary without opening the full text.
- **Full document page** — structured metadata, the judgment typeset as readable prose (headings, paragraphs, numbered clauses, quoted passages) with highlighted hits, search-within-document, copyable citation, official-source link, related cases via case-number citation extraction.
- **Icelandic acts (lög)** — the in-force text of Icelandic law from [Lagasafn](https://www.althingi.is/lagas/), parsed into chapters (kaflar), provisions (greinar) and paragraphs (málsgreinar), with an act reader at `/log/{actNumber}-{year}`.
- **Provision-level case linking** — each provision shows how many decisions cite it ("12 úrlausnir vísa til þessa ákvæðis"), expanding to the citing cases with the sentence the citation was found in, so you can see *why* a case matched before opening it.
- **Act catalogue** — `/log` lists every ingested act with its provision count and how many judgments cite it, searchable by title, short name or number, and sortable by most-cited.
- **Specific search** — alongside the keyword search, two live lookups that narrow the results, each accepting several selections that combine as AND: an act/provision box that takes the citation as it is written ("lög um aðbúnað og hollustuhætti" finds the cases about the act; "57. gr. a. laga um aðbúnað og hollustuhætti" narrows to the cases citing that article), and a subject-tag box. Acts match on title, citation number, or the short names judgments actually use — "vaxtalög" finds lög nr. 38/2001.
- **Administrative case law** — the úrskurðarnefndir, kærunefndir and ministry appeal desks at stjornarradid.is, each board its own tickable source rather than one undifferentiated pile. For immigration, benefits, tenancy, procurement and freedom of information this is where the case law actually is, and a search of the courts alone would miss it. See *Úrskurðarnefndir og ráðuneyti* below.
- **Database schema** (Prisma/PostgreSQL) — `Document`, `Source`, `IngestionRun`, `Act`, `Chapter`, `Provision`, `ProvisionParagraph`, `CaseProvisionLink`, `CaseActLink`.
- **Search** — PostgreSQL full-text search (default, zero extra infrastructure) with a provider abstraction; a Meilisearch provider is included and can be switched on with one env var. Ranking reads a materialized `search_vector` column, so a broad query over thousands of hits stays in the low hundreds of milliseconds.
- **Ingestion adapters** — `icelandic-courts` (island.is's public GraphQL API) runs every 3 hours and pulls only what's new; `lagasafn` ingests every in-force act; `citations` links judgments to the provisions they cite; `efta-court` ingests the EFTA Court case register; `eea-lex` ingests the EEA Joint Committee decisions **in force** (~9,164 acts, and retires one when it falls out of force); `eftasurv` ingests the EFTA Surveillance Authority's ~6,725 public documents; `umbodsmadur` ingests the Ombudsman's opinions and letters; `felagsdomur` ingests the labour court, both halves of it; `uua` ingests Úrskurðarnefnd umhverfis- og auðlindamála (~3,000 planning and environmental rulings, on its own site); `obyggdanefnd` ingests the þjóðlendu commission's 84 úrskurðir; `neytendamal` ingests Áfrýjunarnefnd neytendamála; `stjornarradid` ingests the 40 úrskurðarnefndir and ministry appeal desks (~23,700 rulings, the largest source in the app); `logretta` and `ulfljotur` ingest two peer-reviewed legal journals (see below).
- **Scholarly commentary** — Tímarit Lögréttu and Vefrit Úlfljóts, searched alongside the case law rather than in a separate silo, so a query about an unsettled point returns both the judgments and the articles arguing about them. Articles are indexed in full but read at the journal that published them: their cards and pages link out rather than reproducing the text here.
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

The scheduled ingest service (`railway.ingest.json`) fires **every 3 hours**
(00:00, 03:00, 06:00 … UTC). The Icelandic archive runs in incremental mode:

```
INGEST_MODE=recent INGEST_MAX_PAGES=40 npm run ingest -- --adapter=icelandic-courts
```

`INGEST_MODE=recent` walks island.is's newest-first feed and stops once it has
seen `INGEST_STOP_AFTER_KNOWN` (default 40) consecutive cases it already holds.
Cases already stored are skipped *before* their detail page is fetched, which
is the rate-limited, expensive part — so a firing with nothing new costs a
couple of list queries and no document fetches at all. That is what makes a
3-hourly cadence cheap: the incremental passes idle, and the run's time goes to
the rolling backfills that still have an archive to work through.

The trade-off: a judgment that is amended after we stored it won't be noticed.
Set `INGEST_RECHECK_KNOWN=1` to re-fetch and re-hash known cases, or run a
backfill sweep, which always compares text hashes.

The backfill sweeps are still there for a fresh database or a gap:

```
npm run ingest -- --adapter=icelandic-courts                  # year-chunked, all courts
INGEST_COURT=Hæstiréttur npm run ingest -- --adapter=icelandic-courts
```

Both resume from `IngestCursor`, so repeated runs continue where they stopped.

The stjornarradid boards run on the same 3-hourly schedule and the same three
modes (`recent`, `backfill`, `retry`), each board with its own cursor. Their
archive is the one still being backfilled — see *Úrskurðarnefndir og
ráðuneyti* below for the knobs and the one-off seeding run.

## Sources

`src/lib/sources.ts` is the registry. Each source is `live` (ingested and
offered in the search UI) or `pilot` (adapter still being built — a valid
source key for ingestion and the API, but hidden from the UI so nobody ticks a
court that would return nothing).

Each source is also a `kind`: a `decision` (a court judgment, a board's
úrskurður, an ombudsman opinion) or `scholarship` (a journal article). The
distinction is not cosmetic — it decides what the citation job scans, and
therefore what the act reader is allowed to count. See *Ritrýnd fræðirit*
below.

**A note on vocabulary.** The app began as three courts and its copy said so:
the search UI talked about "courts" and the act reader counted "dómar". It is
now six courts, the Ombudsman, forty appeal boards and two journals, and most
of what it holds is neither a court nor a dómur. So the UI says **sources**
where it used to say courts, and the act reader counts **úrlausnir** — the
Icelandic term that covers a dómur and an úrskurður alike — where it used to
say dómar. The source keys, the `?sources=` query and the database columns are
unchanged; this is copy, not schema.

| Source | Status | Language stored |
|---|---|---|
| Hæstiréttur Íslands, Landsréttur, Héraðsdómar, Endurupptökudómur | live | Icelandic |
| Félagsdómur | live | Icelandic |
| EFTA Court | live | English |
| Sameiginlega EES-nefndin — EEA Joint Committee decisions in force (efta.int/eea-lex) | live | English |
| EFTA Surveillance Authority (eftasurv.int) | live | English |
| Umboðsmaður Alþingis | live | Icelandic |
| 40 úrskurðarnefndir, kærunefndir and ministry appeal desks (stjornarradid.is) | live | Icelandic |
| Úrskurðarnefnd umhverfis- og auðlindamála (uua.is) | live | Icelandic |
| Óbyggðanefnd (obyggdanefnd.is) | live | Icelandic |
| Áfrýjunarnefnd neytendamála (neytendastofa.is) | live | Icelandic |
| Tímarit Lögréttu | live | Icelandic |
| Úlfljótur (vefrit) | live | Icelandic |

### Félagsdómur

The labour court. It rules on collective agreements and on the legality of
industrial action under lög nr. 80/1938 and nr. 94/1986 — a court in its own
right, not one of the úrskurðarnefndir, and it is grouped with the courts.

It was in the app before this, but only as one of the stjornarradid boards, and
only 107 cases of it. **Its archive is split across two sites**, and neither
half is the whole of it:

| Where | What |
|---|---|
| [felagsdomur.is](https://felagsdomur.is/domar-og-urskurdir/) | case numbers from 2010 on — 200 judgments and úrskurðir, F-1/2010 to the present |
| [stjornarradid.is](https://www.stjornarradid.is/gogn/urskurdir-og-alit-/), `Committee=Félagsdómur` | case numbers up to 2009 — 106 cases, the last handed down 1 November 2010 |

**One adapter reads both.** `felagsdomur` owns the court end to end;
Félagsdómur is deliberately absent from `ADR_BOARDS`, so the stjornarradid
adapter does not touch it.

The two sets are disjoint: the split is by case *number*, not by decision date,
which is why the older site still carries cases decided in 2010 (nr. 6/2009,
9/2009, 11/2009, 10/2009) and why nothing is stored twice. stjornarradid.is
says as much itself, with a placeholder entry in the listing reading "Dómar
Félagsdóms frá 2010 og til dagsins í dag eru á felagsdomur.is".

That signpost is counted in the older site's 107 but is not a case — it has no
ruling on its page. The adapter recognises it by the one thing every real entry
has and it does not, a case number in its title, and drops it from the listing
rather than fetching it and then filing it as a gap. So the archive is 106
cases and the source's total is **306**.

**Both halves are stored as one court**, and that means more than sharing a
checkbox. Read as a board, the pre-2010 cases came out visibly different from
the rest of the same court, in four ways at once:

| | as a board | now |
|---|---|---|
| case number | `10/2009` | `F-10/2009` — F-prefixed on both halves |
| title | `Mál nr. 10/2009: Dómur frá 1. nóvember 2010` | the parties, as on the newer half |
| the parties | filed under a `Lykilorð` heading and indexed as a subject tag | the title; no subject tags, because the court published none before 2010 |
| `D Ó M U R:` | left letter-spaced | collapsed, as on the newer half |

The third of those was a genuine misreading: stjornarradid's listing has an
abstract field that holds index terms for every other body on the site, and
holds the *parties* for this court. Read as terms, every pre-2010 case went
into the subject-tag lookup under its own parties.

The F- prefix is the court's own current label and is added to the older half,
which does not print one. The judgments themselves print the bare form in both
eras ("í málinu nr. 10/2009", "Mál nr. 2/2026"), so that form stays findable in
the full text either way.

#### How it is read

Verified against the live site (August 2026):

- **robots.txt** disallows `/extensions/`, `/lisa/` and `/Domar` for every
  user-agent. Nothing the adapter fetches is under any of them: the listing is
  `/domar-og-urskurdir/` and `/default.aspx`, and the judgments are
  `/Cache/Verdicts/*.pdf`.

- **The archive listing** is one page of the stjornarradid search, filtered to
  `Committee=Félagsdómur`. The site returns 200 results a page and the archive
  is 107 entries, so there is no walk to bound. Those rulings are published
  inline on their pages, so there is no PDF to prefer.

- **The live listing** is the page's own "Birta fleiri færslur" endpoint —
  `/default.aspx?pageitemid=…&offset=N&count=M`, server-rendered HTML with no
  session and no `__VIEWSTATE`. It carries everything about a case except its
  text: case number, parties, date, the court's own index terms, and its
  útdráttur where one has been written. `pageitemid` is a CMS GUID, so it is
  read off the button rather than hardcoded — a re-deploy changes it, and a
  stale GUID returns an empty list, which is indistinguishable from "nothing
  new". The server caps a page at about 22 items whatever `count` asks for, so
  the walk uses 20.

- **The text is the PDF**, at `/Cache/Verdicts/<id>.pdf`, derived from the
  case's id so a judgment costs exactly one request. The detail page does carry
  a text layer of its own, but it is visibly lossy — whole words are dropped
  from it — so it is only the fallback for a case whose PDF cannot be had.

- **Letter-spaced headings.** Félagsdómur sets its headings with a space
  between every letter: `F É L A G S D Ó M U R`, `D ó m u r   F é l a g s d ó m s`,
  `D Ó M S O R Ð:`. pdf-parse reproduces that faithfully, and left alone it is
  unreadable, unsearchable (nothing tokenises to "Félagsdómur") and not
  recognised as a heading. `unspaceLetterSpacing` collapses it, narrowly: every
  token in the line has to be a single letter, so initials, dates and ordinary
  prose are untouched.

- **The date is the listing's**, and deliberately not re-read from the
  judgment. This court publishes as it decides, and across a sample spanning
  the whole archive the listing's date agreed with the date the judgment gives
  itself in every case. Going looking would be strictly worse: the older
  judgments put the year and the day in different clauses ("Ár 2010,
  mánudaginn 21. mars, var í Félagsdómi …"), so the first full date in the
  opening is as likely to be the day the case was taken to judgment as the day
  it was decided.

- **Útdráttur.** 15 of the 200 have one; the rest of the listing's abstracts
  read "Útdráttur birtur síðar", which is a promise rather than a summary and
  is dropped. Judgments from about 2020 print their own `Lykilorð` and
  `Útdráttur` at the head of the PDF, so the listing's copies are prepended
  only when the judgment does not already carry them.

#### Running it

```
npm run ingest -- --adapter=felagsdomur                 # the whole listing
INGEST_MODE=retry npm run ingest -- --adapter=felagsdomur   # gap ledger only
```

There is no backfill mode, and that is not an omission. The other adapters
carry cursors and a separate sweep because their archives run to thousands of
cases; this one is 306. Every run walks both listings in full — ten pages of
twenty at felagsdomur.is, one page of two hundred at stjornarradid.is — and
fetches only what is missing, which on a quiet run is nothing at all. A fresh
database is seeded by one run (raise `INGEST_MAX_CASES` past 306, or run it
twice).

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
where those PDFs live.

The adapter therefore keeps that step behind `EFTA_FETCH_DOCUMENTS=1`, off by
default, so a clone of this repo does not crawl a disallowed path by accident.
Without it, a case is stored as its **record** — metadata, subjects, the
Court's own summary, and the documents as links — which is a complete,
searchable case register but not judgment text. With it, the English decision
PDF is downloaded per case and its text appended, giving true full-text search.

**This deployment runs with it on**: the flag is set explicitly in
`railway.ingest.json`, so the choice is recorded where it is made rather than
buried in a default. EFTA case law is public and the corpus is ~460 documents,
fetched once and then only when the Court republishes one. If you fork this,
that is your decision to make again, not one to inherit.

```
INGEST_PROBE=1 npm run ingest -- --adapter=efta-court   # what the site serves now
EFTA_FETCH_DOCUMENTS=1 npm run ingest -- --adapter=efta-court   # the whole register
```

The first full run fetches two documents per case at the shared
`INGEST_DELAY_MS` and takes roughly 25 minutes; later runs skip everything the
sitemap says is unchanged and finish in seconds.

Runs are incremental: a case page is only re-fetched when the sitemap's
`lastmod` is newer than the last time we stored it, so pending cases still
refresh as their court diary moves. `INGEST_FULL=1` forces a full re-walk.

### EEA Joint Committee decisions in force (EEA-Lex)

The EEA Agreement works by incorporation: an EU act becomes EEA law when the
**EEA Joint Committee** decides to take it in. EFTA keeps the register of that
at [EEA-Lex](https://www.efta.int/eea-lex), a factsheet per act naming the
Joint Committee Decision (JCD) that incorporated it, the Annex or Protocol it
landed in, the dates it moved through, and the decision's own text in English,
Icelandic, Norwegian and German.

**Only what is in force.** EEA-Lex's Case Status facet separates *Incorporated
into the EEA Agreement and in force* (9,164 acts) from *Incorporated into the
EEA Agreement but no longer in force* (5,421) and from the four
pre-incorporation stages. `src/ingestion/adapters/eea-lex.ts` walks the first
of those and nothing else — `case_status:14`, the same filter the site's own
URL carries — so a hit here is never an act that has been superseded.

That filter is a *standing* one, not just a starting point. An act that falls
out of force leaves the listing, and the adapter **retires** the stored record
to match; without that step "in force" would quietly come to mean "was in force
when we first saw it". Retirement is deliberately timid: it happens only after
a walk that reached the end of the listing and read at least as many factsheets
as the facet announced, and a run that wants to delete more than 20% of the
source (or 50 records, whichever is more) refuses and says so instead. A
listing that changes shape should cost a log line, not nine thousand rows.

**How it lists.** `items_per_page=60` with `sort_bef_combine=decision_ASC`
(oldest decision first) gives 153 stable pages — 152 full and a last of 44,
exactly the 9,164 the facet announces. The sort is pinned rather than left at
the site's default because a relevance-ordered walk can shuffle between
requests, and a page-by-page walk of a shuffling list both misses and repeats
rows. The facet's own count is the denominator for the progress bar, so the
number on the front page is EFTA's, not an estimate.

**Not every act in force came in by a decision.** The oldest entries were in
the Agreement when it was signed: their JCD field holds "Part of the EEA
Agreement at the time of signing in 1992." instead of a number, and their
history is dated 01.01.1994, the day the Agreement entered into force. They
belong here and are stored — with no case number and with EFTA's own words as
their title, rather than dressed up as a decision the Joint Committee never
took.

**The JCD PDFs are deliberately not fetched**, and this one is not a
robots.txt question — efta.int disallows `/core/`, `/profiles/`, `/admin/`,
`/search/` and the user paths, none of which is involved. It is a measured
one. A single JCD incorporates many acts at once, so its text is shared across
hundreds of factsheets; and JCD 7/1994's PDF is 213 pages and 457,000
characters. Appending it per factsheet would store the same half-megabyte over
and over for no gain a reader could use. The record therefore carries the
decision's identity, its dates, and a link to its text in each language, and
`officialUrl` points at the factsheet the reader can open any of them from.

```
npm run ingest -- --adapter=eea-lex --dry-run   # what it would store
npm run ingest -- --adapter=eea-lex             # bounded pass, oldest first
INGEST_MODE=retry npm run ingest -- --adapter=eea-lex
```

Bounded and resumable without a cursor: every run walks the whole listing,
diffs it against what is stored, and spends `INGEST_MAX_CASES` on the oldest
thing missing. A quiet run costs the 153 listing fetches and no detail fetches
at all. At the default budget a fresh database fills over about a month of
three-hourly firings.

**A note on pace.** efta.int answers 429 if pushed, so the shared fetcher now
retries on 429 as well as 5xx and honours `Retry-After` when the server sends
one. At the default `INGEST_DELAY_MS=1500` a full 153-page walk completes
cleanly; below about a second it does not.

### EFTA Surveillance Authority

ESA is the enforcement half of the EEA: it polices whether Iceland,
Liechtenstein and Norway actually apply the acts the Joint Committee
incorporated. Its [public document
database](https://www.eftasurv.int/esa-at-a-glance/publications/public-access-to-documents/public-documents)
is the paper trail of that work — **6,725 documents** back to 1994: College
decisions, letters of formal notice, reasoned opinions, closure decisions,
referrals to the EFTA Court, requests for information, the states' replies, and
the State aid notifications under the block exemption regulation.

For an Icelandic researcher this is the missing middle of a chain the app
already carried at both ends: the act incorporated (EEA-Lex, above), the
enforcement correspondence (here), and the judgment when it reaches Luxembourg
(the EFTA Court).

**The page is a single-page app, so its HTML is empty** — fetching it yields
"You need to enable JavaScript to run this app". The app reads a plain JSON
API, and so does `src/ingestion/adapters/eftasurv.ts`:

```
/cms/api/node?url=<page alias>&search=page%3D<n>
```

`search` carries what would have been the page's query string, which is where
the paging lives; a bare `&page=` on the API URL is ignored. The response gives
`nodesCount` (6,725), `nodesPerPage` (50) and the page's nodes. Asking past the
last page returns the last page again rather than an empty one, so the walk
stops on the count the API reports, not on an empty response.

Each node is one document — title, ESA case number and case name, document
type, the state it concerns, ESA's document number, a date, and the PDF. There
is no page per document, so **the PDF is the `officialUrl`**, as it already is
for Óbyggðanefnd and Áfrýjunarnefnd neytendamála. ESA's document number is not
unique — one number covers a set of documents sent together — so the attachment
URL is the identity.

**The PDFs are fetched**, unlike the EFTA Court's, on two checked grounds.
eftasurv.int's robots.txt is `User-agent: *` with an empty `Disallow:` and two
query strings excluded: nothing here is off limits. And the record without the
PDF would be nearly empty — a node carries a title and a case name and no prose
at all — so the document's own text is the whole substance of this source. A
sample of fourteen documents across the full date range extracted text from all
fourteen; these are digital PDFs, not scans.

Bounded and resumable on the same pattern as the other archives: every run
enumerates the database (135 API calls), diffs it against what is stored, and
spends `INGEST_MAX_CASES` fetches on the oldest thing missing.
`INGEST_MODE=retry` works the gap ledger and enumerates nothing.

### Umboðsmaður Alþingis

Not a court: the Ombudsman issues *álit* (formal opinions) and *bréf* (letters
closing a case). Both are ingested, and which one a document is shows as the
heading over its body.

There is no usable list endpoint — the site's own search is an ASP.NET
WebForms page driven by `__VIEWSTATE` postbacks. It does not need one: case
pages are addressed by a plain sequential integer,
`/alit-og-bref/mal/nr/{id}/skoda/mal/`, so walking that id space *is* the list.
Ids run 1 to about 11,455, with gaps that answer 404.

One fetch per case is enough. `/skoda/reifun` shows only the summary, while
`/skoda/mal/` carries the summary (`div.reifun`) and the full opinion
(`div.alit`) together. The summary is stored under an **Útdráttur** heading —
the same one Hæstiréttur uses — so it reaches result cards through the existing
extraction with no special-casing, and the subject line becomes the document's
tags.

The walk runs newest first and skips ids already stored without an HTTP
request, so the same pass both backfills history and picks up new cases. That
makes the scheduled run cheap; the initial backfill is the expensive one:

```
INGEST_MAX_CASES=20000 npm run ingest -- --adapter=umbodsmadur
```

At the shared `INGEST_DELAY_MS` that is roughly five hours for the full
archive. It is safe to interrupt and re-run — anything already stored is
skipped on the next pass.

### Úrskurðarnefndir og ráðuneyti

Iceland's administrative appeal bodies — the **40** úrskurðarnefndir,
kærunefndir, matsnefndir and ministry appeal desks that publish at
[stjornarradid.is/gogn/urskurdir-og-alit-](https://www.stjornarradid.is/gogn/urskurdir-og-alit-/).
About **23,700 rulings**, which is more than everything else in the app put
together.

This is the layer of decisions between an agency and the courts, and for whole
areas of law it is where the case law actually is: immigration
(Kærunefnd útlendingamála, 4,846 cases), benefits and social insurance
(Úrskurðarnefnd velferðarmála, ~8,100 across its six divisions), tenancy
(Kærunefnd húsamála, 2,013), public procurement (Kærunefnd útboðsmála, 1,417),
freedom of information (Úrskurðarnefnd um upplýsingamál, 1,383). A researcher
who searched only the courts for any of those would be looking in the wrong
place.

**Each board is its own source.** They arrive through one search endpoint, but
a ruling of Kærunefnd útboðsmála and one of Mannanafnanefnd have nothing to do
with each other, and a researcher wants to tick the one they mean. So every
board gets its own key, its own checkbox and its own row on the progress page.
`src/lib/adr-boards.ts` is the registry, and `src/lib/sources.ts` derives the
40 `SourceDef`s from it rather than keeping a second copy in step by hand. The
site's own dropdown has 41 entries; the one left out is Félagsdómur, which
publishes half its archive here but is a court — see *Félagsdómur* above.

Three identifiers are in play there, and they are not interchangeable:

| | Whose | Used for |
|---|---|---|
| `key` | ours | the `source` column and the `?sources=` query — never change it once documents carry it |
| `committee` | the site's | the exact `Committee=` value its search accepts; its own primary key for a board |
| `boardId` | the site's | the GUID of the board's own page, where it has one — only about a quarter do |

`key` is hand-written rather than slugified from the name, because the site
does rename boards when ministries merge and split, and a derived key would
silently split a board's archive in two. Two `committee` values are not what
they look like: several carry U+066B ARABIC DECIMAL SEPARATOR where a comma
belongs, and "Álit\u00A0á sviði sveitarstjórnarmála" has a non-breaking space
after "Álit". Both are written as escapes so they survive an editor, a linter,
and anyone who "fixes the typo" — change either and the board returns nothing.

**robots.txt allows this.** `User-agent: *` is `Allow: /`, and the Cloudflare
content signals are `search=yes, ai-train=no, use=reference` — which is exactly
what this project does: index for search, show a snippet, link back to the
official page. Several named AI crawlers are disallowed by user-agent; ours is
not one of them and must not pretend to be any of them.

The listing is a plain GET — no `__VIEWSTATE`, no JavaScript, no session. The
query string is the whole API: 200 results a page, newest first, and a
"Sýni 1-200 af 23714 niðurstöðum" line that gives each board's live total for
free (written to `Source.totalAvailable` on every run, so the progress page
compares what we hold against what exists rather than against a figure someone
wrote down once). One more fetch per ruling gets the whole text from
`section.single-news__content`.

#### What the parsing has to get right

Four things that are wrong in the obvious implementation, each caught against
live pages:

- **The ruling's date is not the date it was published.** Boards publish in
  batches: three procurement rulings all decided 3 July 2026 appeared in the
  feed on 27 August, and an immigration ruling of January 2025 eighteen months
  later. Filing those under the publication date puts them in the wrong year
  for every date filter in the app. So the date is taken from the title
  ("Úrskurður frá 3. júlí 2026") first, then from the opening of the ruling —
  these decisions open by saying when they were made — and only then from the
  publication date. A candidate *later* than publication is rejected as a
  mis-parse.

- **`<br>` is a line break, and that decides whether summaries work.** These
  boards write a heading and its text as one paragraph split by a `<br>`:
  `<p><strong>Útdráttur</strong><br /><em>Ágreiningur aðila laut að …</em></p>`.
  Collapse the break and the line reads "Útdráttur Ágreiningur aðila…" — the
  heading swallowed by its own text — and since the summary extractor matches
  a line that is *only* "Útdráttur", every ruling loses the summary its board
  wrote for it.

- **The summary needs an end.** `extractSummary` reads from "Útdráttur" to the
  next heading, and these rulings put no heading over their opening — they
  simply start, "Með kæru móttekinni …". Left alone, the whole first half of
  the case became the "summary" on the result card. The boards *do* mark the
  boundary, in italics rather than in words: the summary is set in `<em>` and
  the ruling is not. The adapter reads that and writes the boundary out as a
  heading, which is what the Umboðsmaður adapter does with "Álit"/"Bréf".

- **Not every ruling has an "n/yyyy" case number.** The nefndir number theirs
  that way; the ministry appeal desks mostly do not — they title by subject and
  carry the ministry's own file reference instead ("IRN26050091",
  "DMR19070007", "MNH25030169"), which is the number printed on the decision
  and the one a researcher has in hand. Matching only "12/2026" left a third of
  the ministry desks' rulings with no case number at all. Úrskurðarnefnd
  raforkumála writes a period where the slash belongs, "í máli nr. 7. 2025",
  and is stored as "7/2025".

- **Index terms are not split on every full stop.** The terms cite
  legislation, so "Vörusamningur. Reglugerð nr. 340/2017. Frávísun." split
  naively yields the tags "Reglugerð nr" and "340/2017" — two fragments where
  one term belongs, both junk in the tag lookup. A split needs a capital after
  it; the abbreviations that cause the trouble ("nr.", "gr.", "mgr.") are
  always followed by a number.

#### Rulings published as PDFs

Two boards — Úrskurðarnefnd raforkumála and Nefnd vegna lausnar um
stundarsakir — publish a one-line page linking a PDF, and that PDF *is* the
ruling. The adapter follows the link when, and only when, the page's own body
is too thin to be the ruling, and reflows the extracted text through
`normalizeJudgmentText` the same way the courts adapter does.

Some of those PDFs carry a custom font encoding with no usable ToUnicode map,
and pdf-parse returns confident-looking rubbish: *"Urskurdur f rskurdarnefndar
raforkum6la i m6li nr. 712025"*. Stored, that is worse than storing nothing —
90 kB of noise in the search index under a title that reads as a real ruling,
which no reader could tell from the real thing until they opened it. So
extracted text is checked for being Icelandic at all before it is indexed:
every readable ruling runs 9–12% á ð é í ó ú ý þ æ ö, and the mangled ones
0.01%. Below 2% it goes to the gap ledger with the reason, not into the index.
That currently costs the 24 cases of Úrskurðarnefnd raforkumála, which are
visible as open gaps rather than quietly absent.

One board's page is a pointer rather than a ruling — Matsnefnd samkvæmt lögum
um lax- og silungsveiði says its newer decisions are on Fiskistofa's site.
Those stay open gaps too, correctly: we do not hold them.

**Félagsdómur** publishes here too, and this adapter deliberately does not
touch it: it is a court, not an appeal board, and the `felagsdomur` adapter
reads both halves of it so that one court is stored one way. It is absent from
`ADR_BOARDS` for that reason, which is why this list is 40 where the site's
dropdown is 41. See *Félagsdómur* above.

#### Running it

Three modes, matching the Icelandic courts adapter:

```
npm run ingest -- --adapter=stjornarradid                    # INGEST_MODE=recent (default)
INGEST_MODE=backfill npm run ingest -- --adapter=stjornarradid
INGEST_MODE=retry    npm run ingest -- --adapter=stjornarradid
```

`recent` walks each board's newest pages and stops after
`INGEST_STOP_AFTER_KNOWN` (default 60) consecutive rulings it already holds. A
case already stored is skipped *before* its detail page is fetched, so a quiet
week costs 40 list queries and no document fetches at all.

`backfill` walks every page of every board, fetching only what is missing. It
is bounded and resumable: each board keeps its own `IngestCursor`, successive
runs carry the sweep forward instead of restarting at page 0, and a board that
reaches its last page wraps around to re-verify. `retry` works the gap ledger
and nothing else.

`STJORNARRADID_BOARDS` limits a run to named boards, which is how to bring one
board in without waiting for the rest:

```
STJORNARRADID_BOARDS=kaerunefnd-utbodsmala,mannanafnanefnd \
INGEST_MODE=backfill INGEST_MAX_CASES=2000 \
  npm run ingest -- --adapter=stjornarradid
```

#### Pulling one board to the front

The rolling backfill walks `ADR_BOARDS` in order and shares one case budget
across all 40, so a board partway down the list gets nothing at all until the
ones above it are complete. Kærunefnd húsamála sits third, behind Kærunefnd
útlendingamála (4,846 cases) and Almannatryggingar (3,453) — days of firings
before its first case would have been fetched.

So the default chain runs `stjornarradid-priority` **first**, before even the
cheap sources: one board, its own case budget, ahead of everything else. It is
two variables, both settable from the Railway dashboard without a code change:

| Variable | Default | What it does |
|---|---|---|
| `STJORNARRADID_PRIORITY` | `kaerunefnd-husamala` | board key(s), comma separated; **empty disables the pass** |
| `STJORNARRADID_PRIORITY_CASES` | `1200` | cases it may fetch per firing |

At 1,200 cases a firing, húsamála's 2,013 are in within two firings — under six
hours from the first run rather than several days. The pass shares the ordinary
per-board cursor, so nothing is re-walked, and the board keeps its progress when
the pass is switched off.

When the board is complete: set `STJORNARRADID_PRIORITY` to empty, and consider
putting `STJORNARRADID_BACKFILL` back to `1500` — it was lowered to `900` to pay
for the priority pass out of the same run rather than lengthening the run.

Seeding a fresh database is a one-off run of the on-demand ingest service with
`INGEST_ADAPTERS="stjornarradid-backfill"` and a much larger
`STJORNARRADID_BACKFILL`. At the shared `INGEST_DELAY_MS` the full 23,700 is
roughly ten hours, and it is safe to interrupt and re-run — the cursors and the
already-stored check pick it up where it stopped.

### Boards that publish elsewhere

Not every appeal board publishes through stjornarradid.is. A good many keep
their own register, and those are invisible to the `stjornarradid` adapter
because the one thing it is built on — a `Committee=` value on the ministries'
site — is exactly what they do not have. They belong in the same group in the
source panel (a researcher looking for planning appeals does not care which
server the rulings are on), so `EXTERNAL_ADR_SOURCES` in `src/lib/sources.ts`
registers them alongside the forty, each with an adapter of its own.

#### Úrskurðarnefnd umhverfis- og auðlindamála

Planning, building and environmental appeals: byggingarleyfi, framkvæmdaleyfi,
deiliskipulag, starfsleyfi and, lately, fish farming. **About 3,000 rulings
back to 1998** — the largest single body in the app after Kærunefnd
útlendingamála, and it was missing entirely. The board is the successor to
úrskurðarnefnd skipulags- og byggingarmála and carries that body's rulings as
its own archive, which is why the older ones open "kom úrskurðarnefnd
skipulags- og byggingarmála saman til fundar".

Verified against the live site (August 2026):

- **robots.txt** is `User-agent: *` with no `Disallow` line at all.

- **The whole index is one page.** `/listi-yfir-urskurdi` is a single
  server-rendered table of every ruling the board has published — 2,995 rows,
  about 3.7 MB. That is what makes the adapter simple: there is no pagination
  to walk and no cursor to keep, so every run sees the entire archive, diffs it
  against what is stored, and spends its budget on the oldest thing missing.
  Bounded by `INGEST_MAX_CASES` like the other archives, and resumable without
  any state of its own.

- **One fetch per ruling**, carried inline on its page — no PDF, no attachment,
  no JavaScript.

Three things about the data were not what they looked like:

- **The case number is in the link, not the column.** The index's first two
  columns are headed "Úrskurð. númer" and "Ártal" and they are the board's own
  ruling sequence, not the case number: for the oldest row the table says 3 /
  1998 while the ruling says "Fyrir var tekið málið nr. 2/1998". The real
  reference is in the link text, in both schemes the board has used —
  `2/1998 Laugavegur` and `UUA2606010 Sjókvíaeldi í Arnarfirði`.

- **Sixty-odd rulings decide several cases at once**, and write the numbers as
  prose sharing a year: `125 og 127/2021 Háafell`, `63, 73 og 75/2021
  Hringtún`, `85, 92, 96/2019 og 9/2020 Hagasel`. All of them are expanded (the
  bare numbers take the year from the first full reference to their right) and
  written into the record, so the ruling is findable by any one of its numbers;
  the first is what the card shows.

- **The opening line is often not in a paragraph.** "Árið 2017, fimmtudaginn
  19. janúar, kom úrskurðarnefnd …" is the only place a ruling states its own
  date, and on many pages it is a loose text node with no element around it. A
  sweep for `p, li, h2…` skips it silently and the ruling loses its date, so
  the text is read by walking the tree — every text node is text, every
  block-level element is a line break — rather than by collecting blocks.

The board has also written that opening four ways over thirty years: with and
without the comma after the year, with and without the point after the day, and
with no weekday at all. All four are matched. Sampled across the whole archive,
every ruling now yields a date and a case number.

```
npm run ingest -- --adapter=uua                    # oldest missing first
INGEST_MODE=retry npm run ingest -- --adapter=uua  # gap ledger only
```

#### Óbyggðanefnd

The commission that decided what is **þjóðlenda** — public commons — and what
is anybody's property, working the country through in twelve svæði from 1998 to
its final report in March 2026. Its rulings are the authority on land rights in
the highlands, cited in every þjóðlendumál that has reached the courts since.

**84 rulings, and they are unlike anything else here**: each is a PDF of 120 to
500 pages, one to five megabytes on the wire, up to 1.4 MB of stored text. The
whole source is about 180 MB of PDF. That is why its per-run budget is 12 and a
full backfill takes a handful of runs, and it is the one place where the
document-size headroom mattered: PostgreSQL refuses a `tsvector` over 1 MB, and
the longest of these produces 439 kB. Comfortable, but not by the margin
everything else in the app enjoys.

- **robots.txt** disallows `/wp-admin/` and nothing else.
- **The index is one page**, `/urskurdir/`, listing the rulings under a heading
  per svæði among about 300 links — the rest are úrskurðarkort (maps) and
  summaries. Rulings are the links whose text opens "Mál nr.". The 2023 rulings
  appear twice under two headings, so the walk dedupes: 90 links, 84 rulings.
- **There is no page per ruling.** The PDF *is* the document, so that is what
  `officialUrl` points at — the only source here where that is true.
- Each PDF's first four lines carry the case number, the land the case concerns
  and the date it was decided, in a form the commission has kept for thirty
  years, so all three are read from there rather than from the index. The index
  supplies the svæði, which is stored as a subject tag alongside "Þjóðlendumál".
- Case references come four ways and all four are in the archive: `4/2018`,
  `S-1/2011`, `3/2004 og 4/2004` and `3-4/2004`. The last two are the same
  thing — two cases joined — written differently in different years.

**Eleven of the 84 cannot be read at all.** The svæði 1 and 2 rulings (2000 and
2001) are typeset in a font with no usable ToUnicode map, and pdf-parse returns
400,000 characters of confident-looking rubbish: "⁄RSKUR–UR ”BYGG–ANEFNDAR m·l
nr. 1/2000 fiingvallakirkjuland og efstu jarir Ì fiingvallahreppi". They are
refused by the same Icelandic-character ratio check the stjornarradid adapter
uses and sit in the gap ledger with that reason, rather than putting half a
megabyte of noise into the index under a title that reads as a real ruling.
Remapping them is not on: tempting as the substitutions look (· = á, Ì = í,
fi = Þ), lowercase ð has no glyph in that encoding and is simply dropped —
"jarðir" arrives as "jarir". The text is lossy, not merely mis-decoded. So
expect this source to read 73 of 84.

```
npm run ingest -- --adapter=obyggdanefnd    # 12 rulings a run by default
```

#### Áfrýjunarnefnd neytendamála

The appeal board for consumer law — misleading advertising, price marking,
unfair commercial practices, product safety — hearing appeals against
Neytendastofa's own decisions. **228 rulings**, published on the site of the
agency whose decisions it reviews rather than through stjornarradid.is, which
is why it was missing.

- **robots.txt** disallows `/extensions/` and `/lisa/`; the index and the
  rulings are under neither.
- **The index is one page and a plain table** — `table.propertytable`, a row
  per ruling with its number, what the case was about, and a link. No
  pagination, no JavaScript. As with Óbyggðanefnd there is no page per ruling,
  so the PDF is the `officialUrl`.
- **The table has no date column** and every link is labelled "Nánar", so the
  ruling's own opening is the only source for it: "Þann 1. mars 2026 er tekið
  fyrir mál áfrýjunarnefndar neytendamála nr. 5/2025" (newer ones say "Hinn"
  for "Þann"). Worth reading rather than falling back on the case number's
  year, because this board runs well behind — case 5/2025 was decided in March
  2026, and the case number would have filed it a year early.
- The board publishes no index terms, so these carry no subject tags. An empty
  list is honest where a guess would not be.

226 of the 228 are stored, every one with a date and a case number. The two
missing are PDFs that extract no text at all, and sit in the gap ledger.

```
npm run ingest -- --adapter=neytendamal     # 120 rulings a run by default
```

#### Still missing

These publish for themselves too and are not yet ingested, roughly in the order
they are worth doing:

| Body | Where | Note |
|---|---|---|
| Yfirskattanefnd | [yskn.is](https://yskn.is/) | Tax appeals, by year back to 1973. The largest archive still missing. `/urskurdir/` is an *úrval*; the full set is behind `Leit í úrskurðum`. |
| Áfrýjunarnefnd samkeppnismála | [samkeppni.is](https://www.samkeppni.is/urlausnir/urskurdir/) | Searchable table, JavaScript-driven. |
| Áfrýjunarnefnd hugverkaréttinda | [hugverk.is](https://www.hugverk.is/utgafa/urskurdir-og-akvardanir) | JavaScript-driven listing. |
| Úrskurðarnefnd í vátryggingamálum; Úrskurðarnefnd um viðskipti við fjármálafyrirtæki | [fme.is](https://www.fme.is/eftirlitsstarfssemi/urskurdarnefndir/) | Both pages return ~6 kB of shell; needs a look before costing. |
| Málskotsnefnd Menntasjóðs | [menntasjodur.is](https://menntasjodur.is/msnm/malskotsnefnd/) | JavaScript-rendered. |
| Nefnd um dómarastörf | domstolasyslan.is | Register not located. |
| Matsnefnd um lax- og silungsveiði | fiskistofa.is | **Partial today**: the 15 older rulings come through stjornarradid; the newer ones are on Fiskistofa. |

A further group has no findable register at all — Kærunefnd vöru og
þjónustukaupa, Álitsnefnd um trúfélög, Úrskurðarnefnd sanngirnisbóta,
Ferðakostnaðarnefnd, Úrskurðarnefnd um Viðlagatryggingu, Úrskurðarnefnd
fjarskipta- og póstmála and Úrskurðarnefnd um skólagöngu fósturbarna. They are
listed on Stjórnarráðið's own page of nefndir with no link to any decisions.

### Ritrýnd fræðirit

Two peer-reviewed Icelandic legal journals, searched in the same index as the
case law. They answer a different question from a judgment — not *what was
decided* but *what the argument was* — and the two are most useful next to each
other, so they are ordinary sources in the source panel rather than a separate
feature.

They are registered as `kind: "scholarship"`, and that has two consequences
beyond the panel heading.

**Reading an article happens at the journal, not here.** A judgment is a public
record; an article is somebody's authored work. So the article text is indexed
— that is what makes it findable — and never republished: a result card's title
and its button both open the journal's own page in a new tab, and
`/api/documents/[id]` withholds `fullText` for a scholarly source, sending the
catalogue entry and the journal's own abstract instead. Reaching
`/document/{id}` directly gets that same catalogue entry — metadata, byline,
keywords, abstract, copyable citation, and a link out — rather than a reader.

There is exactly one route in, and it is the journal's article page. The direct
PDF link that judgments carry is deliberately not offered for an article: the
file is the journal's own, but it lands the reader on a bare document instead
of the page the journal publishes it on, with the byline, the licence terms and
the issue around it.

Search snippets are unaffected; those are cut server-side and are what a search
engine is for.

**The `citations` adapter skips them.** `CaseProvisionLink` is modelled as *a
decision in a case citing a provision*, and the act reader counts its rows as
"úrlausnir" — "12 úrlausnir vísa til þessa ákvæðis". An article citing 26. gr.
skaðabótalaga is worth finding, but an article is not an úrlausn — nobody
decided anything — and feeding it into that table would quietly make every one
of those counts wrong. Linking articles to provisions needs a link type and a
label of its own first.

#### Tímarit Lögréttu

A peer-reviewed Icelandic legal journal published out of the law faculty of
Reykjavík University — first issued at the end of 2004, electronic-only since
2024, double-blind review by at least two specialists in the field. 193
articles across 34 volumes, 2004 to date.

The site is a client-rendered Next.js static export — its HTML is a loading
spinner, so scraping an article page yields no article. What it renders from is
a public Prismic repository, and that is what the adapter reads instead:

```
https://logretta.cdn.prismic.io/api/v2                                   # master ref
/api/v2/documents/search?ref=…&q=[[at(document.type,"greinar")]]         # 196 entries
/api/v2/documents/search?ref=…&q=[[at(document.type,"timarit")]]         # 34 volumes
```

Everything comes back as structured data — title, author, abstract
(`urdrattur`), keywords (`efnisord`), page count, and a link to the volume the
article belongs to. Three of the 196 entries are not articles but whole volumes
filed alongside them, titled with the volume label; those are skipped, since
every article in them is indexed separately. Article pages are addressed by the
pair of Prismic ids (`/timarit/{volumeId}/{articleId}`), so the volume link is
what makes an article's `officialUrl` reachable at all.

**What is stored, and the robots.txt question.** Full article text lives in two
places. 19 articles carry it in the API's own `html` field, and that text is
stored. For the rest the body exists only as a PDF on
`logretta.cdn.prismic.io`, whose robots.txt is `Disallow: *.pdf` for every user
agent.

So by default a PDF-only article is stored as its **record** — title, author,
abstract, keywords, volume and page count, with the PDF kept as a link. That is
a real, searchable bibliography of the journal without fetching a path its host
asks crawlers to stay out of; 93 of the 193 articles carry an abstract or a
body this way, and the rest say plainly, under their `Meginmál` heading, that
the text is published as a PDF.

`LOGRETTA_FETCH_PDFS=1` additionally downloads each article PDF and appends its
text, giving full-text search over the whole journal. Same decision as
`EFTA_FETCH_DOCUMENTS`, and the same reasoning — except that this one is **off
in this deployment too**, because unlike the EFTA Court's, this robots.txt
disallows the exact files in question and the repository's own licence field
reads "All Rights Reserved". Turn it on with the journal's agreement, or on
your own considered reading of that robots.txt.

```
INGEST_PROBE=1 npm run ingest -- --adapter=logretta        # what the API serves now
npm run ingest -- --adapter=logretta                       # records + abstracts
LOGRETTA_FETCH_PDFS=1 npm run ingest -- --adapter=logretta # the whole journal
```

A run is three API calls and finishes in seconds; with PDFs on, the first run
fetches one per article at the shared `INGEST_DELAY_MS` and later runs fetch
none. A record whose body came out of a PDF is never recomposed from metadata
alone — doing so would replace the article with the "published as a PDF" note,
so the second run would undo the first. `INGEST_FULL=1` rebuilds everything.

#### Úlfljótur (vefrit)

The web journal of Úlfljótur, the law students' journal at the University of
Iceland — first issued in February 1947 and published every year since bar
1951, which makes it the longest-running academic journal at the university.
The web journal has its own academic editor and review committee. 47 articles,
2017 to date.

WordPress.com serves no `/wp-json/` on the custom domain, but the platform's
public REST API carries the same content — and carries the *whole* post,
rendered body included:

```
https://public-api.wordpress.com/rest/v1.1/sites/ulfljotur.com/posts/?number=100
```

One request lists the journal and brings every article with it, which makes a
complete run a single HTTP call. Articles are published in full on the web —
abstract (`Ágrip`), an English `Abstract` on the newer ones, the argument,
footnotes and bibliography — so unlike the two sources above this one needs no
opt-in flag to be genuinely full-text.

Two things are read out of the body rather than the post's metadata. The
byline, because every post is authored by the shared `ulfljotur` editorial
account: the opening paragraph is "Eftir Ragnheiði Bragadóttur, prófessor við
lagadeild Háskóla Íslands" (or "By …" on the one English article), and it is
lifted out and stored under its own `Höfundur` heading. And the table of
contents, which is one paragraph of `<br>`-separated entries — cheerio's
`.text()` drops the breaks, so they are turned into newlines first, otherwise
the whole contents list runs together as "1 Inngangur2 Um verðtryggingu".

Peer review is stated in the body too, and stated **both ways**: "Grein þessi
hefur verið ritrýnd og staðist þær fræðilegu kröfur …" on a reviewed article,
"Grein þessi hefur ekki verið ritrýnd" on one that is not, and half a dozen
other phrasings on the older ones. It is therefore left exactly where the
journal put it rather than boiled down to a flag this adapter would have to get
right — a footnote that reads the same to a searcher as to a reader, and no
claim of ours. Occasional news items (tagged `Frétt`) are not scholarship and
are left out.

```
INGEST_PROBE=1 npm run ingest -- --adapter=ulfljotur   # what the API serves now
npm run ingest -- --adapter=ulfljotur
```

### Two ingest services: scheduled and on demand

There are two Railway config files for ingestion, and the difference matters:

| File | `cronSchedule` | When it runs |
|---|---|---|
| `railway.ingest.json` | `0 */3 * * *` | **Only** on the 3-hour mark (00:00, 03:00, 06:00 … UTC) |
| `railway.ingest-once.json` | none | Every time you deploy it |

**A Railway service with a `cronSchedule` does not run when you redeploy it.**
Redeploying builds the image; the start command then waits for the next
scheduled time. So a redeploy does nothing at all until the next firing — up to 3 hours of no
ingestion and no runtime logs, which reads exactly like a broken deploy but is
the schedule working as designed.

`railway.ingest-once.json` is the on-demand runner: no cron, so deploying it
runs ingestion immediately, and `restartPolicyType: NEVER` stops it from
looping. Point a second Railway service at this file (Settings → Config as
code) and redeploy that service whenever you want a run now.

Two further traps with the scheduled service:

- **A run that never exits blocks every run after it.** Railway skips a
  scheduled execution if the previous one is still going, so a deployment stuck
  on `Active` silently stops the cron indefinitely. Check for one before
  assuming the schedule is broken.
- **Config as code is per service.** If a service's config path is not set to
  `railway.ingest.json`, it falls back to `railway.json` — which starts the web
  app, not the ingest.

### Why the archive stalls short, and the gap ledger

A source bar that reads 99.6% and never moves is not a scraping problem. The
API is fine: every court paginates cleanly to its last page, and a sample of
cases across all four courts and every era from 1999 to today extracts text
without a single failure. The shortfall was bookkeeping.

Every adapter used to give up on a case with `stats.skipped++` (or
`stats.errors++`) and a line in the deploy log. That log is gone the moment the
deployment rolls, so a case lost to a one-off 503 became indistinguishable from
a case that genuinely has no extractable text — and **nothing ever went back
for either**. The `recent` sweep stops after a run of already-known
cases, so it cannot reach back to an older gap; the `gaps` sweep that could was
opt-in and off by default. That is the whole mechanism. Endurupptökudómur sat
at 2 of 102 cases not because its cases were unreachable — all 102 list and
extract perfectly — but because the only sweep that would have found the other
100 was one somebody had to remember to switch on.

So gaps are now **written down**. `IngestGap` holds one row per case we know
exists at the official source but do not hold:

| Column | |
|---|---|
| `officialUrl` | the case, addressable — so a gap can be opened and looked at, not just counted |
| `reason` | `no-text`, `fetch-failed`, `unmapped-court`, `error` |
| `attempts`, `lastTriedAt` | how hard we have already tried |
| `resolvedAt` | set automatically by `saveDocument` when the case finally lands |

Because a successful save clears the row, the open rows are by construction
exactly the work outstanding — a retry queue and the explanation for the
missing percent in one table. Both the front-page bars and `/admin/ingestion`
now split the shortfall into *identified* (in the ledger, queued for retry) and
*not yet swept*, because those need different fixes.

An unmapped court gets a row too, under the reserved `_unmapped` source, and a
banner on `/admin/ingestion` naming the court. A counter is how the last one
stayed invisible.

#### The three Icelandic passes

All three are in the default chain of every firing. Completeness that depends on
somebody remembering to set a variable is not completeness.

| Pass | What it does | Cost |
|---|---|---|
| `icelandic-courts` (`INGEST_MODE=recent`) | newest-first, stops after 40 consecutive known cases | a handful of list queries |
| `icelandic-retry` (`INGEST_MODE=retry`) | works the ledger — no listings at all, one detail fetch per outstanding case | proportional to the backlog |
| `icelandic-gaps` (`INGEST_MODE=gaps`) | walks the feed court by court, fetches only what is missing | ~4,300 list pages for a full pass |

The gap sweep is **bounded and resumable**. Each court keeps its own cursor
(`gaps:<filter>`), persisted after every page, so a run cut short by a platform
timeout resumes where it stopped instead of re-walking from page 1 — which is
what made a full sweep something nobody could finish in one sitting. A court
that reaches its last page wraps back to page 1, so repeated runs keep
re-verifying rather than going quiet. `ICELANDIC_GAP_PAGES` caps the pages per
run (default 600); set it to `0` for an unbounded one-off pass.

```
# Finish the archive now — one unbounded pass, then let the scheduled chain hold it
INGEST_ADAPTERS="icelandic-gaps" ICELANDIC_GAP_PAGES=0   # on the ingest-once service

# Or locally
sh scripts/ingest-all.sh icelandic-gaps      # bounded, resumable
sh scripts/ingest-all.sh icelandic-retry     # just re-attempt known gaps
INGEST_COURT=hd-reykjavik INGEST_MODE=gaps npm run ingest -- --adapter=icelandic-courts
```

`INGEST_GAP_MAX_ATTEMPTS` (default 8) is where retrying stops: a case that has
failed that many times is left in the ledger as the honest record of what this
archive cannot reach, rather than burning the budget every week.

#### One list page is ten cases, not twenty

`pageSize` is accepted by the query and silently ignored — 10, 20, 50 and 100
all return 10 items. So `hd-reykjavik` is ~1,305 pages, not the ~653 an earlier
note here claimed, and a full sweep is ~4,300 list queries at roughly 1.3s
each: about an hour and a half, not "minutes". That is why the sweep is bounded
and resumable rather than assumed cheap.

#### The court filter values are slugs

They are not the court names the API returns, and a value it does not
recognise answers 0 rather than erroring — so a wrong guess is silent. The
values were found by reading what island.is/domar's own page sends: filtering
the UI to one district court issues
`webVerdicts(input: { court: ["hd-reykjavik"] })`.

| Filter value | Total | Court |
|---|---|---|
| `Hæstiréttur` | 12,221 | Hæstiréttur — the one court keyed by its display name; the `haestirettur` slug matches nothing |
| `landsrettur` | 6,424 | Landsréttur |
| `endurupptokudomur` | 102 | Endurupptökudómur |
| `hd-reykjavik` | 13,050 | Héraðsdómur Reykjavíkur |
| `hd-reykjanes` | 5,301 | Héraðsdómur Reykjaness |
| `hd-sudurland` | 1,918 | Héraðsdómur Suðurlands |
| `hd-nordurland-eystra` | 1,797 | Héraðsdómur Norðurlands eystra |
| `hd-vesturland` | 914 | Héraðsdómur Vesturlands |
| `hd-austurland` | 662 | Héraðsdómur Austurlands |
| `hd-vestfirdir` | 469 | Héraðsdómur Vestfjarða |
| `hd-nordurland-vestra` | 374 | Héraðsdómur Norðurlands vestra |

These eleven partition the feed exactly: they sum to 43,232, which is what the
unfiltered feed reports. The figures drift upward as the courts publish — they
were re-checked against the live API on 2026-08-27 — so treat the table as
illustrative and `syncAvailableTotals` as the authority. `syncAvailableTotals` checks that on every run and
says so when it stops holding, because that means a court has been added or a
slug has changed and the progress bars are about to be quietly wrong. Nothing
is derived by subtraction any more — that is what let one wrong filter value
corrupt a second court's figure. A total of 0 is never stored: 0 means "we
asked wrong", not "this court has no cases", and storing it is what produced
the `6,321 / 0` bar.

Félagsdómur is not among them, and no filter value reaches it: the labour court
is not in this feed at all. It publishes for itself, and has its own adapter —
see *Félagsdómur* above.

Sweeping per court is also what makes a complete pass possible. The unfiltered
search will not paginate past roughly page 3,081 — the classic fixed
result-window symptom — so no single unfiltered walk can reach the end of a 43k
archive. Every filter above sits comfortably inside that window; the largest,
`hd-reykjavik`, is about 1,305 pages of 10 (`pageSize` is ignored — see above).

### Running ingestion on Railway

Railway gives a service no shell — it runs its start command and nothing else.
So there are three ways to run a particular ingest, in rough order of
convenience:

**1. Set `INGEST_ADAPTERS` on the on-demand service and redeploy.** The
service pointed at `railway.ingest-once.json` has no `cronSchedule`, so
deploying it runs immediately. Set the variable in the dashboard to pick what
runs; no code change and no push:

| `INGEST_ADAPTERS` | Runs |
|---|---|
| *(unset)* | every adapter, in order |
| `icelandic-gaps` | the gap sweep that finishes the Icelandic archive |
| `efta-court umbodsmadur` | just those two |
| `eea-lex eftasurv` | the two EEA sources, incorporation and enforcement |
| `stjornarradid-backfill` | carry the úrskurðarnefndir archive forward |
| `stjornarradid-priority` | just the board being rushed (see below) |

**2. `railway run` — from a local checkout.** This runs on *your* machine with
the service's variables injected, writing to the same Railway database. Good
for the long one-offs, because nothing about a deploy can time it out:

```
railway run sh scripts/ingest-all.sh icelandic-gaps
```

**3. `railway ssh` — a shell in a running container.** Note this only works
against a service that is actually running; a cron service sits idle between
its scheduled fires, so there is usually nothing to attach to.

Command-line arguments take precedence over `INGEST_ADAPTERS`, so a local run
can override whatever the service has set.

### Running ingestion

`scripts/ingest-all.sh` runs the adapters, each isolated from the rest, and is
what the Railway ingest service calls. It exists because the adapters used to
be chained with `&&`: the runner exits non-zero when an adapter throws, so one
failing source silently stopped every source behind it from running at all.
A single island.is or Lagasafn hiccup meant no EFTA Court cases and nothing in
the deploy log obviously saying why. Now a failure is reported and the rest
still run, and the script still exits non-zero so the deploy is marked failed
rather than quietly green — `/admin/ingestion` shows which adapter it was.

```
npm run ingest:all                       # every adapter, in order
sh scripts/ingest-all.sh efta-court      # just one
sh scripts/ingest-all.sh efta-court umbodsmadur
```

Per-adapter limits are read from the environment with defaults, so they can be
tuned as Railway service variables without a code change:

| Variable | Default | Effect |
|---|---|---|
| `ICELANDIC_INGEST_MODE` | `recent` | island.is sweep mode |
| `ICELANDIC_MAX_PAGES` | `40` | Pages of judgments per run |
| `EFTA_FETCH_DOCUMENTS` | `1` | Fetch decision PDFs — see the robots.txt note above |
| `EFTA_MAX_CASES` | `1000` | Cases per run; the register is ~461 |
| `EEALEX_CASES` | `300` | EEA-Lex factsheets per run; the in-force register is ~9,164 |
| `EEALEX_RETRY` | `100` | Factsheets the EEA-Lex retry sweep re-attempts |
| `ESA_CASES` | `300` | ESA documents (one PDF each) per run; the database is ~6,725 |
| `ESA_RETRY` | `100` | Documents the ESA retry sweep re-attempts |
| `UMBODSMADUR_MAX_CASES` | `600` | Cases per run; full backfill is ~11,455 |
| `LOGRETTA_FETCH_PDFS` | unset | Fetch article PDFs — see the robots.txt note above |

Note that a variable written *inline* into a start command (`FOO=1 npm run …`)
overrides a service variable of the same name and cannot be changed from the
Railway dashboard. That is why the limits live in the script instead.

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
    document/[id]/page.tsx       full document view; catalogue entry for articles
    admin/ingestion/page.tsx     ingestion status
    api/search/route.ts          POST — refuses empty source list
    api/sources/route.ts         the registered sources
    api/documents/[id]/route.ts  document + related cases; withholds article text
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
    sources.ts                   source registry: courts, EEA/EFTA, Umboðsmaður, journals
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
      icelandic-courts.ts        GraphQL + embedded PDF/rich text; scheduled incremental
      lagasafn.ts                in-force Icelandic acts; incremental by codex version
      efta-court.ts              EFTA Court case register, via cases-sitemap.xml
      eea-lex.ts                 EEA Joint Committee decisions in force; retires
                                 an act that falls out of the in-force listing
      eftasurv.ts                EFTA Surveillance Authority public documents,
                                 through the site's own JSON API; the PDF is
                                 the document, so it is the officialUrl
      umbodsmadur.ts             Umboðsmaður Alþingis, by walking the case id space
      felagsdomur.ts             Félagsdómur's own register at felagsdomur.is;
                                 one listing walk per run, judgments from PDF
      stjornarradid.ts           40 úrskurðarnefndir and ministry appeal desks,
                                 board by board through the site's own search
      uua.ts                     Úrskurðarnefnd umhverfis- og auðlindamála,
                                 from its one-page index at uua.is
      obyggdanefnd.ts            Óbyggðanefnd's þjóðlendu úrskurðir; the PDF is
                                 the document, so it is the officialUrl
      neytendamal.ts             Áfrýjunarnefnd neytendamála, from the index
                                 table on Neytendastofa's own site
      logretta.ts                Tímarit Lögréttu, via the site's own Prismic API
      ulfljotur.ts               Vefrit Úlfljóts, via the WordPress.com REST API
    citations.ts                 judgments → provisions; incremental by text hash
                                 (scholarship sources excluded — see Ritrýnd fræðirit)
prisma/
  schema.prisma
  sql/setup-search.sql           FTS function, search_vector column + trigger, GIN/trigram indexes
  seed.ts                        courts + [SAMPLE] judgments
```

Every judgment is normalized into one shape (`src/lib/types.ts`), preserving the official island.is URL for every document and never fabricating missing metadata — absent fields stay null.

## Running ingestion

```bash
# what the scheduled job runs — newest cases only, stops when caught up:
INGEST_MODE=recent npm run ingest -- --adapter=icelandic-courts
# backfill sweep, bounded (10 cases/page):
INGEST_MAX_PAGES=2 npm run ingest -- --adapter=icelandic-courts
# backfill one court at a time (exact values: "Hæstiréttur", "Landsréttur", a "Héraðsdómur ..." string):
INGEST_COURT=Hæstiréttur npm run ingest -- --adapter=icelandic-courts

# the two peer-reviewed journals — small enough to run in full every time:
npm run ingest -- --adapter=logretta
npm run ingest -- --adapter=ulfljotur

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
| `INGEST_ADAPTERS` | ingest-all.sh | Which adapters to run, space-separated (Railway-settable) |
| `INGEST_MODE=gaps` | icelandic-courts | Walk the feed court by court, fetch only what is missing |
| `INGEST_PROBE=1` | efta-court, logretta, ulfljotur | Report what the source serves now, ingest nothing |
| `EFTA_FETCH_DOCUMENTS=1` | efta-court | Also fetch decision PDFs — see the robots.txt note above |
| `EFTA_CASES_SITEMAP` | efta-court | Override the case sitemap URL |
| `INGEST_MAX_CASES` | efta-court | Cases per run (default 1000) |
| `INGEST_FULL=1` | efta-court, umbodsmadur, logretta | Ignore what is stored and re-walk everything |
| `INGEST_MAX_CASES` | eea-lex, eftasurv | Detail fetches per run (default 300 each) |
| `INGEST_MODE=retry` | eea-lex, eftasurv | Work the gap ledger only; no listing walk |
| `EEALEX_MAX_PAGES` | eea-lex | Listing pages per run (default 400; the listing is 153). Below the full listing nothing is retired |
| `EEALEX_FACET` | eea-lex | Override the Case Status facet (default `case_status:14`, in force) |
| `EEALEX_BASE` / `EEALEX_PAGE_SIZE` | eea-lex | Override the site or the rows per listing page |
| `ESA_MAX_PAGES` | eftasurv | Safety bound on the API walk (default 400; the database is 135 pages) |
| `ESA_BASE` / `ESA_LISTING_ALIAS` | eftasurv | Override the site or the database's page alias |
| `LOGRETTA_FETCH_PDFS=1` | logretta | Also fetch article PDFs — see the robots.txt note above |
| `LOGRETTA_API` | logretta | Override the Prismic API base |
| `LOGRETTA_SITE` | logretta | Override the site the `officialUrl` points at |
| `ULFLJOTUR_API` | ulfljotur | Override the WordPress.com posts endpoint |
| `INGEST_MAX_CASES` | logretta | Articles per run (default 1000; the journal is ~193) |
| `UMBODSMADUR_START_ID` | umbodsmadur | Highest case id to walk down from |
| `UMBODSMADUR_STOP_ID` | umbodsmadur | Lowest case id to walk down to (default 1) |
| `INGEST_MODE=backfill` | stjornarradid | Walk every page of every board, fetching only what is missing; resumable per board |
| `INGEST_MODE=retry` | stjornarradid | Work the gap ledger and nothing else |
| `INGEST_STOP_AFTER_KNOWN` | stjornarradid recent mode | Consecutive already-stored rulings before a board is considered caught up (default 60) |
| `INGEST_MAX_CASES` | stjornarradid | Decision pages fetched per run (default 500) |
| `INGEST_MAX_PAGES` | stjornarradid | List pages per run (200 rulings each) |
| `STJORNARRADID_BOARDS` | stjornarradid | Comma-separated board keys to run; all 40 by default |
| `INGEST_MAX_CASES` | felagsdomur | Judgments fetched per run (default 300; the court publishes 200) |
| `INGEST_MODE=retry` | felagsdomur | Work the gap ledger and nothing else |
| `FELAGSDOMUR_BASE` | felagsdomur | Override the site base URL |
| `STJORNARRADID_BASE` | stjornarradid | Override the site base URL |
| `INGEST_MAX_CASES` | uua | Rulings fetched per run (default 400; the archive is ~3,000) |
| `INGEST_MODE=retry` | uua | Work the gap ledger and nothing else |
| `UUA_BASE` | uua | Override the site base URL |
| `INGEST_MAX_CASES` | obyggdanefnd | Rulings fetched per run (default 12; each is a several-hundred-page PDF) |
| `INGEST_MODE=retry` | obyggdanefnd | Work the gap ledger and nothing else |
| `OBYGGDANEFND_BASE` | obyggdanefnd | Override the site base URL |
| `INGEST_MAX_CASES` | neytendamal | Rulings fetched per run (default 120; the board has ~228) |
| `INGEST_MODE=retry` | neytendamal | Work the gap ledger and nothing else |
| `NEYTENDAMAL_BASE` | neytendamal | Override the site base URL |
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

Scholarly journals are excluded from that scan — see *Ritrýnd fræðirit* above for why.

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
4. `railway.ingest.json` sets `deploy.cronSchedule` to `0 */3 * * *` (00:00, 03:00, 06:00 … UTC) and a start command that chains the three adapters: new judgments (`INGEST_MODE=recent`), then acts (`lagasafn`), then `citations` to link whatever arrived. Railway spins up a container on that schedule, runs it to completion, then stops it until the next firing — no always-on dyno needed for this service.

   The acts step is deliberately left unbounded so that the first firing loads the whole corpus (~900 acts, ~22 minutes at the default delay) rather than splitting it across firings. Splitting it would be worse than slow: `citations` runs in the same firing, so acts arriving in a *later* firing would find every judgment already marked as scanned and would never be linked to. `LAGASAFN_MAX_ACTS` still exists for bounding a manual run.

   After that first firing the step is nearly free: an act whose codex version still matches the index's is skipped without being fetched, so an unchanged Lagasafn release costs one request. The citations step only rescans judgments whose text changed, so a firing that brought in nothing new does almost nothing. The exception is deliberate: when `lagasafn` ingests an act the database has never held, it clears the citation watermark, so the citations step in the same firing re-links the whole corpus against it. Without that, a late-arriving act would never be linked to anything — the judgments' text has not changed, so they would never be rescanned.
5. No manual redeploys needed after this. Progress is visible at `/admin/ingestion` on the website.

The schedule has moved with how much is left to ingest. It fired every 2 hours during the original backfill, dropped to weekly once the Icelandic archive was complete, and is now **every 3 hours** — the úrskurðarnefndir archive (~23,700 rulings) and the Icelandic gap sweep are still working through their cursors, and those rolling passes only advance when the service fires. Eight firings a day is 56× the weekly throughput on the backfills: the incremental passes are near-free when nothing is new, so the extra firings go almost entirely to the archives that are still filling.

Headroom is the thing to keep an eye on at this cadence. A worst-case run where every bounded pass fills up — 1,200 priority-board rulings, 900 other board rulings, 600 gap pages, 600 Ombudsman cases, 500 + 300 retries, at the 1.5 s polite delay — is about 2 hours 15 minutes against a 3-hour slot. Railway skips a firing whose predecessor is still running, so an overrun costs a slot rather than stacking runs, but a run that regularly comes close is the signal to lower a per-pass budget rather than to raise the frequency again. Run durations are on `/admin/ingestion`.

Once those archives are complete, weekly (`0 6 * * 1`) is enough again; to push harder in the meantime, `0 */3 * * *` or `0 */2 * * *` are the next steps up — watch `/admin/ingestion` for run durations first, and mind that the sources are being fetched politely at one request per 1.5 s. If you ever need to backfill from scratch — a fresh database, or a gap — drop `INGEST_MODE=recent` from the start command and raise `INGEST_MAX_PAGES`; the `IngestCursor` table means each firing continues where the last one stopped.

Note: this repo uses `prisma db push` rather than `prisma migrate`, so there's no `prisma/migrations` folder — `npm run db:deploy` (not `prisma migrate deploy`) is the correct pre-deploy command here. If you later want real migration history for a production database, run `npx prisma migrate dev --name init` locally once, commit the generated `prisma/migrations` folder, and switch the pre-deploy command to `npx prisma migrate deploy && npm run db:setup-search`.

## Legal note

This tool searches and links to public judgments. It always displays the official island.is URL, does not present itself as an official publisher, and displays on every page: *"This is an unofficial research tool. Always verify text against the official source."*

The journals are treated differently, because an article is not a public record — it is the work of its named author and the journal that published it. Both are kept with the record: the byline as the journal wrote it, and a link to the article on the journal's own site. The text is indexed so the article can be **found** here, and is not served for **reading** here — every route into an article opens the journal's page instead, and the document API withholds the text for a scholarly source. Where a journal's own host asks crawlers away from the article files, this repo stays out of them by default and says so above rather than burying the choice in a flag's default.
