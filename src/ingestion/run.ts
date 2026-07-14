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
import { politeFetchText, saveDocument, type IngestionAdapter, type IngestContext } from "./adapter";
import { icelandicCourtsAdapter } from "./adapters/icelandic-courts";

const ADAPTERS: Record<string, IngestionAdapter> = {
  "icelandic-courts": icelandicCourtsAdapter,
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

  const run = await prisma.ingestionRun.create({ data: { sourceKey: adapter.key } });

  const ctx = {
    fetchText: politeFetchText,
    save: dryRun
      ? async (doc: any) => {
          console.log(`[dry-run] would save: ${doc.title} (${doc.officialUrl})`);
          return "skipped" as const;
        }
      : saveDocument,
    log: (msg: string) => console.log(`[${adapter.key}] ${msg}`),
  };

  try {
    const stats = await adapter.run(ctx);
    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: { finishedAt: new Date(), status: "success", ...stats },
    });
    await prisma.source.updateMany({
      where: { key: adapter.key },
      data: { lastIngestedAt: new Date() },
    });
    console.log(`Done: indexed=${stats.indexed} skipped=${stats.skipped} errors=${stats.errors}`);
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
