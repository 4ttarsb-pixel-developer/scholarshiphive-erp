-- 017 — audit document payloads stored in PostgreSQL (not RAM or local filesystem).
-- Existing rows stay intact; migrate any legacy file_key bytes with
-- `npm run migrate:document-bytes` BEFORE retiring backend/var/documents.
-- Nullable until import verified; application refuses serving missing payloads.
ALTER TABLE marketing.expense_documents ADD COLUMN IF NOT EXISTS content_bytes BYTEA;
COMMENT ON COLUMN marketing.expense_documents.content_bytes IS 'Actual verified PDF/PNG/JPG payload. Legacy NULL must be imported before production deployment.';
