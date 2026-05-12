-- JSONkeeper on D1 — initial schema
CREATE TABLE IF NOT EXISTS documents (
  id            TEXT PRIMARY KEY,
  json          TEXT NOT NULL,
  owner_uid     TEXT,
  content_type  TEXT NOT NULL DEFAULT 'application/json',
  jsonld_type   TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_documents_owner   ON documents(owner_uid);
CREATE INDEX IF NOT EXISTS idx_documents_type    ON documents(jsonld_type);
CREATE INDEX IF NOT EXISTS idx_documents_created ON documents(created_at DESC);
