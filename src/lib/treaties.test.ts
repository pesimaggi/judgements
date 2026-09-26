/**
 * The treaty registry, and the two things built on it that are easy to get
 * quietly wrong: the anchors that have to be the same in both languages, and the
 * identity fields that must never be shown to a reader.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  TREATIES,
  TREATY_DOC_TYPE,
  TREATY_JURISDICTION,
  canonicalLanguage,
  treatyAnchor,
  treatyAnnexedTo,
  treatyByIdentity,
  treatyBySlug,
  treatyParagraphAnchor,
  treatyPath,
} from "@/lib/treaties";
import { actCitation, actPath, parseActRef, provisionFullLabel } from "@/lib/acts";

describe("the registry", () => {
  test("holds the four instruments, keyed by slug", () => {
    assert.deepEqual(
      TREATIES.map((t) => t.slug),
      ["ees", "teu", "tfeu", "sca"]
    );
    for (const treaty of TREATIES) {
      assert.equal(treatyBySlug(treaty.slug), treaty);
    }
    assert.equal(treatyBySlug("EES"), TREATIES[0], "slugs are matched case-insensitively");
    assert.equal(treatyBySlug("echr"), null);
  });

  test("the identity fields are unique, because the table's key is built on them", () => {
    // Act's uniqueness constraint is (jurisdiction, docType, actNumber, year,
    // language), and every treaty shares the first two. So a collision here is
    // two instruments that cannot both be stored — and the second one silently
    // overwriting the first is exactly the shape that would take weeks to notice.
    const keys = TREATIES.map((t) => `${t.ordinal}/${t.year}`);
    assert.equal(new Set(keys).size, keys.length, keys.join(", "));
    for (const treaty of TREATIES) {
      assert.equal(treatyByIdentity(treaty.ordinal, treaty.year), treaty);
    }
  });

  test("each treaty says how it is cited in both languages", () => {
    for (const treaty of TREATIES) {
      assert.ok(treaty.titleIs.length > 0, treaty.slug);
      assert.ok(treaty.titleEn.length > 0, treaty.slug);
      assert.ok(treaty.genitiveIs.length > 0, treaty.slug);
      assert.ok(treaty.articleSuffixEn.length > 0, treaty.slug);
      assert.ok(treaty.citedAs.is.length > 0, treaty.slug);
      assert.ok(treaty.citedAs.en.length > 0, treaty.slug);
      assert.ok(treaty.mentionedAs.length > 0, treaty.slug);
    }
  });

  test("only the EEA Agreement has an authentic Icelandic text here", () => {
    // What the reader's language control is switched on by — and not the same
    // question as whether Iceland is a party: the Surveillance and Court
    // Agreement was authenticated in Icelandic too (Article 53(1)), and nobody
    // publishes that text where this app can reach it.
    assert.ok(treatyBySlug("ees")!.icelandicText);
    for (const slug of ["teu", "tfeu", "sca"]) {
      assert.equal(treatyBySlug(slug)!.icelandicText, null, slug);
    }
  });

  test("each treaty says how it reaches Icelandic law, and they differ", () => {
    // The distinction the registry exists to keep straight. Collapsing "ratified"
    // into either of the others would have the reader tell an Icelandic lawyer
    // either that the SCA is part of Icelandic law or that it does not bind
    // Iceland, and both are wrong.
    assert.equal(treatyBySlug("ees")!.icelandicStatus.kind, "force-of-law");
    assert.equal(treatyBySlug("sca")!.icelandicStatus.kind, "ratified");
    assert.equal(treatyBySlug("teu")!.icelandicStatus.kind, "not-a-party");
    assert.equal(treatyBySlug("tfeu")!.icelandicStatus.kind, "not-a-party");

    // Both Icelandic-law states name the act and the article they rest on.
    for (const slug of ["ees", "sca"]) {
      const status = treatyBySlug(slug)!.icelandicStatus;
      assert.notEqual(status.kind, "not-a-party");
      if (status.kind === "not-a-party") return;
      assert.equal(status.actNumber, 2);
      assert.equal(status.year, 1993);
      assert.match(status.article, /^\d+\. gr\.$/);
    }
  });

  test("the English text comes from wherever its author publishes it", () => {
    // Three from Cellar by CELEX, and the EFTA agreement from a PDF on efta.int,
    // because EFTA has no content API and that PDF is the whole of what is
    // published.
    assert.deepEqual(
      TREATIES.map((t) => `${t.slug}:${t.englishText.kind}`),
      ["ees:cellar", "teu:cellar", "tfeu:cellar", "sca:efta-pdf"]
    );
    const sca = treatyBySlug("sca")!.englishText;
    assert.equal(sca.kind === "efta-pdf" && sca.url.endsWith(".pdf"), true);
  });

  test("the governing text is the one this app can serve", () => {
    assert.equal(canonicalLanguage(treatyBySlug("ees")!), "is");
    assert.equal(canonicalLanguage(treatyBySlug("tfeu")!), "en");
    // English even though Iceland is a party: canonical follows the text we
    // hold, not the treaty's standing.
    assert.equal(canonicalLanguage(treatyBySlug("sca")!), "en");
  });

  test("the Agreement's Icelandic text is found from the act that prints it", () => {
    const treaty = treatyAnnexedTo(2, 1993);
    assert.equal(treaty?.slug, "ees");
    assert.equal(treaty?.icelandicText?.annex, "I");
    assert.equal(treaty?.icelandicText?.forceOfLawArticle, "2. gr.");
    assert.equal(treatyAnnexedTo(38, 2001), null);
  });
});

describe("anchors", () => {
  test("are built from the article's number, in every language", () => {
    // The whole point: EUR-Lex anchors the TFEU's article `art_28` and Lagasafn
    // anchors the same article of the Agreement `X27`. If either were stored as
    // it arrives, /log/ees#A28 would land somewhere else the moment a reader
    // switched language.
    assert.equal(treatyAnchor(28), "A28");
    assert.equal(treatyAnchor(28, "a"), "A28A");
    assert.equal(treatyParagraphAnchor(treatyAnchor(28), 2), "A28M2");
  });

  test("cannot collide with an act's or a CELEX's slug", () => {
    for (const treaty of TREATIES) {
      assert.equal(treatyPath(treaty.slug), `/log/${treaty.slug}`);
      assert.ok(/^[a-z]+$/.test(treaty.slug), treaty.slug);
    }
  });
});

describe("how a treaty reaches a reader", () => {
  const row = {
    jurisdiction: TREATY_JURISDICTION,
    docType: TREATY_DOC_TYPE,
    celex: null,
    citation: null,
    textGroup: "ees",
    actNumber: 1,
    year: 1992,
  };

  test("is served at its slug, from either column", () => {
    assert.equal(actPath(row), "/log/ees");
    // Callers that select a narrow identity and no text_group — the well's
    // tools, the lookup route, the Meilisearch sync — must still get this right,
    // or a treaty's every link is a 404.
    assert.equal(actPath({ ...row, textGroup: null }), "/log/ees");
  });

  test("is cited by name, never by the number the row carries", () => {
    assert.equal(actCitation({ ...row, language: "is" }), "EES-samningurinn");
    assert.equal(actCitation({ ...row, language: "en" }), "EEA Agreement");
    // "lög nr. 1/1992" is what the fallback would produce, and it is a claim
    // about the instrument that is simply false.
    for (const language of ["is", "en"]) {
      assert.ok(!/nr\.|1\/1992/.test(actCitation({ ...row, language })));
    }
  });

  test("its articles are cited the way each language cites them", () => {
    assert.equal(
      provisionFullLabel("28. gr.", { ...row, language: "is" }),
      "28. gr. EES-samningsins"
    );
    assert.equal(provisionFullLabel("Article 28", { ...row, language: "en" }), "Article 28 EEA");
    assert.equal(
      provisionFullLabel("Article 101", {
        ...row,
        textGroup: "tfeu",
        actNumber: 3,
        year: 1957,
        language: "en",
      }),
      "Article 101 TFEU"
    );
  });

  test("the slug resolves as an act reference", () => {
    const ref = parseActRef("ees");
    assert.equal(ref?.jurisdiction, "treaty");
    assert.equal(ref && "treaty" in ref ? ref.treaty.slug : null, "ees");
    // And the other three forms still parse as themselves.
    assert.equal(parseActRef("38-2001")?.jurisdiction, "is");
    assert.equal(parseActRef("rg-300-2020")?.jurisdiction, "is");
    assert.equal(parseActRef("32016R0679")?.jurisdiction, "eu");
    assert.equal(parseActRef("nonsense"), null);
  });
});
