/**
 * Frumvörp adapter — the bills Icelandic acts were passed from, with their
 * greinargerð, from Alþingi.
 *
 * This is the corpus the well needs and did not have. Up to now the app stored
 * a *link* to each act's bill (`Act.billUrl`, read off the Lagasafn page) and
 * nothing behind it, which is worth something to a reader with a browser and
 * nothing at all to an assistant answering a question: a URL is not text.
 *
 * ── It walks the acts, not a listing ───────────────────────────────────────
 *
 * Every Lagasafn act page links the þingskjal it was passed from, and that
 * link is already on the act. So this adapter needs no index of its own, and
 * cannot drift out of step with one: it selects acts that have a billUrl and
 * no stored bill, fetches it, and stores it. An act arrives, its bill follows
 * on the next firing.
 *
 * `ctx.isKnown(source, officialUrl)` is the whole of the watermark — a bill
 * already stored under its own URL is skipped before it is fetched, which is
 * the same mechanism the court adapters use and needs no new column.
 *
 * ── What it stores ─────────────────────────────────────────────────────────
 *
 * One `Document` per bill, under the `althingi-frumvorp` source, holding the
 * bill's text and its memorandum. Its `officialUrl` is the act's `billUrl`,
 * which is what joins the two without a foreign key.
 *
 * The bill is *not* a decision and must never be counted as one. `SourceDef`
 * carries `kind: "travaux"` for that reason, and the provision citation job
 * skips it: a bill cites the acts it amends on nearly every page, and the
 * badge those links feed says "úrlausnir".
 *
 * ── Access ─────────────────────────────────────────────────────────────────
 *
 * Alþingi's `/altext/` tree is served through Cloudflare and refuses every
 * datacenter this has run from — the development sandbox it was written in and
 * the Railway ingest both — while `/lagas/` from the same machines answers
 * fine, so the parser was built against pages recovered from the Internet
 * Archive. The first version of this comment left that as a question only a
 * scheduled run could answer; the runs have answered it, identically, on every
 * firing since. Which is what the reporting below is for: a 403 on the first
 * fetch is logged as a blocked source rather than as one act's error, so the
 * run's log distinguishes "Alþingi will not serve us" from "this bill is
 * missing".
 *
 * The adapter stays in the schedule to notice the day that changes, and the
 * corpus has to arrive another way. It needs no index and no crawl — only
 * `Act.billUrl` out of the database — so the same run from a network
 * Cloudflare serves fills the same rows; see docs/regulations-and-travaux.md
 * §2.2.1 for the command, and for the other way out, which is asking Alþingi
 * to undo what looks like bot-management collateral rather than policy.
 */
import { prisma } from "@/lib/db";
import { parseThingskjal, parseThingskjalUrl } from "@/lib/thingskjal";
import { pdfText } from "../pdf-text";
import type { NormalizedDocument } from "@/lib/types";
import type { IngestionAdapter, IngestContext, IngestStats } from "../adapter";

const SOURCE = "althingi-frumvorp";
const COURT = "Alþingi";

/** How many bills one run may fetch. */
const MAX_BILLS = Number(process.env.FRUMVORP_MAX_BILLS ?? 200);

/** An act whose bill has not been stored yet. */
interface Outstanding {
  actNumber: number;
  year: number;
  actTitle: string;
  billUrl: string;
}

/**
 * Acts that link a bill this database does not hold.
 *
 * A left join against Document on the URL, rather than a query per act: there
 * are ~900 acts and asking nine hundred times whether each one's bill exists
 * is nine hundred round trips to decide there is nothing to do.
 */
export async function outstandingBills(limit: number): Promise<Outstanding[]> {
  const rows = await prisma.$queryRaw<
    { act_number: number; year: number; title: string; bill_url: string }[]
  >`
    SELECT a.act_number, a.year, a.title, a.bill_url
      FROM acts a
     WHERE a.jurisdiction = 'is'
       AND a.doc_type = 'act'
       AND a.bill_url IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM "Document" d
          WHERE d.source = ${SOURCE} AND d.official_url = a.bill_url
       )
     ORDER BY a.year DESC, a.act_number DESC
     LIMIT ${limit}
  `;
  return rows.map((r) => ({
    actNumber: r.act_number,
    year: r.year,
    actTitle: r.title,
    billUrl: r.bill_url,
  }));
}

/**
 * Turns a parsed þingskjal into the document row.
 *
 * `caseNumber` is the parliamentary reference — "783/130", mál over þing —
 * because that is how a bill is cited and looked up, and the column is what
 * the search UI shows beside a result.
 */
export function billDocument(
  parsed: ReturnType<typeof parseThingskjal>,
  act: Outstanding
): NormalizedDocument {
  const reference =
    parsed.caseNumber && parsed.parliament ? `${parsed.caseNumber}/${parsed.parliament}` : null;
  // The bill's own title where it has one, and the act's otherwise: a bill
  // published only as a PDF still deserves a row a reader can recognise.
  const title = parsed.title || `Frumvarp til laga nr. ${act.actNumber}/${act.year}`;
  const body = [
    parsed.fullText,
    // The memorandum is inside fullText already; repeating the article-by-
    // article section would double it in the search index.
  ]
    .filter(Boolean)
    .join("\n\n");
  return {
    source: SOURCE,
    court: COURT,
    caseNumber: reference ?? undefined,
    title,
    year: act.year,
    language: "is",
    // The act the bill became, as the one tag worth carrying: it is how a
    // reader finds the bill from the act's number, and the act's own title is
    // already the bill's in all but wording.
    subjectTags: [`lög nr. ${act.actNumber}/${act.year}`],
    officialUrl: act.billUrl,
    fullText: body,
  };
}

/** Whether an error is Alþingi refusing to serve us at all. */
function isBlocked(e: unknown): boolean {
  return /HTTP 40[313]/.test(String(e));
}

export const frumvorpAdapter: IngestionAdapter = {
  key: "frumvorp",
  name: "Frumvörp og greinargerðir (Alþingi)",
  sourceKeys: [SOURCE],

  async run(ctx: IngestContext): Promise<IngestStats> {
    const stats: IngestStats = { indexed: 0, skipped: 0, errors: 0 };

    const outstanding = await outstandingBills(MAX_BILLS);
    if (outstanding.length === 0) {
      ctx.log("Every act that links a bill already has it stored.");
      return stats;
    }
    ctx.log(`${outstanding.length} act(s) link a bill this database does not hold`);

    let blocked = 0;
    for (const act of outstanding) {
      const label = `${act.actNumber}/${act.year}`;
      try {
        const ref = parseThingskjalUrl(act.billUrl);
        let parsed;

        if (ref?.format === "pdf") {
          // The older þing are published only as scans; pdf-text.ts is what
          // the ESA and Óbyggðanefnd adapters already use for the same job.
          const { politeFetchBytes } = await import("../adapter");
          const { body } = await politeFetchBytes(act.billUrl);
          const text = await pdfText(body);
          if (!text.trim()) {
            stats.skipped++;
            ctx.log(`  ${label}: bill is a scan with no extractable text`);
            continue;
          }
          parsed = {
            documentNumber: ref.documentNumber,
            caseNumber: null,
            parliament: ref.parliament,
            title: "",
            kind: "frumvarp" as const,
            fullText: text,
            hasText: true,
            generalCommentary: "",
            articleCommentary: [],
            relatedDocuments: [],
          };
        } else {
          parsed = parseThingskjal(await ctx.fetchText(act.billUrl));
        }

        if (!parsed.hasText) {
          // The page carries a header and a document list and no text: the
          // bill is published only as a PDF alongside it. Recorded as a gap
          // rather than stored empty, so the shortfall is visible and a later
          // pass can go after the PDF.
          await ctx.recordGap({
            adapter: "frumvorp",
            source: SOURCE,
            officialUrl: act.billUrl,
            court: COURT,
            caseNumber: `${act.actNumber}/${act.year}`,
            title: parsed.title || act.actTitle,
            reason: "no-text",
            detail: "þingskjal published only as PDF",
          });
          stats.skipped++;
          continue;
        }

        const result = await ctx.save(billDocument(parsed, act));
        if (result === "indexed") stats.indexed++;
        else stats.skipped++;

        if (parsed.articleCommentary.length > 0 && stats.indexed % 25 === 1) {
          ctx.log(
            `  ${label} "${parsed.title}": ${parsed.articleCommentary.length} articles commented on`
          );
        }
      } catch (e) {
        if (isBlocked(e)) {
          blocked++;
          // One line, not one per act: a blocked source produces the same
          // error nine hundred times and drowns everything else in the run.
          if (blocked === 1) {
            ctx.log(
              `  Alþingi refused the request for ${act.billUrl} (${String(e).slice(0, 80)}). ` +
                `If this repeats for every bill, /altext/ is not being served to this ` +
                `deployment and no amount of retrying will change it — see the adapter header.`
            );
          }
          stats.errors++;
          // Ten refusals in a row is the source, not the bills.
          if (blocked >= 10) {
            ctx.log(`  Giving up after ${blocked} refusals; nothing was stored.`);
            break;
          }
          continue;
        }
        stats.errors++;
        stats.errorSample = stats.errorSample ?? `${label}: ${String(e)}`;
        ctx.log(`  error on ${label}: ${String(e).slice(0, 200)}`);
      }
    }

    ctx.log(
      `Stored ${stats.indexed} bill(s), skipped ${stats.skipped}, ${stats.errors} error(s)` +
        (blocked ? ` — ${blocked} of them refusals from Alþingi` : "")
    );
    return stats;
  },
};
