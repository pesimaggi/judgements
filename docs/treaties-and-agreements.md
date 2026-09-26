# The EEA Agreement, the TEU and the TFEU — a research spike

The three founding treaties a question about Icelandic law keeps running into,
and how to put them in this app. Measured on **2026-09-26** against
`publications.europa.eu` (Cellar), `www.althingi.is` and
`www.stjornarradid.is`; every number below came out of a probe, and the probes
are listed in *Re-running the measurements* at the end so they can be checked
rather than believed.

**All of this has shipped**, in one pass rather than the four stages §9 proposed.
What the build changed about the plan is recorded in §10 at the end; the rest of
this document is the plan as it was written, and the measurements are what it was
decided on. `README.md` documents what now exists, under *The founding
treaties*.

| | What | Recommendation |
|---|---|---|
| **§1** | Where they live in the schema | `Act` rows, `jurisdiction = "treaty"`, keyed by a slug from a small registry. Not a new table. |
| **§2** | The Icelandic text of the EEA Agreement | From **Lagasafn**, fylgiskjal I of lög nr. 2/1993 — not the ministry's PDF. It is the text that has lagagildi, and we already fetch the page daily. It stays readable in that act as well as on the Agreement's own page; §4.2 says who owns the article. |
| **§3** | Two languages | Two `Act` rows joined by a `textGroup`, one flagged canonical. The catalogue and every search see the canonical one only, through `corpusFilter()`. |
| **§4** | The parsers | One new EU layout branch (treaties are neither `oj` nor `legacy`), and one fix in the Lagasafn annex walk. Both verified against the real documents. |
| **§5** | The UI | A fourth tab in `/log`, and an ÍSL/ENG toggle in the act reader that only appears where a second text exists. |
| **§6** | Judgment → treaty-article citations | The real payoff, and a stage of its own. The EFTA Court and CJEU corpora are full of "Article 34 EEA" and "Article 101 TFEU". |
| **§7** | What the well should do | Quote **Icelandic** for the EEA Agreement, **English** for the TEU/TFEU. One line in `scopeFilter()` decides whether the well can see any of it. |

---

## §0 What the sources actually serve

Four documents were fetched and parsed with this repo's own parsers. What
follows is what came back, not what the sites promise.

### §0.1 The treaties on Cellar

`cellarTextUrl()` already builds the right URL; treaties are sector 1 of
CELEX, and Cellar serves them the same way it serves a regulation — a `303`
to a `cellar/…/DOC_1` URL, which `politeFetchText` follows.

| CELEX | What it is | Bytes | Article headings |
|---|---|---|---|
| `12016M/TXT` | Consolidated TEU (OJ C 202, 2016) | 832 KB | 353 |
| `12016E/TXT` | Consolidated TFEU (same OJ) | 1.6 MB | 656 |
| `12016ME/TXT` | Both treaties in one document | 1.7 MB | — |
| `21994A0103(01)` | Agreement on the European Economic Area, main part | 198 KB | 129 |

Two things to take from the article counts. First, the TEU has 55 articles and
the TFEU 358, so those documents are mostly **not** the treaty: each one
carries the same 37 protocols and their annexes after the treaty text ends.
Second, the two treaties are published separately as well as together, and the
separate documents are what we want — `12016ME/TXT` would mean one row holding
two instruments, and "Article 3" would be ambiguous within it. **Ingest
`12016M/TXT` and `12016E/TXT`; ignore `12016ME/TXT`**, even though it is the
URL EUR-Lex hands you when you search.

`12020M/TXT` is a 404: there has been no re-consolidation since 2016, so the
2016 text is current. `12012E/TXT` (the Lisbon-era consolidation) exists, which
is what a `textCelex` field is for if a pinned older version is ever wanted.

The EEA document is the **main part only** — the preamble and the 129 articles,
OJ L 1, 3.1.1994, pp. 3–36. The protocols and the 22 annexes are separate CELEX
numbers and are out of scope here (see §8).

### §0.2 What our EU parser does with them today

`parseEuActHtml()` on each document, unchanged:

```
TFEU   12016E/TXT        layout: legacy   provisions: 1137   (should be 358)
TEU+   12016ME/TXT       layout: legacy   provisions: 1224
EEA    21994A0103(01)    layout: legacy   provisions: 0
```

Both failure modes are the ones the parser's header predicts, and neither is
silent for long:

*The treaties fall through to `parseLegacy()`* because they have no
`div[id^='art_']`. Their skeleton is `<div id="001"><p class="ti-art">Article
1</p><div id="001.001">…` — the same *shape* as the `oj` layout, with numeric
ids instead of `art_1` and `ti-art` instead of `oj-ti-art`. The legacy walk
then treats every paragraph reading "Article N" as an article heading, and a
treaty is wall-to-wall cross-references ("(ex Article 86 TEC)"), so it invents
three times as many articles as exist.

*The EEA Agreement yields nothing* because `ADOPTION_FORMULA` does not match
what a treaty says. An act says "HAVE ADOPTED THIS DIRECTIVE:"; the Agreement
says **"HAVE DECIDED to conclude the following Agreement:"**. With no match the
body is empty by design, so the act would be stored `textStatus:
"no-articles"` — correctly, as far as the parser knows.

### §0.3 The Icelandic text of the EEA Agreement is already in our ingest path

This is the find that shapes §2. **Lagasafn publishes the whole Icelandic main
text of the EEA Agreement as fylgiskjal I of lög nr. 2/1993** — 129 articles,
with the amendment brackets and footnotes Lagasafn puts on everything, at the
current codex version, on a page the `lagasafn` adapter already fetches.

That is not a convenience copy. 2. gr. of the act reads:

> Meginmál EES-samningsins skal hafa lagagildi hér á landi. […] Ákvæði
> EES-samningsins, bókunarinnar og viðaukanna, sem vísað er til í 1. mgr., eru
> prentuð sem fylgiskjöl I–IV með lögum þessum.

So the text in fylgiskjal I *is* the operative Icelandic text, and Alþingi
maintains it.

What we do with it today, from `parseLagasafnHtml()` on the live page:

```
provisions: 139  { article: 5, annex: 134 }
annex sample:  X0 "1. gr."  paras 0 | ""
               X1 "2. gr."  paras 0 | ""
annex total chars: 0
```

Every annexed article is stored as an empty shell. The cause is one condition
in the walk: a paragraph is only opened when an `hk.jpg` marker carries an id
matching `/M\d+$/`, and inside a fylgiskjal Lagasafn emits the marker
**without an id** (the only ids in there are `FG5M2L1`-style list-item
anchors). No paragraph anchor, no paragraph, no text. And because `fullText`
comes out empty, `isRepealed` is then computed `true` — so the act reader shows
129 articles of the EEA Agreement as repealed provisions with no text.

That is a bug worth fixing on its own, and it is also the whole of our
Icelandic acquisition problem for the Agreement.

### §0.4 The ministry's PDF, for comparison

`stjornarradid.is/library/?itemid=7321c093…` is a 41-page digital PDF (not a
scan), `Lang(is)`, which `pdfText()` reads cleanly: 97 KB of text, 129 article
headings. It is a real fallback. But its first line is **"Uppfært 1.8.2016"**,
it carries page furniture on every page, and it is a file someone updates by
hand rather than a page a codex version is attached to.

**Use Lagasafn as the source and keep this PDF as the cross-check** — one
place to look when an article's Icelandic text seems wrong, and the thing to
fall back to if Alþingi ever restructures the fylgiskjal markup.

---

## §1 Where they live: `Act` rows, not a new table

A treaty is a titled instrument with numbered articles whose paragraphs are
cited by number. That is the shape `Act` / `Chapter` / `Provision` /
`ProvisionParagraph` already holds, and the shape the act reader, provision
search, the type-ahead and `CaseProvisionLink` are built on. The schema comment
on `Act` makes the argument for EU acts; it applies unchanged here. A `Treaty`
table would duplicate four tables and every query over them to gain nothing.

So: **one new `jurisdiction` value, `"treaty"`**, and `docType = "treaty"`.

`jurisdiction` is doing the same work it does for `"eu"`: saying which corpus a
row belongs to, and being the column every act query filters on.

### §1.1 Identity, and why it is a slug

Treaties have no number and year. `actNumber` and `year` are non-null, so they
have to hold *something*, and whatever they hold must never be displayed:
"lög nr. 2/1957" is not a thing to call the TFEU.

A small registry — `src/lib/treaties.ts` — is the honest answer, in the spirit
of `adr-boards.ts` and `cjeu-priority.ts`. Three entries, hand-written, each
carrying everything the app needs to render and cite the instrument:

```ts
export interface TreatyDef {
  /** URL slug and registry key: "ees", "teu", "tfeu". */
  slug: string;
  /** Ordinal that fills Act.actNumber. Never displayed. */
  ordinal: number;
  /** Year the instrument was signed — stable identity, fills Act.year. */
  year: number;
  /** "Samningur um Evrópska efnahagssvæðið" */
  titleIs: string | null;
  titleEn: string;
  /** How it is cited: "EES-samningurinn", "TFEU". */
  citationIs: string | null;
  citationEn: string;
  /** Genitive, for provisionFullLabel: "28. gr. EES-samningsins". */
  genitiveIs: string | null;
  /** Short names the type-ahead and the citation parser should know. */
  aliases: string[];
  /** CELEX of the English text on Cellar. */
  celexEn: string;
  /** Where the Icelandic text comes from, where there is one. */
  icelandicText:
    | { kind: "lagasafn-annex"; actNumber: number; year: number; annex: 1 }
    | null;
}
```

`year` is the signature year (EEA 1992, TEU 1992, TFEU 1957) rather than the
consolidation year, so that a new consolidation in OJ C does not change a row's
identity or its URL. Which consolidation the stored text came from goes in
`textCelex`, exactly as it does for a consolidated EU act.

### §1.2 Routing

`parseActRef()` already parses three slug forms; treaties are a fourth, and the
easiest of them, because the set is closed. A letters-only slug cannot collide
with `38-2001`, `rg-300-2020` or a CELEX:

```
/log/ees     Samningur um Evrópska efnahagssvæðið
/log/teu     Treaty on European Union
/log/tfeu    Treaty on the Functioning of the European Union
```

`actPath()` returns the slug from the registry. Nothing else about the route
changes: `/log/[slug]` has served two corpora since `/log/32016R0679`, so it is
the reader for legislation, not the reader for lög.

### §1.3 Anchors must be language-independent

This is the one detail that is annoying to change later. `/log/ees#A28` has to
land on Article 28 whether the reader is showing Icelandic or English, so the
two texts must use the *same* anchors, and they cannot be EUR-Lex's `art_28`
in one row and Lagasafn's `X27` in the other.

**Give every treaty provision the anchor `A{articleNumber}`** (`A28`, and
`A28B` for an inserted "28a"), assigned by our own code from the article
number, in both languages. Paragraphs are `A28M1`, following the Lagasafn
convention that `ProvisionParagraph.anchor` already carries.

### §1.4 The scope filter is the gate for everything

`scopeFilter()` in `src/lib/acts.ts` reads, in "eea" scope:

```sql
jurisdiction = 'is' OR eea_relevant OR cardinality(eea_incorporated_by) > 0
```

A `jurisdiction = 'treaty'` row satisfies none of those, so **until that
function changes, a treaty is invisible to the act catalogue, the act
type-ahead, provision search, and the well** — everything funnels through it.
That is a convenient single switch, and it is also a trap: it will look like
the ingest failed.

Add treaties to both scopes:

```sql
jurisdiction = 'is' OR jurisdiction = 'treaty' OR eea_relevant OR …
```

Treaties belong in "EES" scope even though the TEU and TFEU are not EEA law:
they are the text EFTA Court and CJEU reasoning reads EEA provisions against,
and hiding them behind the wide setting would hide them from the people most
likely to need them. `corpusFilter()` gains a `"treaty"` corpus for the tab.

---

## §2 Acquisition

One new adapter, `treaties`, registered in `src/ingestion/run.ts` and slotted
into `DEFAULT_ADAPTERS` in `scripts/ingest-all.sh` right after `lagasafn` (it
reads a Lagasafn page, so it wants that page's current codex) and before
`eur-lex-catalogue`. It is by far the cheapest adapter here: four fetches.

Like `lagasafn` and `eur-lex` it declares `sourceKeys: []` — these are acts,
not documents, and they do not belong in `SOURCES` or in the search panel's
source tree.

Per treaty in the registry:

1. **English text** — `politeFetchText(cellarTextUrl(celexEn), CELLAR_HEADERS)`,
   parse with the new treaty branch (§4.1), upsert the English row.
2. **Icelandic text**, where `icelandicText` says there is one — fetch the
   Lagasafn page for the named act, take the named fylgiskjal, upsert the
   Icelandic row (§4.2).
3. A `PARSE_VERSION` constant as `lagasafn` has, so a parser improvement
   re-reads the four documents on the next scheduled run instead of needing a
   manual poke.

Because both texts come from documents with change signals we already trust
(the Lagasafn codex version, Cellar's consolidation CELEX), a run that finds
nothing new does nothing.

---

## §3 Two languages, one treaty

The requirement: a reader opening `/log/ees` sees Icelandic, and can switch to
English. The TEU and TFEU have no authentic Icelandic text at all (Iceland is
not a party — any Icelandic version is somebody's translation), so they are
English-only, and the toggle must not appear on them.

### §3.1 Two rows, joined, one canonical

Two `Act` rows per treaty text, with three new columns on `Act`:

```prisma
/// Language of the stored text (ISO 639-1). Document.language has always
/// existed; Act's absence of one was an omission that only became visible
/// when one instrument arrived in two texts.
language     String  @default("is")
/// The instrument this row is a text of: the treaty registry's slug. Two
/// rows sharing it are two languages of one instrument, not two instruments.
textGroup    String? @map("text_group")
/// The row that owns the instrument's identity: its URL, its citation links,
/// its badge counts. The other text is reachable from it and is never listed
/// on its own.
isCanonical  Boolean @default(true) @map("is_canonical")
```

`language` wants backfilling for the EU corpus (`UPDATE acts SET language =
'en' WHERE jurisdiction = 'eu'`) and is otherwise correct by default.

Canonical is the Icelandic row for the EEA Agreement and the English row for
the TEU and TFEU: the text that has legal force where this app is read.

*Why rows and not a translation table.* A `ProvisionTranslation` table keeps one
identity per instrument and cannot leak duplicates into a listing, which is a
real advantage. It costs more everywhere else: a second `tsvector` column, its
own trigger in `setup-search.sql`, its own GIN index declared in the schema, a
reader and API that carry two shapes of text, and a lemma job that has to know
which rows are Icelandic. Rows get all of that for free, because the EU corpus
is already English text in the same `provisions` table and is already indexed
and searched as such. The risk rows carry — the same article appearing twice in
a listing — lands in exactly one place, and it is the place this codebase has
already decided such conditions belong:

> This is the one place `doc_type = 'act'` should be written.
> — `corpusFilter()`, `src/lib/acts.ts`

So `corpusFilter()` gains `AND is_canonical` for every corpus, and the
non-canonical text is reached only by following `textGroup` from the row that
owns it. One function, one test that a listing never returns two rows of one
`textGroup`, and the duplicate-row failure mode is closed.

### §3.2 Alignment

Treaties are drawn up in several languages, each text equally authentic (Art
129 EEA says so for the Agreement), so the article and paragraph numbering is
identical across texts by construction — which is what makes the toggle a
toggle rather than a search. Matching is therefore on `articleNumber` /
`articleLetter`, and a paragraph count that disagrees between two texts of one
article is a parse bug, not a translation difference. Worth asserting in a
test, and worth showing honestly in the UI: where the counts disagree, show the
whole article rather than pretending paragraph 3 is paragraph 3.

---

## §4 The parsers

### §4.1 A treaty layout for `parseEuActHtml()`

The treaties are a fourth layout, and they are much closer to `oj` than to
`legacy`:

| | `oj` | treaty |
|---|---|---|
| Article container | `div id="art_1"` | `div id="001"` |
| Article heading | `p.oj-ti-art` | `p.ti-art` |
| Article's own title | `div.eli-title` | `p.sti-art` |
| Paragraph | `div id="001.002"` | `div id="001.002"` |
| Divisions | `div id="cpt_III"` | `p.ti-section-1` + `p.ti-section-2` |

So `parseStructured()` gains a treaty variant rather than a new function: the
article-level selector becomes "a `div` whose id is `art_N` **or** three
digits", the label selector accepts `ti-art`, and the heading accepts
`sti-art`. Divisions are the one real difference — a treaty prints PART / TITLE
/ CHAPTER / SECTION as flat sibling paragraphs instead of nesting articles
inside division `div`s, so membership is derived from document order, the way
`parseLagasafnHtml()` already derives chapter membership.

**Stopping before the protocols is the whole ballgame**, and there is a clean
rule for it that I checked on both documents: the protocols open with a
`p.doc-ti` reading exactly `PROTOCOLS`, and truncating the document there gives

```
TEU   55 articles   (Article 1 … Article 55)   ✓
TFEU  358 articles  (Article 1 … Article 358)  ✓
```

which is exactly right for both. Note also that `ti-art` text arrives with a
non-breaking space in about half the headings (`Article 1`) — JavaScript's
`\s` covers ` `, so `squish()` already handles it, but a hand-rolled
`split(" ")` would not.

Since the document is truncated at the protocols, the `(ex Article 86 TEC)`
cross-references stop mattering: they are body text inside an article, not
headings.

### §4.2 The Lagasafn annex fix

Two changes in `parseLagasafnHtml()`, both narrow:

1. **Synthesise a paragraph anchor when the marker has none.** An `hk.jpg`
   with no id currently drops the paragraph and everything in it; inside a
   fylgiskjal that is all of the text. Give it `{provisionAnchor}M{n}` and the
   walk works unchanged. This is what makes 129 articles of the EEA Agreement
   in Icelandic appear at all.
2. **Read the annex's own divisions.** Fylgiskjal I prints `I. hluti.` and
   `1. kafli.`; the chapter regex expects a roman `N. kafli`, so neither
   matches. The annex needs its own division rule, and it should not write into
   the act's chapter list.

Then the decision that matters more than either, and it is a product decision
rather than a parsing one: **the annexed text stays readable where it is
printed.** Some readers go to the Agreement through the act that gave it legal
force, and arriving at 129 empty articles is the worst of both worlds. So lög
nr. 2/1993 renders its fylgiskjal I in full, the Agreement gets its own page,
and the act reader carries a line at the fylgiskjal pointing at the other one:

> Meginmál samningsins er birt sem fylgiskjal I. **Lesa EES-samninginn →**

That means the Icelandic text is stored twice, and the cost has to be paid
somewhere: without a rule, every article of the Agreement appears twice in
provision search under two labels, with the "úrlausnir vísa til þessa ákvæðis"
counts split between them.

The rule: **the treaty row owns the article; the annex is a rendering of it.**
Concretely, annex provisions are excluded from provision search and from the
citation job's index, so one article is one searchable provision with one
badge, on the Agreement — and the annex copy is a page you can read, not a
second thing to find. `Provision.kind` already does most of this work for free:
`searchProvisionsPostgres()` filters `kind = 'article'`, and the annex text
keeps `kind = 'annex'`, so the exclusion is the behaviour that already exists
rather than a condition to add. What has to be deliberate is not undoing it —
it will be tempting to promote annex provisions to `article` once they finally
have text in them.

The parser fix lands in `lagasafn.ts` and is worth writing generally rather
than for 2/1993 alone: lög nr. 62/1994 annexes the ECHR the same way and has
the same 129-empty-articles problem today.

---

## §5 The UI

### §5.1 A fourth tab

Yes — a fourth tab in `/log`, beside Íslensk lög / Reglugerðir / ESB-gerðir,
with `totals.treaties` behind it like the others, and **no EES/ESB scope
toggle** on it (the scope is about how much of the EU library comes along; it
has nothing to say about three treaties).

On the label: if you want that word, it is **`Þjóðaréttarsamningar`** with one
`r` — the noun is *þjóðaréttur*, genitive *þjóðaréttar*. Beside three short
labels I would rather use **`Alþjóðasamningar`**, which is the ordinary
Icelandic for the category and reads at tab size, with `Sáttmálar og samningar`
as the alternative if you want the treaties' own word in there. Your call — you
know what your readers call them. No code depends on it either way; the label
is one string in `src/app/log/page.tsx`.

### §5.2 The language toggle

A two-state control in the act reader, in the shape of `ScopeToggle`:
`ÍSL | ENG`, shown only when the act has a sibling in `textGroup`. Default to
the canonical text, which for the EEA Agreement is Icelandic.

Follow `ScopeToggle`'s precedent and remember the choice
(`logbrunnur.actLanguage`): someone reading the Agreement against the EFTA
Court's English reasoning wants English on every article, not on one.

A third state, **`Samhliða`** — the two texts side by side, article by article,
stacked on a phone — is the thing a lawyer actually wants from a bilingual
treaty, and it is cheap once both texts are loaded. Worth doing, worth doing
second.

### §5.3 Badges that must not fire

`eeaTag()` says "tekin upp í EES-samninginn" for an act a Joint Committee
decision names. Said of the Agreement itself that is nonsense, and said of the
TFEU it is wrong. Suppress the EES tag for `jurisdiction = "treaty"`, and
suppress "texti ósóttur" / "engin grein birt" wording that assumes an EU act's
`textStatus`.

The reader should carry one line the other corpora do not need: for the EEA
Agreement, that the main text has lagagildi in Iceland under 2. gr. laga nr.
2/1993, with a link to the act. That is the sentence that tells an Icelandic
reader why this treaty is not merely interesting.

---

## §6 Judgment → treaty-article citations

This is where the corpus pays for the work, and it is a stage of its own.

`citations.ts` links a judgment to a provision only where the article and its
instrument appear together. For treaties the instrument is named, not numbered,
so it needs its own patterns rather than the `nr. N/ÁÁÁÁ` machinery:

- Icelandic: `28. gr. EES-samningsins`, `1. mgr. 31. gr. EES-samningsins`,
  `samningsins um Evrópska efnahagssvæðið`, and the inflected forms
  (`EES-samningnum`, `EES-samningi`).
- English, for the EFTA Court, ESA and CJEU material that is already here in
  English: `Article 28 EEA`, `Article 28 of the EEA Agreement`,
  `Article 101 TFEU`, `Article 267 TFEU`, `Articles 53 and 54 EEA`.

Two traps, both of which this repo has already been bitten by:

- `\b` is ASCII-only in JavaScript, so `/\bEES-samningsins\b/` is not the
  pattern you think it is. Use `src/lib/word-boundary.ts`.
- The job is incremental on `Document.citationScanHash`, so **adding patterns
  links nothing until the corpus is rescanned**: `UPDATE "Document" SET
  citation_scan_hash = NULL;`, as the header says. A `SCAN_VERSION` constant
  folded into the hash comparison would make that automatic; without one, the
  new patterns will look like they do not work.

The provision index in `citations.ts` is keyed `actNumber/year`, which treaties
have no meaningful values for; they need a third index keyed by treaty slug,
next to the two that already exist for lög and reglugerðir.

Expect this stage, not the ingest, to be what makes the feature feel finished:
"úrlausnir vísa til þessa ákvæðis" on Article 28 EEA is the badge that turns
three new documents into a research tool.

---

## §7 What the well should do — English or Icelandic?

Asked because this is being built in one session and the well in another. The
short answer: **Icelandic for the EEA Agreement, English for the TEU and
TFEU** — and this needs no change in `src/lib/ask/` at all.

**The EEA Agreement: Icelandic.** Not as a convenience to the reader, but
because the Icelandic text is not a translation. Article 129 of the Agreement
makes every language version equally authentic, and 2. gr. laga nr. 2/1993
gives the Icelandic main text lagagildi here. It is what Icelandic courts
quote. Three consequences, in descending order of how much they matter:

1. An answer that quotes the Icelandic article is quoting the operative text.
   An answer that quotes the English and renders it into Icelandic prose is
   translating a treaty on the fly, in a legal answer, where a mistranslated
   article is the worst failure this app can have.
2. Retrieval matches vocabulary. The question is Icelandic and so is
   everything around the answer — lög, dómar, úrskurðir — so the Icelandic
   text shares terms with both the query and the lemma index. The English
   text can only be found with English query terms.
3. `evidence.ts` windows and renders source text as-is. Icelandic evidence for
   an Icelandic answer needs no intervening step.

**The TEU and TFEU: English**, because there is no authentic Icelandic text to
prefer. This is also what CLAUDE.md already says — search each corpus in its
own language — and what the EU corpus does today.

**Keep the English EEA text indexed anyway.** The EFTA Court, the CJEU and ESA
material in this corpus reasons in English about "Article 28 EEA", so a
research loop reading an EFTA Court judgment is holding the English wording;
being able to find the Agreement by those words is worth having. The rule is
about which text an answer *cites*, not which texts exist.

Two things worth knowing in the well's session, both of which are decisions
there rather than here:

- **One line controls visibility.** `scopeFilter()` (§1.4) is the only gate:
  `search_provisions`, `read_provision` and retrieval all reach acts through
  it. Until it admits `jurisdiction = 'treaty'`, the well cannot see a treaty;
  the moment it does, the well sees them with no change in `src/lib/ask/`. The
  `is_canonical` condition in `corpusFilter()` (§3.1) is what keeps the well
  from being offered the same article twice, which matters for the numbering
  rule in `citations.ts` — two rows of one article would be two sources for one
  proposition.
- **`rank.ts` scores by jurisdiction.** Today `jurisdiction === "eu"` scores
  −1 unless the plan wants EU material, and anything else scores 0. A new
  `"treaty"` value therefore lands neutral, which is right for the EEA
  Agreement (in substance it is Icelandic law) and probably too generous to the
  TFEU on a purely domestic question. If you want to tune it: score the EEA
  Agreement like `"is"` and the TEU/TFEU like `"eu"`, keyed off the treaty
  slug rather than the jurisdiction. Not urgent, and easier to judge once
  §6 has linked some judgments to treaty articles.

---

## §8 Deliberately not in this plan

- **The protocols and the 22 annexes to the EEA Agreement.** The annexes are
  the lists of EU acts taken into the Agreement, which is a different feature
  and one we already approach from the other end, through
  `eea_incorporated_by` and the Joint Committee's decisions. Protocol 1 (about
  which Icelandic law already has something to say, via 2. gr. laga nr. 2/1993)
  is the one candidate worth revisiting later.
- **The 37 protocols to the TEU/TFEU**, including the Statute of the Court.
  Cheap to add once the treaty parser exists — they are in the same document,
  after the `PROTOCOLS` marker we stop at — and worth nothing until something
  cites them.
- **The Charter of Fundamental Rights** (`12016P/TXT`), the SCA (the
  EFTA Surveillance and Court Agreement) and the ECHR as annexed to lög nr.
  62/1994. All three are the same shape as this work and all three are better
  judged after the first one ships. The SCA in particular is the natural fourth
  entry in the registry: the EFTA Court's own jurisdiction comes from it, and
  our EFTA Court corpus cites it constantly.
- **Pinning an older consolidation.** `textCelex` can hold `12012E/TXT` if a
  "law as it stood" feature ever wants it; nothing here needs it.

---

## §9 The stages, in the order they should be built

**Stage 1 — the TEU and TFEU, English only.** No language columns, no Lagasafn
work, and the smallest possible proof that the modelling is right.
`src/lib/treaties.ts`; `jurisdiction`/`docType` `"treaty"`; the treaty branch
in `parseEuActHtml()` with the `PROTOCOLS` cut; `parseActRef()` / `actPath()` /
`actCitation()` / `actDisplayTitle()` / `provisionFullLabel()`; `scopeFilter()`
and `corpusFilter()`; the `treaties` adapter; the fourth tab; badge
suppression. Tests: the treaty layout parses, it stops at the protocols, and
nothing in a parsed provision contains the word PROTOCOL.

**Stage 2 — the EEA Agreement, both texts.** The Lagasafn annex fix; the
`language` / `textGroup` / `isCanonical` columns and the `is_canonical`
condition in `corpusFilter()`; the ÍSL/ENG toggle; the lagagildi line in the
reader and the pointer from lög nr. 2/1993, which now renders its fylgiskjal in
full. Tests: the annex walk recovers text for the Agreement's articles, a
listing never returns two rows of one `textGroup`, an annex provision never
reaches provision search, and the two texts of an article agree on their
paragraph count.

**Stage 3 — citations.** Treaty citation patterns in `legal-citations.ts`, a
treaty index in `citations.ts`, a `SCAN_VERSION` so the rescan is automatic,
and fixtures from real judgments in both languages. Tests: one Icelandic
judgment citing `28. gr. EES-samningsins` and one EFTA Court judgment citing
`Article 34 EEA` each resolve to the same provision.

**Stage 4 — `Samhliða`,** the side-by-side view.

The README gains its *Treaties* section under *Sources* when stage 1 lands, not
before; it documents what exists.

---

## Re-running the measurements

Everything in §0 came from these, on 2026-09-26. The Cellar fetches need `-L`:
Cellar answers `303` and a fetch without redirects reports `200`-looking
success with zero bytes, which is a quietly misleading way to conclude a
treaty is unavailable.

```sh
# §0.1 — the treaties, as Cellar serves them
for c in 12016M%2FTXT 12016E%2FTXT 12016ME%2FTXT 21994A0103%2801%29; do
  curl -sSL -o "$c.html" -w "%{http_code} %{size_download}\n" \
    -H "Accept: application/xhtml+xml, text/html;q=0.9" \
    -H "Accept-Language: eng" \
    "https://publications.europa.eu/resource/celex/$c"
done

# §0.2 — what our parser does with them
#   parseEuActHtml(readFileSync(f, "utf8")) for each file; print
#   parsed.layout and parsed.provisions.length.

# §0.3 — the Icelandic text, and what we store today
curl -sSL -o 1993002.html "https://www.althingi.is/lagas/nuna/1993002.html"
#   parseLagasafnHtml(...) and count provisions by kind, then sum
#   fullText.length over the annex ones. It is zero.

# §0.4 — the ministry's PDF
curl -sSL -o ees-isl.pdf \
  "https://www.stjornarradid.is/library/?itemid=7321c093-5b5e-11ed-9bb2-005056bc4727"
#   pdfText(readFileSync("ees-isl.pdf")) — 41 pages, ~97 KB of text,
#   129 "N. gr." headings, "Uppfært 1.8.2016" on every page.
```

## Open questions for you

1. **The tab label** — §5.1. `Alþjóðasamningar`, `Sáttmálar og samningar`, or
   `Þjóðaréttarsamningar`.
2. **Icelandic short forms for the TEU and TFEU**, for the type-ahead's
   aliases and for `citationIs`. `EES-samningurinn` is settled; for the other
   two I have seen both the English abbreviations and spelled-out Icelandic
   (*sáttmálinn um starfshætti Evrópusambandsins*) in Icelandic writing, and
   which one your readers would type is a question about them, not about the
   code.
3. **Is the SCA in or out of the first registry?** It is the same work, and our
   EFTA Court corpus cites it more often than it cites the TEU.


---

## §10 What the build changed

Written after the fact, as the record of where the plan was wrong. The staging in
§9 was dropped — it was built in one pass — and four things turned out
differently.

**The annexed text stays readable in lög nr. 2/1993** (§4.2 as amended). The plan
had it stored once, on the treaty row, and the act keeping empty labels. That was
the wrong trade: readers do navigate to the Agreement through the act that
enacted it. Both are rendered, and the duplication is paid for with a rule
instead — the treaty row owns the article, the annex is a rendering of it, and
annex provisions stay out of provision search and the citation index. `kind =
'article'` already arranged it; the work was not undoing it.

**The EEA Agreement's English text needed three more fixes than the plan
found.** §0.2 knew about the adoption formula. It did not know that the
Agreement's divisions print several to a line ("PART III FREE MOVEMENT OF
PERSONS, SERVICES AND CAPITAL CHAPTER 1 WORKERS AND SELF-EMPLOYED PERSONS"), that
Articles 63, 72 and 77 are each a single sentence beginning "Annex XV contains…"
which the annex-heading rule read as a heading — leaving all three empty — or
that everything after Article 129 was being appended to it, giving that article
83 paragraphs where it has three. Two of those three were wrong for every legacy
EU act in the library, not just for this one.

**A treaty has to be identifiable from the narrow act identity**, not only from
`textGroup` (§1.1). The well's tool layer, the lookup route and the Meilisearch
sync all pass around jurisdiction, number and year and nothing else, and without
a fallback every treaty link through one of them was `/log/1-1992` — a 404.
`treatyByIdentity()` resolves it from the ordinal and the year, which the table's
own uniqueness constraint already guarantees are unique. Nothing in
`src/lib/ask/` was touched.

**`SCAN_VERSION` was not optional** (§6 hoped it could be a later refinement).
The citation job's watermark asks whether the *judgment* changed; adding patterns
changes us, so without a version in the watermark the treaty patterns would have
linked only judgments ingested afterwards and would have looked broken. It is in
the watermark now, and bumping it is the whole of a backfill.

Three things in §8 stayed out, as planned: the protocols, the annexes, and the
SCA. The tab is labelled **Alþjóðasamningar**, which is one string in
`src/app/log/page.tsx` if you want the other word.
