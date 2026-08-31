/**
 * This is the query side of the same citation grammar that
 * lib/legal-citations.ts reads out of judgment text. The two have to agree:
 * a provision a user can type must be a provision cases can be linked to, or
 * the lookup offers a provision that is permanently empty.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseProvisionQuery, formatArticleLabel } from "@/lib/provision-query";

describe("parseProvisionQuery", () => {
  test("splits the citation a lawyer would write", () => {
    const p = parseProvisionQuery("57. gr. a. laga um aðbúnað og hollustuhætti");
    assert.equal(p.articleNumber, 57);
    assert.equal(p.articleLetter, "a");
    assert.equal(p.hasArticle, true);
    assert.equal(
      p.actQuery,
      "um aðbúnað og hollustuhætti",
      "the 'laga' lead-in is stripped — stored titles read 'Lög um aðbúnað …'"
    );
  });

  test("an act name alone is an act query with no article", () => {
    const p = parseProvisionQuery("lög um aðbúnað");
    assert.equal(p.hasArticle, false);
    assert.equal(p.articleNumber, null);
    assert.equal(p.actQuery, "lög um aðbúnað");
  });

  test("a short name alone passes through", () => {
    assert.equal(parseProvisionQuery("vaxtalög").actQuery, "vaxtalög");
  });

  test("an article alone is valid — the act may already be chosen", () => {
    const p = parseProvisionQuery("1. mgr. 57. gr.");
    assert.equal(p.paragraphNumber, 1);
    assert.equal(p.articleNumber, 57);
    assert.equal(p.actQuery, "");
  });

  test("does not read the 'l' of 'laga' as the letter suffix", () => {
    // Same trap as in lib/legal-citations.ts: without the word-boundary
    // guard the letter swallows the first character of the following word.
    const p = parseProvisionQuery("57. gr. laga um aðbúnað");
    assert.equal(p.articleLetter, null);
    assert.equal(p.actQuery, "um aðbúnað");
  });

  test("accepts the qualifiers without them having to be trimmed by hand", () => {
    const p = parseProvisionQuery("2. tölul. 1. mgr. 70. gr. laga nr. 88/2008");
    assert.equal(p.paragraphNumber, 1);
    assert.equal(p.articleNumber, 70);
  });

  /**
   * The forms in lib/legal-citations.test.ts under "lettered articles" must
   * all be typeable too, or the lookup and the linker disagree about what a
   * provision is.
   */
  for (const q of ["7. gr. a. jarðalaga", "7. gr. a jarðalaga", "10. gr. a. laga nr. 81/2004"]) {
    test(`parses ${q}`, () => {
      const p = parseProvisionQuery(q);
      assert.equal(p.articleLetter, "a");
      assert.ok(p.articleNumber === 7 || p.articleNumber === 10);
    });
  }
});

describe("formatArticleLabel", () => {
  test("reads back as written", () => {
    assert.equal(formatArticleLabel(parseProvisionQuery("1. mgr. 57. gr. a.")), "1. mgr. 57. gr. a");
    assert.equal(formatArticleLabel(parseProvisionQuery("175. gr.")), "175. gr.");
  });

  test("is empty when no article was recognised", () => {
    assert.equal(formatArticleLabel(parseProvisionQuery("vaxtalög")), "");
  });
});
