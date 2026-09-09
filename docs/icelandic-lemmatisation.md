# Icelandic lemmatisation

The search index used to match word forms exactly. In Icelandic that is close
to not matching at all, and this is what was done about it.

## The problem, in one screen

`prisma/sql/setup-search.sql` builds every search vector with
`to_tsvector('simple', …)`. The `simple` configuration was chosen so that
Icelandic characters survive tokenising, which it does — and it also does no
stemming whatsoever. BÍN's own data shows what that costs:

```
$ grep '^ríkisborgararéttur;' SHsnid.csv
ríkisborgararéttur;83784;kk;alm;ríkisborgararéttur;NFET
ríkisborgararéttur;83784;kk;alm;ríkisborgararétturinn;NFETgr
ríkisborgararéttur;83784;kk;alm;ríkisborgararétt;ÞFET
ríkisborgararéttur;83784;kk;alm;ríkisborgararéttinn;ÞFETgr
ríkisborgararéttur;83784;kk;alm;ríkisborgararétti;ÞGFET
ríkisborgararéttur;83784;kk;alm;ríkisborgararéttinum;ÞGFETgr
ríkisborgararéttur;83784;kk;alm;ríkisborgararéttar;EFET
ríkisborgararéttur;83784;kk;alm;ríkisborgararéttarins;EFETgr
```

Eight spellings of one word, and to Postgres eight unrelated lexemes. A search
for any one of them found none of the other seven.

That fell hardest on the well. `src/lib/ask/plan.ts` asks the model for the
words *the corpus* uses, and a model asked that produces the dictionary form —
`ríkisborgararéttur`. Judgments and legislation are written in the oblique
cases. So the stage whose whole purpose is to bridge the gap between the
question's vocabulary and the corpus's was producing the one form the corpus
mostly does not contain.

## What is here now

A second vector, `lemma_vector`, on `Document` and on `provisions`, built by
mapping every lexeme through BÍN. The query is mapped through the same
dictionary, and the two conditions are OR'd:

```
d.search_vector @@ websearch_to_tsquery('simple', <as typed>)
OR
d.lemma_vector  @@ websearch_to_tsquery('simple', <lemmatised>)
```

**The original condition is untouched.** Everything that matched before matches
now, identically ranked. The lemma condition can only add rows. That property
is worth keeping: it is what made this safe to switch on for every search at
once rather than behind a flag.

| Piece | Where |
|---|---|
| `bin_lemma` table, `bin_lemma_vector()`, the vectors, triggers, indexes | `prisma/sql/setup-lemmas.sql` |
| Runner for the above | `prisma/setup-lemmas.ts` |
| Dictionary loader, unknown-word export, rebuilds | `prisma/load-bin.ts` |
| Query rewriting, pure and unit-tested | `src/lib/lemma.ts` |
| The database lookup and its cache | `src/lib/lemma-lookup.ts` |
| Wiring, ranking, highlighting | `src/lib/search/postgres.ts` |
| Optional compound resolution | `scripts/bin-compounds.py` |

## Running it

```bash
npm run db:setup-lemmas     # table, vectors, triggers, indexes
npm run db:load-bin         # downloads BÍN (~34 MB) and loads it
npm run db:load-bin -- --rebuild    # build vectors for the existing corpus
```

`db:deploy` runs the first of those. The load is deliberately not part of it: it
is a 377 MB download and a one-off, and a deploy should not repeat it.

On a deployment none of this is manual: the scheduled ingest runs a
`bin-dictionary` step first in its chain, which loads the dictionary if it is
missing, invalidates the vectors built before it existed, and rebuilds them
`BIN_REBUILD_ROWS` at a time across firings. See *Running it* in README.

Measured on the full file: **63 seconds**, 7,425,971 rows collapsing to
**3,698,046 surface forms**, of which 108,936 (2.9%) are ambiguous.

## Why a table and not a Postgres dictionary

Postgres ships two mechanisms built for precisely this — an `ispell`/hunspell
dictionary, and the `synonym` template — and both read their data from files
under the server's `$SHAREDIR/tsearch_data`. On managed Postgres, which is what
this deploys to, there is no filesystem to put them on. A table is the portable
form of the same idea, and it has one genuine advantage: the dictionary can be
extended (see compounds, below) without touching the server.

## The three concessions

Each is deliberate, and each is bounded by the fact that the exact vector is
still matching alongside.

**A quoted phrase is never lemmatised.** `websearch_to_tsquery` matches a phrase
by adjacency, and the lemma vector's positions are only approximately those of
the source text — an ambiguous form contributes all its lemmas at one position
and shifts what follows. Lemmatising a phrase would match it as loose words,
which is the regression `everyHitContains` in the search evaluation exists to
catch. It is also wrong on its own terms: quoting a phrase asks for those words.

**An ambiguous form contributes only its first lemma.** Websearch syntax has no
parentheses, so `(a OR b) AND c` cannot be expressed, and moving this path to
`to_tsquery` would mean reimplementing the operator handling in
`src/lib/query-parser.ts` instead of reusing it. 2.9% of forms are affected, the
choice is deterministic (sorted at lookup), and the exact vector still matches.

**A lemma match counts as exact, not fuzzy.** `SearchHit.isFuzzy` drives a
"near match" badge, and an inflected form is the same word — a far stronger
claim than the trigram near-match that badge was built for. Labelling these
fuzzy would put a warning on results that are simply correct.

## Two things that had to be handled or the results look broken

Both were found by testing end to end, and neither is obvious from the SQL.

**Ranking.** A document found only through its inflected forms scores zero
against the plain vector. Without taking the `greatest()` of the two scores,
every row the lemma path newly finds would sort below every row that was
already being found — the recall would be real and invisible.

**Highlighting.** `ts_headline` re-tokenises the judgment and marks what the
*query* matches. A document found because `ríkisborgararéttar` shares a lemma
with the typed `ríkisborgararéttinum` came back with nothing highlighted, which
reads as a broken search rather than a wider one. So the headline query is
expanded back out to the lemma's sibling surface forms — which is what
`bin_lemma_lemmas_idx`, the GIN index on `lemmas`, is for.

## What the trigger costs ingestion

Measured worst case: every word distinct and drawn from BÍN, which no real
judgment is.

| Document | Distinct lexemes | Plain vector only | Both vectors | Added |
|---|---|---|---|---|
| 10 KB | 803 | 5.6 ms | 23.2 ms | +18 ms |
| 50 KB | 3,876 | 8.4 ms | 75.4 ms | +67 ms |
| 200 KB | 13,862 | 30.3 ms | 279 ms | +249 ms |

About 18 µs per distinct lexeme. Ingestion fetches each document over HTTP
before it stores it, so this sits well inside the network cost it is already
paying. The few very long documents — Óbyggðanefnd's rulings run to hundreds of
pages — cost a second or two each, once.

## Compounds, and where BinPackage fits

BÍN holds ~348,000 lemmas. Icelandic legal prose compounds past any dictionary:

```
ríkisborgararéttarumsókninni  ->  ríkisborgararéttarumsókn
málsmeðferðarreglnanna        ->  málsmeðferðarregla
```

Neither is in BÍN. Miðeind's [BinPackage](https://github.com/mideind/BinPackage)
decomposes them, and it is the best Icelandic morphology tool there is — but it
is a Python library with no CLI and **no bulk-export API**: you can ask it about
a word, you cannot ask it for its contents. So it cannot be the runtime
lemmatiser for a TypeScript app, and it cannot generate `bin_lemma` either.
That comes from the published CSV and needs no Python at all.

What it can do is resolve a finite list of words, offline:

```bash
npm run db:load-bin -- --unknown unknown.txt   # corpus words BÍN lacks
pip install islenska
python3 scripts/bin-compounds.py unknown.txt > extra.tsv
npm run db:load-bin -- --extra extra.tsv --rebuild-all
```

`--unknown` reads the stored `search_vector`s, anti-joins the dictionary, and
writes what is missing commonest-first. `--extra` merges the result and never
overwrites BÍN — a decomposition is a guess, the dictionary is not.

`--rebuild-all` rather than `--rebuild` is the part that is easy to get wrong:
`--rebuild` only fills vectors that were never built, so after the dictionary
itself changes the stored vectors are *stale* rather than absent, and the merge
silently does nothing. The loader says so when it adds forms.

Skipping this step costs recall on the long tail and nothing else.

## Licence

BÍN's language-technology data is **CC BY-SA 4.0**, and attribution is a
condition:

> Beygingarlýsing íslensks nútímamáls. Stofnun Árna Magnússonar í íslenskum
> fræðum. Höfundur og ritstjóri Kristín Bjarnadóttir.

It is carried in the site footer (`src/app/layout.tsx`), in `README.md`, and in
the loader. Two consequences worth remembering:

- The CSV is **not committed** — `prisma/data/` is gitignored. It is downloaded
  at load time.
- ShareAlike attaches to the derived table if it is ever *redistributed*.
  Building it from the published file rather than shipping it keeps that
  question from arising.

BinPackage itself is MIT, © Miðeind ehf.

## What is not done

- **Highlighting inside the act reader and `ts_headline` on provisions.**
  Provision snippets are `left(full_text, 400)` with no highlighting at all
  today, so there was nothing to preserve; when they gain it, they need the
  sibling-form expansion too.
- **Meilisearch.** The other provider has its own tokenising and typo
  tolerance and is untouched by this. A deployment on `SEARCH_PROVIDER=meilisearch`
  gets none of the above.
- **Graded** inflection cases. `src/search-eval` now carries seven assertion
  cases in `category: "inflection"` — see *search-evaluation.md* — which prove
  the mechanism works and, deliberately, fail when the dictionary is missing.
  What they cannot say is how much recall this added; that needs hand-labelled
  `relevant` entries over the real corpus, and belongs with the phase-0 work in
  *well-roadmap.md*.
