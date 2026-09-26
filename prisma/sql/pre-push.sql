-- Schema changes `prisma db push` will not make unattended.
--
-- WHY THIS FILE EXISTS. Push refuses anything it classifies as possible data
-- loss, and one of those things is adding a column to an existing unique
-- constraint. The treaties needed exactly that — `acts` is unique on
-- (jurisdiction, doc_type, act_number, year) and one instrument can arrive in
-- two authentic texts — and the deploy stopped dead:
--
--   ⚠️  There might be data loss when applying the changes:
--     • A unique constraint covering the columns [jurisdiction,doc_type,
--       act_number,year,language] on the table `acts` will be added. If there
--       are existing duplicate values, this will fail.
--   Error: Use the --accept-data-loss flag to ignore the data loss warnings
--
-- The tempting fix is to pass that flag in `db:deploy`. It would buy this one
-- constraint at the price of waving *every* future destructive change through on
-- every deploy, unattended, including a dropped column nobody noticed in review.
-- The warning is worth keeping; what it is warning about here is not.
--
-- So the change is made here, in SQL that says what it is doing, and `db:deploy`
-- runs this **before** push. Push then finds the database already matching the
-- schema and has nothing to warn about.
--
-- THE RULES FOR ANYTHING ADDED HERE.
--
--   1. Idempotent. It runs on every deploy, and the second run must be a no-op.
--   2. Safe on a fresh database, where none of these tables exist yet: push
--      creates everything from the schema and this file must not get in the way.
--   3. Matching what Prisma would have created, exactly — same index name, same
--      column type, same default — or push undoes the work on the next line.
--      scripts/test-db-deploy.ts asserts the names still agree after a fresh
--      push, so a change in Prisma's naming fails there rather than in
--      production.
--   4. Never destructive on its own account. Dropping the superseded index is
--      the one removal here, and it happens only after its replacement exists.
--
-- An entry can be deleted once every database has certainly run it. Until then
-- it is cheap: three catalogue lookups.

DO $$
BEGIN
  -- A fresh database. `prisma db push` builds the whole schema from scratch a
  -- moment from now, including the unique index below, so there is nothing to
  -- migrate and nothing to check.
  IF to_regclass('public.acts') IS NULL THEN
    RETURN;
  END IF;

  -- The columns the index needs. Additive, and push would add them happily on
  -- its own — they are here because the index cannot be created before them.
  -- Types and defaults mirror the schema: String -> text, Boolean -> boolean,
  -- @default("is") -> DEFAULT 'is'.
  ALTER TABLE acts ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'is';
  ALTER TABLE acts ADD COLUMN IF NOT EXISTS text_group text;
  ALTER TABLE acts ADD COLUMN IF NOT EXISTS is_canonical boolean NOT NULL DEFAULT true;

  -- The identity of a *text*: one instrument in two languages is two rows.
  --
  -- The name is the one Prisma generates for
  -- @@unique([jurisdiction, docType, actNumber, year, language]) on this table,
  -- and it has to be character-for-character that, or push drops this index and
  -- creates its own — which is the very operation this file exists to avoid.
  -- Prisma implements @@unique as a plain unique index, not a table constraint,
  -- so this does too.
  IF to_regclass('public.acts_jurisdiction_doc_type_act_number_year_language_key') IS NULL THEN
    CREATE UNIQUE INDEX acts_jurisdiction_doc_type_act_number_year_language_key
      ON acts (jurisdiction, doc_type, act_number, year, language);
  END IF;

  -- The key it replaces, dropped only now that its replacement is in place. It
  -- may be either a unique index or a table constraint depending on which
  -- Prisma wrote it, and a constraint-backed index cannot be dropped with DROP
  -- INDEX — so both are handled rather than assumed.
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.acts'::regclass
       AND conname = 'acts_jurisdiction_doc_type_act_number_year_key'
  ) THEN
    ALTER TABLE acts DROP CONSTRAINT acts_jurisdiction_doc_type_act_number_year_key;
  ELSIF to_regclass('public.acts_jurisdiction_doc_type_act_number_year_key') IS NOT NULL THEN
    DROP INDEX acts_jurisdiction_doc_type_act_number_year_key;
  END IF;
END $$;
