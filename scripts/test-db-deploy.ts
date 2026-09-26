/**
 * Integration regression for Railway's pre-deploy command. Run only against a
 * fresh, disposable local database; CI supplies a dedicated Postgres container.
 *
 * THREE PHASES, AND THE THIRD EXISTS BECAUSE THIS TEST ONCE PASSED A DEPLOY THAT
 * FAILED.
 *
 *   1. A push against an empty database, which is the README's quick start and
 *      every new Railway environment.
 *   2. A push against the *legacy* schema — the current one minus the columns and
 *      indexes production predates — with populated search vectors and a BÍN
 *      dictionary, proving the deploy preserves them.
 *   3. A push against the schema **as the base branch has it**, which is what
 *      production actually runs, proving the upgrade path itself.
 *
 * Phase 2 derives its baseline by stripping known things out of the schema under
 * test, so every *other* change — a new column, a widened uniqueness key — is
 * already present in the baseline it pushes against. That makes the diff it
 * exercises empty for exactly the change being reviewed. A widened unique key
 * went green here and then stopped a Railway deploy dead with "Use the
 * --accept-data-loss flag", because `prisma db push` treats adding a column to a
 * unique constraint as possible data loss. Phase 3 is the same command against
 * the real previous schema, so a change Prisma will not apply unattended fails
 * here first.
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

/// The uniqueness key on `acts`, as Prisma names it for
/// @@unique([jurisdiction, docType, actNumber, year, language]).
///
/// prisma/sql/pre-push.sql creates this index itself, before push runs, because
/// push refuses to widen a unique constraint without --accept-data-loss. Both
/// spellings have to agree; phase 1 below is where that is checked.
const PRE_PUSH_ACTS_UNIQUE_INDEX = "acts_jurisdiction_doc_type_act_number_year_language_key";

/// bin_lemma itself is a table rather than an index: PR #70's concern was the
/// dictionary rows, not just the index over them.
const PRESERVED_RELATIONS = ["bin_lemma", ...SQL_OWNED_INDEXES];

/**
 * The rows every phase needs: a BÍN entry, a judgment and a provision whose
 * lemma vectors the setup SQL must populate, an act, and a saved judgment —
 * application data a deploy must not touch.
 */
const FIXTURES_SQL = `
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
`;

async function seedFixtures(client: Client): Promise<void> {
  await client.query(FIXTURES_SQL);
}

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

/**
 * The schema as the branch this change will land on has it — what production is
 * running now.
 *
 * On a pull request that is the base branch; on a push it is the commit before.
 * Returns null when neither can be read (a shallow clone with no history, a
 * branch with no base), and the caller then says so loudly rather than passing:
 * a check that silently skips the only phase exercising the upgrade is worse than
 * no check, because it reads as green.
 */
function baselineSchema(): { source: string; text: string } | null {
  const candidates = [
    process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : null,
    "origin/main",
    "HEAD~1",
  ].filter((ref): ref is string => ref !== null);

  for (const ref of candidates) {
    const result = command("git", ["show", `${ref}:prisma/schema.prisma`]);
    if (result.status === 0 && result.stdout.includes("model Act")) {
      return { source: ref, text: result.stdout };
    }
  }
  return null;
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

    // The one name prisma/sql/pre-push.sql hardcodes, checked against what
    // Prisma itself creates from the schema.
    //
    // That file swaps the uniqueness key on `acts` before push runs, because push
    // will not widen a unique constraint unattended. The swap only works while the
    // index it creates is named character-for-character what Prisma would have
    // named it; a rename upstream would mean push silently dropping the SQL's
    // index and creating its own — which is the operation the file exists to
    // avoid, and which would fail the deploy again. So the agreement is asserted
    // here, on a fresh push, where Prisma's naming is the only thing in play.
    const uniqueKeys = await client.query(
      `SELECT indexname FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'acts' AND indexdef ILIKE '%UNIQUE%'`,
    );
    assert.ok(
      uniqueKeys.rows.some((row) => row.indexname === PRE_PUSH_ACTS_UNIQUE_INDEX),
      `prisma/sql/pre-push.sql names the acts uniqueness key ${PRE_PUSH_ACTS_UNIQUE_INDEX}, ` +
        `but a fresh push created ${uniqueKeys.rows.map((r) => r.indexname).join(", ")}`,
    );
    assert.match(
      readFileSync("prisma/sql/pre-push.sql", "utf8"),
      new RegExp(PRE_PUSH_ACTS_UNIQUE_INDEX),
      "pre-push.sql must create the index it is being checked against",
    );
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

    await seedFixtures(client);

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

    // ---- Phase 3: the upgrade production will actually perform -------------
    //
    // Everything above pushes a baseline derived from the schema under test, so
    // the diff it exercises is empty for the change being reviewed. This pushes
    // the schema the base branch has — what the live database is at — and then
    // runs the real pre-deploy command against it. A change `prisma db push`
    // will not apply unattended fails here instead of on Railway.
    const baseline = baselineSchema();
    assert.ok(
      baseline,
      "Could not read the base branch's schema, so the upgrade phase would be skipped. " +
        "Fetch history (actions/checkout fetch-depth: 0) rather than letting this pass."
    );
    if (baseline.text === schema) {
      console.log("Upgrade phase: schema unchanged from " + baseline.source + ", nothing to upgrade.");
    } else {
      await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
      const basePath = join(dir, "baseline.schema.prisma");
      writeFileSync(basePath, baseline.text);
      run(process.execPath, [...prisma, "--schema", basePath]);
      run("npm", ["run", "db:setup-search"]);
      run("npm", ["run", "db:setup-lemmas"]);
      await seedFixtures(client);
      const beforeUpgrade = await snapshot();

      // Twice, as the deploy chain runs it on every release: the first push is
      // the migration, the second must be a no-op.
      for (let attempt = 1; attempt <= 2; attempt++) {
        run("npm", ["run", "db:deploy"]);
        assert.deepEqual(
          await snapshot(),
          beforeUpgrade,
          `Upgrade deploy ${attempt} changed existing search/account data`
        );
        await assertLemmaSearch();
      }
      console.log(`Upgrade from ${baseline.source} applies unattended and preserves data.`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
