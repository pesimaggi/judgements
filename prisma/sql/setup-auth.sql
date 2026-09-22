-- Additive setup for existing installations. No identities or credentials are
-- imported, and no pre-existing application tables/data are rewritten.
BEGIN;
CREATE TABLE IF NOT EXISTS "saved_documents" (
  "clerk_user_id" TEXT NOT NULL,
  "document_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "saved_documents_pkey" PRIMARY KEY ("clerk_user_id", "document_id"),
  CONSTRAINT "saved_documents_document_id_fkey" FOREIGN KEY ("document_id")
    REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "saved_documents_document_id_idx" ON "saved_documents"("document_id");
COMMIT;
