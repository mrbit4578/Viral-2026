/**
 * Kira AI integration — https://kiraai.vn
 * OpenAI-compatible endpoint: https://kiraai.vn/api/v1
 * Docs: https://kiraai.vn/guide/chatgpt/ , https://kiraai.vn/models/
 *
 * Hỗ trợ hơn 100+ model qua một key: kira-auto, kira-2.0, deepseek, qwen, gpt, claude...
 * Tích hợp như provider fallback thứ 3 sau primary (Genspark/OpenAI) và Explabs.
 *
 * Media integration: image + speech (TTS) — auto fallback chain Gemini->Kira->Pollinations/Google
 */
import type { Bindings } from '../types.js'

export const KIRA_MODELS: Record<string, string> = {
  'kira-auto': 'kira-auto',
  'kira-2.0': 'kira-2.0',
  'kira-3.0': 'kira-3.0',
  'kira-2.5': 'kira-2.5',
  'deepseek-v4-flash': 'deepseek-v4-flash',
  'deepseek-v4-flash-free': 'deepseek-v4-flash-free',
  'qwen3.8-flash': 'qwen3.8-flash',
  'qwen3-235b': 'qwen3-235b',
  'gpt-4o-mini': 'gpt-4o-mini',
  'claude-3.5-sonnet': 'claude-3.5-sonnet',
}

export const DEFAULT_KIRA_MODEL = 'kira-auto'

// --- Media models ---
export const KIRA_IMAGE_MODELS = [
  'kira-image-1',
  'kira-image-pro',
  'kira-flux',
  'flux',
  'dall-e-3',
  'dall-e-2',
  'kira-dalle',
]

export const DEFAULT_KIRA_IMAGE_MODEL = 'kira-image-1'

export const KIRA_VOICES = [
  'kira-female-1',
  'kira-female-2',
  'kira-male-1',
  'kira-male-2',
  'alloy',
  'nova',
  'shimmer',
  'echo',
  'fable',
  'onyx',
]

export const DEFAULT_KIRA_VOICE = 'kira-female-1'

export class KiraError extends Error {}

type KiraResolved = { apiKey: string; baseURL: string }

function resolveKira(env: Bindings): KiraResolved | null {
  const rawKey = (env as any).KIRA_API_KEY?.trim() || env.KIRA_API_KEY?.trim() || ''
  if (!rawKey) return null
  const rawBase = (env as any).KIRA_BASE_URL || env.KIRA_BASE_URL || 'https://kiraai.vn/api/v1'
  const baseURL = String(rawBase).replace(/\/$/, '')
  return { apiKey: String(rawKey), baseURL }
}

export function hasKira(env: Bindings): boolean {
  return Boolean(resolveKira(env))
}

export function getKiraModel(requested?: string, env?: Bindings): string {
  if (env?.KIRA_MODEL) return env.KIRA_MODEL
  if (requested && KIRA_MODELS[requested]) return KIRA_MODELS[requested]
  return DEFAULT_KIRA_MODEL
}

export function getKiraImageModel(requested?: string): string {
  if (!requested) return DEFAULT_KIRA_IMAGE_MODEL
  if (KIRA_IMAGE_MODELS.includes(requested)) return requested
  // map common aliases
  if (requested.includes('flux')) return 'kira-flux'
  if (requested.includes('dall-e')) return requested
  return DEFAULT_KIRA_IMAGE_MODEL
}

export function getKiraVoice(requested?: string): string {
  if (!requested) return DEFAULT_KIRA_VOICE
  if (KIRA_VOICES.includes(requested)) return requested
  return DEFAULT_KIRA_VOICE
}

/** Gọi chat completion qua Kira AI */
export async function askKira(
  env: Bindings,
  system: string,
  user: string,
  model = DEFAULT_KIRA_MODEL,
  timeoutMs = 50_000
): Promise<string> {
  const resolved = resolveKira(env)
  if (!resolved) throw new KiraError('Chưa cấu hình KIRA_API_KEY')

  const chosen = getKiraModel(model, env)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${resolved.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${resolved.apiKey}`,
      },
      body: JSON.stringify({
        model: chosen,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
      signal: controller.signal,
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new KiraError(`Kira ${res.status}: ${detail.slice(0, 400)}`)
    }
    const data = (await res.json()) as any
    let text: string | undefined
    if (typeof data?.choices?.[0]?.message?.content === 'string') {
      text = data.choices[0].message.content
    } else if (typeof data?.choices?.[0]?.text === 'string') {
      text = data.choices[0].text
    } else if (typeof data?.output?.[0]?.content?.[0]?.text === 'string') {
      text = data.output[0].content[0].text
    } else if (typeof data?.output_text === 'string') {
      text = data.output_text
    }
    if (!text || !text.trim()) throw new KiraError('Kira trả về nội dung trống')
    return text.trim()
  } catch (err: any) {
    if (err?.name === 'AbortError') throw new KiraError('Kira quá thời gian chờ')
    throw err instanceof KiraError ? err : new KiraError(String(err?.message || err))
  } finally {
    clearTimeout(timer)
  }
}

export function extractKiraJSON<T = any>(text: string): T {
  let cleaned = (text || '').trim()
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  try {
    return JSON.parse(cleaned) as T
  } catch {
    const objMatch = cleaned.match(/\{[\s\S]*\}/)
    if (objMatch) return JSON.parse(objMatch[0]) as T
    const arrMatch = cleaned.match(/\[[\s\S]*\]/)
    if (arrMatch) return JSON.parse(arrMatch[0]) as T
    throw new KiraError('Không đọc được JSON từ phản hồi Kira')
  }
}

export async function askKiraJSON<T = any>(
  env: Bindings,
  system: string,
  user: string,
  model = DEFAULT_KIRA_MODEL
): Promise<T> {
  const raw = await askKira(env, system, user, model)
  return extractKiraJSON<T>(raw)
}

// ------------------------------------------------------------------ unified helper
export async function tryKiraFallback(
  env: Bindings,
  system: string,
  user: string,
  model?: string,
  timeoutMs = 20_000
): Promise<string | null> {
  if (!hasKira(env)) return null
  try {
    const res = await askKira(env, system, user, model || DEFAULT_KIRA_MODEL, timeoutMs)
    console.log('[kira] fallback success')
    return res
  } catch (e) {
    console.warn('[kira] fallback failed:', String((e as any)?.message || e).slice(0, 300))
    return null
  }
}

// ================================================================== Media: Image

function b64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/\s+/g, '')
  const bin = atob(clean)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

function guessImageContentType(bytes: Uint8Array): string {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg'
  if (bytes.length >= 4 && bytes[0] === 0x52 && bytes[1] === 0x49) return 'image/webp'
  return 'image/png'
}

export async function generateKiraImage(
  env: Bindings,
  prompt: string,
  opts: { model?: string; width?: number; height?: number; n?: number } = {},
  timeoutMs = 50_000
): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  const resolved = resolveKira(env)
  if (!resolved) throw new KiraError('Chưa cấu hình KIRA_API_KEY')

  const model = getKiraImageModel(opts.model)
  const width = Math.max(256, Math.min(2048, opts.width || 768))
  const height = Math.max(256, Math.min(2048, opts.height || 1344))

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    // Try OpenAI-compatible /images/generations
    const payload: any = {
      model,
      prompt,
      n: opts.n || 1,
      size: `${width}x${height}`,
      response_format: 'b64_json',
    }

    const res = await fetch(`${resolved.baseURL}/images/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${resolved.apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      // If endpoint not found, try alternative /v1/images/generations already covered by baseURL
      throw new KiraError(`Kira Image ${res.status}: ${detail.slice(0, 500)}`)
    }

    const data = (await res.json()) as any
    const first = data?.data?.[0]
    if (!first) throw new KiraError('Kira Image trả về rỗng')

    if (first.b64_json) {
      const bytes = b64ToBytes(first.b64_json)
      return { bytes: bytes.buffer as ArrayBuffer, contentType: guessImageContentType(bytes) }
    }

    if (first.url) {
      // Download from URL (may be temporary)
      const imgRes = await fetch(first.url, { signal: controller.signal })
      if (!imgRes.ok) throw new KiraError(`Kira Image URL fetch ${imgRes.status}`)
      const ct = imgRes.headers.get('content-type') || 'image/png'
      const buf = await imgRes.arrayBuffer()
      return { bytes: buf, contentType: ct }
    }

    throw new KiraError('Kira Image không trả về b64_json hay url')
  } catch (err: any) {
    if (err?.name === 'AbortError') throw new KiraError('Kira Image quá thời gian chờ')
    throw err instanceof KiraError ? err : new KiraError(String(err?.message || err))
  } finally {
    clearTimeout(timer)
  }
}

// ================================================================== Media: Speech / TTS

export async function generateKiraSpeech(
  env: Bindings,
  text: string,
  opts: { voice?: string; model?: string; format?: string } = {},
  timeoutMs = 50_000
): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  const resolved = resolveKira(env)
  if (!resolved) throw new KiraError('Chưa cấu hình KIRA_API_KEY')

  const voice = getKiraVoice(opts.voice)
  const model = opts.model || 'kira-tts-1'
  const format = opts.format || 'mp3'

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  // Try endpoints in order: /audio/speech (OpenAI-compatible), /audio/voice, /v1/audio/speech
  const endpoints = [
    `${resolved.baseURL}/audio/speech`,
    `${resolved.baseURL}/audio/voice`,
    `${resolved.baseURL}/audio/generations`,
  ]

  let lastErr: any = null

  for (const ep of endpoints) {
    try {
      const payload: any = {
        model,
        input: text,
        voice,
        response_format: format,
      }

      const res = await fetch(ep, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${resolved.apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })

      if (!res.ok) {
        const detail = await res.text().catch(() => '')
        // 404 -> try next endpoint
        if (res.status === 404) {
          lastErr = new KiraError(`Kira Speech ${res.status} at ${ep}: ${detail.slice(0, 300)}`)
          continue
        }
        throw new KiraError(`Kira Speech ${res.status}: ${detail.slice(0, 500)}`)
      }

      const ct = res.headers.get('content-type') || ''
      // If JSON with b64 audio
      if (ct.includes('application/json')) {
        const data = (await res.json()) as any
        // Possible shapes: { data: [{ b64 }]} or { audio: b64 } or { b64_json }
        let b64: string | undefined
        if (data?.data?.[0]?.b64_json) b64 = data.data[0].b64_json
        else if (data?.data?.[0]?.b64) b64 = data.data[0].b64
        else if (data?.audio) b64 = data.audio
        else if (data?.b64_json) b64 = data.b64_json
        else if (data?.url) {
          const audRes = await fetch(data.url, { signal: controller.signal })
          if (!audRes.ok) throw new KiraError(`Kira Speech URL fetch ${audRes.status}`)
          const buf = await audRes.arrayBuffer()
          const act = audRes.headers.get('content-type') || 'audio/mpeg'
          return { bytes: buf, contentType: act }
        }
        if (b64) {
          const bytes = b64ToBytes(b64)
          const isWav = bytes.length > 4 && bytes[0] === 0x52 && bytes[1] === 0x49
          return { bytes: bytes.buffer as ArrayBuffer, contentType: isWav ? 'audio/wav' : 'audio/mpeg' }
        }
        throw new KiraError('Kira Speech JSON không chứa audio')
      }

      // Binary audio directly
      const buf = await res.arrayBuffer()
      if (buf.byteLength < 100) throw new KiraError('Kira Speech trả về quá nhỏ')
      const contentType = ct || (format === 'wav' ? 'audio/wav' : 'audio/mpeg')
      return { bytes: buf, contentType }
    } catch (err: any) {
      if (err?.name === 'AbortError') throw new KiraError('Kira Speech quá thời gian chờ')
      lastErr = err
      // If it's KiraError with 404 we already continue; else break on first success path
      if (err instanceof KiraError && String(err.message).includes('404')) continue
      // For other errors, if this was not last endpoint, try next
      if (ep !== endpoints[endpoints.length - 1] && String(err?.message || '').includes('404')) continue
      // Otherwise if it's final endpoint, throw
      if (ep === endpoints[endpoints.length - 1]) break
      // Try next
      continue
    }
  }

  throw lastErr instanceof KiraError ? lastErr : new KiraError(String(lastErr?.message || lastErr || 'Kira Speech thất bại'))
}
