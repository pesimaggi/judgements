/**
 * Runs prisma/sql/setup-search.sql against DATABASE_URL directly via `pg`,
 * instead of shelling out to the `psql` CLI (which isn't guaranteed to exist
 * on a deploy platform's build image, e.g. Railway's Nixpacks Node image).
 *
 * The file is executed as one call: node-postgres sends a bare string query
 * over the simple query protocol, which — unlike the parameterized/extended
 * protocol — supports multiple ;-separated statements in a single round
 * trip. This is safe here because setup-search.sql has no semicolons inside
 * its single dollar-quoted function body.
 *
 * Usage: npm run db:setup-search   (also included in `npm run db:deploy`)
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

  const sqlPath = join(__dirname, "sql", "setup-search.sql");
  const sql = readFileSync(sqlPath, "utf-8");

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(sql);
    console.log("Search setup complete: pg_trgm/unaccent extensions, FTS function, and indexes are in place.");
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error("db:setup-search failed:", e.message ?? e);
  process.exit(1);
});
