/**
 * Loads BÍN — Beygingarlýsing íslensks nútímamáls — into the `bin_lemma`
 * table that prisma/sql/setup-lemmas.sql creates.
 *
 *   npm run db:load-bin                 # download if needed, then load
 *   npm run db:load-bin -- --file p.csv # load a CSV already on disk
 *   npm run db:load-bin -- --rebuild    # also rebuild the stored lemma vectors
 *   npm run db:load-bin -- --rebuild-only
 *
 * ATTRIBUTION, which is a licence condition and not a courtesy:
 *
 *   Beygingarlýsing íslensks nútímamáls. Stofnun Árna Magnússonar í íslenskum
 *   fræðum. Höfundur og ritstjóri Kristín Bjarnadóttir.
 *
 * BÍN's language-technology data is published under CC BY-SA 4.0. Attribution
 * is carried in the UI and in README.md as well as here; the ShareAlike term
 * bites if the derived table is ever redistributed, which is why it is built
 * from the published CSV at deploy time rather than committed to this repo.
 *
 * WHY THE STAGING TABLE
 *
 * The file is ~377 MB and 7.4M rows, which becomes 3.7M rows once collapsed to
 * one row per surface form. Doing that collapse in Node means holding several
 * million strings and arrays in memory; doing it in Postgres means holding
 * none. So every row is streamed into an UNLOGGED staging table in batches and
 * the aggregation runs as one GROUP BY, which is the operation a database is
 * for.
 *
 * `pg` alone, no COPY: node-postgres cannot stream COPY without
 * pg-copy-streams, and this is a one-off load that runs in minutes with plain
 * batched inserts. Not worth a dependency — and prisma/setup-search.ts has
 * already established that this repo does not assume `psql` exists on the
 * deploy image.
 */
import { Client } from "pg";
import { createReadStream, existsSync, mkdirSync, statSync } from "node:fs";
import { createInterface } from "node:readline";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

/** The "Sigrúnarsnið" export: ord;bin_id;ofl;hluti;bmynd;mark, no quoting. */
const BIN_URL =
  "https://bin.arnastofnun.is/django/api/nidurhal/?file=SHsnid.csv.zip";
const DEFAULT_FILE = join(process.cwd(), "prisma", "data", "SHsnid.csv");

/** Rows per INSERT. 5,000 × 2 columns is well inside the 65,535 parameter cap. */
const BATCH = 5_000;
/** Documents re-lemmatised per statement during --rebuild. */
const REBUILD_BATCH = 200;

interface Options {
  file: string;
  rebuild: boolean;
  rebuildOnly: boolean;
  /** Where to write the corpus words BÍN does not know. */
  unknown: string | null;
  /** A form<TAB>lemma file to merge in — what scripts/bin-compounds.py emits. */
  extra: string | null;
  /** Rebuild every stored vector, not only the ones never built. */
  rebuildAll: boolean;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    file: DEFAULT_FILE,
    rebuild: false,
    rebuildOnly: false,
    unknown: null,
    extra: null,
    rebuildAll: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--file") opts.file = argv[++i];
    else if (a === "--unknown") opts.unknown = argv[++i];
    else if (a === "--extra") opts.extra = argv[++i];
    else if (a === "--rebuild") opts.rebuild = true;
    else if (a === "--rebuild-all") {
      opts.rebuildAll = true;
      opts.rebuild = true;
    }
    else if (a === "--rebuild-only") {
      opts.rebuildOnly = true;
      opts.rebuild = true;
    } else if (a === "--help" || a === "-h") {
      console.log(
        [
          "Usage: npm run db:load-bin -- [options]",
          "",
          "  --file <path>     A BÍN SHsnid CSV already on disk.",
          "  --rebuild         Build the lemma vectors that are missing.",
          "  --rebuild-all     Rebuild every lemma vector. Needed whenever the",
          "                    dictionary itself changed — after --extra, or a",
          "                    reload — because the existing vectors are then",
          "                    stale rather than absent.",
          "  --rebuild-only    Skip the load; only rebuild the vectors.",
          "  --unknown <path>  Write the corpus words BÍN does not know, one",
          "                    per line, for scripts/bin-compounds.py.",
          "  --extra <path>    Merge a form<TAB>lemma file in, as that script",
          "                    emits. Runs before --rebuild.",
          "",
          "Downloads BÍN to prisma/data/ when the file is absent.",
        ].join("\n")
      );
      process.exit(0);
    }
  }
  return opts;
}

/**
 * Fetches and unzips the BÍN archive.
 *
 * The zip holds one CSV plus a .sha256sum; DecompressionStream cannot read a
 * zip container, so the single deflated entry is located in the central
 * directory and inflated directly. That is less code than adding an unzip
 * dependency for one file with one member.
 */
async function download(target: string): Promise<void> {
  console.log(`Downloading BÍN from ${BIN_URL} …`);
  const res = await fetch(BIN_URL);
  if (!res.ok) throw new Error(`BÍN download failed: HTTP ${res.status}`);
  const zip = Buffer.from(await res.arrayBuffer());
  console.log(`  ${(zip.length / 1e6).toFixed(1)} MB downloaded, inflating …`);

  const csv = await inflateLargestEntry(zip);
  mkdirSync(join(target, ".."), { recursive: true });
  await writeFile(target, csv);
  console.log(`  wrote ${target} (${(csv.length / 1e6).toFixed(0)} MB)`);
}

/** Inflates the largest deflated member of a zip, which is the CSV. */
async function inflateLargestEntry(zip: Buffer): Promise<Buffer> {
  // Local file headers: PK\x03\x04. Walk them and keep the biggest payload.
  let best: { start: number; size: number; method: number } | null = null;
  for (let i = 0; i + 30 <= zip.length; i++) {
    if (zip.readUInt32LE(i) !== 0x04034b50) continue;
    const method = zip.readUInt16LE(i + 8);
    const compressed = zip.readUInt32LE(i + 18);
    const nameLen = zip.readUInt16LE(i + 26);
    const extraLen = zip.readUInt16LE(i + 28);
    const start = i + 30 + nameLen + extraLen;
    if (compressed > 0 && (!best || compressed > best.size)) {
      best = { start, size: compressed, method };
    }
  }
  if (!best) throw new Error("No file entry found in the BÍN archive.");

  const payload = zip.subarray(best.start, best.start + best.size);
  if (best.method === 0) return payload;

  const stream = new Blob([payload as unknown as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return Buffer.from(await new Response(stream).arrayBuffer());
}

async function load(client: Client, file: string): Promise<void> {
  const bytes = statSync(file).size;
  console.log(`Loading ${file} (${(bytes / 1e6).toFixed(0)} MB) …`);

  await client.query(`DROP TABLE IF EXISTS bin_raw`);
  // UNLOGGED: this table exists for the length of one GROUP BY and writing WAL
  // for 7.4M throwaway rows is the single largest cost we can simply not pay.
  await client.query(`CREATE UNLOGGED TABLE bin_raw (form text, lemma text)`);

  const rl = createInterface({
    input: createReadStream(file, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });

  let batch: string[] = [];
  let rows = 0;
  let skipped = 0;

  const flush = async () => {
    if (batch.length === 0) return;
    const values: string[] = [];
    for (let i = 0; i < batch.length; i += 2) {
      values.push(`($${i + 1},$${i + 2})`);
    }
    await client.query(`INSERT INTO bin_raw (form, lemma) VALUES ${values.join(",")}`, batch);
    batch = [];
  };

  for await (const line of rl) {
    if (!line) continue;
    const parts = line.split(";");
    // ord;bin_id;ofl;hluti;bmynd;mark — the lemma is first, the surface form
    // fifth. A short line is a malformed row, not a reason to abandon the load.
    if (parts.length < 6) {
      skipped += 1;
      continue;
    }
    const lemma = parts[0].trim().toLowerCase();
    const form = parts[4].trim().toLowerCase();
    if (!form || !lemma) {
      skipped += 1;
      continue;
    }
    batch.push(form, lemma);
    rows += 1;
    if (batch.length >= BATCH * 2) {
      await flush();
      if (rows % 1_000_000 < BATCH) console.log(`  ${(rows / 1e6).toFixed(0)}M rows staged …`);
    }
  }
  await flush();
  console.log(`  ${rows.toLocaleString()} rows staged${skipped ? `, ${skipped} malformed skipped` : ""}.`);

  console.log("Collapsing to one row per surface form …");
  await client.query(`TRUNCATE bin_lemma`);
  await client.query(`
    INSERT INTO bin_lemma (form, lemmas)
    SELECT form, array_agg(DISTINCT lemma)
      FROM bin_raw
     GROUP BY form
  `);
  await client.query(`DROP TABLE bin_raw`);
  await client.query(`ANALYZE bin_lemma`);

  const { rows: counted } = await client.query<{ forms: string; ambiguous: string }>(`
    SELECT count(*) AS forms,
           count(*) FILTER (WHERE array_length(lemmas, 1) > 1) AS ambiguous
      FROM bin_lemma
  `);
  const { forms, ambiguous } = counted[0];
  console.log(
    `  ${Number(forms).toLocaleString()} surface forms, ` +
      `${Number(ambiguous).toLocaleString()} of them ambiguous.`
  );
}

/**
 * Recomputes the stored lemma vectors.
 *
 * The triggers keep new and edited rows current, so this is only for the
 * corpus that was already in the database when the dictionary arrived — and
 * for the day the dictionary is reloaded. Batched by primary key rather than
 * run as one UPDATE, because one statement over a large corpus is a single
 * transaction holding a lock on the whole table for as long as it takes.
 */
async function rebuild(client: Client, all: boolean): Promise<void> {
  for (const [table, expr] of [
    [`"Document"`, `document_lemma_vector(title, case_name, case_number, parties, full_text)`],
    [`provisions`, `provision_lemma_vector(display_label, heading, full_text)`],
  ] as const) {
    console.log(`Rebuilding lemma vectors for ${table} …`);
    // Clearing first, then filling the NULLs, is the same two-step
    // setup-search.sql documents for its own vectors — and it means one loop
    // serves both modes instead of a second keyset-paginated one. The cost is
    // that lemma matching is degraded for the rows not yet refilled, which is
    // acceptable for a maintenance operation and is why it is not the default.
    if (all) await client.query(`UPDATE ${table} SET lemma_vector = NULL`);
    let done = 0;
    for (;;) {
      const { rowCount } = await client.query(`
        WITH batch AS (
          SELECT id FROM ${table} WHERE lemma_vector IS NULL LIMIT ${REBUILD_BATCH}
        )
        UPDATE ${table} t SET lemma_vector = ${expr}
          FROM batch WHERE t.id = batch.id
      `);
      if (!rowCount) break;
      done += rowCount;
      if (done % (REBUILD_BATCH * 25) === 0) console.log(`  ${done.toLocaleString()} rows …`);
    }
    console.log(`  ${done.toLocaleString()} rows rebuilt.`);
  }
}

/**
 * Writes out the words that appear in the corpus and not in BÍN.
 *
 * This is the input to scripts/bin-compounds.py, and the reason that script
 * exists: BÍN is a dictionary of ~348,000 lemmas, and Icelandic legal prose
 * compounds freely beyond any dictionary — "ríkisborgararéttarumsókninni" is a
 * perfectly ordinary word that BÍN has never heard of. Those words are
 * currently indexed under themselves, which is correct but finds nothing.
 *
 * Read off the stored `search_vector`s rather than by re-tokenising full_text,
 * because the vectors are already exactly the token set the index uses, and
 * lexemes are deduplicated within each one.
 */
async function writeUnknown(client: Client, path: string): Promise<void> {
  console.log("Collecting corpus words BÍN does not know …");
  const { rows } = await client.query<{ lexeme: string; docs: string }>(`
    WITH corpus AS (
      SELECT unnest(tsvector_to_array(search_vector)) AS lexeme FROM "Document"
       WHERE search_vector IS NOT NULL
      UNION ALL
      SELECT unnest(tsvector_to_array(search_vector)) AS lexeme FROM provisions
       WHERE search_vector IS NOT NULL
    )
    SELECT c.lexeme, count(*) AS docs
      FROM corpus c
      LEFT JOIN bin_lemma b ON b.form = c.lexeme
     WHERE b.form IS NULL
       -- Words, not case numbers, section signs or OCR debris. A token with a
       -- digit in it is never a compound BinPackage can decompose.
       AND c.lexeme ~ '^[a-záðéíóúýþæö]{4,}$'
     GROUP BY c.lexeme
     -- Commonest first, so a truncated run still resolves what matters most.
     ORDER BY count(*) DESC
  `);
  await writeFile(path, rows.map((r) => r.lexeme).join("\n") + "\n", "utf-8");
  console.log(`  ${rows.length.toLocaleString()} unknown words written to ${path}`);
  if (rows.length) {
    console.log(`  commonest: ${rows.slice(0, 8).map((r) => r.lexeme).join(", ")}`);
    console.log("  Resolve them with: python3 scripts/bin-compounds.py " + path + " > extra.tsv");
  }
}

/**
 * Merges a form<TAB>lemma file into the dictionary.
 *
 * Additive, and it never overwrites BÍN: a form BÍN already knows keeps BÍN's
 * answer, because a decomposition is a guess and the dictionary is not. That is
 * what the ON CONFLICT DO NOTHING is for.
 */
async function loadExtra(client: Client, path: string): Promise<void> {
  console.log(`Merging ${path} …`);
  const rl = createInterface({
    input: createReadStream(path, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });

  let batch: string[] = [];
  let added = 0;
  let skipped = 0;

  const flush = async () => {
    if (batch.length === 0) return;
    const values: string[] = [];
    for (let i = 0; i < batch.length; i += 2) values.push(`($${i + 1}, ARRAY[$${i + 2}]::text[])`);
    const { rowCount } = await client.query(
      `INSERT INTO bin_lemma (form, lemmas) VALUES ${values.join(",")} ON CONFLICT (form) DO NOTHING`,
      batch
    );
    added += rowCount ?? 0;
    batch = [];
  };

  for await (const line of rl) {
    const [form, lemma] = line.split("\t");
    if (!form?.trim() || !lemma?.trim()) {
      if (line.trim()) skipped += 1;
      continue;
    }
    batch.push(form.trim().toLowerCase(), lemma.trim().toLowerCase());
    if (batch.length >= BATCH * 2) await flush();
  }
  await flush();
  await client.query(`ANALYZE bin_lemma`);
  console.log(`  ${added.toLocaleString()} forms added${skipped ? `, ${skipped} unusable lines skipped` : ""}.`);
  if (added > 0) {
    console.log(
      "  These change how existing text lemmatises. Run with --rebuild-all to apply them;\n" +
        "  --rebuild alone only fills vectors that were never built, so the stored ones stay stale."
    );
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }

  const needsCsv = !opts.rebuildOnly && !opts.extra && !opts.unknown;
  if (needsCsv && !existsSync(opts.file)) {
    if (opts.file !== DEFAULT_FILE) {
      console.error(`No such file: ${opts.file}`);
      process.exit(1);
    }
    await download(opts.file);
  }

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query<{ exists: boolean }>(
      `SELECT to_regclass('public.bin_lemma') IS NOT NULL AS exists`
    );
    if (!rows[0].exists) {
      console.error("bin_lemma does not exist. Run `npm run db:setup-lemmas` first.");
      process.exit(1);
    }

    const started = Date.now();
    if (needsCsv) await load(client, opts.file);
    if (opts.extra) await loadExtra(client, opts.extra);
    if (opts.unknown) await writeUnknown(client, opts.unknown);
    if (opts.rebuild) await rebuild(client, opts.rebuildAll);
    console.log(`Done in ${((Date.now() - started) / 1000).toFixed(0)}s.`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error("db:load-bin failed:", e?.message ?? e);
  process.exit(1);
});
