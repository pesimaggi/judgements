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
| `topHitIsExact` | a trigram near-match being served as the answer |
| `someHitLacksWord` | Icelandic inflection matching regressing — see below |
| `everyHitContainsAnyOf` | the same going too wide |

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

## Near-matches are marked, not hidden

Searching `12595/2024` — a case number *not* in the corpus — returns a
different case, `456/2024`. That is `pg_trgm` doing what it was asked to: the
case-number condition is `d.case_number % <query>`, a trigram near-match, and
it is always on rather than only a fallback.

Right behaviour for a misspelt word, wrong for a case number, where the user
knows exactly what they typed and a near-miss is a *different case*.

Rather than remove it, every hit now carries `isFuzzy` — true when the row was
reached without satisfying an exact condition (full-text match, or
`case_number ILIKE`). The result card shows *"Svipuð niðurstaða"* on those, so
a near-match is still offered but never passes as the thing that was asked
for. The two can appear together, which is why the mark is per-hit rather than
a banner over the page: searching `22/2023` returns that case exactly *and*
`88/2022` as a near-match, and only the second should be marked.

The `topHitIsExact` assertion holds this down on the case-number cases.

**This does not carry to Meilisearch.** That provider applies typo tolerance
inside the engine and does not report whether a hit needed it, so `isFuzzy` is
always false under `SEARCH_PROVIDER=meilisearch` and the mark never appears.
Worth weighing if you ever compare the two on anything but ranking numbers.

## The inflection cases

`category: "inflection"` measures the one thing this corpus needs most and the
one thing an assertion can prove without a single hand-labelled document.

The property is simple: **at least one exact hit must not contain the queried
word at all.** A hit that is an exact match — not a trigram near-match — and
does not contain the word can only have been found through a shared lemma. That
is `someHitLacksWord`, and before `prisma/sql/setup-lemmas.sql` existed no query
could satisfy it.

Two details in it are load-bearing.

**It matches whole words, not substrings.** Icelandic inflection is largely
suffixal, so `stjórnsýslulög` is a *substring* of `stjórnsýslulögum`. A naive
`includes` check would pass this assertion on a corpus with no lemmatisation
whatsoever, which is worse than not having the assertion.

**It ignores fuzzy hits.** `pg_trgm` will also find a hit that lacks the word.
Counting one would let the case pass with the dictionary switched off.

`everyHitContainsAnyOf` watches the other direction. `someHitLacksWord` fails
when lemma matching is too narrow; this fails when it is too wide — a
decomposition that reduced a compound to a common stem would match half the
corpus, and none of those hits would contain any real form of the word.

The queries were chosen from BÍN's actual inflection tables rather than from
memory, and favour words whose **stem changes**, because those are the ones no
prefix, substring or trigram match can reach:

| Query | What the judgments actually write |
|---|---|
| `dráttarvextir` | `dráttarvaxta`, `dráttarvöxtum` |
| `stjórnsýslulög` | `stjórnsýslulaga`, `stjórnsýslulögum` |
| `uppsögn` | `uppsagnar`, `uppsagnarinnar` |
| `skaðabætur` | `skaðabóta`, `skaðabótum` |

`skaðabætur` is the one worth understanding. BÍN lemmatises it to the
**singular** `skaðabót` — so the word a lawyer types is not the lemma, it is
merely mapped to one, and from there reaches forms that share almost nothing
with it. No hand-written synonym list would have produced that.

`inflection-phrase-untouched` guards the opposite promise: a quoted phrase is
deliberately never lemmatised, and must keep behaving exactly as it did before.

### Running them

They need the dictionary. Without it the run says so once, in a line, rather
than producing several failures that read like a ranking problem:

```
! bin_lemma is empty, so every inflection case below will fail.
  Run: npm run db:load-bin -- --rebuild
```

They are not skipped in that state. An inflection case failing because the
dictionary is missing is a real failure of that deployment's search, and
quietly excluding them would report a green run over a corpus that cannot match
an inflected word. On `SEARCH_PROVIDER=meilisearch` the warning says instead
that these are measuring that provider's own tokenising, since the lemma
vectors are Postgres-only.

### One thing found while writing them

`everyHitContains` and `noHitContains` were comparing against the raw snippet,
which is a `ts_headline` string with the matched terms wrapped in `<mark>`. A
two-word phrase therefore arrived as
`<mark>greiðslu</mark> <mark>málskostnaðar</mark>` and never matched a substring
test for `greiðslu málskostnaðar`.

Single-word assertions survive it by luck — `<mark>x</mark>` still contains `x`
— which is why it went unnoticed: the bug is invisible until an assertion spans
more than one word. Both now compare against `hitText()`, which strips the
markup first.

### What is still missing

No **graded** inflection cases. The assertions prove the mechanism works; they
do not say how much recall it added, which needs `relevant: [{officialUrl,
grade}]` labels over the real corpus. `npm run eval:search -- --record` prints
the stubs. That is the phase-0 work in *well-roadmap.md*, and it is where a
number like "governing provision in the top 5" would come from.
