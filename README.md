# Lögbrunnur

An MVP search engine for **Icelandic court judgments only** — Hæstiréttur Íslands, Landsréttur, and Héraðsdómar — sourced from island.is's public GraphQL API.

> **Disclaimer shown throughout the app:** This is an unofficial research tool. Always verify text against the official source.

The three Icelandic courts published at [island.is/domar](https://island.is/domar), searched properly — plus Endurupptökudómur and [Félagsdómur](https://felagsdomur.is/domar-og-urskurdir/), the EFTA Court, the Court of Justice of the European Union and its General Court, Umboðsmaður Alþingis, the 40 administrative appeal boards that publish at [stjornarradid.is](https://www.stjornarradid.is/gogn/urskurdir-og-alit-/), the EEA law in force — the [EEA Joint Committee decisions](https://www.efta.int/about-efta/legal-documents/adopted-joint-committee-decisions) that bring EU acts into the EEA Agreement, and the [EFTA Surveillance Authority](https://www.eftasurv.int/esa-at-a-glance/publications/public-access-to-documents/public-documents) documents enforcing them — and two peer-reviewed Icelandic legal journals for the commentary on them. Alongside the case law sits the legislation it applies: the in-force text of Icelandic law from Lagasafn, and the EU regulations and directives in force from [EUR-Lex](https://eur-lex.europa.eu) — with an EES/ESB toggle that decides whether the EU library is limited to what may be part of EEA law or opened to all of it.

## What's in the MVP

- **Search UI** — main search bar, left-side panel with every source as an opt-in checkbox, filters (date range, year, sort), result cards with highlighted snippets, and paginated results (15 per page). Sources are grouped, and a group of more than eight (the 40 úrskurðarnefndir) folds down to one line showing how many of it are ticked, so a long list cannot bury the courts above it. A group with something already ticked opens itself — a filter you cannot see is a filter you will forget you set.
- **Strict opt-in sources** — nothing is selected when the app opens, the Search button is disabled until at least one source is ticked, selected sources are shown as removable chips above the results, and the API itself returns `400 Select one or more sources to search.` if called without sources. The UI says *sources*, not *courts*: the panel is six courts, the Ombudsman, forty appeal boards and two journals, and calling all of that "courts" was wrong on three counts out of four.
- **Case summaries** — where a judgment carries its own `Útdráttur` section, result cards offer it behind a disclosure arrow, so you can read the court's own summary without opening the full text.
- **Full document page** — structured metadata, the judgment typeset as readable prose (headings, paragraphs, numbered clauses, quoted passages) with highlighted hits, search-within-document, copyable citation, official-source link, related cases via case-number citation extraction.
- **Icelandic acts (lög)** — the in-force text of Icelandic law from [Lagasafn](https://www.althingi.is/lagas/), parsed into chapters (kaflar), provisions (greinar) and paragraphs (málsgreinar), with an act reader at `/log/{actNumber}-{year}`.
- **Provision-level case linking** — each provision shows how many decisions cite it ("12 úrlausnir vísa til þessa ákvæðis"), expanding to the citing cases with the sentence the citation was found in, so you can see *why* a case matched before opening it.
- **EU acts (ESB-gerðir)** — the regulations and directives in force, from EUR-Lex, parsed into the same chapter / article / paragraph structure and read in the same act reader at `/log/{CELEX}` — `/log/32016R0679` is the GDPR. Each act carries whether EUR-Lex marks it *"(Text with EEA relevance)"* and which decisions of the EEA Joint Committee this database holds that name it. See *EU acts (EUR-Lex)* below.
- **EES / ESB scope toggle** — one control, in the act catalogue and beside the specific-search act box, deciding how much of the EU library any act lookup sees. **EES** (the default) is Icelandic law plus the EU acts that may be part of EEA law — the marked ones and the ones a Joint Committee decision names. **ESB** lifts the limit, which is what you want precisely when an act has *not* been incorporated and you need to establish that. Icelandic law is in both: the toggle never hides lög nr. 91/1991.
- **Act catalogue** — `/log` lists every ingested act with its provision count and how many judgments cite it, searchable by title, short name or number, and sortable by most-cited. Two tabs: Icelandic acts and EU acts, the second carrying the scope toggle.
- **The law itself, above the judgments** — the main search box searches the act library as well as the case law. Type `vaxtalög`, `38/2001`, `gdpr` or `2016/679` and the act heads the results, with the judgments below it; type `130. gr. laga nr. 91/1991` and the article heads them, with its text. Each card offers the two things worth doing next — read the text, or narrow the judgments below to the ones citing it. An act is only ever shown when the query genuinely *names* one, so a search for a subject (`gæsluvarðhald`) looks exactly as it did before. See *Searching for a law* below.
- **Specific search** — alongside the keyword search, two live lookups that narrow the results, each accepting several selections that combine as AND: an act/provision box that takes the citation as it is written ("lög um aðbúnað og hollustuhætti" finds the cases about the act; "57. gr. a. laga um aðbúnað og hollustuhætti" narrows to the cases citing that article), and a subject-tag box. Acts match on title, citation number, or the short names judgments actually use — "vaxtalög" finds lög nr. 38/2001.
- **Administrative case law** — the úrskurðarnefndir, kærunefndir and ministry appeal desks at stjornarradid.is, each board its own tickable source rather than one undifferentiated pile. For immigration, benefits, tenancy, procurement and freedom of information this is where the case law actually is, and a search of the courts alone would miss it. See *Úrskurðarnefndir og ráðuneyti* below.
- **Database schema** (Prisma/PostgreSQL) — `Document`, `Source`, `IngestionRun`, `Act`, `Chapter`, `Provision`, `ProvisionParagraph`, `CaseProvisionLink`, `CaseActLink`. `Act` holds both jurisdictions: `jurisdiction` and `docType` say which corpus and which instrument, and an EU act adds its CELEX, its citation, its EEA marker and the Joint Committee decisions naming it.
- **Search** — PostgreSQL full-text search (default, zero extra infrastructure) with a provider abstraction; a Meilisearch provider is included and can be switched on with one env var. Ranking reads a materialized `search_vector` column, so a broad query over thousands of hits stays in the low hundreds of milliseconds.
- **Ingestion adapters** — `icelandic-courts` (island.is's public GraphQL API) runs every 3 hours and pulls only what's new; `lagasafn` ingests every in-force Icelandic act; `eur-lex` ingests the EU regulations and directives in force from the Publications Office; `cjeu` ingests the judgments of the Court of Justice and the General Court from the same endpoint; `citations` links judgments to the provisions they cite; `efta-court` ingests the EFTA Court case register; `eea-joint-committee` ingests the EEA Joint Committee's decisions (their own text, one record each); `eftasurv` ingests the EFTA Surveillance Authority's ~6,725 public documents; `umbodsmadur` ingests the Ombudsman's opinions and letters; `felagsdomur` ingests the labour court, both halves of it; `uua` ingests Úrskurðarnefnd umhverfis- og auðlindamála (~3,000 planning and environmental rulings, on its own site); `obyggdanefnd` ingests the þjóðlendu commission's 84 úrskurðir; `neytendamal` ingests Áfrýjunarnefnd neytendamála; `stjornarradid` ingests the 40 úrskurðarnefndir and ministry appeal desks (~23,700 rulings, the largest source in the app); `logretta` and `ulfljotur` ingest two peer-reviewed legal journals (see below).
- **Scholarly commentary** — Tímarit Lögréttu and Vefrit Úlfljóts, searched alongside the case law rather than in a separate silo, so a query about an unsettled point returns both the judgments and the articles arguing about them. Articles are indexed in full but read at the journal that published them: their cards and pages link out rather than reproducing the text here.
- **The well** — an assistant in the bottom-right corner that answers a question in prose instead of returning a result list. Drop a question in ("Hvernig sæki ég um íslenskan ríkisborgararétt?") and it searches the acts, the provisions and every decision source, then writes an answer in the language you asked in with a numbered citation on every proposition — each one a link to the article or the judgment it rests on. It answers only from what the search returned: with nothing retrieved it says so rather than answering from the model's own memory of the law. Off unless an LLM API key is configured; OpenAI and Anthropic are both supported and swap with one variable. See *Asking the well* below.
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

### Optional: switch on the well

```bash
# .env — one key is enough
OPENAI_API_KEY=sk-...
# or
ANTHROPIC_API_KEY=sk-ant-...
```
The assistant in the bottom-right corner is off until one of these is set —
the launcher is not rendered at all rather than offered and then failing. With
one key configured there is nothing else to set: the provider is whichever key
is present. See *Asking the well* below.

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
| Dómstóll Evrópusambandsins — Court of Justice of the EU | live | English |
| Almenni dómstóll ESB — General Court | live | English |
| Sameiginlega EES-nefndin — EEA Joint Committee decisions (efta.int) | live | English |
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

### EEA Joint Committee decisions

The EEA Agreement works by incorporation: an EU act becomes EEA law when the
**EEA Joint Committee** decides to take it in. That decision is what this
source carries — one record per JCD, holding the decision's own text: *"DECISION
OF THE EEA JOINT COMMITTEE No 25/2010 of 12 March 2010 amending Annex II
(Technical regulations, standards, testing and certification) to the EEA
Agreement"*. It is the legal instrument, and it is what someone looking for a
decision of the Joint Committee is looking for.

**Which decisions exist comes from EUR-Lex.** The Official Journal publishes
every one of them — about 6,780, from No 1/94 to the present — and the SPARQL
endpoint lists them by their authoring body, `CMT_MIX_EEAREA`, which is the
Committee itself. That is the precise filter: sector 2 also holds every other
joint body's decisions, and CELEX shape alone would not separate them. Each run
asks for the list and queues, as `pending` ledger rows, whatever is neither
held nor already queued — matched on the decision's own number ("154/2018"),
never on a URL, so a decision already held from efta.int is not fetched twice.
`JCD_LISTING=0` turns the listing off and leaves the adapter working the ledger
it has.

This is what unfroze the source. Its backlog was seeded once, from a register
that has since been withdrawn (below), and a decision adopted after that day
could not be discovered at all. The listing also gives the progress bar an
honest denominator: what the Committee has adopted, rather than what we happen
to know about.

**The text comes from whichever source the row names.** A JCD has no page of
its own on efta.int; it is published as a PDF per language under
`/sites/default/files/…/adopted-joint-committee-decisions/`, and the English
PDF is that row's `officialUrl`, as the ruling PDF already is for Óbyggðanefnd
and for ESA's documents. A row queued from the listing instead carries the
EUR-Lex reading page, and its text is read from Cellar — no PDF to parse, and
the same record either way: the heading parse below reads both. Note that
Cellar needs the parentheses in a suffixed CELEX percent-encoded
(`21994D0330%2801%29`), which is every decision published before about 2005.

The decisions are small — measured
across 1994–2026, a JCD runs 2–3 pages and 1,700–5,200 characters. The 1994
omnibus decisions are the exception: 7/1994 is 213 pages and 359,000
characters, and it is stored **once**, which is why the decisions are a source
of their own rather than text appended to every act that names them.

Each decision's date and subject are read from its own heading — the date
printed on the instrument, and the Committee's own statement of what the
decision does. That parse was checked against decisions from 1994, 1999, 2010,
2016 and 2026.

#### EEA-Lex was withdrawn, and what that changed

Until now this adapter fed a second source as well: **EEA-Lex
(EU-gerðir í gildi á EES-svæðinu)**, a register of the ~9,164 **EU acts in
force in the EEA**, one record per [EEA-Lex](https://www.efta.int/eea-lex)
factsheet, walked off the site filtered to `case_status:14`. That register was
not the right thing to be ingesting. It has been withdrawn: the source is gone
from the registry, the listing walk is gone from the adapter, and the records
it stored are deleted — documents, search index and gap ledger alike — by a
one-time purge that runs at the head of the decisions pass. Nothing needs to be
set for that purge to happen; it runs on the next firing and costs one count
query on every firing after. EEA-Lex will be ingested again, differently, and
when it is it starts from a clean name and an empty table.

**The decisions used to be derived from those acts.** Every factsheet named its
JCD and linked that decision's English text, so grouping the stored factsheets
by decision number gave both the set of decisions *and*, for free, the filter to
the ones still doing something. With the acts gone, that derivation is gone with
them, and the adapter is driven by the **gap ledger** instead: every decision
known to exist but not held is a row in `ingest_gaps`, and a run is one PDF
fetch per row until `INGEST_MAX_CASES` is spent. The purge seeds that ledger
from the acts **before** deleting them — as `pending` rows, the one gap reason
that is not a failure — so the backlog is carried forward rather than lost with
the register that knew about it.

That left a complete to-do list but not a growing one: the adapter would work
the backlog to the end and then discover nothing, because it walked no listing
of its own. **EUR-Lex is now that listing** — see above — so the ledger grows
again, and a decision adopted next month is queued on the next firing. The
purge's seeding still matters: it carried the backlog forward rather than
losing it with the register, and those rows keep their efta.int PDFs.

**Nothing is retired any more.** The acts pass filtered to what was in force and
removed a decision once the last act it incorporated fell out of force. Without
that filter there is nothing here that can tell a withdrawn decision from one we
simply hold, so the adapter deletes nothing but the acts it is purging. A
superseded decision stays, which is the safe direction: a JCD is a historical
instrument, and the Committee does not unpublish them.

```
npm run ingest -- --adapter=eea-joint-committee   # purge the acts, then work the backlog
```

One pass, not three: there is no listing walk to schedule separately and no
retry sweep either, because first attempts and fifth attempts are rows in the
same ledger. `openGaps` orders it by attempt count and then by how long ago each
row was last tried, so an untouched decision is reached before a re-attempt and
one that keeps failing cannot monopolise the budget. A run whose ledger is
empty makes no requests at all; one whose ledger holds only decisions that
never extract any text re-attempts those, which is the price every retry sweep
here pays for recovering the ones that failed transiently.

**A note on pace.** efta.int answers 429 if pushed, so the shared fetcher
retries on 429 as well as 5xx and honours `Retry-After` when the server sends
one. `INGEST_DELAY_MS=1500` is the default and is comfortable here; below about
a second it is not.

### EU acts (EUR-Lex)

The Joint Committee decisions above say *that* an EU act became EEA law. This
is the act itself: every regulation and directive **in force** — 16,165 and
1,305 of them as this is written — with its articles, from the Publications
Office of the European Union.

Decisions were in this corpus at first, and dropping them is the single
largest change ever made to it; see *Why not decisions* below.

They are stored as **acts, not documents**. A regulation has articles, an
article has numbered paragraphs, and both are cited the way a grein and a
málsgrein are, so an EU act is an `Act` row with `jurisdiction = "eu"` beside
lög nr. 38/2001 rather than a record in a parallel table. Everything already
built on that shape works for it: the act reader, the provision search, the
act type-ahead in specific search, and the provision-level links from
judgments. An EU act is read at `/log/{CELEX}` — `/log/32016R0679` is the
GDPR — and is cited the way it is written, "Regulation (EU) 2016/679", taken
off the front of its own official title rather than composed from its numbers.
(The numbering conventions changed twice: a directive of 2000 is cited
"Directive 2000/31/EC", a regulation of 2003 "Regulation (EC) No 1/2003", and
everything since 2015 "2016/679". None is derivable from another.)

This is **not** the EEA-Lex acts register that was withdrawn in August 2026.
That was a list of factsheets *about* acts, stored as searchable documents; this
is the acts, from the source that publishes them, with their text. See the EEA
Joint Committee adapter's header for the difference.

#### The EES / ESB toggle

Most of the EU library has never had anything to do with Iceland, and a search
that returns a Commission implementing regulation on the marketing of hop
products alongside the four Icelandic acts you asked about is a worse search.
So every act query takes a scope, and the toggle sets it:

| | What an act lookup sees |
|---|---|
| **EES** (default) | Icelandic acts, plus EU acts that may be part of EEA law: those EUR-Lex marks *"(Text with EEA relevance)"*, **or** that a decision of the EEA Joint Committee names. |
| **ESB** | Everything. The whole EU library, incorporated or not. |

Icelandic law is in both. The toggle says how much of the EU library comes
with it, not whether Icelandic law is searched.

The EES side is deliberately generous — a marker *or* a naming is enough —
because the question it answers is "might this matter here": an act wrongly
kept is a line in a list, and an act wrongly dropped is a search that silently
fails.

The two criteria are not one criterion and its backup. They are different
claims, and they cover different eras:

- **The marker** is the Commission's view that an act *belongs* in the
  Agreement. It only became standard practice in the 1990s, so of the EU acts
  of 2000 still in force, **not one carries it**.
- **A naming by the Joint Committee** is the fact: the Committee is what
  actually takes an act into the Agreement. Of those same acts of 2000, **61
  are named by a decision** — every one of which the marker alone would have
  hidden. The e-Commerce Directive (2000/31/EC) is the plain example: no
  marker, and incorporated by Decision No 91/2000.

#### The EES tag

Where an act appears — in the catalogue, in the act reader, in the act
type-ahead — it carries a tag saying which of those two it is, from one shared
definition in `src/lib/eea-tag.ts` so all three make the same claim:

| Tag | Means |
|---|---|
| **EES** | A decision of the Joint Committee names this act. Hovering gives the decision numbers, in the order they were adopted; the act reader prints them with a link to search for the decision itself. |
| **EES?** | Marked *"(Text with EEA relevance)"*, but no decision we know of names it. Often a decision not yet adopted; sometimes a gap in what we hold. |
| *(none)* | Neither. The act is in the library because the ESB scope shows the whole EU corpus, not because it binds anything here. |

The tag says *named by*, not *inserted by*, and the wording under it is careful
about the difference: a decision that deletes a point names the act it is
deleting, and a later decision amending an act names it again. EUR-Lex records
both as citations and offers nothing finer, so nothing here pretends to know
which. What the tag asserts is the useful and defensible thing — the Committee
has dealt with this act — with the decision numbers there to check.

The cross-reference itself comes from two places, merged: EUR-Lex's citation
graph (every decision that exists) and the text of the decisions this database
holds, where the JCDs print the act they are inserting in the Official
Journal's two-part form, `32016 R 0679: Regulation (EU) 2016/679 …`, and both
halves are read. See `src/lib/eu-citations.ts` and `src/ingestion/eurlex-sparql.ts`.

The choice is remembered in `localStorage` rather than asked per query: it is a
research posture, and someone who set ESB on the catalogue page should not find
the act box back on EES.

#### Where the text comes from

Not `eur-lex.europa.eu`, which is the reading room and answers a crawler with
an empty `202 Accepted` rather than an error — a status that would sail through
any `res.ok` check and store thousands of empty acts. The text comes from
**Cellar**, the Publications Office's content API, which serves the act by
CELEX to anything that asks for a format it holds:

```
curl -L -H "Accept: application/xhtml+xml, text/html;q=0.9" -H "Accept-Language: eng" \
  https://publications.europa.eu/resource/celex/32016R0679
```

Both formats are asked for because which one an act is held as depends on when
it was published, and asking for one alone 404s on the acts held as the other.

**The consolidated version is preferred**, since that is the text in force —
the same principle as reading Lagasafn's `/nuna/` pages rather than the act as
originally passed. Which consolidated version is current comes from the
catalogue pass, and a 404 on it falls back to the act as adopted rather than
losing the act.

**Three layouts, one parse.** Cellar does not serve one format:

| Layout | What it is | How it is read |
|---|---|---|
| `oj` | published in the Official Journal, ~2004 onwards | `div id="art_1"` holding `p.oj-ti-art`, headings in `.eli-title`, one `div` per numbered paragraph |
| `consolidated` | the in-force version of an amended act | the same `id="art_1"` skeleton, different class names, paragraph numbers in a `span` of their own |
| `legacy` | anything older, held as plain HTML | no structure at all: an article heading is a `<p>` whose whole content is "Article 3" |

The legacy parse starts only **after** the adoption formula ("HAVE ADOPTED
THIS DIRECTIVE:"), because every recital above that line cites articles of the
Treaty and of other acts — the e-Commerce Directive's recitals name Articles
251, 95 and 46 — and a looser rule turns those citations into articles of this
act. All three layouts are frozen as fixtures and tested offline; see
`src/lib/__fixtures__/README.md`.

#### Three passes, because they cost different amounts

```
INGEST_MODE=catalogue  npm run ingest -- --adapter=eur-lex   # what exists
INGEST_MODE=text       npm run ingest -- --adapter=eur-lex   # the acts' text
INGEST_MODE=text-retry npm run ingest -- --adapter=eur-lex   # what failed
INGEST_MODE=eea-links  npm run ingest -- --adapter=eur-lex   # what the JCDs name
```

- **catalogue** — two SPARQL queries per calendar year against Cellar's
  endpoint give every act of that year in force, with its title, its short
  names (EUR-Lex records "gdpr" as one, which is what makes the type-ahead
  find it), its dates, its EEA marker and its current consolidated version.
  Seconds per year, no document fetches, resumable from a cursor:
  `EURLEX_YEARS_PER_RUN` (default 8) years per firing, **backwards from this
  year** to 1952 and then round again. The direction matters more than the
  rate — the first version swept forwards from 1952 at three years a firing,
  and the production log read "1955: 0 acts in force. 1956: 0. 1957: 0" while
  the acts anyone would actually search for sat two decades of firings away.
  An act the catalogue stops listing is marked `no_longer_in_force` rather than
  deleted — it is still the law a judgment of 2011 applied.
- **text** — one Cellar request per act, bounded by `EURLEX_ACTS` (default
  150) and ordered EEA-relevant first. `EURLEX_TEXT_SCOPE` is `eea` by default,
  so the acts that reached Icelandic law arrive first; set it to `all` to work
  through the rest, which is weeks of runs at the polite fetch rate. The
  catalogue is complete either way, so an act with no text yet is still
  findable, still says what it is, and still links to EUR-Lex.
- **eea-links** — the cross-reference behind the EES tag: which decisions of
  the Joint Committee name each act. Two sources, merged, because each covers
  what the other misses. EUR-Lex's own citation graph is the bulk of it — every
  decision that exists, about 20,400 act references, in ~34 queries — and the
  stored decisions' text catches what the graph does not record, at no request
  cost. Both answer the same question, so they merge into one list of decision
  numbers per act, ordered as the Committee adopted them.

**The act table is the ledger.** There is no `IngestGap` row here, because that
ledger is keyed by `(source, officialUrl)` and these are not documents. The
equivalent lives on the act: `textStatus` is `pending` until the text is read,
then `stored`, `fetch-failed` or `no-articles`, and every run prints the
breakdown the way the document adapters print their gap counts:

```
[eur-lex] EU acts by text status: pending=1171 stored=5
```

So the shortfall is visible and retriable, and an act whose consolidation has
moved on is put back to `pending` by the catalogue pass rather than going
quietly stale.

#### What is deliberately not here

- **Not the Joint Committee's decisions, as acts.** EUR-Lex publishes those
  too, in sector 2 — Decision No 154/2018 is CELEX `22018D1022` there, numbered
  by its place in the Official Journal rather than by its decision number — but
  this app already holds them as documents. Sweeping sector 2 would store every
  one of them a second time, as a document and as an act, findable twice. The
  catalogue query asks Cellar for sector 3 only, and `parseCelex()` refuses
  anything else besides, which is a second guard on the same rule.

  EUR-Lex *is* what the decisions source reads its listing from, which is a
  different thing: see *EEA Joint Committee decisions* above. One copy of each
  decision, stored as a document; EUR-Lex says which ones exist.
- **Not decisions, and not the softer instruments.** Regulations and
  directives (`EURLEX_TYPES=R,L`), and nothing else in the sector: not
  decisions, opinions, recommendations, treaties or international agreements.
  See *Why not decisions* below for the first of those; the rest are in
  EUR-Lex, and they are not what "the EU legal library" means to someone
  asking whether a rule applies.
- **Only plain sector-3 CELEX numbers.** Corrigenda (`32016R0679R(01)`) and
  the suffixed forms are skipped: a CELEX is a reliable identity only while it
  is sector, year, type letter and four digits, which together are unique.
- **No citation linking from Icelandic judgments to EU acts yet.** The
  citation job reads the Icelandic grammar ("1. mgr. 175. gr. laga nr.
  91/1991"); an Icelandic judgment citing "reglugerð (ESB) 2016/679" is a
  different grammar and is not resolved. The link tables are jurisdiction-blind,
  so this is an extractor to add, not a schema to change.

#### Why not decisions

`EURLEX_TYPES` read `R,L,D` at first, and half of everything this app had of
the EU was a decision: **17,380 decisions in force against 16,165 regulations
and 1,305 directives**. That is not a long tail, it is the majority of the
corpus, and almost none of it is law anyone researches from Reykjavík. A
sector-3 decision is overwhelmingly an administrative act addressed to one
member state or one undertaking — State aid to an airline, the approval of an
antigen bank, an internal rule of the ECB. The 2,160 that had already been
ingested were things like *Commission Decision on State aid SA.35956*.

They also made the EES tag read as nonsense, though not by inventing anything.
EUR-Lex genuinely marks those decisions *"(Text with EEA relevance)"*, so the
tag was faithfully repeating the Official Journal — and a marker that is true
and useless is still useless: the EES tag exists to say "this might bind
something here", and a State aid decision addressed to one Spanish airline does
not.

**What is stored under an older setting is deleted, not left to rot.** The
catalogue pass opens by deleting every stored EU act whose `docType` is not one
of the kept families, in chunks, from Meilisearch as well as from Postgres:

```
[eur-lex] Deleting 2160 EU act(s) of unwanted types; keeping regulation, directive.
```

It refuses to delete anything when the kept list is empty, so a mistyped
`EURLEX_TYPES` cannot empty the library. Widening the list again is one env var
and one catalogue sweep — the acts come back on their own.

### CJEU case law (EUR-Lex)

The Court of Justice of the European Union, from the same endpoint the acts
come from: **21,203 judgments of the Court of Justice** and **12,235 of the
General Court**.

**Why it belongs here.** The EEA Agreement is interpreted homogeneously with EU
law. The EFTA Court follows the Court of Justice, Icelandic courts follow both,
and a directive incorporated into the Agreement means in Iceland what the Court
of Justice says it means. A library that carries the directives and the EFTA
Court's judgments but not the Court of Justice's is missing the half both of
the others defer to.

**Two courts, two sources.** They are separate boxes in the search panel,
because they are separate courts and because someone after a preliminary ruling
on a directive should not have to wade through EU trade-mark appeals to reach
it. `CJEU_TYPES=CJ` drops the General Court entirely.

**Judgments only.** Sector 6 also holds orders (`CO`), Advocate General
opinions (`CC`) and the wound-up Civil Service Tribunal (`FJ`). An order is
procedure, an opinion is not the Court speaking, and the staff cases of a court
abolished in 2016 are nobody's research here.

The case number is derived from the CELEX rather than parsed out of prose,
because the CELEX is the one place it is stated unambiguously — `62015CJ0203`
is Case C-203/15 — while the title's own statement of it is sometimes "Joined
Cases C-203/15 and C-698/15", which is two.

#### The title is where the metadata is

EUR-Lex gives a judgment one string of five `#`-separated fields, and for
several of them it is the only statement there is:

```
Judgment of the Court (Grand Chamber) of 21 December 2016.
#Tele2 Sverige AB v Post- och telestyrelsen and Secretary of State …
#Requests for a preliminary ruling from the Kammarrätten i Stockholm …
#Reference for a preliminary ruling — Electronic communications — …
#Joined Cases C-203/15 and C-698/15.
```

Not every judgment has all five — a direct action has no referring court, and
a judgment of 1972 has neither keywords nor a case segment — so the parts are
recognised by shape rather than by position, and anything unrecognised is left
out rather than guessed at. The fourth field is the Court's own index terms,
and it becomes the judgment's **subject tags**, which is what makes a judgment
findable by what it is about rather than only by the words in it. It is
detected by its dash run, and by **both** dashes: the 2016 judgments separate
index terms with an em dash and the 2026 ones with an en dash, and matching one
alone silently drops every tag from half the corpus. Two or more, because a
party's name can contain one and a plain hyphen is never a separator here
("Post- och telestyrelsen").

The stored title leads with the case number and the parties —
`C-203/15 — Tele2 Sverige AB v Post- och telestyrelsen …` — because EUR-Lex's
own opens with "Judgment of the Court (Grand Chamber) of 21 December 2016",
which is true of thousands of judgments and identifies none of them.

#### Two passes

```
INGEST_MODE=listing npm run ingest -- --adapter=cjeu   # which judgments exist
npm run ingest -- --adapter=cjeu                       # their text
```

- **listing** — one SPARQL query per case year, **newest year first** from a
  cursor (`CJEU_YEARS_PER_RUN`, default 3, back to `CJEU_FIRST_YEAR`, 1954),
  writing a `pending` row in the gap ledger for every judgment not already
  held. No document fetches at all. The row carries EUR-Lex's *raw* title, not
  the composed one: composing it early would throw the referring court and the
  index terms away before the fetch pass could read them.
- **the default pass** — the ledger and nothing else: one Cellar request per
  outstanding judgment until `INGEST_MAX_CASES` (default 200) is spent, first
  attempts and re-attempts in one queue ordered by how often they have failed,
  so a judgment that keeps failing cannot monopolise a run. Text under 900
  characters is recorded as a gap rather than stored, because Cellar answers a
  throttled request with a short body and a 2xx.

About 33,000 judgments is days of polite fetching, which is why the listing
sweeps newest-first: the case law anyone is looking for arrives first and the
1950s arrive last.

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
already carried at both ends: the act's incorporation (the Joint Committee
decision, above), the enforcement correspondence (here), and the judgment when
it reaches Luxembourg (the EFTA Court).

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
| `eea-joint-committee eftasurv` | the EEA sources: the Committee's decisions and ESA's enforcement |
| `eur-lex-catalogue eur-lex` | the EU act catalogue, then the acts' text |
| `cjeu-listing cjeu` | find which CJEU judgments exist, then fetch their text |
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
| `JCD_DECISIONS` | `300` | Joint Committee Decisions per run; the pass walks nothing |
| `ESA_CASES` | `300` | ESA documents (one PDF each) per run; the database is ~6,725 |
| `ESA_RETRY` | `100` | Documents the ESA retry sweep re-attempts |
| `UMBODSMADUR_MAX_CASES` | `600` | Cases per run; full backfill is ~11,455 |
| `EURLEX_YEARS_PER_RUN` | `3` | Catalogue years per run, newest first |
| `EURLEX_ACTS` | `150` | Act texts fetched per run |
| `EURLEX_TEXT_SCOPE` | `eea` | `all` works through the whole ~17,500-act library |
| `CJEU_YEARS_PER_RUN` | `3` | Case years listed per run, newest first |
| `CJEU_CASES` | `200` | Judgment texts fetched per run; the two courts hold ~33,400 |
| `CJEU_TYPES` | `CJ,TJ` | `CJ` alone drops the General Court |
| `LOGRETTA_FETCH_PDFS` | unset | Fetch article PDFs — see the robots.txt note above |

Note that a variable written *inline* into a start command (`FOO=1 npm run …`)
overrides a service variable of the same name and cannot be changed from the
Railway dashboard. That is why the limits live in the script instead.

## Searching for a law

The main box answers two different questions with one query, in the order they
were asked. "Show me the judgments about X" is what it has always answered;
"show me X" is the new half, and when the query names an act, that act is the
top result and the case results keep the rest of the page.

```
vaxtalög                  → lög nr. 38/2001, then the judgments
38/2001                   → the same act, found by number
gdpr        /  2016/679   → Regulation (EU) 2016/679
130. gr. laga nr. 91/1991 → the article, with its text, then its act
gæsluvarðhald             → no act; judgments only, exactly as before
```

**The gate is the whole design.** The act lookup behind the type-ahead falls
back to trigram similarity, which is right when a human is picking from a list
and wrong when the top of the page is being decided: a search for
`gæsluvarðhald` would otherwise be headed by whichever act title happens to
share three letters with it. So `src/lib/act-match.ts` scores each candidate
against the query and only three kinds of match are promoted:

| Match | What it means |
|---|---|
| `number` | The query states the act's number, in either convention (`38/2001`, `2016/679`), or its CELEX. Nothing else can mean that. |
| `alias` | The query is one of the short names the act is cited by — `vaxtalög`, `gdpr`. These are harvested from the corpus and from EUR-Lex's own short titles, and are why an act whose title never contains its common name is still findable by it. |
| `title` | The query's words appear in the act's title. Right often enough to show, weak enough to rank last. |
| `weak` | Everything else. Not shown — the type-ahead still offers it, where a human picks. |

An article reference is resolved to the article rather than to its act, because
that is what was asked for: `5. gr. vaxtalaga` and `Article 6 gdpr` both land
on the provision, with the act one card behind it.

Two things follow from where this sits. It is a **separate request** from the
case search (`/api/search/acts`), so it cannot fail the page and does not care
which sources are ticked — a query naming no act returns nothing and nothing
changes. And the "N úrlausnir vísa til laganna — sýna þær" link on each card
**narrows the results below** rather than navigating away, which is the step
that turns a lookup into research: the act, then the cases about it, without
leaving the page.

The EES/ESB scope applies here as everywhere else, so an EU act that has not
been taken into the EEA Agreement heads a search only when the ESB scope is on.

## Asking the well

Lögbrunnur means *the well of law*, and the button in the bottom-right corner
is that well. It takes a question rather than a query — "Hvernig sæki ég um
íslenskan ríkisborgararétt?", "when may an employer dismiss without notice?" —
drops it in, and hands back an answer with the law it rests on attached.

It exists because the search box answers a question nobody starts with. A
result list is the right answer to *"which judgments contain these words"* and
the wrong answer to *"what does the law say about this"*, which is what
somebody who does not know the law yet actually wants to know. Answering that
second question well requires knowing what to search for — and knowing that is
most of what a lawyer knows.

### The three stages, and why the middle one is the feature

```
question ──▶ plan ──▶ retrieve ──▶ answer ──▶ prose + numbered sources
             (LLM)    (this app's search)     (LLM, sources only)
```

**Plan** (`src/lib/ask/plan.ts`). The question and the corpus are rarely in the
same language, and never in the same register. "How do I apply for Icelandic
citizenship" shares not one indexed token with lög nr. 100/1952, and a
full-text search for it returns nothing. So the model is asked first for the
words the *corpus* would use — `ríkisborgararéttur`, `veiting
ríkisborgararéttar` — plus the acts the question is probably governed by, and
a restatement of the question that stands on its own so a follow-up like "and
what does it cost?" is answerable. If this call fails the planner falls back to
stopword-stripped keywords rather than giving up; a bad search still finds the
act when the question names one.

**Retrieve** (`src/lib/ask/retrieve.ts`). The plan's terms go through the
*same search this app already runs* — `searchActs`, `searchProvisions`,
`search` — so the well sees exactly the corpus the search box sees, and
switching `SEARCH_PROVIDER` switches it too. Three kinds of source come back:
the act, when the question names one; the provisions, **in full text**, which
is what an answer is built out of; and the decisions, with the court's own
`Útdráttur` where it wrote one, which is the demonstration that the provision
means in practice what it appears to mean. Two rules are enforced here rather
than in a prompt:

- An act is only quoted to the model as governing when the query *genuinely
  names* it — the same `lib/act-match.ts` rule that decides whether an act may
  head the search results. The act lookup is deliberately fuzzy, which is right
  for a list a human picks from and wrong for a source a model will treat as
  authority.
- `[SAMPLE]` seed judgments are dropped. An answer resting on a sample judgment
  is a fabricated answer however clearly the card labels it.

**Answer** (`src/lib/ask/answer.ts`). The model gets the retrieved law and
nothing else, and is told to cite a numbered source for every proposition, to
never write an act number, article number or case number that is not in the
sources, and to say plainly when the sources do not answer the question. Two
short-circuits sit in front of it and never reach the model at all: a question
that is not a legal one, and a question where retrieval came back empty. Both
are cases where asking a model to answer is asking it to invent, which is the
one failure this feature exists to prevent.

Every numbered source carries a route into this app, so the answer is never a
dead end: `[2]` is a link to 8. gr. in the act reader, `[4]` a link to the
judgment. A journal article links out to the journal instead — its text is
indexed here and never republished, in the well as everywhere else.

### The animation is doing a job

Opening the well shows a stone well; the question falls in on a slip of paper;
while the search runs, article numbers and `§` marks arc up out of the shaft;
the answer rises. Retrieval plus two model calls is several seconds, which is a
long time in front of a spinner and no time at all in front of something to
watch — and what comes *out* says what the well is doing. It is fetching law,
not thinking. Under `prefers-reduced-motion` all of it is switched off and the
scene is a drawing of a well; the request is sent while the paper is still in
the air, so the animation covers the wait rather than adding to it.

### Configuration

The well runs on **OpenAI or Anthropic**, chosen at runtime. Everything above
`src/lib/ask/llm.ts` — the planning, the retrieval, the answer's rules — is
written against a two-method interface and does not know which one answered,
so switching is one variable and no code.

| Variable | Default | What it does |
|---|---|---|
| `OPENAI_API_KEY` | — | The key for the OpenAI side. |
| `ANTHROPIC_API_KEY` | — | The key for the Anthropic side. |
| `ASK_PROVIDER` | *the key that is set* | `openai` or `anthropic`. Only needed when both keys are configured — then this is the switch. |
| `ASK_MODEL_OPENAI` | `gpt-5.6-terra` | Model on the OpenAI side. `gpt-5.6-sol` or `gpt-6-astra` for a better answer, `gpt-5.6-luna` for a much cheaper one. |
| `ASK_MODEL_ANTHROPIC` | `claude-opus-5` | Model on the Anthropic side. |
| `ASK_MODEL` | — | Overrides whichever of those two is active. Set the per-provider pair once and flip `ASK_PROVIDER`; use this for a quick one-off. |
| `ASK_EFFORT` | `medium` | `low` … `max`. How hard the model works on the answer — both APIs happen to take the same five words. A legal answer is worth thinking about, but somebody is watching a bucket go down a well while it does, so the default sits below either API's own `high`. Raise it if you would rather wait. |

**With no key at all the well is off**, and off means absent: the launcher is
never rendered rather than offered and then failing, and `/api/ask` answers
503. The same holds for `ASK_PROVIDER=openai` with no OpenAI key — naming a
provider whose key is missing switches the well off rather than quietly
answering from the other one.

#### Swapping providers to compare them

Set both keys and both model variables once, then flip the one switch:

```bash
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
ASK_MODEL_OPENAI=gpt-5.6-terra
ASK_MODEL_ANTHROPIC=claude-opus-5

ASK_PROVIDER=openai      # ← the only line that changes
```

On Railway these are ordinary service variables, so changing `ASK_PROVIDER`
triggers a redeploy and takes effect a minute or so later — it is a
deploy-time switch, not a per-request one. Ask the same question on each side
and compare; the retrieval is identical either way, so what differs is only
how the retrieved law was written up.

On the Anthropic side, server-side refusal fallbacks are on: if the model
declines a request, the API re-runs it on a substitute chosen by refusal
category rather than returning an empty answer to the well. The OpenAI side
reports a filtered completion through `finish_reason` instead, and the well
says so rather than showing a blank card.

`POST /api/ask` takes `{ question, history }` and returns `{ answer, sources,
language }`. It is rate-limited to 12 questions per 10 minutes per address, in
memory — enough to stop an unmetered public endpoint spending money, and no
substitute for a real limit in front of the app.

#### When the well says it cannot answer

`GET /api/ask` reports what the running server is configured with — not what
it was built with:

```bash
curl https://<your-app>/api/ask
# {"enabled":true,"provider":"openai","model":"gpt-5.6-terra"}
```

That endpoint is also what the launcher itself asks before it renders, which
is why enabling the well does **not** need a rebuild: the pages that carry the
launcher are statically prerendered, so anything the layout read from the
environment would be frozen at build time and a key added afterwards would
never appear to exist.

If a question comes back with an error, the error says which of these it is:

| What you see | What it means |
|---|---|
| *"The API key was rejected"* | The key is wrong, or picked up a trailing space or newline when it was pasted. |
| *"The model … does not exist for this key"* | The default model is not one this account can use. Set `ASK_MODEL_OPENAI` (or `ASK_MODEL_ANTHROPIC`) to one it can. |
| *"The account has no available quota"* | The key is valid but the account has no credit. A brand-new key with no billing set up fails on its very first request; this does not clear by waiting. |
| *"valid but not allowed to use this endpoint"* | Usually a project-scoped key whose project lacks access. |
| *"Ég fann ekkert í brunninum" / "I found nothing in the well"* | Not a key problem at all. The model was never called: the search returned nothing, so there was nothing to answer from. |

That last row is the useful distinction. The well never calls a model without
retrieved law, so *"I found nothing"* means the database and the search are the
thing to look at, and any other error means the provider call is.

The full stack for anything unrecognised goes to the server log
(`console.error("Ask failed:", …)`) — on Railway, the service's **Deploy Logs**.

### What it will not do

It describes what the law says. It does not advise on what to do, does not
predict how a case would be decided, and does not fill a gap in the sources
from its own knowledge. The panel carries the same disclaimer the rest of the
app does, for the same reason: this is an unofficial research tool, and the
citation under each sentence is there to be followed.

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

## Tests

```bash
npm test           # the whole suite, no database and no network
npm run typecheck  # tsc --noEmit
```

Node's own test runner through `tsx`, so there is no test framework to
install and no config to keep in step with `tsconfig.json`. Tests sit next to
what they test as `*.test.ts`. CI (`.github/workflows/ci.yml`) runs the
typecheck and the suite on every pull request.

What is covered, and why those:

| Module | What the tests hold down |
|---|---|
| `lib/legal-citations.ts` | that `lög nr. 91/1991` and `mál nr. 91/1991` stay told apart, and that every citation form the courts use still extracts |
| `lib/provision-query.ts` | that what a user can type matches what the linker can extract — the two halves of the same grammar |
| `lib/judgment-text.ts` | letter-spaced headings, abbreviation-aware sentence splitting, blob reflow, `Útdráttur` extraction |
| `lib/lagasafn.ts` | the act parser, against two real acts frozen from althingi.is |
| `lib/query-parser.ts` | case-number detection and the boolean → `websearch_to_tsquery` translation |
| `lib/sources.ts`, `lib/adr-boards.ts` | registry invariants: unique keys, every board a source, Félagsdómur not among the boards, exotic `Committee=` values surviving URL encoding |
| `search-eval/metrics.ts` | the ranking metrics themselves |
| `lib/ask/llm.ts` | which provider answers and on which model — configuration flipped on a dashboard, whose failure modes (a silent fallback to the other provider, a launcher with no key behind it) are quiet ones |
| `lib/ask/plan.ts` | that a plan is sanitised before it reaches the search, and that a planning failure degrades to keywords instead of failing the question |
| `lib/ask/answer.ts` | that a question with no retrieved law, and a question that is not a legal one, never reach the model at all |
| `lib/ask/render.ts` | that `[3]` becomes the link to source 3 and not four characters of prose |

Every failure mode in that list is silent. A citation that stops matching
produces no link; a board whose filter value is mangled returns an empty
listing, which is indistinguishable from "nothing new" and so fails forever.
None of it raises anything at ingestion time, which is why it is worth a test
rather than a look.

### Fixtures

`src/lib/__fixtures__/` holds gzipped real responses, recorded in
`manifest.json` with their URL and capture date — currently two Lagasafn acts
(38/2001 and 81/2004, chosen between them to carry chapters, lettered
articles, temporary provisions, an annex and repealed articles). Assertions
are structural rather than exact: Alþingi amends these acts, and a test
pinning `provisions.length === 53` fails on the next amendment and trains
everyone to ignore it. What must not change is the shape the parser recovers,
and that breaks only when the markup does.

**The fourteen ingestion adapters have no fixtures yet, and that is the gap
worth closing next.** Each wants one frozen listing page and one frozen
document page; `src/lib/lagasafn.test.ts` is the pattern. Both of the
formatting bugs this repo has fixed by hand — Félagsdómur's letter-spaced
headings, and the pre-2010 half of that court filing its parties as subject
tags — are exactly what a frozen listing page catches on the next run.

## Measuring search

```bash
npm run eval:search
```

Runs the cases in `src/search-eval/queries.json` against the live corpus and
reports how the current configuration does on them. It reads `SEARCH_PROVIDER`
and `DATABASE_URL` from the environment, so it measures whatever the app would
run, and exits non-zero on a failed assertion so it can be used as a gate.

This exists because the app ships two providers behind one interface and had
no way to say which answers better, or whether a ranking change helped.

Cases come in two kinds. **Assertions** need no labelled corpus — a case
number's own case is the top hit, "vaxtalög" finds 38/2001, a scoped query
returns only the ticked sources, a quoted phrase's hits contain the phrase,
`NOT` excludes, nonsense returns nothing. **Graded cases** carry hand-labelled
answers and are scored with recall@1/@5, MRR and nDCG@10; none ship yet, and
`--record` prints the stubs for labelling one.

Cases are split into development and holdout. Tune against development; run
holdout once, to confirm a configuration already chosen.

### Near-matches are marked

The case-number condition is a trigram near-match (`d.case_number % <query>`)
and is always on, not only a fallback — so searching a case number the corpus
does not hold returns a *different* case. Right for a misspelt word, wrong for
a case number, where the reader knows exactly what they typed.

Every hit therefore carries `isFuzzy`, true when the row was reached without
satisfying an exact condition, and the result card marks those *"Svipuð
niðurstaða"*. The mark is per-hit rather than a banner because the two mix:
`22/2023` returns that case exactly *and* `88/2022` as a near-match. Always
false under `SEARCH_PROVIDER=meilisearch`, which does not report whether a hit
needed its typo tolerance.

See [docs/search-evaluation.md](docs/search-evaluation.md) for the schema, the
metrics, and the labelling rules.

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
    api/ask/route.ts             POST — the well: plan, retrieve, answer
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
  components/
    WellChat.tsx                 the well: panel, transcript, cited sources
    WellScene.tsx                the well drawing and its four phases
  lib/
    sources.ts                   source registry: courts, EEA/EFTA, Umboðsmaður, journals
    query-parser.ts              phrases / boolean / case-number detection
    judgment-text.ts             reflows extracted text into readable blocks
    acts.ts                      act catalogue listing with per-act counts
    provision-query.ts           splits "57. gr. a. laga um …" into article + act
    tags.ts                      cached subject-tag vocabulary
    lagasafn.ts                  Lagasafn HTML → chapters/provisions/paragraphs
    eur-lex.ts                   CELEX identity + EU act HTML → articles (three layouts)
    cjeu.ts                      case CELEX → C-203/15; EUR-Lex's five-field case title
    eea-tag.ts                   the one definition of EES / EES? / no tag
    act-match.ts                 whether a query genuinely names an act
    legal-citations.ts           recognises act/regulation citations in judgment text
    search/                      provider abstraction: postgres (default) + meilisearch
    ask/                         the well — see "Asking the well"
      llm.ts                     the one place this app talks to a model;
                                 OpenAI and Anthropic behind one interface
      plan.ts                    question → search terms in the corpus's language
      retrieve.ts                acts + provisions + decisions, numbered
      answer.ts                  the grounding rules, and the two short-circuits
      render.ts                  the answer's headings, bullets and citations
    citation.ts, highlight.ts
  ingestion/
    adapter.ts                   adapter interface, polite fetch, save/upsert
    run.ts                       CLI runner, records IngestionRun rows
    eurlex-sparql.ts             the SPARQL layer the EU adapters share
    adapters/
      icelandic-courts.ts        GraphQL + embedded PDF/rich text; scheduled incremental
      lagasafn.ts                in-force Icelandic acts; incremental by codex version
      efta-court.ts              EFTA Court case register, via cases-sitemap.xml
      eur-lex.ts                 EU regulations and directives in force, from Cellar;
                                 catalogue / text / retry / EEA-links passes, and the
                                 purge of families no longer ingested
      cjeu.ts                    Court of Justice and General Court judgments, from
                                 the same endpoint: a listing pass and a text pass
      eea-joint-committee.ts     EEA Joint Committee decisions (their own text),
                                 worked off the gap ledger; also purges the
                                 withdrawn EEA-Lex acts register
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
| `INGEST_MAX_CASES` | eea-joint-committee, eftasurv | Detail fetches per run (default 300 each) |
| `INGEST_MODE=retry` | eftasurv | Work the gap ledger only; no listing walk |
| `ESA_MAX_PAGES` | eftasurv | Safety bound on the API walk (default 400; the database is 135 pages) |
| `ESA_BASE` / `ESA_LISTING_ALIAS` | eftasurv | Override the site or the database's page alias |
| `INGEST_MODE=listing` | eur-lex (`catalogue`/`text`/`text-retry`/`eea-links`), cjeu | Which pass to run — see each source above |
| `EURLEX_TYPES` | eur-lex | Act families to ingest, as CELEX letters (default `R,L`; anything stored outside the list is deleted) |
| `EURLEX_YEARS_PER_RUN` | eur-lex | Catalogue years per firing, newest first (default 8) |
| `EURLEX_ACTS` | eur-lex | Act texts fetched per run (default 150) |
| `EURLEX_TEXT_SCOPE` | eur-lex | `eea` (default) fetches the possibly-EEA acts first; `all` works through the rest |
| `CJEU_TYPES` | cjeu | Courts to sweep, as CELEX letters (default `CJ,TJ`; `CJ` alone drops the General Court) |
| `CJEU_YEARS_PER_RUN` | cjeu | Listing years per firing, newest first (default 3) |
| `CJEU_FIRST_YEAR` | cjeu | Oldest case year swept (default 1954) |
| `INGEST_MAX_CASES` | cjeu | Judgment texts fetched per run (default 200) |
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

`eur-lex` reads the EU half of the same table. Its catalogue pass is SPARQL against the Publications Office's Cellar endpoint — two queries per calendar year, giving every act of that year in force — and its text pass fetches each act from Cellar by CELEX and parses it into the same chapters, provisions and paragraphs. Provisions are matched on `(actId, anchor)` and updated in place, for exactly the reason the Lagasafn adapter does it: `CaseProvisionLink` cascades from `Provision`. Anchors are EUR-Lex's own (`art_6`), so a provision link deep-links into the official text, and paragraph anchors are synthesised from them (`art_6-p1`) because EUR-Lex anchors articles but not their paragraphs. Unlike the Lagasafn adapter it does *not* clear the citation watermark when it stores new acts: the citation job reads the Icelandic citation grammar, so 17,000 EU acts arriving would trigger a full corpus rescan that could not produce a single link. See *EU acts (EUR-Lex)* above.

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
5. To switch on the well, add `OPENAI_API_KEY` (or `ANTHROPIC_API_KEY`) under **Variables**. Without one the app deploys and runs exactly as before, with no launcher. To be able to compare the two providers, add both keys plus `ASK_MODEL_OPENAI` / `ASK_MODEL_ANTHROPIC`, and flip `ASK_PROVIDER` between `openai` and `anthropic` — Railway redeploys the service on any variable change, so the swap takes effect a minute or so later. See *Asking the well*.

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
