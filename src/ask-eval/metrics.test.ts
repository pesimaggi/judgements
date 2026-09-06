/**
 * The evaluation metrics themselves.
 *
 * A scoring function with a bug reports an improvement that is not there, and
 * nothing downstream would ever notice — which is why these are pure functions
 * with their own tests rather than inline arithmetic in the runner.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  citationValidity,
  claimSupport,
  detectLanguage,
  forbiddenCited,
  inventedAuthorities,
  mean,
  missingPoints,
  prohibitedPresent,
  retrievalRecall,
  statesHistoricalLimitation,
  withoutQualifiedClaims,
} from "@/ask-eval/metrics";
import { unsupportedMarker } from "@/lib/ask/citations";
import type { AskSource } from "@/lib/ask/types";

const SOURCES: AskSource[] = [
  {
    n: 1,
    kind: "provision",
    title: "8. gr. laga nr. 100/1952",
    subtitle: "Lög um íslenskan ríkisborgararétt",
    path: "/log/100-1952#G8",
    cited: true,
  },
  {
    n: 2,
    kind: "decision",
    title: "Hrd. 12/2019",
    subtitle: "Hæstiréttur Íslands — 2019-03-14",
    path: "/document/x",
    cited: false,
  },
];

describe("retrievalRecall", () => {
  test("matches an identifier however the source happens to name it", () => {
    const { recall, missing } = retrievalRecall(SOURCES, ["100/1952", "8. gr.", "12/2019"]);
    assert.equal(recall, 1);
    assert.deepEqual(missing, []);
  });

  test("reports what did not come back", () => {
    const { recall, missing } = retrievalRecall(SOURCES, ["100/1952", "91/1991"]);
    assert.equal(recall, 0.5);
    assert.deepEqual(missing, ["91/1991"]);
  });

  test("a fixture that expects nothing scores 1 rather than 0", () => {
    assert.equal(retrievalRecall(SOURCES).recall, 1);
  });
});

describe("forbiddenCited", () => {
  test("only counts a forbidden source the answer actually cited", () => {
    assert.deepEqual(forbiddenCited(SOURCES, ["100/1952"]), ["100/1952"]);
    // Source 2 was retrieved but never cited, which is not the failure.
    assert.deepEqual(forbiddenCited(SOURCES, ["12/2019"]), []);
  });
});

describe("citationValidity", () => {
  test("is 1 for an answer that cites only what exists", () => {
    assert.equal(citationValidity("Svar [1] og [2].", SOURCES).validity, 1);
  });

  test("catches a citation past the end of the source list", () => {
    const { invalid, validity } = citationValidity("Svar [1] og [9].", SOURCES);
    assert.deepEqual(invalid, [9]);
    assert.equal(validity, 0.5);
  });

  test("an answer with no citations at all is not an invalid one", () => {
    // It is a *claim support* failure, which is measured separately.
    assert.equal(citationValidity("Ég fann ekkert.", SOURCES).validity, 1);
  });
});

describe("claimSupport", () => {
  test("counts a paragraph's citation as supporting its sentences", () => {
    const { support, claims } = claimSupport(
      "Stjórnvald skal taka ákvörðun svo fljótt sem unnt er. Kæra ber að berast innan þriggja mánaða [1]."
    );
    assert.equal(claims, 2, "both sentences state a rule");
    assert.equal(support, 1, "one citation in the paragraph supports both");
  });

  test("catches a paragraph that states law and cites nothing", () => {
    const { support, uncited } = claimSupport("Atvinnurekanda ber ávallt að greiða laun.");
    assert.equal(support, 0);
    assert.equal(uncited.length, 1);
  });

  test("ignores headings", () => {
    assert.equal(claimSupport("## Ákvæðin sem gilda").claims, 0);
  });

  test("an answer with no propositions scores 1 rather than 0", () => {
    assert.equal(claimSupport("Ég fann ekkert um þetta í safninu.").support, 1);
  });
});

describe("inventedAuthorities", () => {
  test("catches an article number that is in no source", () => {
    const invented = inventedAuthorities("Sjá 95. gr. laga nr. 88/2008 [1].", SOURCES);
    assert.ok(invented.includes("95. gr."));
    assert.ok(invented.includes("nr. 88/2008"));
  });

  test("does not flag an identifier the sources actually carry", () => {
    assert.deepEqual(inventedAuthorities("Sjá 8. gr. laga nr. 100/1952 [1].", SOURCES), []);
  });

  test("reads the evidence as well as the source labels", () => {
    const invented = inventedAuthorities("Sjá 95. gr. [1].", SOURCES, [
      "Provision text: Samkvæmt 95. gr. laganna …",
    ]);
    assert.deepEqual(invented, []);
  });

  test("does not count an identifier inside a sentence the pipeline disclaimed", () => {
    // Marking a claim unverified is the fix; scoring it as an invented
    // citation would count the fix as the failure it fixed.
    const answer = `Reglan gildir [1]. Sambærilegt gildir samkvæmt 95. gr.${unsupportedMarker("is")}`;
    assert.deepEqual(inventedAuthorities(answer, SOURCES), []);
  });
});

describe("withoutQualifiedClaims", () => {
  test("removes the disclaimed sentence along with its qualifier", () => {
    const answer = `Fyrsta setning [1]. Önnur setning um 95. gr.${unsupportedMarker("is")}`;
    const out = withoutQualifiedClaims(answer);
    assert.match(out, /Fyrsta setning/);
    assert.doesNotMatch(out, /95\. gr\./);
  });

  test("leaves an answer with no qualifiers alone", () => {
    assert.match(withoutQualifiedClaims("Fyrsta setning [1]."), /Fyrsta setning/);
  });
});

describe("detectLanguage", () => {
  test("reads the alphabet, which for this pair is decisive", () => {
    assert.equal(detectLanguage("Samkvæmt lögum nr. 100/1952 er heimilt að veita undanþágu."), "is");
    assert.equal(detectLanguage("An employer must give notice before dismissal."), "en");
  });

  test("an English answer that names an Icelandic act is still English", () => {
    assert.equal(detectLanguage("Under Act No 100/1952, residence is required."), "en");
  });
});

describe("missingPoints and prohibitedPresent", () => {
  test("report what the fixture asked about, case-insensitively", () => {
    assert.deepEqual(missingPoints("Skilyrði um Búsetu", ["búsetu"]), []);
    assert.deepEqual(missingPoints("Skilyrði", ["búsetu"]), ["búsetu"]);
    assert.deepEqual(prohibitedPresent("Þú átt rétt á bótum", ["þú átt rétt"]), ["þú átt rétt"]);
  });
});

describe("statesHistoricalLimitation", () => {
  test("recognises the limitation however it is worded", () => {
    assert.equal(
      statesHistoricalLimitation("Safnið geymir aðeins gildandi texta laganna, ekki eldri útgáfur."),
      true
    );
    assert.equal(
      statesHistoricalLimitation("This library holds only the current consolidated text."),
      true
    );
  });

  test("is not satisfied by an answer that simply does not mention it", () => {
    assert.equal(statesHistoricalLimitation("Dráttarvextir skulu vera jafnháir grunni [1]."), false);
  });
});

describe("mean", () => {
  test("averages, and is 0 rather than NaN for an empty list", () => {
    assert.equal(mean([1, 0]), 0.5);
    assert.equal(mean([]), 0);
  });
});
