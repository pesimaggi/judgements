/**
 * Ingestion runner.
 *
 *   npm run ingest -- --adapter=icelandic-courts --dry-run
 *   npm run ingest -- --adapter=icelandic-courts
 *
 * Each run is recorded in IngestionRun and shown on /admin/ingestion.
 * Schedule with cron / a worker in production; the MVP runs on demand.
 */
import { prisma } from "@/lib/db";
import { ALL_SOURCES } from "@/lib/sources";
import {
  politeFetchText,
  saveDocument,
  isDocumentKnown,
  recordIngestGap,
  openIngestGaps,
  retireDocuments,
  type IngestionAdapter,
  type IngestContext,
} from "./adapter";
import { icelandicCourtsAdapter } from "./adapters/icelandic-courts";
import { eftaCourtAdapter } from "./adapters/efta-court";
import { eeaLexAdapter } from "./adapters/eea-lex";
import { eftaSurvAdapter } from "./adapters/eftasurv";
import { umbodsmadurAdapter } from "./adapters/umbodsmadur";
import { stjornarradidAdapter } from "./adapters/stjornarradid";
import { felagsdomurAdapter } from "./adapters/felagsdomur";
import { uuaAdapter } from "./adapters/uua";
import { obyggdanefndAdapter } from "./adapters/obyggdanefnd";
import { neytendamalAdapter } from "./adapters/neytendamal";
import { logrettaAdapter } from "./adapters/logretta";
import { ulfljoturAdapter } from "./adapters/ulfljotur";
import { lagasafnAdapter } from "./adapters/lagasafn";
import { citationsAdapter } from "./citations";

const ADAPTERS: Record<string, IngestionAdapter> = {
  "icelandic-courts": icelandicCourtsAdapter,
  "efta-court": eftaCourtAdapter,
  "eea-lex": eeaLexAdapter,
  eftasurv: eftaSurvAdapter,
  umbodsmadur: umbodsmadurAdapter,
  stjornarradid: stjornarradidAdapter,
  felagsdomur: felagsdomurAdapter,
  uua: uuaAdapter,
  obyggdanefnd: obyggdanefndAdapter,
  neytendamal: neytendamalAdapter,
  logretta: logrettaAdapter,
  ulfljotur: ulfljoturAdapter,
  lagasafn: lagasafnAdapter,
  citations: citationsAdapter,
};

async function main() {
  const args = new Map(
    process.argv.slice(2).map((a) => {
      const [k, v] = a.replace(/^--/, "").split("=");
      return [k, v ?? "true"] as const;
    })
  );
  const adapterKey = args.get("adapter");
  const dryRun = args.get("dry-run") === "true";

  if (!adapterKey || !ADAPTERS[adapterKey]) {
    console.log(`Usage: npm run ingest -- --adapter=<name> [--dry-run]`);
    console.log(`Available adapters: ${Object.keys(ADAPTERS).join(", ")}`);
    process.exit(1);
  }
  const adapter = ADAPTERS[adapterKey];
  console.log(`Running adapter: ${adapter.name}${dryRun ? " (dry run)" : ""}`);

  // db:deploy runs `prisma db push` and the search setup, but not the seed, so
  // a source added since the last seed has no Source row — and without one the
  // progress and status pages, which read that table, cannot show it at all.
  // Upserting here keeps the registry in src/lib/sources.ts as the authority.
  for (const key of adapter.sourceKeys) {
    const def = ALL_SOURCES.find((s) => s.key === key);
    if (!def) continue;
    await prisma.source.upsert({
      where: { key: def.key },
      update: { name: def.name, officialBaseUrl: def.officialBaseUrl },
      create: { key: def.key, name: def.name, officialBaseUrl: def.officialBaseUrl },
    });
  }

  const run = await prisma.ingestionRun.create({
    data: { sourceKey: adapter.key, mode: process.env.INGEST_MODE || null },
  });

  const ctx: IngestContext = {
    fetchText: politeFetchText,
    save: dryRun
      ? async (doc) => {
          console.log(`[dry-run] would save: ${doc.title} (${doc.officialUrl})`);
          return "skipped" as const;
        }
      : saveDocument,
    isKnown: isDocumentKnown,
    // A dry run must not write to the gap ledger either — it would record
    // every case it declined to fetch as a gap it had failed on.
    recordGap: dryRun ? async () => {} : recordIngestGap,
    openGaps: openIngestGaps,
    // A dry run must not delete either: it has saved nothing, so every stored
    // document would look like one the source had withdrawn.
    retire: dryRun
      ? async (source, urls) => {
          console.log(`[dry-run] would retire ${urls.length} document(s) from ${source}`);
          return 0;
        }
      : retireDocuments,
    log: (msg: string) => console.log(`[${adapter.key}] ${msg}`),
  };

  try {
    const stats = await adapter.run(ctx);
    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: { finishedAt: new Date(), status: "success", ...stats },
    });
    await prisma.source.updateMany({
      where: { key: { in: adapter.sourceKeys } },
      data: { lastIngestedAt: new Date() },
    });
    console.log(`Done: indexed=${stats.indexed} skipped=${stats.skipped} errors=${stats.errors}`);

    // The number that actually answers "are we there yet". Printed after every
    // run so a shortfall is visible in the deploy log instead of only showing
    // up as a percentage on the front page that nobody can explain.
    const outstanding = await prisma.ingestGap.groupBy({
      by: ["reason"],
      where: { source: { in: adapter.sourceKeys }, resolvedAt: null },
      _count: { _all: true },
    });
    if (outstanding.length) {
      const total = outstanding.reduce((n, r) => n + r._count._all, 0);
      const breakdown = outstanding.map((r) => `${r.reason}=${r._count._all}`).join(" ");
      console.log(`Outstanding gaps for this adapter: ${total} (${breakdown})`);
    } else {
      console.log(`Outstanding gaps for this adapter: none`);
    }
  } catch (e) {
    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: { finishedAt: new Date(), status: "failed", errorSample: String(e) },
    });
    console.error(e);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
