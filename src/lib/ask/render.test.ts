/**
 * What the well is allowed to render, and — more to the point — what it is
 * not. The answer text arrives from a language model, so it is untrusted
 * input: the parser accepts the three forms the model was asked for and
 * leaves everything else as the plain text it is.
 *
 * The citation cases are the ones that matter. "[3]" is not four characters
 * of prose, it is the link from a sentence to the provision it rests on, and
 * getting it wrong either breaks the link or invents one.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseAnswer, parseInline } from "@/lib/ask/render";

describe("parseInline", () => {
  test("turns a citation marker into a citation span", () => {
    assert.deepEqual(parseInline("Sjö ára búseta [2]."), [
      { kind: "text", text: "Sjö ára búseta" },
      { kind: "citation", n: 2 },
      { kind: "text", text: "." },
    ]);
  });

  test("reads several markers in a row", () => {
    const spans = parseInline("Skilyrðin eru þrjú [2][7].");
    assert.deepEqual(
      spans.filter((s) => s.kind === "citation"),
      [
        { kind: "citation", n: 2 },
        { kind: "citation", n: 7 },
      ]
    );
  });

  test("reads a comma-separated group as separate citations", () => {
    // Not the form the model is asked for, but one it writes anyway; a stray
    // "[2, 7]" in the middle of a sentence would otherwise be prose.
    assert.deepEqual(
      parseInline("Þetta leiðir af ákvæðunum [2, 7]").filter((s) => s.kind === "citation"),
      [
        { kind: "citation", n: 2 },
        { kind: "citation", n: 7 },
      ]
    );
  });

  test("drops the space before a marker, so the full stop sits tight", () => {
    const spans = parseInline("búseta [2].");
    assert.equal((spans[0] as { text: string }).text, "búseta");
  });

  test("reads bold, and leaves a lone asterisk alone", () => {
    assert.deepEqual(parseInline("**Búseta.** 7 ár * ekki"), [
      { kind: "bold", text: "Búseta." },
      { kind: "text", text: " 7 ár * ekki" },
    ]);
  });

  test("leaves a bracketed number that is not a citation marker as text", () => {
    // Three digits is not a source number — the well never returns 100 sources
    // — so this is prose about a figure, not a link.
    assert.deepEqual(parseInline("sbr. [100] hér"), [{ kind: "text", text: "sbr. [100] hér" }]);
  });
});

describe("parseAnswer", () => {
  test("reads the three block kinds the model is asked for", () => {
    const blocks = parseAnswer(
      [
        "Umsókn fer eftir lögunum [1].",
        "",
        "## Ákvæðin",
        "- **Búseta.** Sjö ár [2]",
        "- Framfærsla [3]",
        "",
        "Alþingi getur einnig veitt réttinn [1].",
      ].join("\n")
    );

    assert.deepEqual(
      blocks.map((b) => b.kind),
      ["paragraph", "heading", "list", "paragraph"]
    );
    assert.equal(blocks[2].kind === "list" && blocks[2].items.length, 2);
  });

  test("joins a soft-wrapped paragraph rather than breaking it per line", () => {
    const blocks = parseAnswer("Fyrri línan\nseinni línan");
    assert.equal(blocks.length, 1);
    assert.equal(
      blocks[0].kind === "paragraph" &&
        blocks[0].spans.map((s) => ("text" in s ? s.text : "")).join(""),
      "Fyrri línan seinni línan"
    );
  });

  test("a list ends at a blank line", () => {
    const blocks = parseAnswer("- eitt\n- tvö\n\nEftir á.");
    assert.deepEqual(
      blocks.map((b) => b.kind),
      ["list", "paragraph"]
    );
  });

  test("an empty answer parses to nothing rather than throwing", () => {
    assert.deepEqual(parseAnswer(""), []);
    assert.deepEqual(parseAnswer("\n\n  \n"), []);
  });
});
