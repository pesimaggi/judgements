# Reglugerðir, lögskýringargögn, and repealed acts — a research spike

Three proposals, in the order they should be built. Measured on **2026-09-15**
against `api.reglugerd.is`, `www.reglugerd.is` and `www.althingi.is`; the
probes are listed in *Re-running the measurements* at the end so the numbers
can be checked rather than believed.

**Two pieces of this have shipped.**

*§2.1, the Alþingi linkage.* `Act.ferillUrl`, `Act.billUrl` and
`Provision.footnotes` are stored, the act reader shows them, and the Lagasafn
adapter carries a `PARSE_VERSION` so the backfill happens on a scheduled run
rather than by hand.

*All of §1* — every step of §1.7. The `reglugerd` adapter, `docType:
"regulation"` on `Act`, the two-generation parser, the `/log/rg-{nr}-{ár}`
route, a third catalogue tab, the `lagastod` adapter with `RegulationBasis`
behind it, and judgment→regulation citations in the `citations` job. What the
builds changed about the plan is recorded in §1.8, §1.9 and §1.10.

Nothing else here has been built: no þingskjal is fetched, no repealed act is
stored.

| | What | Recommendation |
|---|---|---|
| **§1** | Icelandic regulations (reglugerðir) from reglugerd.is | **Shipped**, all of it; §1.8–§1.10 record what the builds changed. The register itself is not ingested until the robots.txt question in §1.4 is answered. |
| **§2** | Althingi preparatory works (lögskýringargögn) | Linkage **shipped** (§2.1, §2.5 step 1). The ingest itself is held until one access question is answered. |
| **§3** | Acts no longer in force | Not yet, and not in full. There is a cheap 10% of it that solves the real problem; §3.4. |

---

## 1. Reglugerðir

### 1.1 The source is the API, not the repository

`island-is/regulations` is the source code of the reglugerd.is service. There
is nothing in it to ingest. What it exposes is a public JSON API at
`api.reglugerd.is/api/v1/`, and that is what an adapter would talk to:

| Endpoint | Gives |
|---|---|
| `/regulations/newest?page=N` | The register, newest first. 30 per page, **489 pages, 14,648 items**. Each: `name` ("0945/2026"), `title`, `type` (`base` \| `amending`), `publishedDate`, `effectiveDate`, `repealed`, `ministry`. |
| `/regulation/{nnnn-yyyy}/current` | The consolidated current text and everything about it — see below. |
| `/ministries`, `/lawchapters` | The two taxonomies: ~14 ministries, and a subject classification (`01a` "Stjórnskipunarlög", `36a` "Byggingarheimildir, skipulag o.fl.") that mirrors Lagasafn's own. |

A full `/current` payload — byggingarreglugerð 112/2012 is the example — carries
`text` (consolidated, **amendments already applied**), `appendixes[]`,
`signatureDate`, `publishedDate`, `effectiveDate`, `ministry`, `repealed`,
`lastAmendDate`, `lawChapters[]`, `history[]` (every amending regulation, with
date and effect), `effects[]` (what this one amended or repealed),
`originalDoc` (the Stjórnartíðindi PDF) and `pdfVersion`.

That shape is a very good fit. It is the Lagasafn shape: an index that says
what exists, and a per-item document that carries consolidated text plus an
amendment history.

### 1.2 The corpus is half the size it looks

Of a 750-item sample across 25 random pages of the register, **55.5% are
`amending`** — "Reglugerð um (1.) breytingu á reglugerð nr. 842/2026 um veiðar
íslenskra skipa á makríl" — and 44.5% are `base`.

Since `/current` returns the base regulation with its amendments already
applied, **the amending regulations must not be ingested as documents of their
own.** They are the history, and `history[]` already carries them. This is
exactly what we do for lög: Lagasafn gives us the consolidated act and a list
of amending acts, and we store one act.

So the target corpus is **~6,500 base regulations**, not 14,648, and search is
not polluted with several thousand titles that all read "breytingu á".

### 1.3 Blocker one: text structure is available for only a quarter of them

This is the finding that decides how good the feature can be.

Of 48 regulations sampled across the register, **12 returned `text` from the
API and 36 returned a four-field stub** (`name`, `title`, `redirectUrl`,
`originalDoc`) with no text at all.

The text is not lost — it is on the web page the stub redirects to. But those
pages come in two generations:

- **Newer pages** carry semantic markup identical to the API's `text`:
  `<h3 class="article__title">1. gr. <em class="article__name">Markmið og
  gildissvið.</em></h3>`, with `chapter__title` above it. This parses into
  `Chapter` / `Provision` / `ProvisionParagraph` almost mechanically.
- **Older pages** (all 10 stubs I opened, spanning 1993–2012) carry the full
  text as Word-converted soup — `<div class="Section1">` and centred
  `<p>1. gr.</p>` paragraphs, no classes, no anchors, `lang="EN-US"` on
  Icelandic text.

The consequence, stated plainly: **regulations will not have uniform
provision-level structure.** For the structured quarter we get articles,
paragraphs and therefore provision-level case linking. For the rest we get the
full text — searchable, lemmatised, quotable by the well — and article
boundaries only as far as a heuristic parser can recover centred "N. gr."
paragraphs, which is a guess, not an anchor.

That is acceptable, but only if it is recorded rather than hidden. `Act` already
has `textStatus` for exactly this ("why this act has no text"); it wants a
sibling saying **how the structure was obtained** — `"api"`, `"html-structured"`,
`"html-heuristic"` — so the act reader can decline to offer article-level
linking on a heuristic parse, and so the citation job can refuse to hang a
`CaseProvisionLink` off an article boundary nobody published.

### 1.4 Blocker two: the register is only enumerable through the API

**Settled 2026-09-16** — the owner's position is that Icelandic legislative
material is not governed by the robots.txt this section originally treated as a
blocker, and the adapter now runs in the scheduled chain at the ordinary ingest
pace. The rest of this section is kept for the measurement in it.

#### What the original blocker said

```
User-agent: *
Disallow: /
```

`www.reglugerd.is/robots.txt` is permissive (`Crawl-delay: 5`, a handful of
`Disallow`s, `/reglugerdir/` open), so the *pages* are fair game on a 5-second
delay. The API is not, on its face.

This is almost certainly aimed at search-engine crawlers rather than at API
clients — it is a public, unauthenticated, open-data API run by Stafrænt Ísland
— but the project's own rule is to check robots.txt and terms before pointing
an adapter at a live site, and this one says no. **The right move is to ask**
island.is for confirmation (and, while asking, for whether they would rather
serve us a bulk dump than 6,500 requests). Until they answer, the honest
fallback is the web pages at the published crawl-delay, which is slower and
gives worse structure.

Do not start the ingest on the strength of "they probably meant crawlers".

### 1.5 The data model: reuse `Act`

`Act` already holds two jurisdictions in one table, on the argument that "the
two are the same shape — a titled instrument, with numbered articles, cited by
number and year". A reglugerð is the same shape again, and the unique key
`[jurisdiction, docType, actNumber, year]` already has room for it:

```
jurisdiction = "is"
docType      = "regulation"     // "act" today; the column exists
actNumber    = 300              // from "0300/2020"
year         = 2020
```

What comes free, and it is most of the feature:

- **Provision search and the act reader**, for the structured quarter.
- **Judgment → regulation links.** `LEGISLATION_CITATION_RE` in
  `src/lib/legal-citations.ts` already matches `reglugerð nr. 1165/2016` — the
  `REGULATION_LEAD` branch exists and is tested. Today those matches resolve to
  nothing because there is no row to point at. Once there is, the existing
  `citations` adapter links them.
- **Regulation → enabling act links (lagastoð).** Every regulation closes with
  its own authority. Reglugerð nr. 300/2020 ends: *"Reglugerð þessi, sem sett er
  samkvæmt 7., 15. gr. a, 15. gr. b og 20. gr. laga nr. 60/2007 um
  Vatnajökulsþjóðgarð, öðlast þegar gildi."* That sentence is already fully
  parseable by the citation extractor we ship — article numbers, letters and
  all. Running it over regulation text gives, at no new cost, the most useful
  thing this feature can show a lawyer: **on the act reader for lög nr.
  60/2007, a section listing the regulations set under it, article by article.**

What does not come free:

- **The slug collides.** `parseActRef` reads `/log/38-2001` as an Icelandic act;
  `/log/300-2020` would be ambiguous the day an act and a regulation share a
  number and year. Give regulations their own route — `/reglugerd/300-2020` —
  rendering the same reader with `docType` fixed. Cheaper than widening
  `parseActRef`'s contract, and it reads better.
- **The catalogue is two tabs and a EES/ESB toggle**, both shaped around the
  Icelandic/EU split. Regulations are a third tab. The scope toggle is
  meaningless for them and should not render there.
- **Three `Act` columns are Lagasafn-shaped**: `codexVersion`, `currentVersionUrl`
  and `status`. `currentVersionUrl` maps cleanly (the reglugerd.is permalink),
  `status` maps cleanly (`in_force` / `repealed` — and unlike Lagasafn,
  reglugerd.is *tells* us, via `repealed`). `codexVersion` has no analogue;
  `lastAmendDate` is the change signal instead and wants its own column.

The alternative — a separate `Regulation` model — means duplicating `Chapter`,
`Provision`, `ProvisionParagraph`, `CaseProvisionLink` and `CaseActLink`, and
teaching search, the act reader and the well about a second kind of legislation.
Not worth it. Regulations are subordinate legislation, not a different species.

### 1.6 Incremental runs

The register is newest-first, which is the pattern `icelandic-courts` already
uses: walk it, stop after N consecutive items we already hold. For each new
item:

- `type: "base"` → fetch `/current`, parse, upsert.
- `type: "amending"` → **do not store it.** Fetch its `/current`, read
  `effects[]` for the base regulation(s) it changes, and mark those dirty so
  their consolidated text is re-fetched.

That second rule is the whole of change detection, and it is why amending
regulations still have to be *read* even though they are never *stored*.

A cold run is ~489 listing requests plus ~6,500 document fetches. At the
existing polite delay that is a long but bounded backfill, and `IngestCursor`
and `IngestGap` already exist to make it resumable and to stop a one-off 503
from silently losing a regulation.

### 1.7 Suggested phasing

1. Ask island.is about the API. Meanwhile, `docType: "regulation"` on `Act`,
   the structure-provenance column, and the `/reglugerd/{nr}-{ár}` route.
2. Adapter: register walk, base-only ingest, structured parse, HTML fallback.
3. Lagastoð extraction → "reglugerðir settar samkvæmt þessum lögum" on the act
   reader. This is the section that makes the feature feel like it belongs.
4. Let the `citations` adapter resolve regulation citations in judgments.
   **Watch the ambiguity here**: "reglugerð nr. 1165/2016" is Icelandic, but
   "reglugerð Evrópusambandsins nr. 2016/679" is not, and the bare form is
   written both ways. Resolution needs the docType and the corpus to
   disambiguate, and should decline rather than guess.

### 1.8 What the build changed about §1

Five things the research did not see, recorded because they are the kind of
thing that is expensive to rediscover.

**The site has no crawlable register.** §1.4 assumed the web pages were a
usable fallback for the whole feature if the API question went unanswered.
They are not: `/reglugerdir/allar/` is a search form that renders a single
item, so there is no HTML-only route to *what exists*. The API is the only way
to enumerate the register, and the robots.txt question in §1.4 therefore cannot
be designed around — only asked. Individual regulations are still read from the
site, which is where three quarters of the text is.

**The slug collision was settled the cheap way.** §1.5 proposed a separate
`/reglugerd/{nr}-{ár}` route. It got `/log/rg-300-2020` instead: `/log/` has
served EU regulations since `/log/32016R0679`, so it is already the reader for
legislation rather than a route for lög, and a prefix avoided extracting the
450-line reader into a shared component for no gain a reader would notice.

**`jurisdiction` stopped being the corpus.** §1.5 said the catalogue would need
a third tab, which was true and was the small half. The real cost is that
`jurisdiction = 'is'` used to mean lög and now means lög *or* reglugerðir, and
that condition was written inline in every act query. It is now written once,
in `corpusFilter()`. Anything that keeps writing it inline is a regulation
presented as an act.

**The citation index had a live collision, and a latent one.**
`citations.ts` builds its act index keyed by number and year alone — which is
all `laga nr. 91/1991` gives — from *every* row in the table, taking the last
row written on a clash. Regulations overlap act numbers completely, so this
would have pointed judgments citing an act at a regulation, silently. EU acts
were already in that index for the same reason and had not bitten only because
no Icelandic judgment cites `laga nr. 679/2016`. Both are now filtered out.

**Two parser bugs, both found by one regulation.** Byggingarreglugerð nr.
112/2012 numbers its 439 articles hierarchically — "1.2.1. gr.", which is not
article 1 — so they needed stable anchors without integer article numbers, on
the same reasoning the Lagasafn parser refuses to number annex articles. And
its definitions article is an `<ol>` of 726 `<li>` with no `<p>` at all, so a
parser selecting `<p>` dropped the entire article while still reporting
success. Both are now fixtures.

### 1.9 What the build changed about the lagastoð link

§1.7 step 3 was one line — "lagastoð extraction → 'reglugerðir settar samkvæmt
þessum lögum' on the act reader" — on the strength of §1.5's claim that the
closing sentence "is already fully parseable by the citation extractor we
ship". That claim was wrong, in a way worth writing down.

**The general extractor finds a quarter of the answer.**
`extractProvisionCitations` requires an article and its act to be adjacent,
which is correct for judgments. A lagastoð clause enumerates: "7., 15. gr. a,
15. gr. b og 20. gr. laga nr. 60/2007" is four articles sharing one trailing
"gr." and one act reference, and only the last is adjacent to it. So the
feature needed its own extractor after all — one that reads the articles as a
*run* leading up to each act reference, which also happens to be what keeps
them with the right act when a clause names two.

**Precision, not recall, is the hard half.** Anchoring on an act citation near
"sett", "stoð" or "heimild" matched three kinds of thing that are not a basis:
a cross-reference to a requirement, a clause about what a *tariff* is set
under, and a plain "sbr." citation. What distinguishes the real clause is its
subject, so the anchor is "Reglugerð þessi" / "Reglugerðin" / "Reglur þessar"
followed by the verb. A missed lagastoð leaves a regulation looking unmoored;
a false one asserts an act authorises something it does not.

**Two forms that were not on anyone's list.** Measured over 84 regulations,
nine of the twelve initially missed used the pre-1990 citation style, where an
act is named by number and date of assent — "laga nr. 49 17. maí 2005" is lög
nr. 49/2005. (`legal-citations.ts` does not read that form either, so judgments
citing it also fail to link; that is a separate and larger job.) The others
were municipal byelaws, whose verb is "staðfestist" rather than "sett". With
both handled the extractor finds a basis in 83 of 84.

**Two bugs that only a corpus would find.** An enumerated paragraph qualifier —
"3. og 4. mgr. 99. gr." — left a phantom article 3 hanging off the act, because
only the qualifier adjacent to "mgr." was being stripped. And a lettered
article, "59. gr. a.", is a period after a single letter followed by a space:
read as a sentence end, it cut the clause off from the act it names and lost
the citation entirely.

**An unresolvable article does not discard the link.** Where an article names
no provision we hold, the row is written against the act with a null provision
rather than dropped. Lagasafn publishes no provisions for about a tenth of acts
in force, and an article repealed since the regulation was made is gone from
the consolidated text by construction; in both cases the regulation still rests
on the act.

### 1.10 What the build changed about judgment → regulation citations

§1.7 step 4 flagged the right risk — "reglugerð nr. 1165/2016 is Icelandic but
reglugerð Evrópusambandsins nr. 2024/2642 is not, and the bare form is written
both ways" — and then said resolution "should decline rather than guess". What
it did not anticipate is *where* the evidence to decline lives.

**The marker is usually not on the citation.** Measured over 2,802 regulation
citations in 167 judgments from the live archive: only 201 carried an EU marker
within 70 characters. A judgment names the instrument in full once and then
refers to it bare for the rest of the opinion — one EU pharmaceutical case in
the sample cites "reglugerð 1768/92" and "reglugerð 1901/2006" dozens of times
with nothing beside them. So the decisive test is document-level and keyed to
the *instrument*: if this number and year carry a marker anywhere in this
judgment, decline every mention of them in it. That is 380 citations, against
201 for the per-citation test.

**Document-level must not mean document-wide.** The obvious version — "this
judgment mentions the EU, so distrust its regulation citations" — would have
suppressed 1,634 citations in the sample, most of them Icelandic regulations in
judgments that happen to mention the EEA Agreement. Keying on the instrument
keeps both: a judgment can discuss EU Regulation 1901/2006 and cite reglugerð
nr. 1009/2015, and only the first is declined.

**Two spellings of one instrument.** The same judgment writes "1768/92" where
the marker is and "1768/1992" a page later where it is not. Keying the
suppression on the text as written left the second form linking — and the
four-digit spelling is the one form that passes every other test.

**A window that reaches too far is a precision bug, not a recall one.** The
marker window originally ran a fixed 70 characters back, which reached across
sentence boundaries: "Reglugerð … (EB) nr. 1901/2006 gildir um lyf. Hér á landi
gildir hins vegar reglugerð nr. 1009/2015" declined the Icelandic citation
because of its neighbour's marker. The window now stops at the end of the
previous citation.

**The magic number that was wrong.** An early rule declined any regulation
numbered above 1500 as implausibly high for Iceland. Checking the register
rather than trusting the intuition: 2023 reached 1606. The rule was dropped
entirely — the document-level test catches everything it did, except one
citation that the existence check catches anyway.

**No schema change at all.** A regulation is an `Act` row with `Provision`
children, so `CaseProvisionLink` and `CaseActLink` took the new links unchanged,
and every count, badge and expandable case list already built works on a
regulation's articles. This is the return on §1.5's decision to reuse the table,
and it is the one part of that decision that has cost nothing.

---

## 2. Lögskýringargögn from Alþingi

### 2.1 We already have the linkage and we were discarding it

**Shipped.** This section is kept in the past tense it was written in, because
the argument is why the columns exist. What it proposed is now in
`src/lib/lagasafn.ts`, `Act.ferillUrl` / `Act.billUrl` / `Provision.footnotes`,
and the act reader.

This was the headline, and it changes what this project is.

Every Lagasafn act page — the page `src/ingestion/adapters/lagasafn.ts`
downloads today, for every act, on every run — carries this immediately under
the title. From `1991091.html` (lög nr. 91/1991 um meðferð einkamála):

```html
<a href="https://www.althingi.is/thingstorf/thingmalalistar-eftir-thingum/ferill/?ltg=115&mnr=71">Ferill málsins á Alþingi.</a>
<a href="https://www.althingi.is/altext/115/s/0072.html">Frumvarp til laga.</a>
```

So **act → its originating bill is a solved problem**: no title matching, no
number heuristics, no fuzzy join against þingmál. It is an anchor tag in HTML we
already fetch. The same page then links every amending act to its own
Stjórnartíðindi page (`/altext/stjt/1993.133.html`), and those pages carry the
same two links for the amendment.

And it goes one level deeper. The same act page carries **236 footnotes** of the
form `L. 49/2016, 5. gr.` — each naming the amending act *and the article of
that act* that made the change. `src/lib/lagasafn.ts` **already parses these**
into `ParsedAct.provisions[].footnotes` (line 69: *"Amendment footnotes trailing
the provision"*). `Provision` has no column for them, so they are parsed and
dropped on every run.

Persisting that one field is a small change, and it completes the chain that
makes article-level travaux possible:

```
Provision (130. gr. laga nr. 91/1991)
  → footnote "L. 78/2015, 3. gr."          ← already parsed, not stored
    → act 78/2015's Lagasafn page
      → "Frumvarp til laga" → þingskjal     ← anchor tag, already on the page
        → "Athugasemdir við 3. gr."         ← the commentary that explains
                                              why this paragraph reads as it does
```

**Do this part now**, independently of any decision about ingesting Althingi.
Storing the footnotes and the two links costs one migration and a few lines in
an adapter that already has the data in hand, and it is the expensive half of
the feature. The documents can be fetched later; the links cannot be
reconstructed later without re-crawling all ~900 acts.

Two things the build found that the research did not:

- **The footnotes are not only amendments.** Lagasafn footnotes the regulations
  *set under* an article in the same place — "Rgl. 492/2001, sbr. rgl.
  278/2010" under 15. gr. laga nr. 38/2001. So the column is `footnotes`, not
  `amendmentFootnotes`, and anything reading them has to look at what the note
  says. It also means §1's "reglugerðir settar samkvæmt þessum lögum" has a
  second source, per-article, that does not depend on reglugerd.is at all.
- **The cheap skip had to be dealt with first.** The in-force index pins 903 of
  ~905 acts to one codex version, and the adapter skips such an act *without
  fetching it*. Storing a new field would have reached only the acts amended
  afterwards. Hence `Act.parseVersion` and the adapter's `PARSE_VERSION`: an
  act behind the current parse is re-fetched whatever its codex version says,
  so a bump is the backfill. Any later widening of this parse — and §1 will
  want one — now costs one constant instead of a manual `LAGASAFN_FORCE=1` run
  somebody has to remember.

### 2.2 Blocker: `www.althingi.is/altext/**` returns 403 from here

Measured today, from this environment:

| URL | |
|---|---|
| `/lagasafn/nuna/` | **200** |
| `/lagas/nuna/1991091.html` | **200** |
| `/altext/115/s/0072.html` (a þingskjal) | **403** |
| `/altext/stjt/1993.133.html` | **403** |
| `/altext/xml/thingmalalisti/?lthing=154` | **403** |
| `/thingstorf/…/ferill/?ltg=115&mnr=71` | **403** |

The 403 is Cloudflare's block page, and it is **path-based, not User-Agent
based** — a full browser fingerprint (Chrome UA, `Accept`, `Accept-Language`,
a same-site `Referer`) makes no difference, while Lagasafn paths serve 200 to a
bare curl on the same connection.

Which is odd, because Althingi's own `robots.txt` says:

```
# Fyrir sjálfvirka gagnasöfnun, notið XML-vefþjónustuna: https://www.althingi.is/altext/xml/
```

— *for automated data collection, use the XML web service* — and the XML web
service is one of the things returning 403.

So this is very likely bot-management collateral rather than policy. Two things
to establish before designing around it:

1. **Does it 403 from the Railway egress IP too?** This container's address may
   simply be on a datacenter blocklist. One request from the production ingest
   settles it, and the answer changes everything downstream.
2. If it does, **ask Alþingi.** A site whose robots.txt invites automated
   collection through a service that blocks automated collection has a
   misconfiguration, and they are the ones who can fix it.

Do not design a workaround until (1) is answered. Note also that the 403 does
*not* block §2.1 — the links live on Lagasafn pages, which serve fine.

### 2.3 What "preparatory works" actually means here

Not one document type but a family, in descending order of how much a court
cares:

| | | |
|---|---|---|
| **Frumvarp + greinargerð** | The bill and its explanatory memorandum, including *"athugasemdir við einstakar greinar"* — the article-by-article commentary. | The one that matters. This is what judgments quote. |
| **Nefndarálit** | Committee reports, majority and minority. | Quoted where the committee changed the bill. |
| **Breytingartillögur** | Amendments moved during passage. | Explains why the act does not read like the bill. |
| **Umsagnir** | Submissions from consulted bodies. | Rarely cited; large volume. |
| **Ræður** | Floor debate. | Occasionally cited; very large volume. |

Scope it by that column. **Frumvörp with their greinargerðir first** — roughly
900 original bills for the acts in force, plus the amending bills, which is
where the volume is: 91/1991 alone has been amended by enough acts to generate
236 provision-level footnotes. Expect the amending-bill corpus to be in the
low tens of thousands, not hundreds.

### 2.4 The data model: a `Document` source, plus link tables

`Document` is judgment-shaped (`court`, `caseNumber`, `parties`), but the
project has already stretched it once for non-judgments: `logretta` and
`ulfljotur` store journal articles there, and `SourceDef.kind` grew a
`"scholarship"` value to say so. Travaux are the same argument, and the payoff
is large — full-text search, the BÍN lemma vectors, Meilisearch, the source
panel, `IngestGap`'s retry ledger and the well's retrieval all work on
`Document` and would need teaching about any new model.

So: a source key (`althingi-frumvorp`), a third `SourceDef.kind` value
(`"travaux"`), and the linkage in its own tables — `ActPrepWorkLink` and
`ProvisionPrepWorkLink`, the latter carrying which article of the bill's
commentary, mirroring how `CaseProvisionLink` stores the excerpt and not just
the edge.

Two things this must get right:

- **The well needs a new authority tier.** `KIND_WEIGHT` in
  `src/lib/ask/rank.ts` today reads `provision: 1, decision: 0.7, opinion: 0.5,
  act: 0.4, commentary: 0`. Travaux are none of those. They are subordinate to
  the enacted text and above case law *on the single question of legislative
  intent*, and worth roughly nothing on any other question. A flat weight will
  be wrong in both directions; this wants its own slot and probably a
  query-dependent one.
- **Travaux are not law, and the UI must not let anyone read them as law.** An
  explanatory memorandum describes a bill that Alþingi then amended. The
  greinargerð for a clause that was struck in committee still exists and still
  reads authoritative. Every travaux surface needs to say which bill, which
  þing, and whether the article survived — and the well must never state a
  proposition of law with only a travaux citation behind it.

### 2.5 Suggested phasing

1. ~~**Now, unblocked:** persist the footnotes and the two links from the
   Lagasafn parse, and show them on the act reader.~~ **Shipped.** Zero new
   fetches; the one cost is a single ~900-act re-fetch when `PARSE_VERSION`
   rolls, which the run announces before it starts.
2. Settle the 403 from production (§2.2).
3. Ingest the ~900 original bills; link act → bill; render on the act reader.
4. Parse *"athugasemdir við einstakar greinar"* into per-article sections; link
   provision → commentary through the footnote chain in §2.1. This is the step
   that makes the feature worth building.
5. Amending bills, then nefndarálit. Umsagnir and ræður probably never.

---

## 3. Acts no longer in force

Asked for as pros and cons, so: here they are, and then the thing I would
actually do.

### 3.1 The case for

- **The app is currently, quietly wrong about old judgments.** A 2005 judgment
  applied the 2005 text of an article. We link it to the *current* text of that
  article. Wherever the article has been amended since — and 91/1991 has 236
  such footnotes — the passage a reader is shown is not the passage the court
  construed. Historical text is the only fix. This is a correctness argument,
  not a feature argument, and it is much the strongest thing on this list.
- **Citations to repealed acts resolve to nothing today.** A judgment citing
  lög nr. 19/1940 produces no `CaseProvisionLink` at all, so the case appears to
  cite nothing. The gap is invisible, which is the worst kind.
- **Succession chains.** "This is now 5. gr. laga nr. 88/2008" is a question the
  well cannot answer at all right now.
- **Transitional law is real law.** Lex mitior in criminal cases, tax years
  under the rules as they stood, procedural regimes for cases already filed.
- **The well would stop being silently incomplete.** "That act was repealed in
  2008; the rule is now…" is a better answer than an answer that does not
  mention it.

### 3.2 The case against

- **The safety cost is the real cost.** Everything this app does is framed
  "the law in force". Put repealed provisions in the same reader, the same
  search results and the same AI answers, and someone will read superseded law
  as current. Mitigating that is not a badge — it is status on every surface, a
  different reader treatment, retrieval that excludes historical text unless
  asked, and a well that refuses to state repealed law in the present tense.
  That is most of the work, and none of it is the ingest.
- **The schema has no time dimension at all.** `Act` and `Provision` model *the
  current text*, full stop. Point-in-time law needs `validFrom`/`validTo` on
  provisions, a versioned provision identity, and `CaseProvisionLink` pointing
  at a *version* rather than a provision. That is a migration through the most
  load-bearing tables in the app.
- **Provision identity does not survive renumbering.** `Provision.anchor` is
  stable within a codex edition, not across them. Articles are inserted,
  lettered and renumbered. Linking a 1998 judgment to the 1998 text means
  resolving "5. gr. as it then was", which is not the same object as today's.
- **The source is much worse.** Lagasafn's `/nuna/` index — our whole basis for
  "what exists" — is in-force only, by construction. Historical text means
  either per-codex snapshots (≈30 editions × ~900 acts, mostly near-duplicates)
  or Stjórnartíðindi's original act texts, which are *unconsolidated*: to get
  "the text as at 1998-06-01" you would have to apply amendments yourself. That
  is a legal-publishing product, not an adapter.
- **Search dilution.** Most historical provision text is near-identical to
  current text. Adding it makes every provision search noisier and gives the
  well's retrieval superseded passages to quote, which is precisely the failure
  mode the citation-checking in `verify.ts` exists to prevent.

### 3.3 The asymmetry worth noticing

The pros are nearly all about **knowing that something exists and what became
of it**. The cons are nearly all about **storing and displaying its text**.

Those are separable, and separating them is most of the value for almost none
of the cost.

### 3.4 What I would actually do — three tiers

**Tier 1 — repealed-act stubs. Recommended, build whenever there is room.**
Number, year, title, when it took effect, when it was repealed, what repealed
it, link to Stjórnartíðindi. **No provision text.** `Act.status` already exists
and already documents this intent: *"the field exists so they can be
represented later without a migration."* This kills the dangling-citation
problem, lets a judgment page say "cites lög nr. 19/1940 (fallin úr gildi
1940→2008; now lög nr. 88/2008)", gives the well the succession facts, and
dilutes nothing because there is no text to retrieve. No schema change beyond a
couple of date columns.

**Tier 2 — demand-driven historical text.** Only acts that judgments in *this*
corpus actually cite in a repealed form, and within those, only the provisions
actually cited. The `CaseProvisionLink` misses from tier 1 tell you exactly
which those are — the corpus writes its own work list. Probably a few dozen
acts and a few hundred provisions, which makes the time-dimension schema work
tractable and testable instead of speculative.

**Tier 3 — full historical codex.** Only if the app's purpose changes from
"search the law in force and the case law applying it" to "trace Icelandic law
through time". That is a different product with a different safety story, and
it should be a decision, not a drift.

Tier 1 and Tier 2 together answer every "pro" in §3.1 except the deepest one —
showing a 2005 judgment the 2005 text of an article nobody has since litigated.
That one is genuinely Tier 3, and it is worth being honest that it stays
unsolved.

---

## Open questions

1. **reglugerð ingest:** proceed on the web pages at the published crawl-delay
   while island.is is asked about the API, or wait for the answer? (§1.4)
2. **Structure coverage:** is a searchable-but-unstructured three-quarters of
   the regulation corpus acceptable, given it means no provision-level case
   linking there? (§1.3)
3. **Althingi 403:** can someone run one request to `/altext/xml/` from the
   production ingest? Everything in §2 downstream of §2.5 step 1 depends on the
   answer. (§2.2)
4. **Travaux scope:** original bills only to start, or original + amending
   bills? The second is where the volume and most of the interpretive value
   both are. (§2.3)

## Re-running the measurements

```bash
# Register size and composition
curl -s 'https://api.reglugerd.is/api/v1/regulations/newest?page=1' | head -c 400
# → totalItems 14648, totalPages 489. Sample random pages for base/amending split.

# Text availability: sample /current across the register and count `text` vs stub
curl -s 'https://api.reglugerd.is/api/v1/regulation/0112-2012/current'   # structured
curl -s 'https://api.reglugerd.is/api/v1/regulation/0822-2004/current'   # stub

# Structured vs Word-soup pages
curl -s 'https://www.reglugerd.is/reglugerdir/allar/nr/0950-2026' | grep -c article__title  # newer: >0
curl -s 'https://www.reglugerd.is/reglugerdir/allar/nr/0359-1993' | grep -c 'Section1'      # older: soup

# The Althingi links we already download and discard
curl -s 'https://www.althingi.is/lagas/nuna/1991091.html' | grep -o 'Ferill málsins á Alþingi'
curl -s 'https://www.althingi.is/lagas/nuna/1991091.html' | grep -oE 'L\. [0-9]{1,3}/[0-9]{4}, [0-9]{1,3}\. gr\.' | wc -l   # → 236

# The 403, and that it is path-based
curl -s -o /dev/null -w '%{http_code}\n' 'https://www.althingi.is/lagas/nuna/1991091.html'   # 200
curl -s -o /dev/null -w '%{http_code}\n' 'https://www.althingi.is/altext/115/s/0072.html'    # 403
```
