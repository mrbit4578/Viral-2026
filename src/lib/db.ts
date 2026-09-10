/**
 * Thin Postgres adapter that preserves the small D1 surface used by the app.
 * It keeps route and domain code database-agnostic while running on Neon via
 * Vercel Functions.
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
