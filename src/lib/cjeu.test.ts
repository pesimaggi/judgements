/**
 * Reading a judgment's identity out of what EUR-Lex states about it.
 *
 * The titles here are real, copied from the endpoint's answers. They are the
 * only place some of these fields exist, and the shape varies more than a
 * five-field format suggests: a direct action has no referring court, a
 * judgment of 1975 has neither keywords nor a case segment, and joined cases
 * state two case numbers where the CELEX states one.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseCaseCelex, parseCaseTitle, composeCaseTitle, caseLawUrl } from "@/lib/cjeu";

describe("case CELEX numbers", () => {
  test("reads the court, the year and the case number", () => {
    const c = parseCaseCelex("62015CJ0203");
    assert.equal(c?.caseNumber, "C-203/15");
    assert.equal(c?.source, "cjeu");
    assert.equal(c?.year, 2015);
  });

  test("tells the General Court from the Court of Justice", () => {
    const t = parseCaseCelex("62015TJ0203");
    assert.equal(t?.caseNumber, "T-203/15");
    assert.equal(t?.source, "eu-general-court");
  });

  test("drops the leading zeros the CELEX pads with", () => {
    assert.equal(parseCaseCelex("62015CJ0001")?.caseNumber, "C-1/15");
  });

  test("refuses everything that is not a judgment of those two courts", () => {
    // An order, an Advocate General's opinion, the wound-up Civil Service
    // Tribunal, an act, and a malformed number. None of them is a judgment
    // this app carries.
    for (const raw of ["62015CO0203", "62015CC0203", "62015FJ0001", "32016R0679", "62015CJ203"]) {
      assert.equal(parseCaseCelex(raw), null, raw);
    }
  });

  test("sends the reader to EUR-Lex for the official text", () => {
    assert.match(caseLawUrl("62015CJ0203"), /CELEX:62015CJ0203$/);
  });
});

describe("the five-field title", () => {
  const tele2 =
    "Judgment of the Court (Grand Chamber) of 21 December 2016.#Tele2 Sverige AB v Post- och " +
    "telestyrelsen and Secretary of State for the Home Department v Tom Watson and Others." +
    "#Requests for a preliminary ruling from the Kammarrätten i Stockholm and the Court of Appeal " +
    "(England & Wales) (Civil Division).#Reference for a preliminary ruling — Electronic " +
    "communications — Processing of personal data — Confidentiality of electronic communications — " +
    "Protection — Directive 2002/58/EC.#Joined Cases C-203/15 and C-698/15.";

  test("separates the parties from everything around them", () => {
    const parsed = parseCaseTitle(tele2);
    assert.match(parsed.parties ?? "", /^Tele2 Sverige AB v Post- och telestyrelsen/);
    assert.match(parsed.heading ?? "", /^Judgment of the Court \(Grand Chamber\)/);
    assert.match(parsed.referredBy ?? "", /Kammarrätten i Stockholm/);
    assert.equal(parsed.casesAsStated, "Joined Cases C-203/15 and C-698/15");
  });

  test("keeps the Court's own index terms, which become the subject tags", () => {
    const parsed = parseCaseTitle(tele2);
    assert.ok(parsed.keywords.includes("Electronic communications"));
    assert.ok(parsed.keywords.includes("Processing of personal data"));
    // The run opens with the procedure, which is worth keeping as a tag too.
    assert.equal(parsed.keywords[0], "Reference for a preliminary ruling");
  });

  test("reads the en-dash keyword run the recent judgments use", () => {
    // Real, from 2026. EUR-Lex switched dash: the 2016 titles separate index
    // terms with "—" and these with "–", and matching only the first silently
    // dropped every tag from half the corpus.
    const parsed = parseCaseTitle(
      "Judgment of the Court (Fourth Chamber) of 23 April 2026.#Criminal proceedings against " +
        "Procuratore generale presso la Corte d’Appello.#Reference for a preliminary ruling – " +
        "Urgent preliminary ruling procedure – Area of freedom, security and justice – Judicial " +
        "cooperation in criminal matters – Directive 2012/29/EU."
    );
    assert.ok(parsed.keywords.includes("Area of freedom, security and justice"));
    assert.ok(parsed.keywords.includes("Directive 2012/29/EU"));
    assert.match(parsed.parties ?? "", /^Criminal proceedings against/);
  });

  test("survives a judgment with only a heading and parties", () => {
    // The older judgments carry no keyword run and no case segment.
    const parsed = parseCaseTitle(
      "Judgment of the Court of 12 December 1972.#International Fruit Company NV and others v " +
        "Produktschap voor Groenten en Fruit."
    );
    assert.equal(parsed.parties, "International Fruit Company NV and others v Produktschap voor Groenten en Fruit");
    assert.deepEqual(parsed.keywords, []);
    assert.equal(parsed.casesAsStated, null);
  });

  test("does not mistake a dash in a party's name for the keyword run", () => {
    // One em dash is punctuation; the keyword run is built out of them.
    const parsed = parseCaseTitle(
      "Judgment of the Court of 3 May 2012.#Legal Services — Ireland v Commission."
    );
    assert.deepEqual(parsed.keywords, []);
    assert.equal(parsed.parties, "Legal Services — Ireland v Commission");
  });
});

describe("the stored title", () => {
  test("leads with the case number and the parties", () => {
    // EUR-Lex's own title opens with "Judgment of the Court (Grand Chamber) of
    // 21 December 2016", which is true of thousands of judgments and
    // identifies none of them.
    const parsed = parseCaseTitle(
      "Judgment of the Court of 21 December 2016.#Tele2 Sverige AB v Post- och telestyrelsen."
    );
    assert.equal(
      composeCaseTitle("C-203/15", parsed),
      "C-203/15 — Tele2 Sverige AB v Post- och telestyrelsen"
    );
  });

  test("falls back to the case number alone when the parties are not stated", () => {
    assert.equal(composeCaseTitle("C-203/15", parseCaseTitle("Judgment of the Court.")), "C-203/15");
  });
});
