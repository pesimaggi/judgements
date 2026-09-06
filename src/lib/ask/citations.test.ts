/**
 * Citation validation — the code that does not take the model's word for it.
 *
 * The rule under nearly every test here is the same one: an invalid citation
 * is removed, never remapped. Renumbering "[11]" to "[1]" would produce a
 * sentence that looks supported and is not, which is a worse outcome than the
 * broken marker it replaced and one no reader could detect.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  validateCitations,
  citedNumbers,
  statesLegalProposition,
  authorityIdentifiers,
  extractClaims,
  applyVerdicts,
  isQualified,
  unsupportedMarker,
} from "@/lib/ask/citations";
import type { AskSource } from "@/lib/ask/types";

const SOURCES: AskSource[] = [1, 2, 3].map((n) => ({
  n,
  kind: "provision" as const,
  title: `${n}. gr.`,
  subtitle: "…",
  path: `/log/1-2000#G${n}`,
  cited: false,
}));

describe("citedNumbers", () => {
  test("reads the marker the model is told to write", () => {
    assert.deepEqual(citedNumbers("Svar [2] og [3]."), [2, 3]);
  });

  test("reads the shapes it writes anyway", () => {
    assert.deepEqual(citedNumbers("Svar [2, 3]."), [2, 3]);
    assert.deepEqual(citedNumbers("Svar [2; 3]."), [2, 3]);
  });

  test("does not repeat a number cited twice", () => {
    assert.deepEqual(citedNumbers("[2] og aftur [2]"), [2]);
  });
});

describe("statesLegalProposition", () => {
  test("recognises the normative vocabulary of Icelandic legislation", () => {
    assert.equal(statesLegalProposition("Stjórnvald skal taka ákvörðun svo fljótt sem unnt er."), true);
    // "ber ávallt að" — the adverb between "ber" and "að" is the commonest
    // shape, and an ASCII \b would refuse to match the "að" at all.
    assert.equal(
      statesLegalProposition("Atvinnurekanda ber ávallt að greiða laun út uppsagnarfrest."),
      true
    );
    assert.equal(
      statesLegalProposition("Skilyrði um búsetu verður að vera uppfyllt við afgreiðslu."),
      true
    );
  });

  test("recognises it in English too", () => {
    assert.equal(
      statesLegalProposition("An employer must give notice before terminating the contract."),
      true
    );
  });

  test("treats naming an instrument as a statement about it", () => {
    assert.equal(statesLegalProposition("Þetta kemur fram í 8. gr. laga nr. 100/1952."), true);
  });

  test("is not tripped by a short fragment or by ordinary description", () => {
    assert.equal(statesLegalProposition("Já."), false);
    assert.equal(statesLegalProposition("Brunnurinn fann ekkert um þetta efni í safninu."), false);
  });
});

describe("authorityIdentifiers", () => {
  test("picks out act numbers and article numbers in both corpora", () => {
    const found = authorityIdentifiers("Sjá 8. gr. laga nr. 100/1952 og Article 6 GDPR.");
    assert.ok(found.includes("8. gr."));
    assert.ok(found.includes("nr. 100/1952"));
    assert.ok(found.includes("Article 6"));
  });
});

describe("validateCitations", () => {
  test("removes a citation to a source that does not exist", () => {
    const { answer, issues } = validateCitations("Reglan gildir [9].", SOURCES, "is");
    assert.doesNotMatch(answer, /\[9\]/);
    assert.equal(issues.some((i) => i.kind === "nonexistent-citation" && i.n === 9), true);
  });

  test("never turns an invalid citation into a different source", () => {
    const { answer } = validateCitations("Reglan gildir [9].", SOURCES, "is");
    for (const n of [1, 2, 3]) assert.doesNotMatch(answer, new RegExp(`\\[${n}\\]`));
  });

  test("keeps the valid half of a mixed group", () => {
    const { answer } = validateCitations("Reglan gildir [2, 9].", SOURCES, "is");
    assert.match(answer, /\[2\]/);
    assert.doesNotMatch(answer, /\[9\]/);
  });

  test("leaves a valid answer completely alone", () => {
    const text = "Reglan gildir [2].\n\n## Ákvæðin\n\nStjórnvald skal taka ákvörðun fljótt [3].";
    const { answer, issues } = validateCitations(text, SOURCES, "is");
    assert.equal(answer, text);
    assert.deepEqual(issues, []);
  });

  test("qualifies a paragraph that states law and cites nothing", () => {
    const { answer, issues } = validateCitations(
      "Atvinnurekanda ber ávallt að greiða laun út uppsagnarfrest.",
      SOURCES,
      "is"
    );
    assert.match(answer, /óstaðfest/);
    assert.equal(issues[0].kind, "uncited-claim");
    assert.equal(issues[0].action, "qualified");
  });

  test("qualifies in English when the answer is in English", () => {
    const { answer } = validateCitations(
      "An employer must always pay wages through the notice period.",
      SOURCES,
      "en"
    );
    assert.match(answer, /unverified/);
  });

  test("qualifies a sentence that lost its only citation to the check", () => {
    // The difference from a sentence that never had one: this was resting on a
    // source that does not exist, which is worse than an unsupported aside.
    const { answer } = validateCitations(
      "Reglan gildir [2]. Sambærileg skilyrði gilda um farbann [9].",
      SOURCES,
      "is"
    );
    assert.match(answer, /farbann\.?\s*\(óstaðfest/);
  });

  test("reports, but does not rewrite, a sentence inside a paragraph that cites", () => {
    const text = "Reglan gildir [2]. Sama skilyrði gildir um framlengingu hennar að auki.";
    const { answer, issues } = validateCitations(text, SOURCES, "is");
    assert.equal(answer, text, "a citation at the end of a paragraph is ordinary legal writing");
    assert.equal(issues.some((i) => i.action === "flagged"), true);
  });

  test("never marks a heading", () => {
    const { answer } = validateCitations("## Ákvæðin sem gilda", SOURCES, "is");
    assert.equal(answer, "## Ákvæðin sem gilda");
  });

  test("keeps the answer's paragraph structure", () => {
    const { answer } = validateCitations("Fyrsti [2].\n\n## Fyrirsögn\n\nAnnar [3].", SOURCES, "is");
    assert.match(answer, /\n\n## Fyrirsögn\n\n/);
  });

  test("an empty source list makes every citation invalid, and none is remapped", () => {
    const { answer } = validateCitations("Reglan gildir [1].", [], "is");
    assert.doesNotMatch(answer, /\[\d/);
  });

  test("reports the numbers that survived", () => {
    const { cited } = validateCitations("[1] og [9]", SOURCES, "is");
    assert.deepEqual(cited, [1]);
  });
});

describe("extractClaims", () => {
  test("returns only cited propositions, with what they cite", () => {
    const claims = extractClaims(
      "## Fyrirsögn\n\nStjórnvald skal taka ákvörðun svo fljótt sem unnt er [2]. Þetta er stutt."
    );
    assert.equal(claims.length, 1);
    assert.deepEqual(claims[0].cites, [2]);
    assert.doesNotMatch(claims[0].text, /\[2\]/, "the marker is stripped before the verifier sees it");
  });

  test("skips uncited sentences — there is no evidence to check them against", () => {
    assert.deepEqual(extractClaims("Stjórnvald skal taka ákvörðun svo fljótt sem unnt er."), []);
  });
});

describe("applyVerdicts", () => {
  const ANSWER =
    "Stjórnvald skal taka ákvörðun svo fljótt sem unnt er [2]. Frestur er þrír mánuðir samkvæmt 5. gr. [3].";
  const claims = extractClaims(ANSWER);

  test("qualifies an unsupported claim in place rather than deleting it", () => {
    const { answer, issues } = applyVerdicts(
      ANSWER,
      [{ claim: claims[1].text, verdict: "unsupported" }],
      "is"
    );
    assert.match(answer, /þrír mánuðir samkvæmt 5\. gr\. \[3\]\. \(óstaðfest/);
    assert.match(answer, /Stjórnvald skal taka ákvörðun/, "the rest of the answer is untouched");
    assert.equal(issues[0].kind, "unsupported-claim");
    assert.equal(issues[0].action, "qualified");
  });

  test("marks a contradicted claim differently from an unsupported one", () => {
    const { answer } = applyVerdicts(
      ANSWER,
      [{ claim: claims[0].text, verdict: "contradicted" }],
      "is"
    );
    assert.match(answer, /ganga gegn/);
  });

  test("leaves a supported claim exactly as written", () => {
    const { answer, issues } = applyVerdicts(
      ANSWER,
      [{ claim: claims[0].text, verdict: "supported" }],
      "is"
    );
    assert.equal(answer, ANSWER);
    assert.deepEqual(issues, []);
  });

  test("reports a partial claim without rewriting the answer", () => {
    const { answer, issues } = applyVerdicts(
      ANSWER,
      [{ claim: claims[0].text, verdict: "partial" }],
      "is"
    );
    assert.equal(answer, ANSWER);
    assert.equal(issues[0].kind, "partially-supported-claim");
  });

  test("a verdict on a claim that is no longer there is flagged, never guessed at", () => {
    const { answer, issues } = applyVerdicts(
      ANSWER,
      [{ claim: "Something the answer never said at all about anything.", verdict: "unsupported" }],
      "is"
    );
    assert.equal(answer, ANSWER);
    assert.equal(issues[0].action, "flagged");
  });
});

describe("isQualified", () => {
  test("recognises the pipeline's own qualifiers, in both languages", () => {
    assert.equal(isQualified(`Eitthvað.${unsupportedMarker("is")}`), true);
    assert.equal(isQualified(`Something.${unsupportedMarker("en")}`), true);
    assert.equal(isQualified("An ordinary sentence."), false);
  });
});
