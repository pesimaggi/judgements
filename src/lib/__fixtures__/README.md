# Fixtures

Real documents, frozen, so a parser can be tested against what the sites
actually publish rather than against what we remember them publishing.

Every fixture is one gzipped response captured from the live source, recorded
in `manifest.json` with its URL and the date it was captured. Nothing here is
hand-written: a fixture that has been tidied up tests the tidying, not the
parser.

## Why

The parsers in `src/lib` and `src/ingestion/adapters` read markup nobody
promises to keep stable. When a site is redesigned the fetch still returns 200
and the parse still "succeeds" — it just returns less, or the wrong thing, and
the first sign of it is a gap in the corpus weeks later.

A frozen fixture turns that into a failing test on the next `npm test`, and it
does it without hitting the network, so the suite runs in CI and offline.

Two bugs in this repo's history were of exactly this shape: Félagsdómur
headings left letter-spaced (`D Ó M U R`), and the pre-2010 half of that court
filing its *parties* as subject tags because the field that holds index terms
for every other body on stjornarradid.is holds something else for this one.
Both were found by reading output by hand.

## Adding one

```bash
curl -sS "https://www.althingi.is/lagas/nuna/2004081.html" \
  | gzip -9 > src/lib/__fixtures__/lagasafn/2004081.html.gz
```

Then add a `manifest.json` entry with the URL and capture date, and assert
against structure rather than exact counts where you can — `provisions.length
=== 53` breaks every time Alþingi amends the act, which is noise, not a
regression. Assert instead that the lettered articles are present, that the
temporary provisions parsed as `temporary`, that no provision came back
without paragraphs. Those hold across amendments and break on a redesign,
which is the distinction worth encoding.

Keep them small. One document per shape, not per source.

## Coverage

| Parser | Fixtures | Status |
|---|---|---|
| `lib/lagasafn.ts` | 2 acts | covered |
| `lib/judgment-text.ts` | — | unit-tested against reconstructed cases; no frozen judgment yet |
| the 14 ingestion adapters | — | none yet |

The adapters are the gap. Each one wants a single frozen listing page and a
single frozen document page; `lagasafn.test.ts` is the pattern to copy.
