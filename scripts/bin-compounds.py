#!/usr/bin/env python3
"""
Resolves the corpus words BÍN does not know, using Miðeind's BinPackage.

    npm run db:load-bin -- --unknown unknown.txt
    pip install islenska
    python3 scripts/bin-compounds.py unknown.txt > extra.tsv
    npm run db:load-bin -- --extra extra.tsv --rebuild

WHY THIS IS A SEPARATE, OPTIONAL SCRIPT

BinPackage is the best Icelandic morphology tool there is, and it is a Python
library with no CLI and no bulk-export API — you can ask it about a word, but
you cannot ask it for its contents. This app is TypeScript. So it cannot be the
runtime lemmatiser here, and it cannot generate `bin_lemma` either: that comes
from BÍN's published CSV, loaded by prisma/load-bin.ts, and needs no Python at
all.

What BinPackage can do that the CSV cannot is decompose a compound BÍN has
never seen. Icelandic legal prose builds those constantly:

    ríkisborgararéttarumsókninni  ->  ríkisborgararéttar-umsókn
    málsmeðferðarreglnanna        ->  málsmeðferðarregla

BÍN holds ~348,000 lemmas; the words above are not among them, and without a
decomposition they are indexed under themselves and found by nothing. So Python
runs here — offline, over a finite word list, never in a request — and its
output is merged into the same table.

Skipping this step costs recall on the long tail and nothing else. The
dictionary works without it.

ATTRIBUTION (a licence condition of BÍN, which BinPackage embeds):

    Beygingarlýsing íslensks nútímamáls. Stofnun Árna Magnússonar í íslenskum
    fræðum. Höfundur og ritstjóri Kristín Bjarnadóttir.

BÍN is CC BY-SA 4.0. BinPackage itself is MIT, © Miðeind ehf.

Output: one `form<TAB>lemma` pair per line, for --extra. Words BinPackage
cannot resolve are left out rather than guessed at; a wrong lemma is worse than
a missing one, because it makes a word findable under something it does not
mean.
"""
import sys


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__, file=sys.stderr)
        return 2

    try:
        from islenska import Bin
    except ImportError:
        print(
            "islenska is not installed. Run: pip install islenska",
            file=sys.stderr,
        )
        return 1

    bin_ = Bin()
    resolved = unresolved = 0

    with open(sys.argv[1], encoding="utf-8") as fh:
        for line in fh:
            word = line.strip()
            if not word:
                continue

            _key, matches = bin_.lookup(word)
            if not matches:
                unresolved += 1
                continue

            # A decomposition marks the compound boundary with a hyphen
            # ("ríkisborgararéttar-umsókn"); the searchable lemma is that
            # without the marker. Sorted and de-duplicated so a rerun over the
            # same list produces the same file.
            lemmas = sorted({m.ord.replace("-", "") for m in matches if m.ord})
            if not lemmas:
                unresolved += 1
                continue

            # One lemma per form, matching what lemmaQuery in src/lib/lemma.ts
            # will actually use. The first alphabetically, so the choice is
            # stable rather than dependent on lookup order.
            print(f"{word}\t{lemmas[0]}")
            resolved += 1

    print(
        f"{resolved:,} resolved, {unresolved:,} left alone.",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
