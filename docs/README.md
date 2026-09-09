# docs

Five files, and it is not obvious from the names which are describing today and
which are describing a decision made once. That is what this index is for.

| File | What it is | Trust it for |
|---|---|---|
| **[ai-answer-evaluation.md](ai-answer-evaluation.md)** | A human-reviewed log of real AI answers, scored by hand. Live and actively being added to. | What the well is doing *now*, and what is wrong with it. This is where the current round of work is judged. |
| **[well-roadmap.md](well-roadmap.md)** | The plan for making the well competitive, and the diagnosis behind it. Roughly half has shipped — read its *Where this stands* table first. | Why a thing was done, and what is left. Its diagnosis sections are written in the present tense about problems that are in several cases fixed. |
| **[icelandic-lemmatisation.md](icelandic-lemmatisation.md)** | How the search index learned that Icelandic words inflect: BÍN, the two vectors, the trade-offs, the measured costs. Current. | How lemma matching works today, and how to run or extend it. |
| **[search-evaluation.md](search-evaluation.md)** | The automated search evaluation — its two kinds of case, the assertions, and the inflection cases. Current. | How to measure a search or ranking change. |
| **[phase-0-acts-provisions.md](phase-0-acts-provisions.md)** | A finished research spike from August 2026, before acts and provisions were built. Everything it proposed has shipped. | The Lagasafn HTML contract and the citation-pattern traps — findings that are still true and expensive to rediscover. **Not** for how the feature behaves now; the README is that. |

**The README is the live documentation.** These files exist for the reasoning
that does not belong in it: measurements, dead ends, and the arguments behind
decisions that are now just how the app works.

## Which to read for a given question

- *What is broken about the AI's answers?* → ai-answer-evaluation.md
- *What should I work on next?* → well-roadmap.md, §9
- *Why does search find `stjórnsýslulögum` when I typed `stjórnsýslulög`?* → icelandic-lemmatisation.md
- *I changed ranking — did I break anything?* → search-evaluation.md
- *How does the app work?* → the root README, not here.
