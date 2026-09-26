# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Lögbrunnur — Icelandic legal research over judgments, acts, regulations and EEA/EU
law. Next.js App Router, Postgres via Prisma, deployed on Railway.

`README.md` is long and genuinely authoritative: it documents every source, every
environment variable and every ingestion mode. Consult it before inventing an
answer about a source or a knob. This file covers what the README does not — the
cross-cutting rules you would otherwise have to infer by reading several files.

## Commands

```bash
npm test                                  # whole suite; no database, no network
node --import tsx --test src/lib/ask/tools.test.ts   # one test file
npm run typecheck                         # tsc --noEmit
npm run eval:ask                          # answer evaluation, offline
npm run eval:ask -- --live                # real pipeline; needs DATABASE_URL + an API key
npm run eval:search                       # retrieval ranking metrics
npm run dev

npm run ingest -- --adapter=<key>         # one adapter; keys are in src/lib/sources.ts
INGEST_MODE=recent npm run ingest -- --adapter=icelandic-courts
```

First run needs a database: see *Quick start* in the README (`db:push`,
`db:setup-search`, `db:setup-lemmas`, `db:load-bin`, `db:seed`).

CI runs typecheck, the suite and the offline answer evaluation on every PR.
**`npm run lint` is not wired up** — ESLint has never been configured, so
`next lint` prompts for a config and would hang. Don't add it to a workflow
without configuring ESLint first.

## Three subsystems

**Search** — `src/lib/search/` behind a provider interface: Postgres FTS by
default, Meilisearch optional. `query-parser.ts` turns what a user types
(phrases, booleans, case numbers) into a query.

**Acts and provisions** — Lagasafn and EUR-Lex acts parsed into
chapters/provisions/paragraphs, with judgments linked to the articles they cite
by `src/ingestion/citations.ts`. One `Act` table holds Icelandic acts, Icelandic
regulations, EU acts and the four founding treaties; `jurisdiction` tells them
apart and is what every act query filters on. A treaty is one instrument with
possibly two authentic texts — two rows joined by `textGroup`, one `isCanonical` —
and `corpusFilter()` is the only place that keeps a listing to one of them.

How a treaty binds Iceland is a separate question from which of its texts we hold,
and `src/lib/treaties.ts` keeps them in separate fields because the answers come
apart: the EEA main text was enacted here, the Surveillance and Court Agreement
binds Iceland without having been enacted, and the EU treaties bind it not at all.
Saying any of the three where another is true is a false statement about Icelandic
law, not a wording choice.

**The well** (`src/lib/ask/`) — the assistant. Stages run in order via
`pipeline.ts`: plan → retrieve → answer → (optional) verify. With research
enabled — the default — retrieval is replaced by an agentic loop in
`research.ts` that calls the tools in `tools.ts`.

## Rules that are easy to break

**Only `llm.ts` talks to a model.** Every stage takes the `AskModel` interface,
which is why no test makes a model call or touches the network — tests hand it a
fake, including for refusals, throws, hangs and unparseable replies. Keep any new
model call behind that seam.

**Our code numbers the sources, never the model.** A citation to a source that
does not exist is removed and the rest are *not* renumbered (`citations.ts`). In
the research loop, only a document actually opened with `read_decision` or
`read_provision` can be cited — searching adds nothing to the source list.

**`scopeFilter()` is the gate for the whole act library.** Every act lookup, the
act type-ahead, provision search and the well's retrieval reach acts through it,
so a `jurisdiction` value it does not admit is invisible to the entire
application — which looks exactly like an ingest that stored nothing. It is why
adding the treaties was one line there and no lines in `src/lib/ask/`.

**`SOURCES` is live sources only.** `sources.ts` exports `ALL_SOURCES` (including
`status: "pilot"`) and `SOURCES` (live only). The well's retrieval and tool
schemas are both built from `SOURCES`, so a pilot source is invisible to the
assistant and its key is rejected as unknown — currently true of
`althingi-frumvorp`. A source's `kind` (`decision` / `scholarship` / `travaux`)
decides what the provision-citation job will scan; only decisions feed the
"úrlausnir vísa til þessa ákvæðis" badge.

**`ASK_EFFORT` must keep working.** `config.ts` has per-stage effort variables,
but a deployment that set only the old single knob must still get what it asked
for. There is a test class for exactly this; don't regress it. Note also that the
deep path takes `max(chosen, deep.answerEffort)`, so a per-stage setting can be
silently moot.

**Metrics carry no content.** No metrics line may include the question, the
conversation, the answer, or an error message. Asserted by a negative test.

**Source text must not read as an instruction.** `evidence.ts` guards against
retrieved text passing itself off as a prompt; keep that in mind when changing
how evidence is windowed or rendered.

## Ingestion

Adapters live in `src/ingestion/adapters/`, one per source, registered against a
key in `sources.ts`. They share `politeFetchText` / `politeFetchBytes` from
`adapter.ts`: one request at a time, a minimum delay, an honest User-Agent,
retries on 5xx and 429 only. Check robots.txt and terms before pointing a new
adapter at a live site.

Adapters resume rather than restart: `IngestCursor` for position, and
`ctx.isKnown(source, officialUrl)` as the watermark so a known document is
skipped *before* its detail page is fetched. That is what makes the 3-hourly
schedule cheap.

An adapter that cannot reach its source should say so distinctly — a blocked
source is not the same as one missing document. `adapters/frumvorp.ts` is the
worked example: Alþingi's Cloudflare rule refuses `/altext/*` to datacenter IPs,
so it logs a blocked source and gives up rather than reporting hundreds of
per-document errors.

Seed and mock rows carry `isSample`. Never let them pass as real.

## Tests

Node's own runner through `tsx`; tests sit next to what they test as
`*.test.ts`. There is no framework and no separate config.

Assertions on fixtures are **structural, not exact**. `src/lib/__fixtures__/`
holds gzipped real responses; asserting `provisions.length === 53` fails on the
next amendment to the act and teaches everyone to ignore the suite. Assert the
shape the parser recovers.

What earns a test here is a **silent** failure: a citation pattern that stops
matching produces no link, a mangled board filter returns an empty listing that
looks exactly like "nothing new", a parse that keeps reading past the end of a
treaty returns a thousand articles that are all real text filed under the wrong
numbers. The README's *Tests* section lists what each
module's tests hold down and why.

Known gap: the ingestion adapters have no fixtures except `treaties`, and the
research loop has no offline evaluation at all — `eval:ask` replays a recorded retrieval, which
switches deep research off, so the loop only runs under `--live`.

## Icelandic

The UI, the model prompts and the answers are in Icelandic. Code and comments are
in English.

JavaScript's `\b` is ASCII-only, so `/\bþágildandi\b/` matches nothing and fails
silently. Use `src/lib/word-boundary.ts`. Several tests exist only because of
this.

Search each corpus in its own language: Icelandic sources in Icelandic, the EFTA
Court, CJEU and ESA in English.

## House style

Comments here are unusually discursive and explain *why* — the constraint, the
bug that motivated the code, the failure mode being prevented — rather than
restating what the code does. Match that when editing; a terse comment in this
codebase reads as a gap.
