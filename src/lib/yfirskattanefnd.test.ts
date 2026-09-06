/**
 * Parsing yskn.is.
 *
 * The fixtures here are cut down from live pages (September 2026) and keep the
 * markup that decides something: the two eras' headers, the bold paragraph
 * that means a different thing in each, the statute table's one-entry-per-line
 * shape, and the opening formula only the newer rulings carry.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  boardName,
  composeRecord,
  ingestOrder,
  parseActiveYear,
  looksLikeTermList,
  parseOpening,
  parseRuling,
  parseRulingNumber,
  parseStatutes,
  parseYearIndex,
  parseYears,
  rulingTitle,
  rulingUrl,
  splitTermLine,
  YFIRSKATTANEFND_SOURCE_KEY,
} from "@/lib/yfirskattanefnd";
import { extractSummary, parseJudgmentText } from "@/lib/judgment-text";

const INDEX = `
  <p class="yearselect">Veldu ár:
    <a href="?year=2026" class='active'>2026</a>
    <a href="?year=2025">2025</a>
    <a href="?year=1992">1992</a>
    <a href="?year=1973">1973</a>
  </p>
  <div class="resultviewerleft equal"><ul>
    <li class="searchresultitem">
      <a href='/urskurdir/skoda-urskurd/?nr=7882' data-urskurdurid="7882" class="urskudurlink">
        Úrskurður
        <div class="UrskurdurSplitText">nr. 107/2026</div>
      </a>
    </li>
    <li class="searchresultitem">
      <a href='/urskurdir/skoda-urskurd/?nr=5535' data-urskurdurid="5535" class="urskudurlink">
        Úrskurður rskn.
        <div class="UrskurdurSplitText">nr. 1285/1973</div>
      </a>
    </li>
  </ul></div>
`;

/** A modern ruling: index terms in a list, a prose summary, an opening date. */
const MODERN = `
  <h1 class="resulttitle">Úrskurður yfirskattanefndar</h1>
  <div class="urskurdurInfoContainer">
    <div class="atridicontainer">
      <ul><li>Leiðrétting skattskila</li><li>Sönnun</li></ul>
    </div>
    <h2 class="resultparagraphUrskurdurNr">Úrskurður nr. 107/2026</h2>
    <p class="resultparagraphGjaldar">Gjaldár 2020</p>
  </div>
  <div class="tilvisuncontainer">
    <p>
      Lög nr. 90/2003, 7. gr. A-liður 1. tölul., 96. gr. &nbsp;
      Lög nr. 37/1993, 10. gr. &nbsp;
    </p>
  </div>
  <p class="resultparagraphBold">
    A óskaði á árinu 2023 eftir þeirri leiðréttingu á skattframtali sínu að laun
    frá G ehf. yrðu felld niður. Kröfu kæranda var hafnað að hluta.
  </p>
  <div class="resultcontainer">
    <p>Ár 2026, miðvikudaginn 8. júlí, er tekið fyrir mál nr. 1/2026; kæra A, mótt. 5. janúar 2026, vegna álagningar opinberra gjalda gjaldárið 2020.</p>
    <p>Málavextir eru þeir að ríkisskattstjóri féllst ekki á beiðni kæranda.</p>
    <p>Ú r s k u r ð a r o r ð :</p>
    <p>Kröfu kæranda er hafnað.</p>
  </div>
`;

/** A ríkisskattanefnd ruling: no term list, and the bold line *is* the terms. */
const OLD = `
  <h1 class="resulttitle">Úrskurður ríkisskattanefndar</h1>
  <div class="urskurdurInfoContainer">
    <h2 class="resultparagraphUrskurdurNr">Úrskurður rskn. nr. 474/1984</h2>
    <p class="resultparagraphGjaldar">Gjaldár 1983</p>
  </div>
  <div class="tilvisuncontainer"><p>Lög nr. 75/1981 — 2. gr. 1. mgr. 5. tl., 91. gr. &nbsp;</p></div>
  <p class="resultparagraphBold">
    D&#225;narb&#250; &#8212; Eignarskattsstofn &#8212; L&#246;ga&#240;ili
  </p>
  <div class="resultcontainer">
    <p>Kærður er &#250;rskur&#240;ur skattstjóra um eignarskattsstofn dánarbús.</p>
    <p>Kröfu kæranda er synjað.</p>
  </div>
`;

describe("the listing", () => {
  test("reads every year the board publishes, newest first", () => {
    assert.deepEqual(parseYears(INDEX), [2026, 2025, 1992, 1973]);
  });

  test("ignores anything that is not a four-digit year", () => {
    assert.deepEqual(parseYears(`<a href="?year=20">x</a><a href="?year=1973">y</a>`), [1973]);
  });

  test("reads a ruling's id, number and board from the link", () => {
    assert.deepEqual(parseYearIndex(INDEX), [
      { id: "7882", rulingNumber: "107/2026", board: "yfirskattanefnd" },
      { id: "5535", rulingNumber: "1285/1973", board: "rikisskattanefnd" },
    ]);
  });

  test('"rskn." in the label is what marks the older body', () => {
    assert.equal(boardName("rikisskattanefnd"), "Ríkisskattanefnd");
    assert.equal(boardName("yfirskattanefnd"), "Yfirskattanefnd");
  });

  test("a ruling is fetched, and cited, at its own page", () => {
    assert.equal(
      rulingUrl("https://www.yskn.is", "7882"),
      "https://www.yskn.is/urskurdir/skoda-urskurd/?nr=7882"
    );
  });

  test("the ruling number survives every way the site writes it", () => {
    assert.equal(parseRulingNumber("nr. 107/2026"), "107/2026");
    assert.equal(parseRulingNumber("Úrskurður rskn. nr. 728/1973 "), "728/1973");
    assert.equal(parseRulingNumber("Úrskurður nr. 128 / 1997"), "128/1997");
    assert.equal(parseRulingNumber("Úrskurður"), undefined);
  });
});

describe("the opening formula", () => {
  test("gives both the day it was decided and the case behind the ruling", () => {
    const { date, caseNumbers } = parseOpening(
      "Ár 2026, miðvikudaginn 8. júlí, er tekið fyrir mál nr. 1/2026; kæra A, mótt. 5. janúar 2026."
    );
    assert.equal(date?.toISOString().slice(0, 10), "2026-07-08");
    assert.deepEqual(caseNumbers, ["1/2026"]);
  });

  test("months whose last letter is not ASCII still parse", () => {
    // JavaScript's \b does not fire after "júlí", "júní" or "maí", which would
    // silently cost every ruling of those three months its date.
    for (const [month, iso] of [
      ["maí", "2021-05-05"],
      ["júní", "2021-06-05"],
      ["júlí", "2021-07-05"],
    ] as const) {
      const { date } = parseOpening(`Ár 2021, miðvikudaginn 5. ${month}, er tekið fyrir mál nr. 3/2021;`);
      assert.equal(date?.toISOString().slice(0, 10), iso, month);
    }
  });

  test("a ruling without the formula has no date at all, and says so", () => {
    // Everything before 2016 is published without it, and the date appears
    // nowhere else in the record — not in the body, not at the end.
    const opening = parseOpening("I. Málavextir eru þeir að kærandi, sem er hlutafélag, …");
    assert.equal(opening.date, undefined);
    assert.deepEqual(opening.caseNumbers, []);
  });

  test("a later date in the same sentence is not mistaken for the ruling's", () => {
    const { date } = parseOpening(
      "Ár 2020, miðvikudaginn 26. febrúar, er tekið fyrir mál nr. 148/2019; kæra A, dags. 27. ágúst 2019."
    );
    assert.equal(date?.toISOString().slice(0, 10), "2020-02-26");
  });

  test("a ruling deciding several cases keeps all of their numbers", () => {
    const { caseNumbers } = parseOpening(
      "Ár 2024, mánudaginn 10. júní, er tekið fyrir mál nr. 40/2024 og 41/2024; kæra A ehf."
    );
    assert.deepEqual(caseNumbers, ["40/2024", "41/2024"]);
  });
});

describe("terms versus summary", () => {
  test("a dashed line of noun phrases is a term list", () => {
    assert.ok(looksLikeTermList("Dánarbú — Eignarskattsstofn — Lögaðili"));
    assert.deepEqual(splitTermLine("Dánarbú — Eignarskattsstofn — Lögaðili"), [
      "Dánarbú",
      "Eignarskattsstofn",
      "Lögaðili",
    ]);
  });

  test("a single term is still a term list", () => {
    assert.ok(looksLikeTermList("Opinber gjöld"));
  });

  test("length alone does not make it prose", () => {
    // Ríkisskattanefnd indexes some rulings under thirty terms, which runs to
    // several hundred characters and is still a keyword list.
    const long = Array.from({ length: 30 }, (_, i) => `Söluhagnaður fyrnanlegs lausafjár ${i}`).join(" — ");
    assert.ok(looksLikeTermList(long));
  });

  test("prose is not a term list", () => {
    assert.equal(
      looksLikeTermList(
        "Kærandi gerði kröfu til að hann og sambýliskona hans væru skattlögð sem hjón. Kröfunni var hafnað."
      ),
      false
    );
  });

  test("a one-sentence summary is not a term list either", () => {
    assert.equal(looksLikeTermList("Kröfu kæranda var hafnað."), false);
  });
});

describe("the statute table", () => {
  test("keeps one entry per act, as the board prints them", () => {
    assert.deepEqual(
      parseStatutes(`<p>
         Lög nr. 75/1981, 30. gr. 1. mgr. A-liður 1. tölul. &nbsp;
         Lög nr. 37/1993, 11. gr. &nbsp;
         Reglugerð nr. 591/1987, 6. gr., 7. gr. &nbsp;
       </p>`),
      [
        "Lög nr. 75/1981, 30. gr. 1. mgr. A-liður 1. tölul.",
        "Lög nr. 37/1993, 11. gr.",
        "Reglugerð nr. 591/1987, 6. gr., 7. gr.",
      ]
    );
  });
});

describe("a modern ruling", () => {
  const ruling = parseRuling(MODERN)!;

  test("reads the board, the number, the gjaldár and the date", () => {
    assert.equal(ruling.board, "yfirskattanefnd");
    assert.equal(ruling.rulingNumber, "107/2026");
    assert.equal(ruling.period, "Gjaldár 2020");
    assert.equal(ruling.date?.toISOString().slice(0, 10), "2026-07-08");
  });

  test("the ruling number and the case number are different things", () => {
    // "Úrskurður nr. 107/2026" is how the ruling is cited; "mál nr. 1/2026" is
    // the board's own file. Storing one as the other would make every citation
    // to this ruling point somewhere else.
    assert.equal(ruling.caseNumber, "1/2026");
    assert.notEqual(ruling.caseNumber, ruling.rulingNumber);
  });

  test("the list above the bold paragraph makes the paragraph a summary", () => {
    assert.deepEqual(ruling.terms, ["Leiðrétting skattskila", "Sönnun"]);
    assert.match(ruling.summary ?? "", /^A óskaði á árinu 2023/);
  });

  test("the body keeps its paragraphs and starts at the opening", () => {
    assert.match(ruling.body, /^Ár 2026, miðvikudaginn 8\. júlí/);
    assert.equal(ruling.body.split("\n").length, 4);
  });

  test("the record puts the summary where a result card can find it", () => {
    const summary = extractSummary(composeRecord(ruling));
    assert.match(summary ?? "", /^A óskaði á árinu 2023/);
    assert.doesNotMatch(summary ?? "", /Málavextir/);
  });

  test("every heading the record composes renders as one", () => {
    const headings = parseJudgmentText(composeRecord(ruling))
      .filter((b) => b.kind === "heading")
      .map((b) => b.text);
    for (const heading of ["Lykilorð", "Skrá um lög", "Útdráttur", "Úrskurður"]) {
      assert.ok(headings.includes(heading), `${heading} did not render as a heading`);
    }
  });

  test("the card is titled by the board's own index terms", () => {
    assert.equal(rulingTitle(ruling), "Leiðrétting skattskila — Sönnun");
  });
});

describe("a ríkisskattanefnd ruling", () => {
  const ruling = parseRuling(OLD)!;

  test("is named as the body that actually decided it", () => {
    assert.equal(ruling.board, "rikisskattanefnd");
    assert.equal(boardName(ruling.board), "Ríkisskattanefnd");
  });

  test("has no date, because the published text states none", () => {
    assert.equal(ruling.date, undefined);
  });

  test("reads its bold line as index terms rather than as a summary", () => {
    assert.deepEqual(ruling.terms, ["Dánarbú", "Eignarskattsstofn", "Lögaðili"]);
    assert.equal(ruling.summary, undefined);
  });

  test("decodes the numeric entities the site escapes its text with", () => {
    assert.match(ruling.body, /Kærður er úrskurður skattstjóra/);
  });

  test("the record carries no Útdráttur it does not have", () => {
    assert.equal(extractSummary(composeRecord(ruling)), null);
  });
});

describe("titles", () => {
  test("fall back to the ruling number when the board indexed no terms", () => {
    const ruling = parseRuling(OLD.replace(/<p class="resultparagraphBold">[\s\S]*?<\/p>/, ""))!;
    assert.deepEqual(ruling.terms, []);
    assert.equal(rulingTitle(ruling), "Úrskurður ríkisskattanefndar nr. 474/1984");
  });

  test("stop at a readable length, though every term stays a tag", () => {
    const many = Array.from({ length: 25 }, (_, i) => `Fyrnanleg eign ${i}`);
    const title = rulingTitle({ board: "rikisskattanefnd", terms: many, statutes: [], body: "" });
    assert.ok(title.length <= 110, title);
    assert.ok(title.startsWith("Fyrnanleg eign 0 — "));
  });
});

describe("a page that is not a ruling", () => {
  test("is refused rather than stored empty", () => {
    assert.equal(parseRuling("<h1>Villa kom upp</h1>"), undefined);
  });
});

describe("what a bounded run does first", () => {
  const missing = [1973, 1999, 2024, 2025, 2026].map((year) => ({ year }));

  test("this year and last year, before any of the backfill", () => {
    assert.deepEqual(ingestOrder(missing, 2026), [
      { year: 2026 },
      { year: 2025 },
      { year: 1973 },
      { year: 1999 },
      { year: 2024 },
    ]);
  });

  test("the backfill runs from the oldest end, so runs do not overlap", () => {
    const older = ingestOrder([2010, 1980, 1995].map((year) => ({ year })), 2026);
    assert.deepEqual(older, [{ year: 1980 }, { year: 1995 }, { year: 2010 }]);
  });
});

test("the year a listing page is showing is read, not assumed", () => {
  assert.equal(parseActiveYear(INDEX), 2026);
  assert.equal(parseActiveYear(`<a href="?year=2025">2025</a>`), undefined);
});

test("the source key is the one the registry uses", () => {
  assert.equal(YFIRSKATTANEFND_SOURCE_KEY, "yfirskattanefnd");
});
