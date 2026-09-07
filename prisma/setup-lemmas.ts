/**
 * Runs prisma/sql/setup-lemmas.sql against DATABASE_URL, the same way
 * prisma/setup-search.ts runs its own file and for the same reason: `psql` is
 * not guaranteed to exist on a deploy platform's build image.
 *
 * Creates the `bin_lemma` table and the lemma vectors; it does not populate
 * the dictionary. Run `npm run db:load-bin` after this.
 *
 * Usage: npm run db:setup-lemmas
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

  const sql = readFileSync(join(__dirname, "sql", "setup-lemmas.sql"), "utf-8");
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(sql);
    console.log(
      "Lemma setup complete: bin_lemma table, lemma vectors, triggers and indexes are in place.\n" +
        "Populate the dictionary with `npm run db:load-bin`."
    );
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error("db:setup-lemmas failed:", e.message ?? e);
  process.exit(1);
});
