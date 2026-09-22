/**
 * Integration regression for Railway's pre-deploy command. Run only against a
 * fresh, disposable local database; CI supplies a dedicated Postgres container.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";

function command(executable: string, args: string[]) {
  const result = spawnSync(executable, args, {
    encoding: "utf8",
    timeout: 180_000,
    maxBuffer: 10 * 1024 * 1024,
    env: process.env,
  });
  if (result.error) throw result.error;
  return result;
}

function run(executable: string, args: string[]) {
  const result = command(executable, args);
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  assert.equal(result.status, 0, `Command failed: ${executable} ${args.join(" ")}`);
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  assert.ok(connectionString, "DATABASE_URL is required");
  const url = new URL(connectionString);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname),
    "This test only runs against local disposable Postgres");
  assert.equal(url.pathname, "/logbrunnur_deploy_test",
    "This test requires the dedicated logbrunnur_deploy_test database");

  const client = new Client({ connectionString });
  await client.connect();
  const dir = mkdtempSync(join(tmpdir(), "logbrunnur-deploy-"));
  try {
    const existing = await client.query(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public'",
    );
    assert.equal(existing.rowCount, 0, "Use a fresh database, never existing application data");

    // Recreate the schema before Prisma knew about the SQL-managed lemma data.
    // The unchanged setup SQL then creates the exact legacy table/column types.
    const schema = readFileSync("prisma/schema.prisma", "utf8");
    const legacySchema = schema
      .replace(/^  lemmaVector\s+Unsupported\("tsvector"\)\?[^\n]*\n/gm, "")
      .replace(/^  @@index\(\[lemmaVector[^\n]*\n/gm, "")
      .replace(/model BinLemma \{[\s\S]*?\n\}/, "");
    assert.notEqual(legacySchema, schema);
    const legacyPath = join(dir, "schema.prisma");
    writeFileSync(legacyPath, legacySchema);
    const prisma = ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"];
    run(process.execPath, [...prisma, "--schema", legacyPath]);
    run("npm", ["run", "db:setup-search"]);
    run("npm", ["run", "db:setup-lemmas"]);

    await client.query(`
      INSERT INTO bin_lemma (form, lemmas)
        VALUES ('samnings', ARRAY['samningur']), ('laga', ARRAY['lög', 'laga']);
      INSERT INTO "Document"
        (id, source, court, title, subject_tags, official_url, full_text, text_hash, updated_at)
        VALUES ('deploy-document', 'haestirettur', 'Hæstiréttur Íslands',
          'Prófun', ARRAY[]::text[], 'https://example.test/judgment',
          'samnings', 'fixture', now());
      INSERT INTO acts
        (id, act_number, year, title, aliases, current_version_url, source_hash,
         eea_incorporated_by, updated_at)
        VALUES ('deploy-act', 1, 2026, 'Prófun', ARRAY[]::text[],
          'https://example.test/act', 'fixture', ARRAY[]::text[], now());
      INSERT INTO provisions
        (id, act_id, display_label, anchor, full_text, ordering, updated_at)
        VALUES ('deploy-provision', 'deploy-act', '1. gr.', 'G1', 'samnings', 1, now());
      INSERT INTO saved_documents (clerk_user_id, document_id)
        VALUES ('user_deploy_fixture', 'deploy-document');
    `);

    async function snapshot() {
      const dictionary = await client.query("SELECT * FROM bin_lemma ORDER BY form");
      const documents = await client.query('SELECT to_jsonb(d) AS row FROM "Document" d ORDER BY id');
      const provisions = await client.query("SELECT to_jsonb(p) AS row FROM provisions p ORDER BY id");
      const saved = await client.query("SELECT * FROM saved_documents ORDER BY clerk_user_id, document_id");
      // These indexes are expensive to rebuild in the real corpus. Comparing
      // OIDs catches drop/recreate even if a setup script puts the names back.
      const relations = await client.query(`
        SELECT relname, oid FROM pg_class WHERE relnamespace = 'public'::regnamespace
          AND relname IN ('bin_lemma', 'bin_lemma_lemmas_idx',
                          'document_lemma_vector_idx', 'provision_lemma_vector_idx')
        ORDER BY relname
      `);
      assert.equal(relations.rowCount, 4);
      return { dictionary: dictionary.rows, documents: documents.rows,
        provisions: provisions.rows, saved: saved.rows, relations: relations.rows };
    }

    async function assertLemmaSearch() {
      const result = await client.query(`
        SELECT 'document' AS kind,
          lemma_vector @@ to_tsquery('simple', 'samningur') AS matches
          FROM "Document" WHERE id = 'deploy-document'
        UNION ALL
        SELECT 'provision',
          lemma_vector @@ to_tsquery('simple', 'samningur')
          FROM provisions WHERE id = 'deploy-provision'
      `);
      assert.equal(result.rowCount, 2);
      for (const row of result.rows) assert.equal(row.matches, true, row.kind);
    }

    await assertLemmaSearch();
    const before = await snapshot();
    // Prove the fixture reproduces the reported failure, without accepting loss.
    const rejected = command(process.execPath, [...prisma, "--schema", legacyPath]);
    assert.notEqual(rejected.status, 0, "Legacy schema must reject the populated lemma data");
    assert.match(rejected.stdout + rejected.stderr, /--accept-data-loss/);
    assert.deepEqual(await snapshot(), before, "Rejected push must leave data intact");

    for (let attempt = 1; attempt <= 2; attempt++) {
      run("npm", ["run", "db:deploy"]);
      assert.deepEqual(await snapshot(), before, `Deploy ${attempt} changed existing search/account data`);
      await assertLemmaSearch();
    }

    // The setup scripts must also leave their triggers usable for future ingest.
    await client.query(`
      UPDATE "Document" SET full_text = 'samnings samnings' WHERE id = 'deploy-document';
      UPDATE provisions SET full_text = 'samnings samnings' WHERE id = 'deploy-provision';
    `);
    await assertLemmaSearch();
    assert.notDeepEqual(await snapshot(), before, "Updates should refresh search vectors");
    console.log("Deployment preserves legacy dictionary, vectors, indexes and saved judgments; lemma search and triggers work.");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
