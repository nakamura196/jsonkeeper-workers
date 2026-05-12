-- Add unlisted flag (excludes doc from AS Collection when true)
ALTER TABLE documents ADD COLUMN unlisted INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_documents_unlisted ON documents(unlisted);
