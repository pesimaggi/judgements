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

/// Indexes that prisma/sql/*.sql creates and prisma/schema.prisma also
/// declares. The declarations earn their keep only if `prisma db push` then
/// leaves them alone: push drops every index missing from the schema, so an
/// undeclared one was dropped and rebuilt on every Railway deploy — a full GIN
/// rebuild of the corpus inside the pre-deploy window. Comparing pg_class OIDs
/// across two deploys is what catches a regression, because a drop followed by
/// setup-search.sql putting the same name back looks identical otherwise.
///
/// document_source_date_idx is absent on purpose. Prisma cannot express its
/// `NULLS LAST`, and a declaration would not even churn it — push accepts the
/// SQL's index as matching — but on a fresh database push would build it first,
/// as NULLS FIRST, and setup-search.sql's CREATE INDEX IF NOT EXISTS would then
/// leave that wrong ordering in place. So it stays undeclared, and stays one
/// btree that each deploy drops and rebuilds. See the note in schema.prisma.
const SQL_OWNED_INDEXES = [
  "document_search_vector_idx",
  "provision_search_vector_idx",
  "document_case_number_trgm_idx",
  "document_title_trgm_idx",
  "document_case_name_trgm_idx",
  "document_parties_trgm_idx",
  "document_subject_tags_idx",
  "acts_title_trgm_idx",
  "document_lemma_vector_idx",
  "provision_lemma_vector_idx",
  "bin_lemma_lemmas_idx",
];

/// bin_lemma itself is a table rather than an index: PR #70's concern was the
/// dictionary rows, not just the index over them.
const PRESERVED_RELATIONS = ["bin_lemma", ...SQL_OWNED_INDEXES];

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

    const schema = readFileSync("prisma/schema.prisma", "utf8");
    const prisma = ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"];

    // A brand-new database has to come up from the schema alone, before any of
    // our SQL has run. That is not free now that the trigram indexes are
    // declared: `gin_trgm_ops` does not exist until pg_trgm does, so the push
    // fails outright unless the datasource declares the extension. This is the
    // README's quick start and every new Railway environment.
    run(process.execPath, [...prisma]);
    const created = await client.query(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = ANY($1)`,
      [SQL_OWNED_INDEXES],
    );
    assert.equal(created.rowCount, SQL_OWNED_INDEXES.length,
      "A push against an empty database must create every declared SQL-owned index");
    await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");

    // Recreate the schema before Prisma knew about the SQL-managed lemma data
    // or about the indexes setup-search.sql creates — which is what production
    // looks like today. The unchanged setup SQL then creates the exact legacy
    // table/column types, and the indexes below are the SQL's own, so the
    // deploys that follow are proving push leaves *those* in place.
    const legacySchema = SQL_OWNED_INDEXES.reduce(
      (text, index) => text.replace(new RegExp(`^  @@index\\([^\\n]*"${index}"\\)\\n`, "m"), ""),
      schema,
    )
      .replace(/^  lemmaVector\s+Unsupported\("tsvector"\)\?[^\n]*\n/gm, "")
      .replace(/^  extensions = \[[^\n]*\n/m, "")
      .replace(/model BinLemma \{[\s\S]*?\n\}/, "");
    assert.notEqual(legacySchema, schema);
    // Every mapped @@index in the schema is a SQL-owned one, so none may survive
    // the strip. This doubles as the tripwire for the list above: declare a new
    // index in schema.prisma without adding it here and this fails, rather than
    // the index quietly going untested.
    assert.ok(!/@@index\([^\n]*map:/.test(legacySchema),
      "Every mapped @@index belongs in SQL_OWNED_INDEXES");
    const legacyPath = join(dir, "schema.prisma");
    writeFileSync(legacyPath, legacySchema);
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
      const relations = await client.query(
        `SELECT relname, oid FROM pg_class WHERE relnamespace = 'public'::regnamespace
           AND relname = ANY($1) ORDER BY relname`,
        [PRESERVED_RELATIONS],
      );
      assert.equal(relations.rowCount, PRESERVED_RELATIONS.length,
        "Every preserved relation must exist before the comparison means anything");
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
    console.log("Deployment preserves legacy dictionary, vectors, SQL-owned indexes and saved judgments; lemma search and triggers work.");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
