/**
 * Runs prisma/sql/pre-push.sql — the schema changes `prisma db push` will not
 * make unattended — and runs them *before* push, which is the whole point.
 *
 * Same shape as setup-search.ts and setup-lemmas.ts, and for the same reason:
 * `psql` is not guaranteed to exist on Railway's Nixpacks Node image, so the
 * file goes over `pg` directly. It is one dollar-quoted block with no semicolons
 * outside it, so node-postgres can send it as a single simple query.
 *
 * It is a no-op on a database that has already had it, and on a fresh one where
 * push is about to create everything from the schema. See the SQL for what that
 * costs and why the alternative — `--accept-data-loss` in the deploy command —
 * was not worth it.
 *
 * Usage: npm run db:pre-push   (first step of `npm run db:deploy`)
 */
import { Client } from "pg";
import { readFileSync } from "fs";
import { join } from "path";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }

  const sql = readFileSync(join(__dirname, "sql", "pre-push.sql"), "utf-8");
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(sql);
    console.log("Pre-push migrations applied (or already in place).");
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error("db:pre-push failed:", e.message ?? e);
  process.exit(1);
});
