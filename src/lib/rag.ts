/**
 * RAG engine — port của backend/rag_engine.py
 * TF-IDF cosine retrieval thuần TypeScript trên Neon Postgres (thay MongoDB),
 * LLM trả lời có citation + sinh kịch bản video.
 */
import { ask, hasLLM } from './llm.js'
import type { Bindings } from '../types.js'
import { uid } from './media.js'

export const CHUNK_SIZE = 800
export const CHUNK_OVERLAP = 100
const MAX_CHUNKS_SCAN = 3000

// [\w\u00C0-\u1EF9]+ — giữ nguyên regex gốc (hỗ trợ dấu tiếng Việt)
const WORD_RE = /[0-9A-Za-z_\u00C0-\u1EF9]+/gu

export function tokenize(text: string): string[] {
  return ((text || '').toLowerCase().match(WORD_RE) || []) as string[]
}

/** chunk_text() — cắt theo ranh giới đoạn/câu, có overlap */
export function chunkText(raw: string, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {
  const text = (raw || '').trim().replace(/\n{3,}/g, '\n\n')
  if (!text) return []
  const chunks: string[] = []
  let start = 0
  while (start < text.length) {
    let end = Math.min(start + size, text.length)
    if (end < text.length) {
      const window = text.slice(start, end)
      const cut = Math.max(window.lastIndexOf('\n\n'), window.lastIndexOf('. '), window.lastIndexOf('\n'))
      if (cut > size * 0.5) end = start + cut + 1
    }
    const chunk = text.slice(start, end).trim()
    if (chunk) chunks.push(chunk)
    if (end >= text.length) break
    start = Math.max(end - overlap, start + 1)
  }
  return chunks
}

export interface RagDoc {
  id: string
  name: string
  size: number
  chunk_count: number
  char_count: number
  source: string
  created_at: string
}

/** ingest_document() — text đã được parse ở client (pdf.js/docx) hoặc là plain text */
export async function ingestDocument(
  env: Bindings,
  name: string,
  text: string,
  source = 'upload',
): Promise<RagDoc> {
  const chunks = chunkText(text)
  if (!chunks.length) throw new Error('Tài liệu trống hoặc không đọc được nội dung')

  const id = uid('doc')
  const now = new Date().toISOString()
  const doc: RagDoc = {
    id,
    name: name || 'tai-lieu.txt',
    size: new TextEncoder().encode(text).length,
    chunk_count: chunks.length,
    char_count: text.length,
    source,
    created_at: now,
  }

  await env.DB.prepare(
    `INSERT INTO rag_docs (id, name, size, chunk_count, char_count, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(doc.id, doc.name, doc.size, doc.chunk_count, doc.char_count, doc.source, doc.created_at)
    .run()

  // Chia nhỏ batch để truy vấn Postgres luôn gọn và dễ retry.
  // Mỗi batch là MỘT multi-row INSERT (thay vì 1 query/chunk như bản cũ):
  // tài liệu 900k ký tự ~1.100 chunk giảm từ ~1.100 HTTP query xuống ~56.
  const CHUNK_COLS = 6
  const BATCH = 20
  for (let i = 0; i < chunks.length; i += BATCH) {
    const slice = chunks.slice(i, i + BATCH)
    const rowMarks = slice
      .map(() => `(${Array.from({ length: CHUNK_COLS }, () => '?').join(', ')})`)
      .join(', ')
    const values = slice.flatMap((c, k) => [
      `${id}-${i + k}`,
      id,
      doc.name,
      i + k,
      c,
      JSON.stringify(tokenize(c)),
    ])
    await env.DB.prepare(
      `INSERT INTO rag_chunks (id, doc_id, doc_name, idx, text, tokens) VALUES ${rowMarks}`,
    )
      .bind(...values)
      .run()
  }
  return doc
}

export async function listDocuments(env: Bindings): Promise<RagDoc[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, name, size, chunk_count, char_count, source, created_at
     FROM rag_docs ORDER BY created_at DESC LIMIT 200`,
  ).all()
  return (results || []) as unknown as RagDoc[]
}

export async function deleteDocument(env: Bindings, docId: string) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM rag_chunks WHERE doc_id = ?').bind(docId),
    env.DB.prepare('DELETE FROM rag_docs WHERE id = ?').bind(docId),
  ])
}

export interface RagHit {
  id: string
  doc_id: string
  doc_name: string
  index: number
  text: string
  score: number
}

/** retrieve() — TF-IDF cosine similarity, giữ nguyên công thức bản gốc */
export async function retrieve(
  env: Bindings,
  question: string,
  docIds?: string[] | null,
  topK = 5,
): Promise<RagHit[]> {
  let rows: any[]
  if (docIds && docIds.length) {
    const marks = docIds.map(() => '?').join(',')
    const { results } = await env.DB.prepare(
      `SELECT id, doc_id, doc_name, idx, text, tokens FROM rag_chunks
       WHERE doc_id IN (${marks}) LIMIT ${MAX_CHUNKS_SCAN}`,
    )
      .bind(...docIds)
      .all()
    rows = results || []
  } else {
    const { results } = await env.DB.prepare(
      `SELECT id, doc_id, doc_name, idx, text, tokens FROM rag_chunks LIMIT ${MAX_CHUNKS_SCAN}`,
    ).all()
    rows = results || []
  }
  if (!rows.length) return []

  const qTokens = tokenize(question)
  if (!qTokens.length) return []

  const chunks = rows.map((r) => {
    let toks: string[]
    try {
      toks = JSON.parse(r.tokens || '[]')
    } catch {
      toks = []
    }
    if (!toks.length) toks = tokenize(r.text)
    return { ...r, toks }
  })

  const n = chunks.length
  const df = new Map<string, number>()
  for (const c of chunks) {
    for (const t of new Set<string>(c.toks)) df.set(t, (df.get(t) || 0) + 1)
  }
  const idf = new Map<string, number>()
  for (const [t, d] of df) idf.set(t, Math.log((n + 1) / (d + 1)) + 1)

  const unseen = Math.log(n + 1) + 1
  const qTf = new Map<string, number>()
  for (const t of qTokens) qTf.set(t, (qTf.get(t) || 0) + 1)
  const qVec = new Map<string, number>()
  for (const [t, f] of qTf) qVec.set(t, (1 + Math.log(f)) * (idf.get(t) ?? unseen))
  let qNorm = Math.sqrt([...qVec.values()].reduce((s, v) => s + v * v, 0)) || 1

  const scored: Array<{ score: number; c: any }> = []
  for (const c of chunks) {
    const tf = new Map<string, number>()
    for (const t of c.toks) tf.set(t, (tf.get(t) || 0) + 1)
    let dot = 0
    let normSq = 0
    for (const [t, f] of tf) {
      const w = (1 + Math.log(f)) * (idf.get(t) ?? 1)
      normSq += w * w
      const q = qVec.get(t)
      if (q !== undefined) dot += w * q
    }
    const cNorm = Math.sqrt(normSq) || 1
    const cos = dot / (qNorm * cNorm)
    if (cos > 0) scored.push({ score: cos, c })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, topK).map(({ score, c }) => ({
    id: c.id,
    doc_id: c.doc_id,
    doc_name: c.doc_name || '',
    index: c.idx,
    text: c.text,
    score: Math.round(score * 10000) / 10000,
  }))
}

const ASK_SYSTEM =
  'Bạn là trợ lý hỏi đáp tài liệu (RAG). ' +
  'CHỈ trả lời dựa trên các trích đoạn được cung cấp. ' +
  'Trả lời bằng tiếng Việt, rõ ràng, có cấu trúc. ' +
  'Khi dùng thông tin từ trích đoạn nào, ghi [C1], [C2]... ngay sau câu. ' +
  'Nếu trích đoạn không đủ thông tin, nói rõ là tài liệu không đề cập.'

export interface RagAnswer {
  answer: string
  citations: Array<{ label: string; doc_name: string; doc_id: string; snippet: string; score: number }>
  llm: boolean
}

/** ask() — trả lời có citation [C1]..[Cn] */
export async function askDocs(
  env: Bindings,
  question: string,
  docIds?: string[] | null,
  topK = 5,
  model?: string,
): Promise<RagAnswer> {
  const hits = await retrieve(env, question, docIds, topK)
  if (!hits.length) {
    return {
      answer:
        'Không tìm thấy nội dung liên quan trong tài liệu. Hãy upload tài liệu hoặc đặt câu hỏi khác.',
      citations: [],
      llm: false,
    }
  }
  const citations = hits.map((h, i) => ({
    label: `C${i + 1}`,
    doc_name: h.doc_name,
    doc_id: h.doc_id,
    snippet: h.text.slice(0, 220),
    score: h.score,
  }))

  if (!hasLLM(env)) {
    // Fallback không cần key: trả về chính các trích đoạn khớp nhất
    const answer =
      'Chưa cấu hình LLM nên đây là các trích đoạn liên quan nhất trong tài liệu:\n\n' +
      hits.map((h, i) => `[C${i + 1}] ${h.text.slice(0, 400)}`).join('\n\n')
    return { answer, citations, llm: false }
  }

  const context = hits
    .map((h, i) => `[C${i + 1}] (tài liệu: ${h.doc_name})\n${h.text}`)
    .join('\n\n')
  const answer = await ask(
    env,
    ASK_SYSTEM,
    `TRÍCH ĐOẠN:\n${context}\n\nCÂU HỎI: ${question}`,
    model,
  )
  return { answer: answer.trim(), citations, llm: true }
}

const SCRIPT_SYSTEM =
  'Bạn là biên kịch video chuyên nghiệp. Dựa trên tài liệu được cung cấp, ' +
  'viết lời bình (voice-over) tiếng Việt tự nhiên như người thật nói, ' +
  'có mở đầu cuốn hút, thân bài mạch lạc, kết thúc kêu gọi hành động. ' +
  'KHÔNG dùng markdown, KHÔNG tiêu đề, KHÔNG ghi chú cảnh quay — ' +
  'chỉ viết đoạn văn lời bình liền mạch để đọc thành audio.'

/** generate_video_script() */
export async function generateVideoScript(
  env: Bindings,
  opts: {
    docIds?: string[] | null
    topic?: string
    style?: string
    durationSec?: number
    model?: string
  },
) {
  const topic = (opts.topic || '').trim()
  const style = opts.style || 'storytelling'
  const durationSec = Math.max(15, Math.min(opts.durationSec || 60, 600))
  const hits = await retrieve(env, topic || 'nội dung chính của tài liệu', opts.docIds, 8)
  if (!hits.length) throw new Error('Chưa có tài liệu để tạo kịch bản — hãy upload trước')

  const words = Math.max(60, Math.round(durationSec * 2.4))
  const sources = [...new Set(hits.slice(0, 3).map((h) => h.doc_name))]

  if (!hasLLM(env)) {
    const script = hits
      .slice(0, 4)
      .map((h) => h.text.replace(/\s+/g, ' ').slice(0, 320))
      .join(' ')
    return {
      script,
      word_count: script.split(/\s+/).length,
      est_duration_sec: durationSec,
      sources,
      llm: false,
    }
  }

  const context = hits.map((h) => h.text).join('\n\n')
  const user =
    `TÀI LIỆU:\n${context}\n\n` +
    `YÊU CẦU: Viết lời bình video khoảng ${words} từ (~${durationSec} giây đọc). ` +
    `Phong cách: ${style}. ` +
    (topic ? `Chủ đề trọng tâm: ${topic}.` : '')
  const script = (await ask(env, SCRIPT_SYSTEM, user, opts.model)).trim()
  return {
    script,
    word_count: script.split(/\s+/).filter(Boolean).length,
    est_duration_sec: durationSec,
    sources,
    llm: true,
  }
}
