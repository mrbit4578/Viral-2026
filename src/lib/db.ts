/**
 * Thin Postgres adapter that preserves the small D1 surface used by the app.
 * It keeps route and domain code database-agnostic while running on Neon via
 * Vercel Functions.
 * Thêm tự tạo schema DB (IF NOT EXISTS) để không cần chạy migration thủ công.
 */
import { neon } from '@neondatabase/serverless'

export type QueryResult<T = Record<string, unknown>> = {
  results: T[]
  success: true
  meta: { rows_written: number }
}

export interface PreparedStatement {
  bind(...values: unknown[]): BoundStatement
  run(): Promise<QueryResult>
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>
  first<T = Record<string, unknown>>(): Promise<T | null>
}

export interface BoundStatement {
  run(): Promise<QueryResult>
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>
  first<T = Record<string, unknown>>(): Promise<T | null>
}

export interface AppDatabase {
  prepare(query: string): PreparedStatement
  batch(statements: BoundStatement[]): Promise<QueryResult[]>
}

/**
 * Đổi placeholder kiểu D1 (`?`) sang kiểu Postgres (`$1..$n`).
 * Bỏ qua `?` nằm trong literal 'chuỗi' hoặc "identifier" để tránh đánh số sai
 * khi SQL có dấu hỏi trong dữ liệu (ví dụ LIKE '%?%', check json … '? key').
 */
function toPostgresPlaceholders(query: string): string {
  let index = 0
  let inSingle = false
  let inDouble = false
  let out = ''
  for (let i = 0; i < query.length; i++) {
    const ch = query[i]
    if (inSingle) {
      out += ch
      if (ch === "'") {
        if (query[i + 1] === "'") {
          out += "'"
          i++
        } else {
          inSingle = false
        }
      }
      continue
    }
    if (inDouble) {
      out += ch
      if (ch === '"') inDouble = false
      continue
    }
    if (ch === "'") {
      inSingle = true
      out += ch
    } else if (ch === '"') {
      inDouble = true
      out += ch
    } else if (ch === '?') {
      out += `$${++index}`
    } else {
      out += ch
    }
  }
  return out
}

class NeonBoundStatement implements BoundStatement {
  constructor(
    private readonly execute: (query: string, values: unknown[]) => Promise<Record<string, unknown>[]>,
    private readonly query: string,
    private readonly values: unknown[],
  ) {}

  async run(): Promise<QueryResult> {
    const results = await this.execute(this.query, this.values)
    return { results, success: true, meta: { rows_written: results.length } }
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    return { results: (await this.execute(this.query, this.values)) as T[] }
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const rows = await this.execute(this.query, this.values)
    return (rows[0] as T | undefined) ?? null
  }
}

class NeonPreparedStatement implements PreparedStatement {
  constructor(
    private readonly execute: (query: string, values: unknown[]) => Promise<Record<string, unknown>[]>,
    private readonly query: string,
  ) {}

  bind(...values: unknown[]): BoundStatement {
    return new NeonBoundStatement(this.execute, this.query, values)
  }

  run(): Promise<QueryResult> {
    return this.bind().run()
  }

  all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    return this.bind().all<T>()
  }

  first<T = Record<string, unknown>>(): Promise<T | null> {
    return this.bind().first<T>()
  }
}

export function createDatabase(connectionString?: string): AppDatabase {
  if (!connectionString) {
    const unavailable = async (): Promise<Record<string, unknown>[]> => {
      throw new Error('Chưa cấu hình DATABASE_URL (Neon Postgres) trên Vercel')
    }
    return {
      prepare: (query) => new NeonPreparedStatement(unavailable, query),
      batch: async () => unavailable().then(() => []),
    }
  }

  const sql = neon(connectionString)
  const execute = async (query: string, values: unknown[]) => {
    return (await sql.query(toPostgresPlaceholders(query), values)) as Record<string, unknown>[]
  }

  return {
    prepare: (query) => new NeonPreparedStatement(execute, query),
    // The app only batches independent inserts/deletes. Promise.all preserves the
    // D1 API shape without opening an HTTP transaction for every small operation.
    batch: (statements) => Promise.all(statements.map((statement) => statement.run())),
  }
}

// ------------------------------------------------------------------ auto schema

export const SCHEMA_SQL = `
-- Faceless Forge — Neon Postgres schema for Vercel (auto-create)
CREATE TABLE IF NOT EXISTS ideas (
  id TEXT PRIMARY KEY,
  raw_topic TEXT NOT NULL,
  niche TEXT,
  audience TEXT,
  platform TEXT,
  language TEXT DEFAULT 'Tiếng Việt',
  tone TEXT,
  duration_sec INTEGER DEFAULT 45,
  goal TEXT,
  refined_json TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS blueprints (
  id TEXT PRIMARY KEY,
  idea_id TEXT REFERENCES ideas(id),
  title TEXT,
  concept TEXT,
  viral_score INTEGER DEFAULT 0,
  duration_sec INTEGER DEFAULT 45,
  language TEXT,
  platform TEXT,
  data_json TEXT NOT NULL,
  status TEXT DEFAULT 'draft',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  blueprint_id TEXT REFERENCES blueprints(id),
  kind TEXT NOT NULL,
  shot_index INTEGER DEFAULT 0,
  r2_key TEXT NOT NULL,
  content_type TEXT,
  size BIGINT DEFAULT 0,
  prompt TEXT,
  meta_json TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS distributions (
  id TEXT PRIMARY KEY,
  blueprint_id TEXT NOT NULL REFERENCES blueprints(id),
  platform TEXT NOT NULL,
  caption TEXT,
  hashtags TEXT,
  best_time TEXT,
  pack_json TEXT,
  status TEXT DEFAULT 'ready',
  published_at TIMESTAMPTZ,
  post_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS metrics (
  id TEXT PRIMARY KEY,
  distribution_id TEXT,
  blueprint_id TEXT,
  platform TEXT,
  views INTEGER DEFAULT 0,
  likes INTEGER DEFAULT 0,
  comments INTEGER DEFAULT 0,
  shares INTEGER DEFAULT 0,
  followers_gained INTEGER DEFAULT 0,
  revenue_usd DOUBLE PRECISION DEFAULT 0,
  revenue_source TEXT,
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  progress INTEGER DEFAULT 0,
  message TEXT,
  params_json TEXT,
  result_json TEXT,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_blueprints_idea ON blueprints(idea_id);
CREATE INDEX IF NOT EXISTS idx_blueprints_created ON blueprints(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assets_blueprint ON assets(blueprint_id);
CREATE INDEX IF NOT EXISTS idx_assets_kind ON assets(kind);
CREATE INDEX IF NOT EXISTS idx_dist_blueprint ON distributions(blueprint_id);
CREATE INDEX IF NOT EXISTS idx_metrics_blueprint ON metrics(blueprint_id);
CREATE INDEX IF NOT EXISTS idx_metrics_platform ON metrics(platform);
CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created_at DESC);

-- Faceless Studio: RAG documents, chunks and browser job history.
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
`

let schemaEnsured = false

export async function ensureSchema(connectionString?: string): Promise<{ ok: boolean; message: string }> {
  if (!connectionString) {
    return { ok: false, message: 'Chưa cấu hình DATABASE_URL' }
  }
  if (schemaEnsured) {
    return { ok: true, message: 'Schema đã được đảm bảo trước đó trong instance này' }
  }
  try {
    const sql = neon(connectionString)
    // Tách theo ; nhưng giữ an toàn — các CREATE không chứa ; trong literal
    const statements = SCHEMA_SQL.split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    for (const stmt of statements) {
      // Bỏ comment dòng
      const cleaned = stmt
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n')
        .trim()
      if (!cleaned) continue
      await sql.query(cleaned, [])
    }
    schemaEnsured = true
    return { ok: true, message: 'Đã tự tạo / kiểm tra schema DB thành công' }
  } catch (e: any) {
    const msg = String(e?.message || e).slice(0, 500)
    console.error('[db] ensureSchema failed:', msg)
    return { ok: false, message: `Tự tạo schema thất bại: ${msg}` }
  }
}

// Dùng trong health check để tự tạo schema khi bảng chưa tồn tại
export function isMissingTableError(err: unknown): boolean {
  const msg = String((err as any)?.message || err).toLowerCase()
  return msg.includes('does not exist') || msg.includes('relation') || msg.includes('no such table')
}
