/**
 * The founding treaties — the EEA Agreement, the TEU and the TFEU — as acts.
 *
 * Four fetches a run, which makes this by a wide margin the cheapest adapter
 * here: the registry in src/lib/treaties.ts lists three instruments, and one of
 * them is stored twice because it exists in two authentic texts.
 *
 * WHERE EACH TEXT COMES FROM, AND WHY NOT THE OBVIOUS PLACE.
 *
 * The English texts come from Cellar by CELEX, like the EU acts. Two of the
 * three are consolidations that the Official Journal publishes *with all 37
 * protocols attached*, which is why the treaty layout in lib/eur-lex.ts cuts the
 * document at the PROTOCOLS heading: parsed whole, the TFEU has 1,137 articles
 * instead of 358.
 *
 * The Icelandic text of the EEA Agreement comes from Lagasafn — fylgiskjal I of
 * lög nr. 2/1993 — and not from the copy the ministry publishes as a PDF. Both
 * are real, and Lagasafn wins on every count that matters: it is the text 2. gr.
 * of that act gives lagagildi, Alþingi maintains it at the current codex
 * version, it carries the amendment brackets and footnotes, and this app already
 * fetches the page every day for the act itself. The ministry's PDF is a
 * cross-check — it reads cleanly, and it says "Uppfært 1.8.2016" at the top of
 * every page.
 *
 * WHAT IS NOT STORED. The protocols and the annexes, to either treaty. The EEA
 * annexes are the lists of EU acts taken into the Agreement, which this database
 * already approaches from the other end — through `eea_incorporated_by` and the
 * Joint Committee's decisions — and the protocols are worth nothing until
 * something cites them. The Agreement's preamble goes the same way for a duller
 * reason: neither source marks it as a provision, so there is nowhere to put it
 * that would not be inventing an article.
 *
 * TWO TEXTS, ONE INSTRUMENT. Each text is its own `Act` row, and the two are
 * tied by `textGroup`. Only one is `isCanonical` — Icelandic for the Agreement,
 * English for the other two — and that row owns the instrument: its URL, the
 * citation links from judgments, the counts on its articles. The other is
 * reached from it. That distinction is enforced in corpusFilter(), not here; the
 * job of this adapter is to write it down correctly.
 *
 * Run with:  npm run ingest -- --adapter=treaties
 */
import { createHash } from "crypto";
import { prisma } from "@/lib/db";
import {
  CELLAR_HEADERS,
  cellarTextUrl,
  euLexUrl,
  parseEuActHtml,
  type ParsedEuAct,
  type ParsedEuProvision,
} from "@/lib/eur-lex";
import { parseLagasafnHtml, actUrl as lagasafnActUrl } from "@/lib/lagasafn";
import {
  TREATIES,
  TREATY_DOC_TYPE,
  TREATY_JURISDICTION,
  canonicalLanguage,
  treatyAnchor,
  treatyParagraphAnchor,
  type TreatyDef,
} from "@/lib/treaties";
import { politeFetchText } from "../adapter";
import { saveEuActText } from "./eur-lex";
import type { IngestContext, IngestStats, IngestionAdapter } from "../adapter";

/**
 * Which release of this adapter's parses produced the stored structure, in the
 * column the Lagasafn adapter uses for the same question.
 *
 * Bumping it is the whole of a backfill: a run re-reads any text stored by an
 * older version, and without it an improvement to the treaty layout or the
 * annex walk would only reach a treaty that changed upstream — which, for a
 * treaty, is roughly once a decade.
 */
const PARSE_VERSION = 1;

/** "28. gr.", "[28. gr. a]" — the way the annexed Icelandic text labels one. */
const ICELANDIC_ARTICLE = /^\[?(\d+)\.\s*gr\.\s*([a-záðéíóúýþæö])?\.?\]?$/i;

/**
 * The divisions of one fylgiskjal, by the labels the Lagasafn parser builds.
 *
 * "Fylgiskjal I" must not match "Fylgiskjal II", which a prefix test does — and
 * fylgiskjal II of lög nr. 2/1993 is bókun 1, whose articles are numbered from 1
 * like the Agreement's. Getting this wrong would append a second Article 1 to
 * the treaty.
 */
function annexDivisionRe(annex: string): RegExp {
  return new RegExp(`^Fylgiskjal ${annex}(?![IVXLCDM])`);
}

function hashParsed(parsed: ParsedEuAct): string {
  // Separators as escapes, not raw control characters, for the reason the other
  // two adapters' hashAct gives: typed literally they make the file read as
  // binary to git and grep.
  const body = parsed.provisions
    .map((p) => `${p.anchor}\u0000${p.displayLabel}\u0000${p.heading ?? ""}\u0000${p.fullText}`)
    .join("\u0001");
  return createHash("sha256").update(body).digest("hex");
}

/**
 * Re-anchors a parsed article on the treaty's own numbering.
 *
 * EUR-Lex anchors the TFEU's articles `art_28` and Lagasafn anchors the same
 * article of the Agreement `X27`; stored as they arrive, `/log/ees#A28` would
 * land somewhere else the moment a reader switched language. Both texts agree on
 * the article number — a treaty's language versions are one instrument, numbered
 * once — so the number is what both are keyed on. See treatyAnchor().
 */
function reanchor(provision: ParsedEuProvision): ParsedEuProvision | null {
  if (provision.articleNumber === null) return null;
  const anchor = treatyAnchor(provision.articleNumber, provision.articleLetter);
  return {
    ...provision,
    anchor,
    paragraphs: provision.paragraphs.map((paragraph) => ({
      ...paragraph,
      anchor: treatyParagraphAnchor(anchor, paragraph.number),
    })),
  };
}

/**
 * The English text, out of what Cellar served.
 *
 * Exported apart from the fetch because what can go wrong here is silent: a
 * layout change upstream, or a protocol's articles surviving the cut, both
 * produce a treaty that parses — with the wrong articles in it. See the tests.
 */
export function parseEnglishTreaty(html: string, treaty: TreatyDef): ParsedEuAct {
  const parsed = parseEuActHtml(html);
  const provisions = parsed.provisions
    // Annexed material is not stored: see the header. On the EEA Agreement this
    // is also what drops the three ANNEX entries the legacy walk finds in the
    // list of annexes printed after Article 129.
    .filter((p) => p.kind === "article")
    .map(reanchor)
    .filter((p): p is ParsedEuProvision => p !== null);
  return { ...parsed, provisions, title: parsed.title ?? treaty.titleEn };
}

async function fetchEnglish(treaty: TreatyDef): Promise<ParsedEuAct> {
  const html = await politeFetchText(cellarTextUrl(treaty.celexEn), CELLAR_HEADERS);
  // Cellar answers a throttled request with a short body and a 2xx, and a
  // treaty is never short: taking that at face value would store an instrument
  // with no articles and call it done.
  if (html.trim().length < 5000) {
    throw new Error(`short response for ${treaty.celexEn} (${html.trim().length} bytes)`);
  }
  return parseEnglishTreaty(html, treaty);
}

/**
 * The Icelandic text, out of the fylgiskjal it is printed in.
 *
 * The act's own articles are left where they are — the reader for lög nr. 2/1993
 * shows them, and its fylgiskjal, unchanged. What is taken here is the annexed
 * text, re-labelled as the instrument it is.
 */
export function parseIcelandicTreaty(html: string, treaty: TreatyDef): ParsedEuAct {
  const source = treaty.icelandicText;
  if (!source) throw new Error(`${treaty.slug} has no Icelandic text`);
  const act = parseLagasafnHtml(html);

  const inAnnex = annexDivisionRe(source.annex);
  /** Index in the act's chapter list → index in the treaty's. */
  const divisionMap = new Map<number, number>();
  const chapters: ParsedEuAct["chapters"] = [];
  act.chapters.forEach((chapter, i) => {
    if (!inAnnex.test(chapter.label)) return;
    // The fylgiskjal itself is not a division *of* the treaty — it is the
    // treaty — so its articles sit at the top level, as they do in the English
    // text. Its own divisions keep their names with the fylgiskjal stripped
    // off: "I. hluti", not "Fylgiskjal I — I. hluti".
    const own = chapter.label.replace(/^Fylgiskjal\s+\S+\s*(—\s*)?/, "").trim();
    if (!own) return;
    divisionMap.set(i, chapters.length);
    chapters.push({ label: own, title: chapter.title });
  });

  const provisions: ParsedEuProvision[] = [];
  for (const provision of act.provisions) {
    if (provision.chapterIndex === null) continue;
    const chapter = act.chapters[provision.chapterIndex];
    if (!chapter || !inAnnex.test(chapter.label)) continue;
    const m = ICELANDIC_ARTICLE.exec(provision.displayLabel);
    if (!m) continue;
    const articleNumber = Number(m[1]);
    const articleLetter = m[2]?.toLowerCase() ?? null;
    const anchor = treatyAnchor(articleNumber, articleLetter);
    provisions.push({
      kind: "article",
      anchor,
      articleNumber,
      articleLetter,
      displayLabel: provision.displayLabel,
      heading: provision.heading,
      chapterIndex: divisionMap.get(provision.chapterIndex) ?? null,
      paragraphs: provision.paragraphs.map((paragraph) => ({
        anchor: treatyParagraphAnchor(anchor, paragraph.number),
        number: paragraph.number,
        text: paragraph.text,
      })),
      fullText: provision.fullText,
    });
  }

  return {
    title: treaty.titleIs,
    chapters,
    provisions,
    eeaRelevanceStated: false,
    layout: "treaty",
  };
}

async function fetchIcelandic(treaty: TreatyDef): Promise<ParsedEuAct> {
  const source = treaty.icelandicText;
  if (!source) throw new Error(`${treaty.slug} has no Icelandic text`);
  return parseIcelandicTreaty(
    await politeFetchText(lagasafnActUrl(source.actNumber, source.year)),
    treaty
  );
}

/** Writes one text of one treaty, and says whether it had to. */
async function storeText(
  treaty: TreatyDef,
  language: "is" | "en",
  parsed: ParsedEuAct,
  ctx: IngestContext
): Promise<"indexed" | "skipped"> {
  const canonical = canonicalLanguage(treaty) === language;
  const sourceHash = hashParsed(parsed);
  const currentVersionUrl =
    language === "en"
      ? euLexUrl(treaty.celexEn)
      : lagasafnActUrl(treaty.icelandicText!.actNumber, treaty.icelandicText!.year);

  const identity = {
    jurisdiction: TREATY_JURISDICTION,
    docType: TREATY_DOC_TYPE,
    actNumber: treaty.ordinal,
    year: treaty.year,
    language,
  };

  const existing = await prisma.act.findUnique({
    where: { jurisdiction_docType_actNumber_year_language: identity },
    select: { id: true, sourceHash: true, parseVersion: true },
  });
  if (existing && existing.sourceHash === sourceHash && existing.parseVersion >= PARSE_VERSION) {
    return "skipped";
  }
  if (ctx.dryRun) return "indexed";

  const shared = {
    title: language === "en" ? treaty.titleEn : treaty.titleIs,
    citation: language === "en" ? treaty.citationEn : treaty.citationIs,
    aliases: treaty.aliases,
    status: "in_force",
    currentVersionUrl,
    textGroup: treaty.slug,
    isCanonical: canonical,
    parseVersion: PARSE_VERSION,
    // Only one row may carry a CELEX — the column is unique — and the English
    // text is the one that has one. The Icelandic text's identifier is the act
    // it is printed in, which `currentVersionUrl` already points at.
    celex: language === "en" ? treaty.celexEn : null,
    textCelex: language === "en" ? treaty.celexEn : null,
    fetchedAt: new Date(),
  };

  const act = await prisma.act.upsert({
    where: { jurisdiction_docType_actNumber_year_language: identity },
    create: { ...identity, ...shared, sourceHash },
    update: shared,
  });
  await saveEuActText(act.id, parsed, sourceHash);
  return "indexed";
}

/**
 * The EU corpus predates `Act.language`, so every EU act reads back as
 * Icelandic until something says otherwise.
 *
 * One idempotent statement, run here because this is the adapter the column
 * arrived with. It is not a per-row correction the catalogue sweep could make in
 * passing: that sweep walks a handful of years per firing, so an EU act would
 * carry the wrong language for as long as it took to come round again.
 */
async function backfillEuLanguage(ctx: IngestContext): Promise<number> {
  if (ctx.dryRun) return 0;
  const { count } = await prisma.act.updateMany({
    where: { jurisdiction: "eu", language: { not: "en" } },
    data: { language: "en" },
  });
  return count;
}

export const treatiesAdapter: IngestionAdapter = {
  key: "treaties",
  name: "Founding treaties (EEA Agreement, TEU, TFEU)",
  // These are acts, not documents: they belong in the act library beside lög
  // nr. 38/2001, not among the sources in the search panel. Same reason the
  // Lagasafn and EUR-Lex adapters declare none.
  sourceKeys: [],

  async run(ctx: IngestContext): Promise<IngestStats> {
    const stats: IngestStats = { indexed: 0, skipped: 0, errors: 0 };

    const relabelled = await backfillEuLanguage(ctx);
    if (relabelled > 0) console.log(`  language: marked ${relabelled} EU acts as English`);

    for (const treaty of TREATIES) {
      // Each text is fetched and stored on its own, so a treaty whose English
      // text Cellar will not serve still gets its Icelandic one — and a reader
      // gets the text that governs here rather than an empty page.
      const texts: { language: "is" | "en"; fetch: () => Promise<ParsedEuAct> }[] = [
        { language: "en", fetch: () => fetchEnglish(treaty) },
      ];
      if (treaty.icelandicText) {
        texts.unshift({ language: "is", fetch: () => fetchIcelandic(treaty) });
      }

      for (const text of texts) {
        try {
          const parsed = await text.fetch();
          if (parsed.provisions.length === 0) {
            // Distinctly an error and not an empty treaty. A parse that recovers
            // nothing means the source changed shape, and the stored text — the
            // one a reader is being served meanwhile — is left alone.
            stats.errors++;
            stats.errorSample ??= `${treaty.slug} (${text.language}): no articles parsed`;
            console.log(`  ${treaty.slug} ${text.language}: no articles parsed, keeping stored text`);
            continue;
          }
          const outcome = await storeText(treaty, text.language, parsed, ctx);
          stats[outcome === "indexed" ? "indexed" : "skipped"]++;
          console.log(
            `  ${treaty.slug} ${text.language}: ${parsed.provisions.length} articles, ${parsed.chapters.length} divisions — ${outcome}`
          );
        } catch (e) {
          stats.errors++;
          const message = e instanceof Error ? e.message : String(e);
          stats.errorSample ??= `${treaty.slug} (${text.language}): ${message}`;
          console.log(`  ${treaty.slug} ${text.language}: ${message}`);
        }
      }
    }

    return stats;
  },
};
