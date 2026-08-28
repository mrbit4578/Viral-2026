-- Studio WASM: RAG documents + chunks, studio job log
CREATE TABLE IF NOT EXISTS rag_docs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  size INTEGER DEFAULT 0,
  chunk_count INTEGER DEFAULT 0,
  char_count INTEGER DEFAULT 0,
  source TEXT DEFAULT 'upload',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rag_chunks (
  id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL,
  doc_name TEXT DEFAULT '',
  idx INTEGER DEFAULT 0,
  text TEXT NOT NULL,
  tokens TEXT DEFAULT '[]',
  FOREIGN KEY (doc_id) REFERENCES rag_docs(id)
);

CREATE INDEX IF NOT EXISTS idx_rag_chunks_doc ON rag_chunks(doc_id);
CREATE INDEX IF NOT EXISTS idx_rag_docs_created ON rag_docs(created_at DESC);

-- Lịch sử các phiên Studio (STT / dịch SRT / dub / băm / RAG)
CREATE TABLE IF NOT EXISTS studio_jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT DEFAULT '',
  status TEXT DEFAULT 'done',
  meta TEXT DEFAULT '{}',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_studio_jobs_kind ON studio_jobs(kind, created_at DESC);
