/**
 * The Lagasafn parser, against two real acts frozen from althingi.is.
 * See `src/lib/__fixtures__/README.md` for why the fixtures are real
 * responses and how to add another.
 *
 * Assertions are deliberately structural rather than exact. Alþingi amends
 * these acts; a test that pins `provisions.length === 53` fails on the next
 * amendment, which trains everyone to ignore it. What must not change is the
 * *shape* the parser recovers — anchors resolving, chapters holding their
 * articles, lettered articles being found at all — and that breaks only when
 * the markup does, which is exactly what a fixture is for.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseLagasafnHtml,
  parseActSlug,
  parseFerillUrl,
  splitFootnotes,
  actPath,
  actUrl,
  normalizeLawText,
  type ParsedAct,
  type ParsedProvision,
} from "@/lib/lagasafn";

const FIXTURES = join(process.cwd(), "src/lib/__fixtures__/lagasafn");

function fixture(name: string): ParsedAct {
  return parseLagasafnHtml(gunzipSync(readFileSync(join(FIXTURES, name))).toString("utf8"));
}

describe("vaxtalög (38/2001)", () => {
  const act = fixture("2001038.html.gz");

  test("reads its identity off the page", () => {
    assert.equal(act.actNumber, 38);
    assert.equal(act.year, 2001);
    assert.equal(act.title, "Lög um vexti og verðtryggingu");
  });

  test("records the codex version the text was parsed from", () => {
    // What tells a stored act it is out of date against a Lagasafn update.
    assert.match(act.codexVersion ?? "", /^\d+[a-z]?$/);
  });

  test("recovers the chapter structure", () => {
    assert.ok(act.chapters.length >= 8, `only ${act.chapters.length} chapters`);
    assert.ok(act.chapters.every((c) => c.label), "every chapter needs a label");
  });

  test("every article carries a Lagasafn anchor and at least one paragraph", () => {
    // The anchors are what let a provision deep-link into the official text;
    // a provision with none is a provision nobody can cite.
    const articles = act.provisions.filter((p) => p.kind === "article" && !p.isRepealed);
    assert.ok(articles.length > 0);
    for (const p of articles) {
      assert.match(p.anchor, /^G\d/, `${p.displayLabel} has no article anchor`);
      assert.ok(p.paragraphs.length > 0, `${p.displayLabel} parsed with no paragraphs`);
    }
  });

  test("paragraph anchors are the ones althingi.is actually publishes", () => {
    // "G7AM1" — article 7 a, paragraph 1. Deep-linking depends on the exact form.
    const withParagraphs = act.provisions.find((p) => p.paragraphs.length > 1);
    assert.ok(withParagraphs);
    for (const para of withParagraphs.paragraphs) {
      assert.match(para.anchor, /^[GB]\d+[A-ZÞÆÖ]*M\d+$/, para.anchor);
    }
  });

  test("temporary provisions parse as temporary, numbered in roman", () => {
    // "Ákvæði til bráðabirgða" carry no <span> anchor and are labelled with
    // roman numerals rather than "N. gr.".
    const temporary = act.provisions.filter((p) => p.kind === "temporary");
    assert.ok(temporary.length > 0, "38/2001 has temporary provisions");
    for (const p of temporary) {
      assert.match(p.displayLabel, /^[IVXL]+\.$/, p.displayLabel);
      assert.match(p.anchor, /^B\d/, p.anchor);
    }
  });

  test("a repealed article is kept and flagged, not dropped", () => {
    // Judgments still cite provisions that have since been repealed.
    assert.ok(act.provisions.some((p) => p.isRepealed));
  });

  test("provisions are in document order", () => {
    const numbers = act.provisions
      .filter((p) => p.kind === "article")
      .map((p) => Number(/^(\d+)/.exec(p.displayLabel)?.[1]));
    assert.deepEqual(numbers, [...numbers].sort((a, b) => a - b));
  });
});

describe("jarðalög (81/2004)", () => {
  const act = fixture("2004081.html.gz");

  test("reads its identity off the page", () => {
    assert.equal(act.actNumber, 81);
    assert.equal(act.year, 2004);
    assert.equal(act.title, "Jarðalög");
  });

  /**
   * Articles inserted by amendment are lettered. Lagasafn encodes the letter
   * structurally — `G7A` is "7. gr. a" — which is what makes them addressable
   * rather than only printable, and they are the shape that
   * lib/legal-citations.ts silently failed to extract until 2026-08-31.
   */
  test("parses articles inserted by amendment", () => {
    const lettered = act.provisions.filter((p) => /^\d+\. gr\. [a-záðéíóúýþæö]\.?$/.test(p.displayLabel));
    assert.ok(lettered.length >= 4, `expected the 7. gr. a–d run, got ${lettered.length}`);
    assert.ok(lettered.some((p) => p.displayLabel.startsWith("7. gr. a")));
    for (const p of lettered) {
      assert.match(p.anchor, /^G\d+[A-ZÞÆÖ]$/, `${p.displayLabel} → ${p.anchor}`);
    }
  });

  test("per-article headings are kept separate from the body", () => {
    const first = act.provisions.find((p) => p.displayLabel.startsWith("1. gr."));
    assert.equal(first?.heading, "Markmið");
    const definitions = act.provisions.find((p) => p.displayLabel.startsWith("2. gr."));
    assert.equal(definitions?.heading, "Skilgreiningar");
  });

  test("the definitions article keeps its terms as separate paragraphs", () => {
    // Each defined term is its own málsgrein. This is the structure a
    // definitions index would be built from.
    const definitions = act.provisions.find((p) => p.heading === "Skilgreiningar");
    assert.ok((definitions?.paragraphs.length ?? 0) > 5);
  });

  test("an annex parses as an annex", () => {
    assert.ok(act.provisions.some((p) => p.kind === "annex"));
  });

  test("no provision comes back with an empty label", () => {
    for (const p of act.provisions) assert.ok(p.displayLabel.trim(), `empty label at ${p.anchor}`);
  });
});

describe("both fixtures", () => {
  const acts = [fixture("2001038.html.gz"), fixture("2004081.html.gz")];

  test("every provision's chapter index, where set, points at a real chapter", () => {
    // chapterIndex is an index into act.chapters, so an off-by-one puts a
    // provision under the wrong heading — or, past the end, under none.
    for (const act of acts) {
      for (const p of act.provisions) {
        if (p.chapterIndex === null) continue;
        assert.ok(
          Number.isInteger(p.chapterIndex) &&
            p.chapterIndex >= 0 &&
            p.chapterIndex < act.chapters.length,
          `${p.displayLabel} → chapter ${p.chapterIndex} of ${act.chapters.length}`
        );
      }
    }
  });

  test("chapter membership follows document order", () => {
    // Chapters have no anchor, so membership is derived from position. If it
    // ever goes backwards, the derivation has lost its place.
    for (const act of acts) {
      const indices = act.provisions
        .map((p) => p.chapterIndex)
        .filter((i): i is number => i !== null);
      assert.deepEqual(indices, [...indices].sort((a, b) => a - b));
    }
  });

  test("an annex has no article number the citation linker could resolve", () => {
    // Annexed treaty text carries its own "1. gr." numbering, which is not
    // the act's. Resolving "5. gr. laga nr. 62/1994" to an annex article that
    // merely shares a number would be a wrong link, not a missing one.
    for (const act of acts) {
      for (const p of act.provisions.filter((p) => p.kind === "annex")) {
        assert.equal(p.articleNumber, null, p.displayLabel);
      }
    }
  });

  test("amendment footnotes are captured, not left in the paragraph text", () => {
    // "L. 74/2022, 2. gr." — the provenance every provision carries, and the
    // raw material for an amendment history.
    const withFootnotes = acts.flatMap((a) => a.provisions).filter((p) => p.footnotes.length > 0);
    assert.ok(withFootnotes.length > 0, "both acts have been amended");
    for (const p of withFootnotes) {
      for (const f of p.footnotes) assert.ok(f.trim(), `empty footnote on ${p.displayLabel}`);
    }
  });

  test("no anchor is used twice", () => {
    for (const act of acts) {
      const anchors = act.provisions.map((p) => p.anchor);
      assert.equal(new Set(anchors).size, anchors.length, "duplicate provision anchor");
    }
  });

  test("no paragraph text still carries markup or a non-breaking space", () => {
    for (const act of acts) {
      for (const p of act.provisions) {
        for (const para of p.paragraphs) {
          assert.ok(!para.text.includes("<"), `markup leaked into ${p.displayLabel}`);
          assert.ok(!/[   ]/.test(para.text), `nbsp left in ${p.displayLabel}`);
        }
      }
    }
  });
});

describe("slugs and URLs", () => {
  test("round-trips an act slug", () => {
    assert.deepEqual(parseActSlug("38-2001"), { actNumber: 38, year: 2001 });
    assert.equal(actPath(38, 2001), "/log/38-2001");
  });

  test("rejects what is not a slug", () => {
    for (const bad of ["nonsense", "38-2001-x", "", "38"]) {
      assert.equal(parseActSlug(bad), null, bad);
    }
  });

  test("the official URL is the zero-padded Lagasafn form", () => {
    // 38/2001 lives at /lagas/nuna/2001038.html — year first, number padded.
    assert.match(actUrl(38, 2001), /2001038\.html$/);
  });
});

describe("normalizeLawText", () => {
  test("collapses runs of spaces without eating Icelandic letters", () => {
    assert.equal(normalizeLawText("  þjóð   lenda  æðarvarp "), "þjóð lenda æðarvarp");
  });

  test("keeps line breaks — they separate paragraphs — but trims around them", () => {
    assert.equal(normalizeLawText("fyrsta  \n   önnur"), "fyrsta\nönnur");
  });

  test("replaces the non-breaking spaces Lagasafn is full of", () => {
    // A citation split by an nbsp does not match the citation patterns, and
    // the same text stored twice with different space characters hashes
    // differently — so the act looks changed on every ingest.
    assert.equal(normalizeLawText("175. gr."), "175. gr.");
  });

  test("composes decomposed Icelandic letters", () => {
    // A decomposed letter would not equal its composed form in the search
    // index or in the source hash that decides whether an act changed.
    const decomposed = "þjóð".normalize("NFD");
    assert.notEqual(decomposed, "þjóð");
    assert.equal(normalizeLawText(decomposed), "þjóð");
  });
});

/**
 * The two things a Lagasafn page carries about where an act came from, and
 * which this app discarded until now: the links to Alþingi, and the footnotes
 * saying which act amended which article.
 *
 * Both are the input to preparatory works. Matching an act to its þingmál by
 * number and title is guesswork; these are anchors Alþingi publishes on the
 * act's own page, and the assertions here are that we still find them.
 */
describe("the Alþingi trail on a Lagasafn page", () => {
  const act = fixture("2004081.html.gz");

  test("finds the act's ferill on the parliamentary record", () => {
    assert.ok(act.ferillUrl, "no ferill link found");
    assert.match(act.ferillUrl, /althingi\.is\/thingstorf\/.*\/ferill\/\?/);
    // The two numbers that address Alþingi's own XML service.
    const ferill = parseFerillUrl(act.ferillUrl);
    assert.ok(ferill);
    assert.ok(ferill.parliament > 0 && ferill.caseNumber > 0);
  });

  test("finds the bill the act was passed from", () => {
    assert.ok(act.billUrl, "no bill link found");
    // /altext/{þing}/s/{skjal}.html for recent þing; the older ones are
    // published only as scans under /altext/pdf/.
    assert.match(act.billUrl, /althingi\.is\/altext\/(pdf\/)?\d+\/s\/\d+\.(html|pdf)$/);
  });

  test("links are absolute, so they are openable from this app", () => {
    for (const url of [act.ferillUrl, act.billUrl]) {
      assert.match(url ?? "", /^https:\/\//);
    }
  });

  test("provisions carry their amendment footnotes, one entry per note", () => {
    const withNotes = act.provisions.filter((p) => p.footnotes.length > 0);
    assert.ok(withNotes.length > 10, `only ${withNotes.length} provisions had footnotes`);
    // The point of splitting: a provision amended twice yields two entries,
    // not one string holding both. Without this, "which act last touched this
    // article" cannot be answered from the stored value.
    const several = act.provisions.find((p) => p.footnotes.length > 1);
    assert.ok(several, "no provision parsed with more than one footnote");
    for (const note of several.footnotes) {
      assert.match(note, /^\d+\) \S/, note);
    }
  });

  test("footnotes do not bleed into the provision text", () => {
    // They sit in the markup after the last paragraph; a parser that let them
    // through would put "1) L. 74/2022, 2. gr." inside the law itself.
    for (const p of act.provisions) {
      assert.ok(!/L\. \d+\/\d{4}, \d+\. gr\.$/.test(p.fullText), p.displayLabel);
    }
  });
});

describe("splitFootnotes", () => {
  test("splits the glued run Lagasafn serves into one entry per note", () => {
    assert.deepEqual(splitFootnotes("1)L. 159/2008, 1. gr. 2)L. 8/2015, 9. gr."), [
      "1) L. 159/2008, 1. gr.",
      "2) L. 8/2015, 9. gr.",
    ]);
  });

  test("keeps notes that are not amendments at all", () => {
    // Lagasafn footnotes the regulations set under an article here too, which
    // is why the field is `footnotes` and not `amendmentFootnotes`.
    const notes = splitFootnotes("1)L. 126/2011, 322. gr. 2)Rgl. 492/2001, sbr. rgl. 278/2010.");
    assert.equal(notes.length, 2);
    assert.match(notes[1], /^2\) Rgl\. 492\/2001/);
  });

  test("a year inside a note is not read as the next marker", () => {
    // "278/2010," has a digit run and a slash but no close paren, and the
    // marker test also requires a capital letter to follow.
    const notes = splitFootnotes("1)Rgl. 492/2001, sbr. rgl. 278/2010, rgl. 369/2010.");
    assert.equal(notes.length, 1);
  });

  test("keeps an unmarked note rather than dropping it", () => {
    assert.deepEqual(splitFootnotes("L. 74/2022, 2. gr."), ["L. 74/2022, 2. gr."]);
  });

  test("collapses the line breaks Lagasafn wraps long notes with", () => {
    assert.deepEqual(splitFootnotes("1)Rgl. 492/2001,\n  sbr.\n rgl. 278/2010."), [
      "1) Rgl. 492/2001, sbr. rgl. 278/2010.",
    ]);
  });

  test("is empty for a provision with no notes", () => {
    assert.deepEqual(splitFootnotes("   "), []);
  });
});

describe("parseFerillUrl", () => {
  test("reads the þing and the case number", () => {
    assert.deepEqual(
      parseFerillUrl("https://www.althingi.is/thingstorf/thingmalalistar-eftir-thingum/ferill/?ltg=115&mnr=71"),
      { parliament: 115, caseNumber: 71 }
    );
  });

  test("survives the HTML-escaped ampersand Lagasafn writes", () => {
    assert.deepEqual(parseFerillUrl("/ferill/?ltg=115&amp;mnr=71"), {
      parliament: 115,
      caseNumber: 71,
    });
  });

  test("returns null rather than half an answer", () => {
    for (const bad of ["", "/ferill/?ltg=115", "https://www.althingi.is/lagas/nuna/1991091.html"]) {
      assert.equal(parseFerillUrl(bad), null, bad);
    }
  });
});

describe("an annexed treaty (lög nr. 2/1993, which prints the EEA Agreement)", () => {
  const act = fixture("1993002.html.gz");

  test("the act's own articles are unaffected", () => {
    const own = act.provisions.filter((p) => p.kind === "article");
    assert.equal(own.length, 5);
    assert.equal(own[0].anchor, "G1");
    // 2. gr. is the one that gives the Agreement lagagildi, and the reason this
    // act is where the Icelandic text lives.
    assert.match(own[1].fullText, /Meginmál EES-samningsins skal hafa lagagildi/);
  });

  /** Fylgiskjal I — the Agreement's own main text, and what the fix is about. */
  const inAnnexOne = (p: ParsedProvision) =>
    p.kind === "annex" &&
    p.chapterIndex !== null &&
    /^Fylgiskjal I(?![IVXLCDM])/.test(act.chapters[p.chapterIndex]?.label ?? "");

  test("the annexed text has text", () => {
    // It did not. Lagasafn prints the paragraph marker inside a fylgiskjal with
    // no id, and a paragraph with no anchor was dropped along with everything in
    // it — so all 129 articles of the Agreement were stored as bare labels.
    const agreement = act.provisions.filter(inAnnexOne);
    assert.ok(agreement.length >= 129, `only ${agreement.length} articles in fylgiskjal I`);
    assert.deepEqual(
      agreement.filter((p) => p.fullText.trim().length === 0).map((p) => p.displayLabel),
      []
    );
    assert.ok(
      agreement.reduce((n, p) => n + p.fullText.length, 0) > 50_000,
      "the annexed text is too short to be the Agreement"
    );
  });

  test("and is therefore no longer shown as repealed", () => {
    // `isRepealed` is computed from an empty body, because an empty body is how
    // Lagasafn writes a repealed provision. With the text dropped, every annexed
    // article qualified — the reader showed the whole EEA Agreement as struck
    // out.
    assert.deepEqual(
      act.provisions.filter(inAnnexOne).filter((p) => p.isRepealed).map((p) => p.displayLabel),
      []
    );
  });

  test("an article the fylgiskjal does not reproduce is still elided", () => {
    // Two provisions of fylgiskjal V — the protocol amending the Agreement — are
    // printed as a bare "…" with a footnote saying what they were about. That is
    // Lagasafn stating the text is not reproduced, and it must keep reading as
    // elided: the paragraph-anchor fix recovers text that was there, and must
    // not invent text that is not.
    const elided = act.provisions
      .filter((p) => p.kind === "annex" && p.fullText.trim().length === 0)
      .map((p) => p.displayLabel);
    assert.deepEqual(elided, ["2.–7. gr.", "15. gr."]);
    const first = act.provisions.find((p) => p.displayLabel === "2.–7. gr.");
    assert.equal(first?.isRepealed, true);
    assert.deepEqual(first?.footnotes, ["1) Ákvæði um breytingar á EES-samningi."]);
  });

  test("every annexed paragraph has an anchor of its own", () => {
    // Synthesised, and unique within the provision: ProvisionParagraph is keyed
    // (provisionId, anchor), so a repeated anchor is a write that fails at the
    // database rather than a rendering nobody notices.
    for (const p of act.provisions) {
      const anchors = p.paragraphs.map((par) => par.anchor);
      assert.equal(new Set(anchors).size, anchors.length, `${p.displayLabel} repeats an anchor`);
      for (const anchor of anchors) {
        assert.match(anchor, /^[A-Z][A-Z0-9]*M\d+$/, `${p.displayLabel}: ${anchor}`);
      }
    }
  });

  test("the annex keeps its own divisions, under the fylgiskjal they are in", () => {
    // The Agreement divides itself into hluti and kaflar, and an arabic
    // "1. kafli." is not how Lagasafn numbers an act's chapters — so these
    // rules cannot reach the act's own structure. The label carries the
    // fylgiskjal because "1. kafli" read as a chapter of lög nr. 2/1993 would
    // be a claim about the act that is not true.
    assert.ok(act.chapters.some((c) => /^Fylgiskjal I$/.test(c.label)));
    assert.ok(
      act.chapters.some((c) => c.label === "Fylgiskjal I — I. hluti"),
      act.chapters.slice(0, 5).map((c) => c.label).join(" | ")
    );
    assert.ok(act.chapters.some((c) => c.label === "Fylgiskjal I — II. hluti — 1. kafli"));
    // Fylgiskjal II is bókun 1, whose articles are numbered from 1 like the
    // Agreement's: they must not end up under fylgiskjal I.
    assert.ok(act.chapters.some((c) => /^Fylgiskjal II\b/.test(c.label)));
  });

  test("an annexed article is still not an article of the act", () => {
    // `articleNumber` stays null on annexed material, which is what stops the
    // citation linker resolving "5. gr. laga nr. 2/1993" to the fifth article
    // of the Agreement. The Agreement's own articles are reachable through the
    // treaty row instead — see src/lib/treaties.ts.
    const annex = act.provisions.filter((p) => p.kind === "annex");
    assert.deepEqual(
      annex.filter((p) => p.articleNumber !== null).map((p) => p.displayLabel),
      []
    );
  });
});
