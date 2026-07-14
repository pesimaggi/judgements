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

CREATE INDEX IF NOT EXISTS document_fts_idx ON "Document"
  USING GIN (document_search_vector(title, case_name, case_number, parties, full_text));

-- Trigram indexes for fuzzy matching (Icelandic variants, typos, case numbers).
CREATE INDEX IF NOT EXISTS document_case_number_trgm_idx ON "Document" USING GIN (case_number gin_trgm_ops);
CREATE INDEX IF NOT EXISTS document_title_trgm_idx ON "Document" USING GIN (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS document_case_name_trgm_idx ON "Document" USING GIN (case_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS document_parties_trgm_idx ON "Document" USING GIN (parties gin_trgm_ops);
