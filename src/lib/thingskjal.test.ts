/**
 * The þingskjal parser, against two real pages from Alþingi.
 *
 * The fixtures came from the Internet Archive rather than from althingi.is
 * directly: `/altext/` is served through Cloudflare and refuses requests from
 * the environment this was built in, while `/lagas/` from the same machine
 * answers fine. See the manifest, and the adapter header for what that means
 * for the ingest.
 *
 * The two were chosen to be opposites. 130/1194 is a whole bill — text,
 * memorandum, and seventy-five articles commented on one by one, which is the
 * thing this corpus exists for. 153/0001 is the fjárlagafrumvarp, whose page
 * carries a header, a document list and a link to a 368-page PDF: the failure
 * mode, and the one the parser must not report as a success.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseThingskjal,
  splitArticleCommentary,
  parseThingskjalUrl,
  thingskjalUrl,
  normalizeThingskjalText,
} from "@/lib/thingskjal";

const FIXTURES = join(process.cwd(), "src/lib/__fixtures__/althingi");
const fixture = (name: string) =>
  parseThingskjal(gunzipSync(readFileSync(join(FIXTURES, name))).toString("utf8"));

describe("frumvarp til jarðalaga — þskj. 1194 of the 130th þing", () => {
  const doc = fixture("130-1194.html.gz");

  test("reads its parliamentary identity off the header", () => {
    assert.equal(doc.documentNumber, 1194);
    assert.equal(doc.caseNumber, 783);
    assert.equal(doc.parliament, 130);
    assert.equal(doc.kind, "frumvarp");
  });

  test("takes the bill's title, not the page's furniture", () => {
    assert.equal(doc.title, "Frumvarp til jarðalaga");
  });

  test("stores the document, not the site around it", () => {
    assert.ok(doc.hasText);
    assert.ok(doc.fullText.length > 50_000, `only ${doc.fullText.length} characters`);
    // The document picker above it and the site menu below it are both out.
    assert.ok(!doc.fullText.includes("Þú ert hér:"), "site navigation leaked into the text");
    assert.ok(!doc.fullText.includes("Valmynd"), "the site menu leaked into the text");
  });

  test("separates the general memorandum from the bill", () => {
    assert.ok(doc.generalCommentary.length > 10_000, `only ${doc.generalCommentary.length}`);
    assert.match(doc.generalCommentary, /samið í landbúnaðarráðuneytinu/);
    // It stops where the article-by-article section starts.
    assert.ok(!doc.generalCommentary.includes("Um 1. gr."));
  });

  test("splits the article-by-article commentary", () => {
    // This is the whole reason for holding bills: what a court quotes when it
    // construes a provision.
    assert.ok(doc.articleCommentary.length > 60, `only ${doc.articleCommentary.length} articles`);
    const first = doc.articleCommentary[0];
    assert.equal(first.articleNumber, 1);
    assert.match(first.heading, /^Um 1\. gr/);
    assert.match(first.text, /markmið eða tilgang laganna/);
  });

  test("a heading naming no single article carries no article number", () => {
    // "Um 5. og 6. gr." comments on two, and "Um ákvæði til bráðabirgða I" on
    // none. Attaching either to one article would put commentary about
    // something else under it.
    const ranged = doc.articleCommentary.find((a) => /Um 5\. og 6\. gr/.test(a.heading));
    assert.ok(ranged, "the two-article heading was not found");
    assert.equal(ranged.articleNumber, null);
    const temporary = doc.articleCommentary.find((a) => /bráðabirgða/.test(a.heading));
    assert.ok(temporary);
    assert.equal(temporary.articleNumber, null);
  });

  test("every commentary entry has text under it", () => {
    for (const a of doc.articleCommentary) {
      assert.ok(a.text.length > 0, `${a.heading} has no text`);
    }
  });

  test("finds the other documents of the case", () => {
    // The only route this app has to a bill's nefndarálit: the ferill page
    // that would otherwise list them is not served to us.
    assert.ok(doc.relatedDocuments.length >= 4, `only ${doc.relatedDocuments.length}`);
    assert.ok(doc.relatedDocuments.some((r) => /nefndarálit/.test(r.description)));
    assert.ok(doc.relatedDocuments.every((r) => r.documentNumber > 0));
  });
});

describe("fjárlagafrumvarp 2023 — a page with no document on it", () => {
  const doc = fixture("153-0001.html.gz");

  test("reads the newer header form", () => {
    // "Þingskjal 1 — 1. mál." where the older pages say "Þskj. 1194 — 783. mál."
    assert.equal(doc.documentNumber, 1);
    assert.equal(doc.caseNumber, 1);
    assert.equal(doc.parliament, 153);
  });

  test("is not named after its own category", () => {
    // The line under the header is "Stjórnarfrumvarp." — the kind, not the
    // name. Taking it would title a hundred unrelated bills identically.
    assert.notEqual(doc.title, "Stjórnarfrumvarp");
    assert.match(doc.title, /^Frumvarp til fjárlaga/);
  });

  test("reports that it holds no text rather than storing the menu", () => {
    // The text is a 368-page PDF beside the page. What is left on the page is
    // a header and several thousand characters of site navigation, and
    // counting that as the bill is how a corpus fills up with menus.
    assert.equal(doc.hasText, false);
    assert.equal(doc.fullText, "");
    assert.equal(doc.articleCommentary.length, 0);
  });
});

describe("splitArticleCommentary", () => {
  test("a heading opens an entry and the prose under it is its text", () => {
    const parsed = splitArticleCommentary(
      ["Um 1. gr.", "Ákvæðið er nýmæli.", "Um 2. gr.", "Hér er kveðið á um gildissvið."].join("\n")
    );
    assert.deepEqual(
      parsed.map((a) => [a.articleNumber, a.text]),
      [
        [1, "Ákvæðið er nýmæli."],
        [2, "Hér er kveðið á um gildissvið."],
      ]
    );
  });

  test("a lettered article keeps its letter", () => {
    const [a] = splitArticleCommentary("Um 7. gr. a\nUm þetta ákvæði gildir sérregla.");
    assert.equal(a.articleNumber, 7);
    assert.equal(a.articleLetter, "a");
  });

  test("a sentence beginning with Um is not a heading", () => {
    // "Um þetta gildir…" opens with the same word. The length bound and the
    // shape of the rest are what separate them.
    const parsed = splitArticleCommentary(
      "Um 1. gr.\nUm þetta gildir sú meginregla að samningar skuli standa, og af því leiðir að ákvæðið verður skýrt þröngt."
    );
    assert.equal(parsed.length, 1);
    assert.match(parsed[0].text, /^Um þetta gildir/);
  });

  test("a heading with nothing under it is dropped", () => {
    assert.deepEqual(splitArticleCommentary("Um 1. gr.\nUm 2. gr.\nTexti."), [
      { heading: "Um 2. gr", articleNumber: 2, articleLetter: null, text: "Texti." },
    ]);
  });
});

describe("þingskjal URLs", () => {
  test("composes the canonical form", () => {
    assert.equal(thingskjalUrl(130, 1194), "https://www.althingi.is/altext/130/s/1194.html");
    assert.equal(thingskjalUrl(115, 72), "https://www.althingi.is/altext/115/s/0072.html");
  });

  test("reads þing and skjal back out, in both formats", () => {
    assert.deepEqual(parseThingskjalUrl("https://www.althingi.is/altext/115/s/0072.html"), {
      parliament: 115,
      documentNumber: 72,
      format: "html",
    });
    // The older þing are published only as scans.
    assert.deepEqual(parseThingskjalUrl("https://www.althingi.is/altext/pdf/63/s/0001.pdf"), {
      parliament: 63,
      documentNumber: 1,
      format: "pdf",
    });
  });

  test("returns null for anything else", () => {
    for (const bad of ["", "https://www.althingi.is/lagas/nuna/1991091.html", "nonsense"]) {
      assert.equal(parseThingskjalUrl(bad), null, bad);
    }
  });
});

describe("normalizeThingskjalText", () => {
  test("replaces the non-breaking spaces the conversion is full of", () => {
    assert.equal(normalizeThingskjalText("Þskj. 1194"), "Þskj. 1194");
  });

  test("composes decomposed Icelandic letters", () => {
    assert.equal(normalizeThingskjalText("þjóð".normalize("NFD")), "þjóð");
  });
});
