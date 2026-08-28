-- Faceless Studio: RAG documents, chunks and browser job history.
-- Run after 0001_initial_schema.sql in the Neon SQL Editor.

CREATE TABLE IF NOT EXISTS rag_docs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  size INTEGER DEFAULT 0,
  chunk_count INTEGER DEFAULT 0,
  char_count INTEGER DEFAULT 0,
  source TEXT DEFAULT 'upload',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rag_chunks (
  id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL REFERENCES rag_docs(id),
  doc_name TEXT DEFAULT '',
  idx INTEGER DEFAULT 0,
  text TEXT NOT NULL,
  tokens TEXT DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_rag_chunks_doc ON rag_chunks(doc_id);
CREATE INDEX IF NOT EXISTS idx_rag_docs_created ON rag_docs(created_at DESC);

CREATE TABLE IF NOT EXISTS studio_jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT DEFAULT '',
  status TEXT DEFAULT 'done',
  meta TEXT DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_studio_jobs_kind ON studio_jobs(kind, created_at DESC);
