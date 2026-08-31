# Measuring search

Lögbrunnur ships two search providers behind one interface — PostgreSQL FTS
and Meilisearch — and, until this existed, no way to say which of them answers
better, or whether a ranking change helped or hurt. This is that way.

```bash
npm run eval:search                               # both splits, current provider
npm run eval:search -- --split development        # while changing ranking
SEARCH_PROVIDER=meilisearch npm run eval:search   # the other provider, same cases
```

It reads `DATABASE_URL` and `SEARCH_PROVIDER` from the environment, so it
measures whatever the app itself would run. It exits non-zero when an
assertion fails, so it works as a gate and not only as something to read.

## Two kinds of case

`src/search-eval/queries.json` holds both. The split exists because waiting
for a hand-labelled corpus would have meant measuring nothing for months.

**Assertions** are properties that hold without anyone deciding what the right
answer is:

| Assertion | Catches |
|---|---|
| `topHitCaseNumber` | a case-number lookup that stops being a lookup |
| `act` | an act alias regressing — "vaxtalög" no longer finding 38/2001 |
| `minResults` / `maxResults` | a query going empty, or nonsense returning rubbish |
| `onlySources` | the strict opt-in promise leaking |
| `everyHitContains` | a quoted phrase being matched as loose words |
| `noHitContains` | `NOT` no longer excluding |

These run today and catch most of what actually goes wrong. A ranking
regression that empties a common query shows up here long before it shows up
as a tenth of a point of nDCG.

**Graded cases** carry hand-labelled answers and are scored properly:

```json
{
  "id": "vaxtalog-cases",
  "query": "dráttarvextir",
  "relevant": [
    { "officialUrl": "https://www.haestirettur.is/domur/...", "grade": 3 },
    { "officialUrl": "https://landsrettur.is/domar/...", "grade": 2 }
  ],
  "mustOutrank": [{ "before": "https://…/a", "after": "https://…/b" }]
}
```

Grades are `3` primary answer, `2` strongly relevant, `1` contextual. A
document keyed by `officialUrl` because that — with `source` — is the
document's identity in the schema, and unlike the row id it survives a
re-ingest.

To label a case, run it and paste the stubs:

```bash
npm run eval:search -- --case vaxtalog-cases --record
```

## What is reported

- **recall@1 / recall@5** — was anything relevant in the top 1 / top 5.
- **strict recall@1** — was the *primary* answer first. Usually the number
  that matters: a search for "vaxtalög" that returns eight cases mentioning
  interest but not the act is not a success.
- **MRR** — reciprocal rank of the first relevant result.
- **nDCG@10** — the whole first page, discounted by position. The ideal
  ranking is built from the case's declared grades, not from what the engine
  returned, so missing a relevant document is penalised rather than hidden.
- **pairwise accuracy** — the share of `mustOutrank` pairs ordered correctly.

`src/search-eval/metrics.ts` also has `pairedBootstrapCI`, for the question
that actually decides whether to merge a ranking change: *is this difference
bigger than the noise in a query set this small?* Feed it the per-case deltas
between two runs. An interval that includes zero means the change is not
supported by the evidence, however good the average looks.

## Development and holdout

Cases are split. **Tune against development. Run holdout once, to confirm a
configuration you have already chosen.** Tuning against holdout turns it into
a second development set and the numbers stop meaning anything.

## Adding cases

Add them from observed failures — a query that returned the wrong thing is
worth more than a query invented to be answered. Two rules worth keeping:

- Do not tune expected results to whatever the engine currently ranks first.
  That measures agreement with today's ranking, not correctness.
- Do not generate relevance labels from the same signals being evaluated. If
  the ranking uses citation counts, labelling by citation count grades the
  ranking against itself.

This set is a regression suite, not a representative sample of what users
search for. Do not use aggregate recall over eighteen cases to justify
switching providers — expand it first.

## Known limits

- **No labelled cases ship with it.** Every case is currently assertion-only.
  The metrics are unit-tested (`src/search-eval/metrics.test.ts`) but the
  ranking numbers stay empty until someone labels a case against a real
  corpus.
- **Assertions were written against the corpus as described, not verified
  against it.** They were exercised against the four-document seed, where
  most correctly report an empty corpus. Run once against production and
  correct any that turn out to encode a wrong expectation rather than a real
  failure.
- **Latency is not measured.** Add it only with the usual caveats: same
  machine, same Node version, same corpus, warm cache.

## One thing the seed run already surfaced

Searching `12595/2024` — a case number *not* in the corpus — returned a
different case, `456/2024`, at rank 1. That is the `pg_trgm` fuzzy fallback
doing what it was asked to do. It is the right behaviour for a misspelt word
and the wrong behaviour for a case number, where the user knows exactly what
they typed and a near-miss is not a near-answer.

Worth deciding deliberately: either exclude case-number lookups from the
fuzzy fallback, or mark fuzzy hits in the UI. `parseQuery` already flags
`isCaseNumberLookup`, so the information is there.
