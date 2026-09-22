import { Client } from "pg";
import { readFileSync } from "fs";
import { join } from "path";

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set.");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(readFileSync(join(__dirname, "sql", "setup-auth.sql"), "utf-8"));
    console.log("Saved-document table is ready. Existing data was preserved.");
  } finally { await client.end(); }
}
main().catch(() => { console.error("db:setup-auth failed. Check database access and schema."); process.exit(1); });
