/**
 * Seeds the three court sources and a handful of SAMPLE judgments so the UI
 * and search pipeline can be exercised before real ingestion is wired up.
 *
 * Every seeded document is flagged isSample=true, titled "[SAMPLE]", and its
 * officialUrl points to the real *listing* page (island.is/domar) — no fake
 * deep links and no fabricated judgment content presented as real. Replace
 * them by running the real adapter:
 *   npm run ingest -- --adapter=icelandic-courts
 */
import { PrismaClient } from "@prisma/client";
import { createHash } from "crypto";
import { SOURCES } from "../src/lib/sources";

const prisma = new PrismaClient();
const hash = (t: string) => createHash("sha256").update(t).digest("hex");

const sampleText = (extra: string) =>
  `[SAMPLE DOCUMENT — placeholder text for development. This is not a real judgment.]\n\n` +
  `Þetta er sýnishorn af skjali til að prófa leitarvélina. Textinn inniheldur íslenska stafi: á, ð, é, í, ó, ú, ý, þ, æ, ö. ` +
  `${extra}\n\n` +
  `Í málinu reynir á meginreglur einkamálaréttarfars og sönnunarmat dómstóla. ` +
  `Run the real ingestion adapter (npm run ingest -- --adapter=icelandic-courts) to replace this sample content.`;

async function main() {
  for (const s of SOURCES) {
    await prisma.source.upsert({
      where: { key: s.key },
      update: { name: s.name, officialBaseUrl: s.officialBaseUrl },
      create: { key: s.key, name: s.name, officialBaseUrl: s.officialBaseUrl },
    });
  }

  const docs = [
    {
      source: "haestirettur", court: "Hæstiréttur Íslands",
      caseNumber: "22/2023", caseName: "[SAMPLE] A gegn B",
      title: "[SAMPLE] Hæstaréttardómur — skaðabætur og sönnunarbyrði",
      date: new Date("2023-11-15"), parties: "A; B",
      subjectTags: ["skaðabætur", "sönnun"],
      officialUrl: "https://island.is/domar",
      fullText: sampleText("Ágreiningur aðila laut að skaðabótaskyldu og sönnunarbyrði um orsakatengsl."),
    },
    {
      source: "landsrettur", court: "Landsréttur",
      caseNumber: "456/2024", caseName: "[SAMPLE] C ehf. gegn D",
      title: "[SAMPLE] Landsréttardómur — vinnuréttur og uppsögn",
      date: new Date("2024-06-02"), parties: "C ehf.; D",
      subjectTags: ["vinnuréttur", "uppsögn"],
      officialUrl: "https://island.is/domar",
      fullText: sampleText("Deilt var um lögmæti uppsagnar og hlutastörf, sbr. tilskipun 97/81/EB."),
    },
    {
      source: "heradsdomar", court: "Héraðsdómur Reykjavíkur",
      caseNumber: "E-3210/2025", caseName: "[SAMPLE] E gegn íslenska ríkinu",
      title: "[SAMPLE] Héraðsdómur — skipulagslög og bótaréttur",
      date: new Date("2025-03-20"), parties: "E; íslenska ríkið",
      subjectTags: ["skipulagsmál", "bætur"],
      officialUrl: "https://island.is/domar",
      fullText: sampleText("Krafist var bóta á grundvelli 51. gr. skipulagslaga vegna skerðingar á nýtingu fasteignar."),
    },
    {
      source: "haestirettur", court: "Hæstiréttur Íslands",
      caseNumber: "88/2022", caseName: "[SAMPLE] F gegn Tryggingastofnun",
      title: "[SAMPLE] Hæstaréttardómur — almannatryggingar",
      date: new Date("2022-09-08"), parties: "F; Tryggingastofnun",
      subjectTags: ["almannatryggingar"],
      officialUrl: "https://island.is/domar",
      fullText: sampleText("Reyndi á rétt til greiðslna úr almannatryggingum og skýringu á búsetuskilyrðum."),
    },
  ];

  for (const d of docs) {
    const officialUrl = `${d.officialUrl}#sample-${d.caseNumber}`;
    await prisma.document.upsert({
      where: { source_officialUrl: { source: d.source, officialUrl } },
      update: {},
      create: {
        ...d,
        language: "is",
        year: d.date.getFullYear(),
        officialUrl,
        textHash: hash(d.fullText),
        isSample: true,
      },
    });
  }

  console.log(`Seeded ${SOURCES.length} court sources and ${docs.length} sample judgments.`);
}

main().finally(() => prisma.$disconnect());
