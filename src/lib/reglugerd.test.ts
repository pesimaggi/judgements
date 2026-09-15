/**
 * The regulation parser, against five real responses frozen from
 * reglugerd.is. See `src/lib/__fixtures__/README.md`.
 *
 * Assertions are structural rather than exact, as the Lagasafn ones are: a
 * ministry amends a regulation and a test pinning `provisions.length === 44`
 * fails on the next amendment, which trains everyone to ignore it. What must
 * not change is the shape the parser recovers from each of the two markup
 * generations — and *which* generation it thinks it is looking at, since that
 * is what the app tells its readers about how far to trust the divisions.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseRegulationBody,
  extractRegulationBody,
  detectStructure,
  parseRegulationName,
  parseArticleLabel,
  regulationSlug,
  regulationUrl,
  normalizeRegulationText,
} from "@/lib/reglugerd";
import {
  parseRegisterPage,
  parseRegulationRecord,
  hashRegulation,
} from "@/ingestion/adapters/reglugerd";

const FIXTURES = join(process.cwd(), "src/lib/__fixtures__/reglugerd");
const raw = (name: string): string =>
  gunzipSync(readFileSync(join(FIXTURES, name))).toString("utf8");
const json = (name: string): unknown => JSON.parse(raw(name));

describe("reglugerð nr. 300/2020 (Vatnajökulsþjóðgarður) — the API's structured text", () => {
  const record = parseRegulationRecord(json("api-0300-2020.json.gz"))!;
  const parsed = parseRegulationBody(record.text!, record.title);

  test("the record reads as a base regulation with its amendments folded in", () => {
    assert.equal(record.number, 300);
    assert.equal(record.year, 2020);
    assert.equal(record.type, "base");
    assert.equal(record.repealed, false);
    // `history` is the amending regulations already in the consolidated text.
    // They are the reason those regulations are never stored on their own.
    assert.ok(record.amendedBy.length > 0, "no amending regulations recorded");
    assert.ok(record.amendedBy.every((n) => /^\d{4}\/\d{4}$/.test(n)), record.amendedBy.join());
  });

  test("carries the metadata the reader shows", () => {
    assert.match(record.ministry ?? "", /ráðuneyti/);
    assert.ok(record.publishedDate, "no publication date");
    assert.ok(record.effectiveDate, "no entry into force");
    assert.match(record.originalDocUrl ?? "", /^https:\/\/.*\.pdf$/);
    assert.ok(record.subjectChapters.length > 0);
  });

  test("markup the publisher wrote is read as structured", () => {
    assert.equal(parsed.structure, "structured");
    assert.equal(detectStructure(record.text!), "structured");
  });

  test("recovers chapters and articles", () => {
    assert.ok(parsed.chapters.length >= 5, `only ${parsed.chapters.length} chapters`);
    assert.ok(parsed.provisions.length >= 30, `only ${parsed.provisions.length} articles`);
    assert.ok(parsed.chapters.every((c) => c.label));
  });

  test("every article carries a number, a label and text", () => {
    for (const p of parsed.provisions) {
      assert.match(p.displayLabel, /gr\.?$/, p.displayLabel);
      assert.ok(p.articleNumber !== null, `${p.displayLabel} has no article number`);
      assert.ok(p.fullText.length > 0, `${p.displayLabel} parsed with no text`);
      assert.ok(p.paragraphs.length > 0, `${p.displayLabel} parsed with no paragraphs`);
    }
  });

  test("anchors are derived from the article number, not from position", () => {
    // Stability is the whole point: CaseProvisionLink cascades from Provision,
    // so a positional key would throw every judgment link on the regulation
    // away the next time an amendment inserted an article above it.
    const first = parsed.provisions[0];
    assert.equal(first.anchor, `A${first.articleNumber}`);
    const anchors = parsed.provisions.map((p) => p.anchor);
    assert.equal(new Set(anchors).size, anchors.length, "anchors are not unique");
  });

  test("articles are attached to the chapter they sit under", () => {
    assert.ok(parsed.provisions.some((p) => p.chapterIndex !== null));
    for (const p of parsed.provisions) {
      if (p.chapterIndex === null) continue;
      assert.ok(parsed.chapters[p.chapterIndex], `${p.displayLabel} points at no chapter`);
    }
  });

  test("the enabling act is in the text, for the lagastoð link that comes next", () => {
    // "Reglugerð þessi, sem sett er samkvæmt 7. … gr. laga nr. 60/2007 …".
    // Not linked yet; this asserts the sentence survives the parse, which is
    // what any later job would read.
    const all = parsed.provisions.map((p) => p.fullText).join("\n");
    // The run has to cross periods: "samkvæmt 7., 15. gr. a, 15. gr. b og
    // 20. gr. laga nr. 60/2007" is one citation with five of them in it.
    assert.match(all, /sett er samkvæmt[\s\S]{0,200}?laga nr\. \d+\/\d{4}/);
  });
});

describe("byggingarreglugerð nr. 112/2012 — the awkward one", () => {
  const record = parseRegulationRecord(json("api-0112-2012.json.gz"))!;
  const parsed = parseRegulationBody(record.text!, record.title);

  test("reads the hierarchical article numbering the big technical ones use", () => {
    // "1.1.1. gr." rather than "1. gr.", across 400+ articles.
    const dotted = parsed.provisions.filter((p) => /^\d+\.\d+\.\d+\. gr\./.test(p.displayLabel));
    assert.ok(dotted.length > 100, `only ${dotted.length} dotted articles`);
    assert.equal(dotted[0].anchor, "A1_1_1");
  });

  test("refuses to give a dotted article an integer number", () => {
    // 1.2.1 is not article 1. Storing it as 1 would let a citation to "1. gr."
    // of the regulation resolve to it — the same refusal the Lagasafn parser
    // makes for annex articles.
    for (const p of parsed.provisions) {
      if (/^\d+\.\d+/.test(p.displayLabel)) {
        assert.equal(p.articleNumber, null, p.displayLabel);
      }
    }
  });

  test("an article whose body is a list keeps its text", () => {
    // 1.2.1. gr. "Skilgreiningar" is an <ol> of 700+ <li> and no <p> at all.
    // Selecting <p> alone dropped the entire article while still reporting a
    // successful parse.
    const definitions = parsed.provisions.find((p) => p.displayLabel.startsWith("1.2.1."));
    assert.ok(definitions, "1.2.1. gr. not found");
    assert.ok(
      definitions.paragraphs.length > 50,
      `definitions article has only ${definitions.paragraphs.length} paragraphs`
    );
    assert.match(definitions.fullText, /Aðaluppdráttur/);
  });

  test("no article is stored empty", () => {
    const empty = parsed.provisions.filter((p) => !p.fullText.trim());
    assert.equal(empty.length, 0, empty.map((p) => p.displayLabel).join(", "));
  });

  test("sections and chapters are flattened into one ordered list", () => {
    // "1. HLUTI" and "1.1. KAFLI" both open a division; Chapter has no parent,
    // so an article belongs to whichever opened most recently above it.
    assert.ok(parsed.chapters.some((c) => /HLUTI/.test(c.label)));
    assert.ok(parsed.chapters.some((c) => /KAFLI/.test(c.label)));
  });
});

describe("the Word-converted generation", () => {
  const page = raw("html-0359-1993.html.gz");
  const body = extractRegulationBody(page);

  test("the body is found on the page even though the API served a stub", () => {
    assert.ok(body, "no body extracted");
    assert.equal(detectStructure(body), "heuristic");
  });

  test("articles are recovered from centred paragraphs", () => {
    const parsed = parseRegulationBody(body!, "Reglugerð um þjóðgarðinn í Jökulsárgljúfrum.");
    assert.equal(parsed.structure, "heuristic");
    assert.ok(parsed.provisions.length >= 10, `only ${parsed.provisions.length} articles`);
    assert.equal(parsed.provisions[0].displayLabel, "1. gr.");
    assert.equal(parsed.provisions[0].anchor, "A1");
    assert.match(parsed.provisions[0].fullText, /Reglugerð þessi gildir um þjóðgarðinn/);
  });

  test("the centred italic line above an article becomes its heading", () => {
    const parsed = parseRegulationBody(body!, "t");
    const first = parsed.provisions[0];
    assert.equal(first.heading, "Gildissvið");
    // …and does not end up inside the article's own text.
    assert.ok(!first.fullText.startsWith("Gildissvið"));
  });

  test("the page's own chrome is not read as regulation text", () => {
    const parsed = parseRegulationBody(body!, "t");
    const all = parsed.provisions.map((p) => p.fullText).join("\n");
    for (const chrome of ["Reglugerð á PDF formi", "Breytingareglugerðir", "Valmynd"]) {
      assert.ok(!all.includes(chrome), `"${chrome}" leaked into the text`);
    }
  });
});

describe("the structured generation on the site", () => {
  const body = extractRegulationBody(raw("html-0950-2026.html.gz"));

  test("a page can be structured even when the API served a stub for it", () => {
    // Which is why the generation is decided by looking at the markup rather
    // than by where the bytes came from or how old the regulation is.
    assert.ok(body);
    assert.equal(detectStructure(body), "structured");
  });

  test("parses into numbered articles with headings", () => {
    const parsed = parseRegulationBody(body!, "Reglugerð um merkingu og lýsingu hindrana.");
    assert.ok(parsed.provisions.length >= 10);
    assert.equal(parsed.provisions[0].displayLabel, "1. gr.");
    assert.equal(parsed.provisions[0].heading, "Markmið og gildissvið");
  });
});

describe("the register listing", () => {
  const page = parseRegisterPage(json("newest-page1.json.gz"));

  test("reads a page of the register", () => {
    assert.equal(page.entries.length, 30);
    assert.ok(page.totalItems > 10_000, `register has only ${page.totalItems} items`);
    assert.ok(page.totalPages > 100);
  });

  test("says which entries are amendments", () => {
    // More than half the register is; they are read for their effects and
    // never stored, so the flag decides what the walk does with each entry.
    assert.ok(page.entries.some((e) => e.type === "amending"));
    assert.ok(page.entries.some((e) => e.type === "base"));
  });

  test("every entry resolves to a number and a year", () => {
    for (const e of page.entries) {
      assert.ok(e.number > 0 && e.year > 1900, e.name);
      assert.ok(e.title, `${e.name} has no title`);
    }
  });
});

describe("an amending regulation names the regulation it changes", () => {
  const record = parseRegulationRecord(json("api-0840-2021.json.gz"))!;

  test("effects[] is the change signal the incremental walk runs on", () => {
    assert.equal(record.type, "amending");
    const amended = record.effects.filter((e) => e.effect === "amend").map((e) => e.name);
    assert.ok(amended.includes("0300/2020"), JSON.stringify(record.effects));
  });
});

describe("hashRegulation", () => {
  const record = parseRegulationRecord(json("api-0300-2020.json.gz"))!;
  const parsed = parseRegulationBody(record.text!, record.title);

  test("is stable for the same input", () => {
    assert.equal(hashRegulation(record, parsed), hashRegulation(record, parsed));
  });

  test("changes when a regulation is repealed, though its text does not", () => {
    // The status is the point of the row for anyone reading it; a hash over
    // the articles alone would skip the one update that matters most.
    assert.notEqual(
      hashRegulation(record, parsed),
      hashRegulation({ ...record, repealed: true }, parsed)
    );
  });

  test("changes when an amendment is folded in", () => {
    assert.notEqual(
      hashRegulation(record, parsed),
      hashRegulation({ ...record, amendedBy: [...record.amendedBy, "0001/2030"] }, parsed)
    );
  });

  test("changes when the same text is read by a different generation's parser", () => {
    // A regulation that moves from the soup to the structured generation has
    // better divisions than before, and the row should be rewritten.
    assert.notEqual(
      hashRegulation(record, parsed),
      hashRegulation(record, { ...parsed, structure: "heuristic" })
    );
  });
});

describe("parseRegulationName", () => {
  test("reads both forms reglugerd.is writes", () => {
    assert.deepEqual(parseRegulationName("0300/2020"), { number: 300, year: 2020 });
    assert.deepEqual(parseRegulationName("0300-2020"), { number: 300, year: 2020 });
    assert.deepEqual(parseRegulationName("1135/2021"), { number: 1135, year: 2021 });
  });

  test("returns null rather than a half-parsed reference", () => {
    for (const bad of ["", "300", "nonsense", "300/20", "0300/2020/1"]) {
      assert.equal(parseRegulationName(bad), null, bad);
    }
  });

  test("the slug is zero-padded to four digits, as the source writes it", () => {
    assert.equal(regulationSlug(300, 2020), "0300-2020");
    assert.equal(regulationSlug(1135, 2021), "1135-2021");
    assert.match(regulationUrl(300, 2020), /\/reglugerdir\/allar\/nr\/0300-2020$/);
  });
});

describe("parseArticleLabel", () => {
  test("reads the flat numbering most regulations use", () => {
    assert.deepEqual(parseArticleLabel("12. gr."), { key: "12", number: 12, letter: null });
    assert.deepEqual(parseArticleLabel("7. gr. a"), { key: "7A", number: 7, letter: "a" });
  });

  test("reads the hierarchical numbering, without inventing an integer for it", () => {
    assert.deepEqual(parseArticleLabel("1.2.1. gr."), {
      key: "1_2_1",
      number: null,
      letter: null,
    });
  });

  test("is not fooled by text that merely mentions an article", () => {
    for (const bad of ["sbr. 12. gr.", "12", "gr.", "I. KAFLI", ""]) {
      assert.equal(parseArticleLabel(bad), null, bad);
    }
  });
});

describe("normalizeRegulationText", () => {
  test("composes decomposed Icelandic letters", () => {
    // A decomposed letter would not equal its composed form in the search
    // index or in the hash that decides whether a regulation changed.
    assert.equal(normalizeRegulationText("þjóð".normalize("NFD")), "þjóð");
  });

  test("replaces the non-breaking spaces the Word conversion is full of", () => {
    assert.equal(normalizeRegulationText("12. gr."), "12. gr.");
  });
});
