# Making the well competitive

A plan for turning the well from a good retrieval-grounded answer feature into
something that answers legal questions well enough that a lawyer would use it
instead of opening three tabs.

Originally written against `main` at `b26ba46`. Every claim about current
behaviour below is a claim about a file in this repository, and the file is
named.

---

## Where this stands

**Read this first.** Roughly half of what follows has shipped, and the
diagnosis sections are written in the present tense describing problems that
no longer exist. They are kept because *why* something was done is worth more
than the fact that it was — but check here before treating any of it as a
description of today.

| Item | State |
|---|---|
| §2 Phase 0 — measurement | **partly.** Seven inflection assertions in `src/search-eval` (see *search-evaluation.md*). No gold set, no nDCG, no LLM-judge, not in CI. The largest thing still outstanding. |
| §3.1 Icelandic morphology | **shipped** (#56). Route B, BÍN, 3.7M surface forms. Route A turned out to be impossible on managed Postgres — see the correction in that section. Written up in *icelandic-lemmatisation.md*. |
| §3.2 Hybrid / vector search | **not started.** No pgvector, no embeddings anywhere in the repo. |
| §3.3 A real reranker | **not started.** `ASK_RERANK_WITH_MODEL` is still off and still the expensive LLM version; no cross-encoder. |
| §3.4 Raise the budgets | **not started.** Still `maxCandidates` 30, `maxSources` 10, evidence 1,200 chars, provisions 2,400, and case-number searches fetching 5 rows. |
| §4 Phase 2 — make the wait visible | **shipped** (#58). SSE, per-line validated streaming, plan terms and sources during the wait, minimise-to-pill. The answer cache and a real rate limiter are *not* done. |
| §5 Phase 3 — deep research | **shipped** (#57). `ASK_RESEARCH=1` or `{"mode":"deep"}`. Six tools including `find_citing_cases` and subject-tag filtering. The adversarial pass in that section is not done. |
| §6 Phase 4 — legal substance | **not started.** No point-in-time law, no citator, and the corpus priorities in §6.3 are untouched. |
| §7 Phase 5 — product | **not started.** |

Two things shipped that this roadmap never proposed, both fixing bugs found
while doing the above:

- **English section extraction.** `extractReasoning`/`extractHolding` matched
  only `Niðurstaða`/`Dómsorð`, so they returned null for every EFTA Court,
  CJEU, General Court and ESA document — the well held those judgments in full
  and could not read their reasoning or operative part. See
  *icelandic-lemmatisation.md* and the README's evidence section.
- **A reading pane.** A source or a citation chip now opens the judgment beside
  the answer instead of navigating away from the conversation.

The live scoring log is *ai-answer-evaluation.md*, which is where the next
round of work is being judged.

---

## 0. What is already right, and must not be rebuilt

It is worth being explicit about this, because the temptation when something
feels underpowered is to rewrite it, and most of what is here is the part that
is hard to get right.

- **The pipeline shape is correct.** Plan → retrieve → rank → answer → validate
  → verify (`src/lib/ask/pipeline.ts`) is the shape every serious
  retrieval-grounded legal system converges on. Which stages may fail and what
  each degrades to is already decided and already documented.
- **The grounding discipline is correct.** The answer stage sees the retrieved
  law and nothing else; a citation to a source that does not exist is deleted
  rather than renumbered (`src/lib/ask/citations.ts`); an uncited proposition
  is marked unverified. This is the thing that separates a legal research tool
  from a chatbot that sounds like one, and it is done.
- **Fusion is correct.** Weighted RRF over several focused searches
  (`src/lib/ask/fusion.ts`) is the right merge, and — this matters for
  everything below — it takes an arbitrary number of `RankedList`s. A vector
  search slots into it as one more list with one more weight. No rewrite.
- **The evidence extraction is correct.** Labelling a judgment's útdráttur,
  matched passage, Niðurstaða and Dómsorð separately
  (`src/lib/ask/evidence.ts`) is a real insight about legal text that most
  RAG implementations never have.
- **The provider seam is correct.** `src/lib/ask/llm.ts` is the only file that
  knows which model answers, and it is already on current API surfaces —
  adaptive thinking, `output_config.effort`, strict tools, server-side refusal
  fallbacks, prompt caching on the system prompt.
- **There is an evaluation harness at all**, and it replays through the real
  code rather than a copy of it (`src/ask-eval/run.ts`). That design is right.
  It is starved of fixtures, which is a different problem.

So: nothing below is a rewrite. Everything below is either a new stage that
plugs into an existing seam, a corpus, or a number that is set too low.

---

## 1. Diagnosis — what actually caps the quality

Five things, roughly in order of how much they cost you.

### 1.1 Retrieval is lexical only, over a language that punishes lexical search

`prisma/sql/setup-search.sql` builds every `search_vector` with
`to_tsvector('simple', …)`. The `simple` configuration does no stemming at
all — it lowercases, splits on non-word characters, and stops.

Icelandic is one of the worst languages in Europe for that. A noun has up to
sixteen surface forms across case, number and definiteness; an adjective over a
hundred. The planner (`src/lib/ask/plan.ts`) is explicitly asked for the words
the *corpus* uses, and a model asked that will produce nominative singular —
`ríkisborgararéttur`. The corpus, being legal prose, says
`ríkisborgararéttar`, `ríkisborgararétti`, `ríkisborgararéttinum`,
`ríkisborgararéttinn`. None of those match. Compounding makes it worse:
`búsetuskilyrði` and `skilyrði um búsetu` are the same rule and share no token.

Everything downstream is well built on top of a retriever that is missing a
large fraction of what it should find. Ranking cannot promote what retrieval
never returned; the answer stage cannot cite it; the citation validator will
correctly confirm that the answer is grounded in the wrong sources.

**This is the single biggest defect in the feature.**

### 1.2 There is no semantic retrieval at all

Confirmed absent, and already noted in `docs/phase-0-acts-provisions.md`: no
pgvector, no embeddings, no chunk table. So a question phrased in ordinary
words about a concept the legislation names differently returns nothing, and
the only bridge across that gap is the planner's vocabulary guess. When the
guess is good the well works. When it is not, the well abstains — correctly,
and uselessly.

### 1.3 The answer sees far too little

`src/lib/ask/config.ts`:

| Knob | Default | What it means |
|---|---|---|
| `maxSources` | 10 | ten numbered sources, total |
| `evidenceWindow` | 1200 chars | ~180 words around a matched passage |
| `provisionChars` | 2400 chars | an article, truncated at a paragraph boundary |
| `answerMaxTokens` | 8000 | reasoning included |

The whole prompt is somewhere around 15–25k tokens. The models in
`src/lib/ask/llm.ts` take 1M. The comment in `evidence.ts` is right that
truncating a provision before its exceptions is dangerous — the answer is not
to warn the model about the truncation, it is to stop truncating.

### 1.4 Retrieval happens once, and cannot follow what it learns

The pipeline plans, searches, and answers. It cannot do what a lawyer does:
read the provision, notice it refers to a regulation, go and find the
regulation; read the judgment, notice it distinguishes an earlier one, go and
find the earlier one. `CaseProvisionLink` already holds "which decisions cite
this article" and the well cannot ask it.

The user has said latency is acceptable. That is permission to spend two
minutes doing eight searches instead of five seconds doing six.

### 1.5 The corpus is missing the sources Icelandic legal method actually uses

Two absences stand out, and both are structural rather than incremental:

- **Lögskýringargögn** — frumvörp, greinargerðir, nefndarálit. In Icelandic
  legal method these are not background reading; courts cite them to settle
  what a provision means. A tool that cannot produce the greinargerð for an
  article cannot answer an interpretation question properly.
- **Reglugerðir.** Most operative detail — deadlines, fees, forms, criteria —
  lives in delegated legislation, not in the act. Answering "what do I have to
  do" from the act alone produces an answer that is correct and unusable.

And one that is a correctness problem rather than a coverage one:
**the corpus holds only current consolidated law**. `retrieve.ts` is honest
about it (`historicalLimitation`), which is the right behaviour and not a
substitute for fixing it. Legal questions are almost always about events that
already happened, under the law as it then stood.

---

## 2. Phase 0 — measure, before changing anything

**~1–2 weeks. Do this first. It is not optional and it is not glamorous.**

Eight fixtures (`src/ask-eval/fixtures.json`), no split populated. That cannot
tell you whether any change below helped. Every hour spent here is repaid
several times over in phase 1, where you will be changing the retriever and
will otherwise be guessing.

1. **Build a gold set of 150–300 questions.** Across skattaréttur,
   útlendingamál, vinnuréttur, stjórnsýsluréttur, sifjaréttur, refsiréttur,
   eignaréttur, EES. For each: the governing provisions, the leading decisions,
   the points the answer must make, and — the part that catches the real
   failures — at least one *trap*: an exception, a condition, or a later
   amendment that a shallow answer will miss.
2. **Populate the `split` field**: development and holdout. The harness already
   accepts `--split` and nothing uses it. Tune on development, report on
   holdout, and do not look at holdout more than once a fortnight.
3. **Add the metrics that are missing.** The harness has recall, citation
   validity, claim support, invented authorities, abstention, language. Add:
   - **nDCG@10** over graded retrieval labels, so a ranking change is a number.
   - **Governing-provision-in-top-5** — the single most decision-relevant
     retrieval metric for this app.
   - **Exception coverage** — did the answer state the trap?
   - **An LLM-judge rubric** against a reference answer, scored on
     completeness, correctness and hedging. Use a different model from the one
     answering; judge one dimension per call.
4. **Run offline mode in CI on every PR.** It costs nothing and needs no key.
   Run live nightly against a fixed corpus snapshot.
5. **Persist the metrics line.** `src/lib/ask/metrics.ts` writes JSON to stdout.
   Add an `AskRequestMetric` table beside the existing `AskFeedback` — same
   privacy rule (no question text, no answer text) — so you can plot latency,
   abstention rate and citation-issue rate over time and correlate them with
   the feedback kinds that already exist.
6. **Mine the feedback table into fixtures.** `missing-source` and
   `missed-exception` reports are pre-labelled failures. That is your fixture
   pipeline, for free, forever.

**Get two or three practising Icelandic lawyers to write the gold answers.**
This is expensive and it is the moat. Nobody else has an Icelandic legal
evaluation set, and without one no amount of model capability turns into
measurable quality.

---

## 3. Phase 1 — retrieval

**~3–4 weeks. The biggest single quality jump available.**

### 3.1 Icelandic morphology (do this before embeddings)

> **Shipped in #56.** The analysis below stands; the route taken was B.
> Implementation notes are in *icelandic-lemmatisation.md*.

The cheapest large win in the entire plan. Two routes:

> **Corrected after implementing this — see `docs/icelandic-lemmatisation.md`.**
> Route A below does not work on this deployment. Both of Postgres's built-in
> mechanisms (`ispell`/hunspell and the `synonym` template) read their data from
> files under the server's `$SHAREDIR/tsearch_data`, and managed Postgres gives
> you no filesystem to put them on. Route B, as a table, is what shipped — and
> BÍN's licence is **CC BY-SA 4.0**, not CC BY as stated below. The ShareAlike
> term matters if the derived table is ever redistributed, and attribution is
> mandatory.

**Route A — Postgres ispell/hunspell dictionary.** An `is_IS` hunspell
dictionary exists (the Icelandic spell-checking project). Drop the `.dic` and
`.aff` into `$SHAREDIR/tsearch_data`, then:

```sql
CREATE TEXT SEARCH DICTIONARY is_hunspell (
  TEMPLATE = ispell, DictFile = is_is, AffFile = is_is, StopWords = icelandic
);
CREATE TEXT SEARCH CONFIGURATION islenska (COPY = simple);
ALTER TEXT SEARCH CONFIGURATION islenska
  ALTER MAPPING FOR word, asciiword WITH is_hunspell, simple;
```

Then a second materialized column, `lemma_vector`, built with `'islenska'`
beside the existing `'simple'` one, and matched as an additional OR condition
in `src/lib/search/postgres.ts`. Keep `simple` — it is what makes an exact
phrase match exact, and you want both.

Cost: a migration in `prisma/sql/setup-search.sql`, a reindex, and a condition
in two query builders. Perhaps three days.

**Route B — BÍN (this is what shipped).** *Beygingarlýsing íslensks nútímamáls*
is free under CC BY-SA 4.0 and ships ~6.5M inflected forms mapped to lemmas. Load it into a
`bin_forms(form, lemma)` table, write an immutable `lemmatize(text)` SQL
function, and materialize from that. Slower to build than route A, and
substantially better: it handles proper compounds and legal vocabulary that a
spell-check dictionary does not.

**Shipped: route B.** Route A turned out not to be available on managed
Postgres at all, which settled the choice. 3,698,046 surface forms, loaded in
63 seconds.

Whichever route: also expand the *query* side. The planner should emit the
lemma, and `termToQuery` should search the lemma vector with it.

### 3.2 Hybrid search — add the vector list to the fusion

> **Not started.** Still accurate as written.

Add pgvector to the Postgres 16 in `docker-compose.yml` (the `pgvector/pgvector`
image, or the extension on Railway) and:

**Schema.** A `DocumentChunk` table: `documentId`, `ordinal`, `section`
(`utdrattur` | `matsatridi` | `nidurstada` | `domsord` | `body`), `text`,
`tokens`, `embedding vector(1024)`, HNSW index on the embedding. Provisions get
an `embedding` column directly — a provision *is* the natural chunk, and
`ProvisionParagraph` gives a finer one where an article is long.

**Chunking.** Do not use a fixed character window. `src/lib/judgment-text.ts`
already extracts the structural sections; chunk *within* them, 600–900 tokens
with ~15% overlap, and carry the section label into the chunk's stored text so
the embedding knows whether it is reading a party's argument or the court's
holding. This is the same insight `evidence.ts` already had, applied one layer
earlier.

**Embedding model.** Anthropic does not serve an embeddings API, so this is a
separate provider decision from `ASK_PROVIDER`. Three candidates:

| Model | Why | Against |
|---|---|---|
| `BAAI/bge-m3` (self-hosted) | multilingual, 8k context, produces dense + sparse + multi-vector from one pass; no per-token cost; corpus never leaves your infra | you run a GPU or a CPU inference box |
| OpenAI `text-embedding-3-large` | the `openai` package is already a dependency; `dimensions` lets you cut to 1024 to shrink the index | per-token cost, Icelandic is incidental to it |
| Cohere `embed-v4` | strong multilingual, int8 output cuts index size ~4× | another vendor, another key |

**Recommendation: start with `text-embedding-3-large` at 1024 dimensions**
because it is one client you already have and gets you measuring this month;
benchmark `bge-m3` against it on the phase-0 set and switch if it wins, which
on Icelandic it plausibly will.

**Cost.** Order of magnitude, because this is the number that usually stops
people and it should not. Say ~80k documents at ~4 chunks each, plus ~150k
provisions: roughly half a million embeddings, ~500 tokens apiece, ~250M
tokens. At any current commercial embedding rate that is **tens of dollars for
the whole corpus, once**, plus a trickle for the incremental ingest. Confirm
the current rate before you commit, but budget is not the constraint here.

**Wiring.** `searchDecisions` and `searchProvisions` in `retrieve.ts` return
`RankedList[]`. Add `vector:concepts` and `vector:standalone` as two more
entries with their own `QUERY_WEIGHTS` (start at ~1.3 — between concept and
phrase — and tune on the gold set). Fusion needs no change at all. This is
maybe 150 lines.

Run the vector query on the **standalone restatement** as well as the concepts:
the whole point of a dense retriever is that it does not need the corpus's
vocabulary, so give it the user's own sentence, which is the one thing the
lexical path can never use.

### 3.3 A real reranker

> **Not started.** Still accurate as written.

`src/lib/ask/rerank.ts` exists, is off, and uses a full LLM call to produce an
ordering — expensive and slow for what it is. Replace it with a cross-encoder
over the fused top ~100 → top ~30. Cohere Rerank (multilingual) or a
self-hosted `bge-reranker-v2-m3`. Roughly an order of magnitude cheaper and
faster than the LLM call, and after hybrid search this is normally the largest
remaining nDCG jump.

Keep `applyModelOrder`'s discipline exactly as it is: the reranker may reorder,
never add, never remove. That constraint is what makes it safe to switch on by
default, which is where it should end up.

### 3.4 Raise the budgets

> **Not started**, and now the cheapest unclaimed win in this file.

Once retrieval is finding the right things, let the answer see them:

```
ASK_MAX_CANDIDATES  30   → 120   (the clamp already allows it)
ASK_MAX_SOURCES     10   → 30    (raise the clamp ceiling too)
ASK_EVIDENCE_CHARS  1200 → 4000
ASK_PROVISION_CHARS 2400 → 12000 (i.e. whole articles, no truncation)
ASK_ANSWER_MAX_TOKENS 8000 → 32000
```

And make the provision truncation rule *conditional*: below ~8k characters,
send the whole article and drop the truncation warning entirely. The warning
exists because the cut is dangerous; the cut is now usually unnecessary.

**Expected outcome of phase 1**, measured on the gold set:
governing-provision-in-top-5 from wherever it lands today to 85%+, and a
visible fall in the `missing-source` feedback kind.

---

## 4. Phase 2 — make the wait visible

> **Shipped in #58**, except the answer cache (§4.3) and the rate limiter
> (§4.5), which are still as described.

**~1–2 weeks. Do it before phase 3, because it is what buys the budget for it.**

"Wait time should not be an issue" is a statement about willingness, and the
current UI does not deserve it. `src/components/WellChat.tsx` fires one
`fetch`, animates a bucket, and shows nothing until the whole answer lands — up
to 90 seconds of an animation with no information in it. That is the worst
possible way to spend a latency budget the user has already granted.

1. **Stream the answer.** `POST /api/ask` becomes an SSE route.
   `AskModel.complete` grows an `onDelta`; the Anthropic side switches to
   `client.messages.stream()`, the OpenAI side to `stream: true`. Time to first
   token drops to a couple of seconds. This is also simply the correct way to
   call these APIs at the token ceilings phase 1 raises — non-streaming
   requests at high `max_tokens` hit HTTP timeouts.
2. **Stream the pipeline, not just the prose.** Emit an event per stage:
   - `plan` — show the search terms the planner produced. This is genuinely
     interesting and it is the first thing that can appear.
   - `source` — one per source, *as retrieval finds them*. The split-screen
     sources pane already exists (`pane: "sources"`); fill it while the answer
     is still being written.
   - `token` — the prose.
   - `issue` — what validation flagged.

   Sixty seconds of watching the law arrive is a different experience from
   sixty seconds of a spinner, and it is the experience the big ones sell.
3. **Cache answers.** Key on normalised question + corpus version + scope.
   Legal questions repeat heavily. A `AskAnswerCache` table with a TTL is an
   afternoon and takes a large fraction of production traffic to zero cost.
4. **Extend prompt caching.** `llm.ts` caches the system prompt today. In the
   agentic loop of phase 3, the growing tool-result history is the expensive
   part — put a `cache_control` breakpoint after the last tool result each
   turn. Cache reads bill at roughly a tenth of input rate; on a 15-step loop
   that is most of the bill.
5. **Fix the rate limiter.** In-memory, per-instance, 12 per 10 minutes
   (`src/app/api/ask/route.ts`) is a placeholder and says so. Move it to Redis
   or the database before this is public.

Only after streaming is in place should you raise `ASK_EFFORT_COMPLEX` past
`medium`. Then it costs the user nothing they can perceive.

---

## 5. Phase 3 — deep research mode

> **Shipped in #57**, except the adversarial pass at the end of this
> section. The tool list below is close to what was built; the built set is
> in `src/lib/ask/tools.ts` and the README's *Deep research* chapter.

**~3–4 weeks. This is what "as good as the big ones" actually means.**

Two tiers, chosen by the user, the way the serious tools do it:

- **Quick** (~5–15s): today's pipeline with phase 1's retrieval. Good enough
  for "what does 8. gr. say".
- **Deep** (~60–180s): an agentic research loop.

### The loop

Use the SDK's tool runner (`client.beta.messages.toolRunner` with
`betaZodTool`) rather than hand-rolling the loop, and give it a **task budget**
(`output_config.task_budget`, beta `task-budgets-2026-03-13`) so the model
paces itself to a finish instead of being cut off mid-research. Stream it, both
for the UX above and because these turns are long.

The tools — every one of them backed by code that already exists:

| Tool | Backed by |
|---|---|
| `search_provisions(query, actId?, scope?)` | `getSearchProvider().searchProvisions` |
| `search_decisions(query, sources?, court?, dateFrom?, dateTo?)` | `getSearchProvider().search` |
| `read_provision(id)` | `prisma.provision` — full text, no truncation |
| `read_act_outline(actId)` | `Chapter` / `Provision` — lets it *navigate* an act instead of keyword-guessing into it |
| `read_decision_section(id, section)` | `src/lib/judgment-text.ts` |
| `decisions_citing_provision(provisionId)` | `CaseProvisionLink` — **already populated, currently unreachable from the well** |
| `decisions_citing_decision(documentId)` | needs the citation graph in §6.2 |

That `decisions_citing_provision` row deserves emphasis. The ingestion pipeline
already computes which decisions cite which article, the act reader already
shows it ("12 úrlausnir vísa til þessa ákvæðis"), and the well cannot ask the
question. Exposing it as a tool turns "here is the article" into "here is the
article and here is how the courts have actually applied it", which is the
difference between a search result and legal research.

### Rules for the loop

- Same grounding discipline. Every proposition still cites a numbered source;
  the sources are still assembled by our code from what the tools returned, not
  by the model.
- Bound it: max steps, wall-clock cap, task budget. Return the partial research
  with what it found if it hits a bound — an honest partial answer beats a
  timeout.
- Reuse `validateCitations` and `verifyAnswer` unchanged at the end. And turn
  `ASK_VERIFY_CITATIONS` **on** for this tier: it is built, it works, it is off
  only because it cost a call, and on a two-minute deep run one more call is
  nothing.

### An adversarial pass

Worth its own call on the deep tier, and it targets a failure mode your own
feedback taxonomy already names. After the answer is drafted, ask a second
call: *what exception, condition, time limit or later amendment does this
answer miss, given these sources?* Then merge what it finds. `missed-exception`
is one of the seven feedback kinds in `src/lib/ask/feedback.ts`; this is the
stage that attacks it directly.

---

## 6. Phase 4 — the legal substance

**~6–10 weeks. This is what makes it a legal product rather than a good RAG demo.**

### 6.1 Point-in-time law

The corpus holds current consolidated text. Events happened in the past. Every
serious legal database solves this and it is a genuine differentiator here
because no Icelandic competitor has it.

- Version `Act` and `Provision`: `validFrom`, `validTo`, `supersededById`.
- Ingest Lagasafn's historical editions (one per parliamentary session) as
  successive versions rather than overwrites — the `lagasafn` adapter already
  parses the structure, it just needs to stop treating the newest as the only.
- Take entry-into-force dates from the amending acts (breytingalög) via
  Alþingi's open data.
- EUR-Lex serves date-specific consolidated versions per CELEX; the `eur-lex`
  adapter can ask for them.
- Then the planner's existing `date` and `historical` fields stop being a
  *limitation to state* and become a *retrieval filter*, and
  `historicalLimitation()` gets deleted rather than displayed.

### 6.2 A citator — "is this still good law?"

The second table-stakes feature, and most of the machinery exists.

- Promote the case-number citation extraction that already powers "related
  cases" on the document page into a real `CaseCaseLink` table: citing
  document, cited document, the sentence it was found in.
- Per decision, derive: how many later decisions cite it, from which tiers, and
  — with a small classifier over the citing sentence — whether it was
  *followed*, *distinguished*, *criticised*, or *overturned*. Even the raw
  count plus citing-court tier is a strong signal before any classification.
- Feed it into `src/lib/ask/rank.ts` as a new weighted feature (`citedBy`), and
  into the source block the answer sees: "cited by Hæstiréttur 14 times, once
  distinguished". A model told that will write a better paragraph about the
  case.
- Once §6.1 lands, flag provisions that have been amended or repealed since a
  cited decision was decided. That single flag is worth more to a practising
  lawyer than a great deal of prose quality.

### 6.3 The corpus, in priority order

The user already knows ingestion is incomplete. For *answer quality*
specifically, the order is:

1. **Lögskýringargögn** (Alþingi: frumvörp, greinargerðir, nefndarálit,
   þingskjöl — open XML at `althingi.is/altext/xml/`). The highest-value
   missing corpus, by a distance. Link each greinargerð passage to the
   provision it explains and it becomes a retrievable source per article.
2. **Reglugerðir** (Stjórnartíðindi B / `reglugerd.is`). Where the operative
   detail lives. Link each to its enabling provision.
3. **ECHR / MDE case law** (HUDOC API). Iceland is bound; the Convention is
   incorporated by lög nr. 62/1994; Icelandic courts cite Strasbourg
   constantly. Currently absent.
4. **Stjórnartíðindi A**, for authoritative amendment history — which §6.1
   needs anyway.
5. Deeper héraðsdómar coverage; more journals (Tímarit lögfræðinga); theses
   from Skemman.

---

## 7. Phase 5 — product

Not quality, but the difference between a tool and a demo:

- Accounts, saved research sessions, shareable answers.
- Export to `.docx` / PDF with the citations intact — a lawyer's output is a
  memo, and the last mile of every legal research tool is getting the research
  into one.
- A "research trail" view: the searches the deep loop ran, in order, and what
  each returned. Auditability is a feature in this domain, and phase 3 produces
  the data for free.
- An operator dashboard over the metrics table from phase 0.

---

## 8. Cost, honestly

Anthropic model rates, per million tokens (cached 2026-06-24; confirm before
budgeting):

| Model | Input | Output |
|---|---|---|
| Opus 5 | $5 | $25 |
| Sonnet 5 | $2 | $10 |
| Haiku 4.5 | $1 | $5 |

Cache reads bill at roughly 0.1×, cache writes at roughly 1.25×.

A rough shape for the deep tier: ~15 tool calls, maybe 200k total input tokens
with most of it served from cache, ~10k output. That is on the order of tens of
cents per deep question on Opus 5 — meaningful at scale, negligible while you
are proving the thing works. The quick tier stays at a few cents.

Levers, in the order to reach for them: prompt caching on the tool-result
prefix (free, largest), the answer cache from §4.3 (free), Haiku or Sonnet for
the planner / reranker / verifier while Opus 5 writes the answer (the
`AskModel` seam already permits a different model per stage — that is worth
building), and only then effort tuning.

---

## 9. What to do first

*Rewritten now that §3.1, Phase 2 and Phase 3 have shipped. The original
ordering is in the history of this file.*

The uncomfortable position this leaves us in: three of the four things that
were supposed to make the well better are done, and **we still cannot say
whether it got better.** Phase 0 was meant to come first and did not, so
*ai-answer-evaluation.md* is a human reading answers one at a time — which is
how a regression gets found late and a small gain gets missed entirely.

So:

1. **§3.4 raise the budgets.** Hours, not days, and unmeasured. Ten sources,
   1,200-character evidence windows and five rows per case-number search are
   all far below what the models take, and cost has been ruled out as a
   constraint. Do this before anything that needs measuring, because it may
   move the answers on its own.
2. **§2 Phase 0 — the gold set.** Now overdue rather than merely first. Until
   it exists every change after this point is a guess, including whether deep
   research is actually better than quick.
3. **§3.3 the reranker, then §3.2 hybrid search.** In that order, reversing
   the original: the reranker is cheaper, is a smaller change, and reorders
   what retrieval already finds — and with lemmatisation shipped, retrieval
   now finds a great deal more than it did when this file was written.
4. **§6.1 point-in-time law and §6.2 the citator.** What makes it a legal
   product rather than a good RAG demo, and what no Icelandic competitor has.
5. **§6.3 the corpus** — lögskýringargögn first.

Two things not in the original list, both surfaced by
*ai-answer-evaluation.md* and both ahead of everything except item 1:

- **Find out what is actually reaching the model on a real question.** The
  reviewer's diagnosis on Q1 is that the well reads a summary rather than the
  judgment. That is a specific, checkable claim about production data and it
  should be settled with a query, not a redesign.
- **Record the configuration each answer was produced under.** The evaluation
  log has no model, commit or settings against its three outputs, so they
  cannot be compared with each other, let alone with what comes next.

---

## 10. What not to do

- **Do not fine-tune a model.** Not yet, possibly not ever. Every failure
  diagnosed above is a retrieval or corpus failure. Fine-tuning fixes neither
  and makes both harder to diagnose.
- **Do not relax the grounding rules to make answers look fuller.** The
  discipline in `answer.ts` and `citations.ts` is the product. An answer that
  abstains is a feature; an answer that confabulates an article number is the
  end of the product's credibility, and in this domain you get one of those.
- **Do not replace the deterministic ranker with a model.** Keep it as the
  floor that a reranker reorders. Determinism is what makes the eval harness
  mean anything, and `applyModelOrder` already has the right shape.
- **Do not chase more sources before fixing retrieval.** Ingesting another
  20,000 rulings that the `simple` tsvector cannot match is work that produces
  nothing. Lemmatisation first, then corpus.
- **Do not remove the abstention paths.** They will fire less often after phase
  1. That is the correct way for them to become rarer.
