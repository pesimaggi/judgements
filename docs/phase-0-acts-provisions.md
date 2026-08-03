# Phase 0 research spike — legal acts + provision-level case linking

Findings from the research spike that precedes schema work for Lögbrunnur's
act/provision feature. Nothing here is shipped code; the throwaway scripts
that produced these numbers are described at the end so they can be re-run.

Measured on 2026-08-03 against Lagasafn codex version **157b** (Íslensk lög
20. apríl 2026) and a 255-judgment sample of the island.is/domar archive.

---

## 0. Status of the RAG layer

**There is no RAG layer in this repository.** No pgvector, no Voyage AI, no
embedding code, no migration, no dependency, and no mention in `README.md` —
checked across `main` and the only other remote branch. So there is nothing to
sequence around: acts/provisions can proceed without waiting on it, and
without risk of a schema collision.

If that work exists somewhere unpushed, it needs to be surfaced before the
migration lands, because both features want to add tables and both want to
touch `prisma/sql/setup-search.sql`.

---

## 1. Lagasafn HTML structure

Lagasafn's HTML has no published schema, but it carries **stable per-article
and per-paragraph anchors**, which makes it far more tractable than "scrape the
HTML" suggests.

```html
<b>II. kafli A.</b> <b>Jarðir í sameign.]<sup>1)</sup></b>   ← chapter (no anchor)
<span id="G7A"></span>                                       ← article anchor
<img src="/lagas/sk.jpg"> <b>[7. gr. a.</b> <em>Fyrirsvar jarða í sameign.</em>
<img src="/lagas/hk.jpg" id="G7AM1"> Ef eigendur jarðar …    ← paragraph (mgr.) anchor
<sup>1)</sup>
<i><small><sup>1)</sup><a href="/altext/stjt/2022.074.html">L. 74/2022, 2. gr.</a></small></i>
```

| Element | Encoding | Notes |
|---|---|---|
| Article (`gr.`) | `<span id="G{n}{LETTER}">` | `G7A` = "7. gr. a" — sub-numbering is in the anchor, not just the label |
| Paragraph (`mgr.`) | `<img src="/lagas/hk.jpg" id="G{art}M{n}">` | `#G7AM1` is a real, linkable anchor on althingi.is |
| Chapter (`kafli`) | `<b>I. kafli.</b> <b>Title.</b>` | **No anchor** — chapter membership must be derived from document order |
| Amended text | `[ … ]` brackets + `<sup>n)</sup>` | Brackets are editorial, not part of the law's text |
| Amendment footnote | `<i><small><sup>n)</sup><a href="/altext/stjt/…">L. 85/2020, 5. gr.</a></small></i>` | Links to the amending act |
| Repealed article | body is a bare `…` | Sometimes a link whose `title` explains the removal |
| Temporary provisions | `<b>Ákvæði til bráðabirgða.</b>` then `<b>I.</b>`, `<b>I.–V.</b>` | Anchors are `B{n}M{m}` — **not** `G…`, and labels are roman numerals, not "N. gr." |

### How reliably does it parse?

A ~200-line cheerio prototype was run over **33 acts** (every act in the
proposed seed set, plus the constitution and two spot checks):

```
TOTAL 33 acts: provisions 3223/3223 anchors (100.0%)
               paragraphs  8600/8966 anchors ( 95.9%)
               chapters 435, provisions missing a label: 0
```

- **Numbered articles: 100%.** Every article anchor produced a provision with
  a usable label, across acts as messy as almenn hegningarlög (300 articles,
  42 with letter suffixes, 29 repealed, 252 carrying amendment footnotes).
- **Paragraphs: the 366-paragraph shortfall is entirely temporary
  provisions.** Verified exactly: 366 missing anchors are `B*`, **zero** are
  `G*`. Temporary provisions need their own provision kind (roman-numeral
  label, no article number); once modelled, coverage is 100%.

Two cosmetic bugs found in the prototype, both trivial and noted for the real
implementation: the act's own number/date is read from the wrong `<p>`, and
chapter titles pick up trailing footnote markers (`"Jarðir í sameign.1)"`).

### Encoding

The task brief warned about ISO-8859-1. Confirmed, but narrower than expected:

- `https://www.althingi.is/lagas/nuna/{year}{nr}.html` — **UTF-8** on every
  page fetched, including a 1940 act.
- `https://www.althingi.is/lagasafn/zip/nuna/allt.zip` — **ISO-8859-1**
  (8.8 MB, 1710 law files named `{year}{nr}.html`, site chrome stripped).

Decoding a zip file as ISO-8859-1 and re-parsing produced **byte-identical
structured output** to the live page, so the parser is source-agnostic. For a
30-act seed set the live pages are the better source: UTF-8, and they *are*
the canonical `/nuna/` permalink we store. The zip only becomes worth it if we
later ingest all ~900 acts.

### lagasafn-xml — reference, not dependency

[althingi-net/lagasafn-xml](https://github.com/althingi-net/lagasafn-xml) (MIT,
actively maintained, ~1,355 commits) parses the same HTML into XML. **Recommend
using it as a reference and cross-check, not a dependency:**

- It is Python 3; our ingestion service is the Node app deployed from
  `railway.ingest.json`. Depending on it means putting a Python toolchain into
  that image, or consuming a third party's committed XML and inheriting their
  release cadence.
- Its data is versioned per codex release; we want `/nuna/`, which is what the
  brief specifies and what changes roughly daily.
- Our own parse already validates at 100% article coverage, so the dependency
  would buy correctness we already have.

### A dead end worth recording

island.is's `webVerdicts` GraphQL input accepts a `laws` filter, which looked
like it might mean upstream already tags judgments with the acts they cite. It
does not help: `WebVerdictItem` exposes no `laws` field, introspection is
disabled, and probing the filter gives `laws: ["91/1991"] → 3 results` against
30,796 for unrecognised values. The vocabulary is something else and the recall
is far worse than our own extraction (which finds 91/1991 in 36% of judgments).
Not usable.

---

## 2. Citation survey over the case corpus

This container has no `DATABASE_URL`, so rather than querying the ingested
`Document` table the survey sampled the same upstream the `icelandic-courts`
adapter ingests from, using the same extraction paths (`pdfString` /
`richText`). Pages were sampled with a stride across each court's archive
rather than taking the newest N, so the ranking is not skewed to what is
current.

```
SAMPLE: 255 judgments, 2000–2026
courts: Hæstiréttur 72 (28%), Héraðsdómar 149 (58%), Landsréttur 34 (13%)
```

The court mix closely matches the real archive (Hæstiréttur is 12,221 of
43,017 judgments upstream ≈ 28%), so the ranking should transfer.

```
judgments citing ≥1 act by number:     251 (98%)
explicit "N. gr. + act" citations:    2892 (11.3 per judgment)
bare "N. gr." with no act attached:   3869
distinct acts cited:                   247 — 114 in force, 133 repealed/amending
```

**98% of judgments cite at least one act by number, at ~11 resolvable
provision citations each.** The deterministic pass is not a thin
proof-of-concept — it is enough to populate the feature on its own.

### Two pattern traps found (both would have shipped as silent bugs)

1. **The article-letter suffix eats the next word.** A naive
   `(\d+)\.\s*gr\.\s*([a-z])?` reads `"5. gr. laga nr. 91/1991"` as article 5
   letter **l**, and then fails to see the act. Fixed with a `(?![\p{L}])`
   guard after the letter. Before the fix, bare references were overcounted by
   ~47%.

2. **Act names are multi-word.** `"244. gr. almennra hegningarlaga nr.
   19/1940"` does not match a single-word act-name pattern. Allowing up to four
   words before the `lög` stem lifted almenn hegningarlög from 45 to **362**
   provision citations, and total explicit citations by 15%. Without it, the
   most-cited act in Icelandic law would have been almost invisible at
   provision level.

Both fixes are in the pattern set proposed below.

### The bare-reference question

Bare `"N. gr."` references outnumber explicit ones 1.3:1, so resolving them by
carrying forward the last-named act is tempting. **Spot-checking says do it
only within a tight window.** Precision tracks the distance to the last-named
act:

| gap to last-named act | share of bare refs | observed precision |
|---|---|---|
| ≤ 300 chars | 33% | high — spot checks correct |
| 300–1000 | ~15% | mixed |
| > 1000 (median gap is 605) | ~50% | mostly wrong |

Concrete failures beyond the window: `"16. gr."` resolved to 88/2008 when the
sentence itself says *almennra hegningarlaga* (gap 3,358); `"8. gr."` resolved
to an act when the reference was to **reglugerð nr. 785/1999** — a regulation,
not an act at all.

**Recommendation:** Phase 1 ships explicit citations as the core, plus a
guarded carry-forward — bare ref within 300 characters of a named act, with no
intervening `reglugerð`/`tilskipun` citation, preferentially anchored by an
anaphoric cue (`sömu laga`, `laganna`). Store it under a distinct `matchType`
so it can be measured and dropped independently of the explicit links.

### End-to-end validation

Joining extracted citations against the parsed provisions, for the six acts
parsed in full:

```
explicit citations into those 6 acts: 720
resolved to a parsed provision:       720
unresolved:                             0  (0.0%)
```

Every citation found a real provision. The loop works.

The top provisions by citing judgments are exactly what an Icelandic
practitioner would predict, which is the best available sanity check:

| provision | judgments |
|---|---|
| 130. gr. laga um meðferð einkamála (málskostnaður) | 37 |
| 6. gr. vaxtalaga (dráttarvextir) | 29 |
| 164. gr. laga um meðferð sakamála (sakarkostnaður) | 26 |
| 5. gr. laga um ávana- og fíkniefni | 22 |
| 192./235. gr. sakamálalaga (áfrýjun) | 17 / 14 |
| 57. gr. almennra hegningarlaga (skilorð) | 12 |
| 26. gr. skaðabótalaga (miskabætur) | 11 |

### Short names must come from the corpus, not the titles

Acts are cited by compound short name far more often than by official title,
and the short name is frequently **not derivable from the title**:

| act | official title | how judgments actually cite it |
|---|---|---|
| 38/2001 | Lög um vexti og verðtryggingu | `vaxtalaga` (36×) — the word "vaxtalög" appears nowhere in the title |
| 19/1940 | Almenn hegningarlög | `hegningarlaga` (341×) |
| 37/1993 | Stjórnsýslulög | `stjórnsýslulaga` (42×) |
| 39/1978 | Þinglýsingalög | `þinglýsingalaga`, also `þinglýsingarlaga` |
| 36/1994 | Húsaleigulög | `húsaleigulaga`, also `húsleigulaga` (a typo in the judgment itself) |

A type-ahead built on official titles alone fails on `vaxtalög`, which is the
most natural query for that act. **Harvest aliases from the citation corpus**
during the linking job and index them alongside the title — this also picks up
declined forms and real-world misspellings for free.

---

## 3. Proposed seed set

Ranked by number of judgments citing the act; **intersected with the in-force
index** at `https://www.althingi.is/lagasafn/nuna/` (900 acts), which cleanly
excludes repealed acts and amending acts.

| # | act | judgments | prov. cites | title |
|---|---|---|---|---|
| 1 | 19/1940 | 51% | 362 | Almenn hegningarlög |
| 2 | 88/2008 | 40% | 362 | Lög um meðferð sakamála |
| 3 | 91/1991 | 36% | 326 | Lög um meðferð einkamála |
| 4 | 38/2001 | 32% | 256 | Lög um vexti og verðtryggingu |
| 5 | 50/1988 | 14% | 21 | Lög um virðisaukaskatt |
| 6 | 65/1974 | 14% | 46 | Lög um ávana- og fíkniefni |
| 7 | 50/1993 | 11% | 52 | Skaðabótalög |
| 8 | 37/1993 | 7% | 35 | Stjórnsýslulög |
| 9 | 7/1936 | 5% | 38 | Lög um samningsgerð, umboð og ógilda löggerninga |
| 10 | 62/1994 | 5% | 1 | Lög um mannréttindasáttmála Evrópu |
| 11 | 21/1991 | 5% | 138 | Lög um gjaldþrotaskipti o.fl. |
| 12 | 80/2002 | 4% | 65 | Barnaverndarlög |
| 13 | 77/2019 | 4% | 42 | Umferðarlög |
| 14 | 16/1998 | 4% | 19 | Vopnalög |
| 15 | 90/2003 | 3% | 26 | Lög um tekjuskatt |
| 16 | 50/2000 | 3% | 17 | Lög um lausafjárkaup |
| 17 | 138/1994 | 3% | 12 | Lög um einkahlutafélög |
| 18 | 150/2007 | 2% | 13 | Lög um fyrningu kröfuréttinda |
| 19 | 30/1987 | 2% | 10 | Lög um orlof |
| 20 | 90/1996 | 2% | 5 | Lögreglulög |
| 21 | 20/1991 | 2% | 24 | Lög um skipti á dánarbúum o.fl. |
| 22 | 161/2002 | 2% | 19 | Lög um fjármálafyrirtæki |
| 23 | 46/1980 | 2% | 18 | Lög um aðbúnað, hollustuhætti og öryggi á vinnustöðum |
| 24 | 39/1978 | 2% | 22 | Þinglýsingalög |
| 25 | 26/1994 | 2% | 34 | Lög um fjöleignarhús |
| 26 | 55/1980 | 2% | 29 | Lög um starfskjör launafólks og skyldutryggingu lífeyrisréttinda |
| 27 | 40/2002 | 2% | 27 | Lög um fasteignakaup |
| 28 | 31/1993 | 2% | 18 | Hjúskaparlög |
| 29 | 28/1930 | 2% | 6 | Lög um greiðslu verkkaups |
| 30 | 76/2003 | 2% | 6 | Barnalög |

Plus **33/1944 Stjórnarskrá lýðveldisins Íslands** — it ranks lower on raw
counts (it is cited by name rather than by number, so the number-based ranking
understates it: 19 of 255 judgments mention `stjórnarskrá*`) but it is the one
act no Icelandic legal research tool can ship without.

**31 acts, ≈3,000 provisions.** Coverage of explicit provision citations:

| seed size | coverage |
|---|---|
| top 10 | 52% |
| top 20 | 64% |
| top 25 | 68% |
| **top 30** | **71%** |
| top 40 | 77% |

The curve is flat past 30 — a long tail of acts cited in 1–2 judgments each —
so 30 is the right stopping point for a phase whose purpose is to prove the
loop end to end.

### Excluded, deliberately

Acts that rank high on citations but are **not in the in-force index** must not
be auto-added: 22/1955 (25 judgments) and 50/1987 (17) are *amending* acts,
cited as `"sbr. 4. gr. laga nr. 22/1955"`; 19/1991 (23) and 68/2001 (12) are
*repealed*. Neither is something a user browses, and Lagasafn has no `/nuna/`
page for them. The in-force index is the filter that separates them.

---

## 4. Proposed data model

Refined from the brief's starting hypothesis; changes are called out.

```prisma
model Act {
  id                String   @id @default(cuid())
  actNumber         Int      // 91
  year              Int      // 1991
  title             String   // "Lög um meðferð einkamála"
  /// Short names harvested from how judgments actually cite this act
  /// ("vaxtalaga", "hegningarlaga"), for the type-ahead. See §2.
  aliases           String[]
  status            String   // "in_force" | "repealed"
  currentVersionUrl String   // https://www.althingi.is/lagas/nuna/1991091.html
  /// Lagasafn codex version the stored text was parsed from, e.g. "157b".
  codexVersion      String?
  sourceHash        String   // sha256 of the normalized law body
  fetchedAt         DateTime
  @@unique([actNumber, year])
}

model Chapter {
  id       String  @id @default(cuid())
  actId    String
  numeral  String? // "II" — null for "Ákvæði til bráðabirgða"
  letter   String? // "A" in "II. kafli A."
  label    String  // "II. kafli A."
  title    String?
  ordering Int
}

model Provision {
  id            String  @id @default(cuid())
  actId         String
  chapterId     String?
  /// "article" | "temporary" — temporary provisions have no article number
  /// and a roman-numeral label. See §1.
  kind          String
  articleNumber Int?    // 7
  articleLetter String? // "a"
  displayLabel  String  // "7. gr. a"
  heading       String? // "Fyrirsvar jarða í sameign"
  /// Lagasafn's own anchor — gives a deep link to the exact article
  /// on althingi.is for free: {currentVersionUrl}#G7A
  anchor        String  // "G7A"
  fullText      String
  isRepealed    Boolean @default(false)
  ordering      Int
  searchVector  Unsupported("tsvector")?
  @@unique([actId, kind, articleNumber, articleLetter])
}

/// Paragraph (málsgrein) within a provision. Separate table rather than JSON
/// because "1. mgr. 5. gr." is how Icelandic judgments cite, and Lagasafn
/// gives every paragraph its own stable anchor (#G7AM1).
model ProvisionParagraph {
  id          String @id @default(cuid())
  provisionId String
  number      Int    // 1 → "1. mgr."
  anchor      String // "G7AM1"
  text        String
  ordering    Int
}

model CaseProvisionLink {
  id          String @id @default(cuid())
  documentId  String // FK to the existing Document
  provisionId String
  /// "explicit_citation" — article and act adjacent in the text.
  /// "carried_act_context" — bare article ref resolved to a nearby act (§2).
  /// Room for "ai_inferred_interpretation" in a later phase.
  matchType   String
  paragraphNumber Int? // from "1. mgr."
  pointNumber     Int? // from "2. tölul."
  citationText String  // "1. mgr. 175. gr. laga nr. 91/1991", as written
  excerpt      String  // the citing sentence(s), for the "why did this match" UI
  charOffset   Int     // offset into Document.fullText, so the UI can jump to it
  @@unique([documentId, provisionId, charOffset])
  @@index([provisionId])
}

/// Act-level citations that name no article ("sbr. lög nr. 91/1991").
/// Needed for the act reader's header count; not derivable from
/// CaseProvisionLink, which only holds article-level hits.
model CaseActLink {
  id         String @id @default(cuid())
  documentId String
  actId      String
  matchType  String
  excerpt    String
  charOffset Int
  @@unique([documentId, actId, charOffset])
}
```

Changes from the brief's hypothesis, and why:

- **`Provision.anchor`** — Lagasafn's own anchor, which the brief did not
  anticipate existing. It gives a free, exact deep link to althingi.is and is a
  stable natural key for re-ingestion.
- **`Provision.kind`** — temporary provisions are real, frequently litigated,
  and have no article number. Without this they are silently dropped (§1).
- **`ProvisionParagraph`** as a table, not JSON — chosen because `mgr.`-level
  citation is pervasive and the anchors exist. `CaseProvisionLink` still points
  at the *article*, with `paragraphNumber` alongside, so the badge count stays
  at article level as the brief specifies.
- **`Act.aliases`** — see §2; without it the type-ahead fails on `vaxtalög`.
- **`CaseActLink`** — small addition, but the act reader page needs a count the
  provision links cannot supply.

### Citation-scan job: incremental and resumable

Rather than a new cursor table, add one column to `Document`:

```prisma
citationScanHash String? @map("citation_scan_hash")
```

The job processes `WHERE citation_scan_hash IS NULL OR citation_scan_hash <>
text_hash`. This reuses the `textHash` convention already in `saveDocument()`,
makes the job naturally incremental (new judgments and re-ingested ones are
picked up automatically), resumable (crash mid-run, re-run continues), and
re-runnable when new acts land (`UPDATE "Document" SET citation_scan_hash =
NULL`). Runs are logged through the existing `IngestionRun` table so they
appear on `/admin/ingestion` alongside everything else.

### Search integration

The brief requires provisions to be searchable through the existing
`SearchProvider` abstraction. `SearchProvider.search()` returns judgment-shaped
`SearchHit`s, so the cleanest fit is a **second method on the same interface**:

```ts
export interface SearchProvider {
  search(req: SearchRequest): Promise<ProviderResult>;
  searchProvisions(req: ProvisionSearchRequest): Promise<ProvisionResult>;
}
```

`PostgresSearchProvider` implements it with a `search_vector` column on
`Provision`, built by the same `simple`-config, trigger-maintained pattern
`setup-search.sql` already uses for `Document`, plus a trigram index on act
title/aliases for the type-ahead. `MeilisearchProvider` gets a `provisions`
index. Both stay behind the abstraction — no separate search path.

---

## 5. Incidental finding

`src/app/api/documents/[id]/route.ts` finds related cases with
`CASE_NUMBER_RE = /\b(…|\d{1,6}\/\d{4})\b/g` over the judgment text. That
pattern matches **act citations too** — `"laga nr. 91/1991"` yields the
case-number candidate `91/1991`, so any judgment numbered 91/1991 surfaces as
"related" to the ~36% of judgments that cite einkamálalög. The act-citation
extraction built for this phase can exclude those spans and fix it cheaply.

Flagged, not fixed — it is outside this phase's scope.

---

## Reproducing

Scripts live in the session scratchpad, not the repo (throwaway research code):

| script | what it does |
|---|---|
| `rank-acts.mjs` | Samples judgments from island.is (stride-paged, polite, resumable via `sample.jsonl`) |
| `parse-lagasafn.mjs` | Lagasafn HTML → chapters/provisions/paragraphs; prints coverage per act |
| `citations.mjs` | The corrected citation pattern set (§2) |
| `final.mjs` | Act ranking, seed-set coverage curve |
| `e2e.mjs` | Joins extracted citations against parsed provisions |
| `coverage.mjs` | Parser coverage across all seed acts |
| `aliases.mjs` | Harvests act short names from citation usage |
