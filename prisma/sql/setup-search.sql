-- Run after `prisma db push`:  npm run db:setup-search
-- Sets up full-text search + fuzzy matching. Uses the 'simple' text search
-- configuration so Icelandic characters (á ð é í ó ú ý þ æ ö) are preserved
-- exactly, and pg_trgm for fuzzy matching of spelling variants and case numbers.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Weighted document vector: title/case data rank above body text.
CREATE OR REPLACE FUNCTION document_search_vector(
  title text, case_name text, case_number text, parties text, full_text text
) RETURNS tsvector
LANGUAGE sql IMMUTABLE AS $$
  SELECT
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(case_name, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(case_number, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(parties, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(full_text, '')), 'D')
$$;

-- Materialized search vector.
--
-- The previous setup indexed the *expression*
-- document_search_vector(title, …, full_text). That makes `@@` fast, but any
-- query that also needs the vector's value — ts_rank() for relevance
-- ordering — has to recompute the whole tsvector from full_text for every
-- matching row. On a broad query like "gæsluvarðhald" (thousands of hits)
-- that meant re-tokenising thousands of complete judgments per search, which
-- dominated the response time.
--
-- Storing the vector in a column means ts_rank() reads a precomputed value
-- instead, and the GIN index below still serves `@@`.
--
-- It's a plain column kept up to date by a trigger rather than a GENERATED
-- … STORED column, because `prisma db push` refuses to run against a
-- generated column ("column … is a generated column", while trying to alter
-- its default). schema.prisma declares it as Unsupported("tsvector") so push
-- leaves the column in place; Prisma Client never reads or writes it.
--
-- Changing document_search_vector()'s definition does not retroactively
-- update stored vectors: clear the column (UPDATE "Document" SET
-- search_vector = NULL) and re-run this script to have them rebuilt.
CREATE OR REPLACE FUNCTION document_search_vector_refresh() RETURNS trigger
LANGUAGE plpgsql AS $refresh$
BEGIN
  NEW.search_vector := document_search_vector(
    NEW.title, NEW.case_name, NEW.case_number, NEW.parties, NEW.full_text
  );
  RETURN NEW;
END
$refresh$;

DROP TRIGGER IF EXISTS document_search_vector_refresh_tg ON "Document";
CREATE TRIGGER document_search_vector_refresh_tg
  BEFORE INSERT OR UPDATE OF title, case_name, case_number, parties, full_text
  ON "Document"
  FOR EACH ROW EXECUTE FUNCTION document_search_vector_refresh();

-- Backfill anything written before the trigger existed. A no-op on every
-- later run, so this stays safe to re-run on each deploy.
UPDATE "Document"
   SET search_vector = document_search_vector(title, case_name, case_number, parties, full_text)
 WHERE search_vector IS NULL;

CREATE INDEX IF NOT EXISTS document_search_vector_idx ON "Document" USING GIN (search_vector);

-- Superseded by document_search_vector_idx: same lookups, but this one also
-- had to recompute the vector on every insert/update. Dropping it halves the
-- FTS index-maintenance cost of ingestion.
DROP INDEX IF EXISTS document_fts_idx;

-- Trigram indexes for fuzzy matching (Icelandic variants, typos, case numbers).
-- These back the `%` (similarity above pg_trgm.similarity_threshold) operator,
-- which is what the fuzzy fallback in src/lib/search/postgres.ts uses — an
-- explicit `similarity(a || b, q) > 0.35` cannot use them and forces a full
-- table scan instead.
CREATE INDEX IF NOT EXISTS document_case_number_trgm_idx ON "Document" USING GIN (case_number gin_trgm_ops);
CREATE INDEX IF NOT EXISTS document_title_trgm_idx ON "Document" USING GIN (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS document_case_name_trgm_idx ON "Document" USING GIN (case_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS document_parties_trgm_idx ON "Document" USING GIN (parties gin_trgm_ops);

-- Tag browsing (`/?tag=…`) filters with subject_tags @> ARRAY[…]; without a
-- GIN index that's a sequential scan of the whole table.
CREATE INDEX IF NOT EXISTS document_subject_tags_idx ON "Document" USING GIN (subject_tags);

-- "Newest/oldest first" within a court selection, and the front page's
-- newest-cases list.
CREATE INDEX IF NOT EXISTS document_source_date_idx ON "Document" (source, date DESC NULLS LAST);

-- ---------------------------------------------------------------------------
-- Acts and provisions
--
-- Provisions are searched through the same SearchProvider abstraction as
-- judgments (searchProvisions), so they get the same treatment here: the
-- 'simple' configuration to preserve Icelandic characters, a materialized
-- vector kept current by a trigger, and a GIN index over it.
-- ---------------------------------------------------------------------------

-- Weighted provision vector: the label and heading are what a reader scans
-- for ("26. gr.", "Miskabætur"), so they outrank the provision's body text.
CREATE OR REPLACE FUNCTION provision_search_vector(
  display_label text, heading text, full_text text
) RETURNS tsvector
LANGUAGE sql IMMUTABLE AS $$
  SELECT
    setweight(to_tsvector('simple', coalesce(display_label, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(heading, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(full_text, '')), 'D')
$$;

CREATE OR REPLACE FUNCTION provision_search_vector_refresh() RETURNS trigger
LANGUAGE plpgsql AS $prov$
BEGIN
  NEW.search_vector := provision_search_vector(
    NEW.display_label, NEW.heading, NEW.full_text
  );
  RETURN NEW;
END
$prov$;

DROP TRIGGER IF EXISTS provision_search_vector_refresh_tg ON provisions;
CREATE TRIGGER provision_search_vector_refresh_tg
  BEFORE INSERT OR UPDATE OF display_label, heading, full_text
  ON provisions
  FOR EACH ROW EXECUTE FUNCTION provision_search_vector_refresh();

-- Backfill rows written before the trigger existed; a no-op on later runs,
-- so this stays safe to re-run on every deploy.
UPDATE provisions
   SET search_vector = provision_search_vector(display_label, heading, full_text)
 WHERE search_vector IS NULL;

CREATE INDEX IF NOT EXISTS provision_search_vector_idx ON provisions USING GIN (search_vector);

-- The act type-ahead matches on title and on the short names harvested from
-- the corpus ("vaxtalög" for 38/2001, which its title does not contain).
--
-- aliases is a text[], so the trigram index goes on its flattened form — and
-- the lookup query must use this same function, or the index will not apply.
-- array_to_string() itself is only STABLE (the generic-type machinery behind
-- it is not guaranteed immutable for every element type), which Postgres
-- refuses in an index expression. Pinned to text[] with a constant delimiter
-- it genuinely is immutable, so the wrapper below can declare it.
CREATE OR REPLACE FUNCTION act_alias_text(aliases text[]) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT array_to_string(aliases, ' ')
$$;

CREATE INDEX IF NOT EXISTS acts_title_trgm_idx ON acts USING GIN (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS acts_aliases_trgm_idx
  ON acts USING GIN (act_alias_text(aliases) gin_trgm_ops);

-- The provision badge ("12 dómar vísa til þessa ákvæðis") counts links per
-- provision, and the act reader loads every provision's count in one pass.
CREATE INDEX IF NOT EXISTS case_provision_links_provision_idx
  ON case_provision_links (provision_id, match_type);
