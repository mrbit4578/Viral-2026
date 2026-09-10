/**
 * Phương án 2 — Gemini API (key dạng mới `AQ.Ab...` của AI Studio).
 * Ảnh: Gemini native image (Nano Banana) qua :generateContent.
 * Video: Veo qua :predictLongRunning + poll operation + download.
 *
 * LƯU Ý: key AQ. chỉ hoạt động với native endpoint (header x-goog-api-key),
 * KHÔNG dùng được cho OpenAI-compatible (/v1beta/openai/...).
 */
import type { Bindings } from '../types.js'

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta'

export class GeminiError extends Error {}

export function hasGemini(env: Bindings): boolean {
  return Boolean(env.GEMINI_API_KEY)
}

export const GEMINI_IMAGE_MODELS = [
  'gemini-3.1-flash-image',
  'gemini-3.1-flash-lite-image',
  'gemini-2.5-flash-image',
] as const

export const VEO_MODELS = [
  'veo-3.1-fast-generate-preview',
  'veo-3.1-generate-preview',
] as const

// ---------------------------------------------------------------- helpers

async function geminiFetch(env: Bindings, path: string, init: RequestInit, timeoutMs = 50_000): Promise<Response> {
  const key = env.GEMINI_API_KEY
  if (!key) throw new GeminiError('Chưa cấu hình GEMINI_API_KEY')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const headers = new Headers(init.headers || {})
    headers.set('x-goog-api-key', key)
    const res = await fetch(`${API_BASE}${path}`, { ...init, headers, signal: controller.signal })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new GeminiError(friendlyGeminiError(res.status, text))
    }
    return res
  } catch (err: any) {
    if (err?.name === 'AbortError') throw new GeminiError('Gemini quá thởi gian chờ')
    throw err instanceof GeminiError ? err : new GeminiError(String(err?.message || err))
  } finally {
    clearTimeout(timer)
  }
}

/** Dịch lỗi Google API thành thông báo ngắn, hữu ích. */
function friendlyGeminiError(status: number, raw: string): string {
  let message = raw.slice(0, 380)
  try {
    const parsed = JSON.parse(raw)
    if (parsed?.error?.message) message = String(parsed.error.message).slice(0, 380)
  } catch { /* giữ raw */ }
  if (status === 401 || status === 403) {
    return `Gemini từ chối key (${status}): ${message}. Kiểm tra key trong AI Studio và project đã bật Generative Language API.`
  }
  if (status === 404) {
    return `Model không khả dụng với key này (404): ${message}. Thử model khác trong /api/config.`
  }
  if (status === 429) {
    return `Hết hạn mức/lượt gọi (429): ${message}. Veo và ảnh chất lượng cao cần bật Billing cho project.`
  }
  return `Gemini ${status}: ${message}`
}

// ---------------------------------------------------------------- ảnh

export async function generateGeminiImage(
  env: Bindings,
  prompt: string,
  opts: { model?: string; aspectRatio?: string } = {}
): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  const model = GEMINI_IMAGE_MODELS.includes(opts.model as any) ? String(opts.model) : GEMINI_IMAGE_MODELS[0]
  const aspect = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'].includes(
    String(opts.aspectRatio)
  )
    ? String(opts.aspectRatio)
    : '9:16'

  const res = await geminiFetch(env, `/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt.slice(0, 4000) }] }],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: { aspectRatio: aspect },
      },
    }),
  })
  const data = (await res.json()) as any

  if (data?.promptFeedback?.blockReason) {
    throw new GeminiError(`Prompt bị chặn bởi bộ lọc an toàn: ${data.promptFeedback.blockReason}`)
  }

  const parts: any[] = data?.candidates?.[0]?.content?.parts || []
  for (const part of parts) {
    const inline = part?.inlineData || part?.inline_data
    if (inline?.data) {
      const g = globalThis as any
      const bytes: ArrayBuffer = g.Buffer
        ? g.Buffer.from(String(inline.data), 'base64').buffer.slice(0)
        : Uint8Array.from(atob(String(inline.data)), (c) => c.charCodeAt(0)).buffer
      if (bytes.byteLength < 1024) throw new GeminiError('Ảnh Gemini trả về không hợp lệ')
      return { bytes, contentType: String(inline.mimeType || inline.mime_type || 'image/png') }
    }
  }
  const textPart = parts.map((p) => p?.text).filter(Boolean).join(' ').slice(0, 200)
  throw new GeminiError(`Gemini không trả ảnh${textPart ? ` (phản hồi: ${textPart})` : ''}`)
}

// ---------------------------------------------------------------- video (Veo)

export async function startVeoOperation(
  env: Bindings,
  prompt: string,
  opts: { model?: string; aspectRatio?: string } = {}
): Promise<string> {
  const model = VEO_MODELS.includes(opts.model as any) ? String(opts.model) : VEO_MODELS[0]
  const aspect = opts.aspectRatio === '16:9' ? '16:9' : '9:16'

  const res = await geminiFetch(
    env,
    `/models/${model}:predictLongRunning`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instances: [{ prompt: prompt.slice(0, 2500) }],
        parameters: { aspectRatio: aspect },
      }),
    },
    30_000
  )
  const data = (await res.json()) as any
  const name = data?.name
  if (!name || typeof name !== 'string') {
    throw new GeminiError('Veo không trả về operation name')
  }
  return name
}

export type VeoStatus =
  | { done: false }
  | { done: true; videoUri: string }
  | { done: true; error: string }

export async function getVeoOperationStatus(env: Bindings, name: string): Promise<VeoStatus> {
  // Chỉ chấp nhận operation path hợp lệ để tránh SSRF/query injection.
  if (!/^models\/[\w.-]+\/operations\/[\w.-]+$/i.test(name)) {
    throw new GeminiError('Operation name không hợp lệ')
  }
  const res = await geminiFetch(env, `/${name}`, { method: 'GET' }, 20_000)
  const data = (await res.json()) as any
  if (!data?.done) return { done: false }
  if (data?.error?.message) return { done: true, error: String(data.error.message).slice(0, 300) }
  const uri = data?.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri
  if (!uri || typeof uri !== 'string') {
    return { done: true, error: 'Hoàn tất nhưng không tìm thấy video URI' }
  }
  if (!/^https:\/\/generativelanguage\.googleapis\.com\//i.test(uri)) {
    return { done: true, error: 'Video URI không đúng nguồn Google' }
  }
  return { done: true, videoUri: uri }
}

export async function downloadVeoVideo(env: Bindings, uri: string): Promise<ArrayBuffer> {
  // URI tuyệt đối trỏ về googleapis — fetch trực tiếp với header key.
  const key = String(env.GEMINI_API_KEY || '')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 55_000)
  try {
    const fileRes = await fetch(uri, { headers: { 'x-goog-api-key': key }, signal: controller.signal, redirect: 'follow' })
    if (!fileRes.ok) throw new GeminiError(`Tải video thất bại (${fileRes.status})`)
    const bytes = await fileRes.arrayBuffer()
    if (bytes.byteLength < 50_000) throw new GeminiError('Video tải về quá nhỏ — dữ liệu không hợp lệ')
    return bytes
  } catch (err: any) {
    if (err?.name === 'AbortError') throw new GeminiError('Tải video quá thởi gian chờ')
    throw err instanceof GeminiError ? err : new GeminiError(String(err?.message || err))
  } finally {
    clearTimeout(timer)
  }
}
