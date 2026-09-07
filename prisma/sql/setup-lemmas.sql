-- Run after setup-search.sql:  npm run db:setup-lemmas
--
-- Icelandic lemmatisation for search, from BÍN (Beygingarlýsing íslensks
-- nútímamáls).
--
-- WHY THIS EXISTS
--
-- setup-search.sql builds every search vector with to_tsvector('simple', …).
-- The 'simple' configuration preserves Icelandic characters exactly, which is
-- why it was chosen — and it does no stemming whatsoever. In a language where
-- one noun carries up to sixteen surface forms, that means the index treats
-- every inflection as an unrelated word:
--
--   ríkisborgararéttur  ríkisborgararéttar  ríkisborgararétti  ríkisborgararéttinum
--
-- are four separate lexemes to Postgres, and a search for one of them finds
-- none of the other three. The planner in src/lib/ask/plan.ts is asked for the
-- words the corpus uses and produces the dictionary form; the judgments are
-- written in the oblique cases. So the well was searching for a form that
-- largely does not occur in the text it was searching.
--
-- HOW
--
-- A form → lemma table, loaded from BÍN, and a second materialized vector
-- built by mapping each lexeme through it. The original `search_vector` is
-- left exactly as it is and keeps matching exactly as it did: `lemma_vector`
-- is an ADDITIONAL condition OR'd alongside it in
-- src/lib/search/postgres.ts. Recall goes up; nothing that matched before
-- stops matching.
--
-- WHY A TABLE RATHER THAN A TEXT SEARCH DICTIONARY
--
-- Postgres has two mechanisms built for exactly this — an `ispell`/hunspell
-- dictionary, and the `synonym` template — and both are unavailable to us.
-- Both read their data from files under the server's $SHAREDIR/tsearch_data,
-- and on managed Postgres (Railway, which is what this deploys to) there is no
-- filesystem to put them on. A table is the portable form of the same idea.
--
-- LICENCE
--
-- BÍN is CC BY-SA 4.0. Attribution is required and is carried in the UI, in
-- README.md, and in prisma/load-bin.ts:
--
--   Beygingarlýsing íslensks nútímamáls. Stofnun Árna Magnússonar í íslenskum
--   fræðum. Höfundur og ritstjóri Kristín Bjarnadóttir.

-- ---------------------------------------------------------------------------
-- The dictionary
-- ---------------------------------------------------------------------------

-- One row per surface form, carrying every lemma that form can belong to.
--
-- An array rather than one row per (form, lemma) pair: 2.9% of forms are
-- ambiguous, and the array shape means a lexeme costs one index probe instead
-- of fanning a join out into several rows for the 97% that are not. Loaded by
-- prisma/load-bin.ts; see there for the aggregation.
CREATE TABLE IF NOT EXISTS bin_lemma (
  form   text   PRIMARY KEY,
  lemmas text[] NOT NULL
);

COMMENT ON TABLE bin_lemma IS
  'BÍN form → lemma map. Source: Beygingarlýsing íslensks nútímamáls, Stofnun Árna Magnússonar í íslenskum fræðum, CC BY-SA 4.0. Loaded by prisma/load-bin.ts.';

-- The reverse direction: every surface form belonging to a lemma.
--
-- Needed for highlighting, which is the one place the lemma match would
-- otherwise be visibly worse than the plain one. `ts_headline` re-tokenises the
-- stored judgment and marks what the *query* matches — so a document found
-- because `ríkisborgararéttar` shares a lemma with the typed
-- `ríkisborgararéttinum` gets a result card with nothing highlighted at all,
-- which reads as a broken search rather than a wider one. Expanding the
-- headline query back out to the lemma's surface forms is what marks the word
-- actually present in the text. See lemmaSiblings in lib/lemma-lookup.ts.
CREATE INDEX IF NOT EXISTS bin_lemma_lemmas_idx ON bin_lemma USING GIN (lemmas);

-- ---------------------------------------------------------------------------
-- Lemmatising text
-- ---------------------------------------------------------------------------

-- Maps every lexeme in `txt` through bin_lemma and returns the result as a
-- tsvector.
--
-- Tokenising with to_tsvector('simple', …) first, rather than splitting on
-- whitespace, is deliberate: it is the same tokeniser the stored
-- `search_vector` uses, so the two vectors agree about what a word is. It also
-- lowercases, which is why bin_lemma.form is stored lowercased.
--
-- A form BÍN does not know keeps its own spelling (the coalesce below). That is
-- the conservative fallback: an unknown proper noun, a case number or a Latin
-- tag still matches itself, so the lemma vector is never *worse* than the plain
-- one for those tokens.
--
-- STABLE, not IMMUTABLE, because it reads a table — which is why the vectors
-- below are plain columns maintained by a trigger rather than generated
-- columns or expression indexes, both of which would require immutability.
-- setup-search.sql already keeps `search_vector` this way for its own reasons,
-- so the pattern is the established one here.
-- Rebuilt in the original word order rather than in whatever order the join
-- returns. `unnest(tsvector)` yields each lexeme once with the positions it
-- occurred at, so the positions are expanded and the lemmas re-emitted in that
-- order; without the ORDER BY, "dráttarvaxta krafist" comes back with
-- `dráttarvextir` at position 1 and the vector's positional data is nonsense.
--
-- The positions are not exact even so: an ambiguous form contributes all of its
-- candidate lemmas at one position and shifts everything after it. That is why
-- the query layer never sends a quoted phrase down this path — see
-- `lemmaQuery` in src/lib/lemma.ts. Ordering still matters for everything that
-- reads the vector positionally, and costs nothing.
CREATE OR REPLACE FUNCTION bin_lemma_vector(txt text) RETURNS tsvector
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT coalesce(to_tsvector('simple', string_agg(word, ' ' ORDER BY pos)), ''::tsvector)
  FROM (
    SELECT unnest(t.positions) AS pos,
           coalesce(array_to_string(b.lemmas, ' '), t.lexeme) AS word
      FROM unnest(to_tsvector('simple', coalesce(txt, ''))) AS t
      LEFT JOIN bin_lemma b ON b.form = t.lexeme
  ) AS ordered
$$;

-- ---------------------------------------------------------------------------
-- Documents
-- ---------------------------------------------------------------------------

-- The same weighting as document_search_vector: what a reader scans for ranks
-- above the body. Kept in step with that function by hand — if one changes,
-- change both, and clear the columns to have them rebuilt.
CREATE OR REPLACE FUNCTION document_lemma_vector(
  title text, case_name text, case_number text, parties text, full_text text
) RETURNS tsvector
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT
    setweight(bin_lemma_vector(coalesce(title, '')), 'A') ||
    setweight(bin_lemma_vector(coalesce(case_name, '')), 'A') ||
    setweight(bin_lemma_vector(coalesce(case_number, '')), 'A') ||
    setweight(bin_lemma_vector(coalesce(parties, '')), 'B') ||
    setweight(bin_lemma_vector(coalesce(full_text, '')), 'D')
$$;

ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS lemma_vector tsvector;

CREATE OR REPLACE FUNCTION document_lemma_vector_refresh() RETURNS trigger
LANGUAGE plpgsql AS $lemma$
BEGIN
  NEW.lemma_vector := document_lemma_vector(
    NEW.title, NEW.case_name, NEW.case_number, NEW.parties, NEW.full_text
  );
  RETURN NEW;
END
$lemma$;

DROP TRIGGER IF EXISTS document_lemma_vector_refresh_tg ON "Document";
CREATE TRIGGER document_lemma_vector_refresh_tg
  BEFORE INSERT OR UPDATE OF title, case_name, case_number, parties, full_text
  ON "Document"
  FOR EACH ROW EXECUTE FUNCTION document_lemma_vector_refresh();

CREATE INDEX IF NOT EXISTS document_lemma_vector_idx ON "Document" USING GIN (lemma_vector);

-- ---------------------------------------------------------------------------
-- Provisions
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION provision_lemma_vector(
  display_label text, heading text, full_text text
) RETURNS tsvector
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT
    setweight(bin_lemma_vector(coalesce(display_label, '')), 'A') ||
    setweight(bin_lemma_vector(coalesce(heading, '')), 'B') ||
    setweight(bin_lemma_vector(coalesce(full_text, '')), 'D')
$$;

ALTER TABLE provisions ADD COLUMN IF NOT EXISTS lemma_vector tsvector;

CREATE OR REPLACE FUNCTION provision_lemma_vector_refresh() RETURNS trigger
LANGUAGE plpgsql AS $provlemma$
BEGIN
  NEW.lemma_vector := provision_lemma_vector(
    NEW.display_label, NEW.heading, NEW.full_text
  );
  RETURN NEW;
END
$provlemma$;

DROP TRIGGER IF EXISTS provision_lemma_vector_refresh_tg ON provisions;
CREATE TRIGGER provision_lemma_vector_refresh_tg
  BEFORE INSERT OR UPDATE OF display_label, heading, full_text
  ON provisions
  FOR EACH ROW EXECUTE FUNCTION provision_lemma_vector_refresh();

CREATE INDEX IF NOT EXISTS provision_lemma_vector_idx ON provisions USING GIN (lemma_vector);
