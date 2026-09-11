/**
 * Kira AI integration — https://kiraai.vn
 * OpenAI-compatible endpoint: https://kiraai.vn/api/v1
 * Docs: https://kiraai.vn/documents/ (official)
 *
 * Models per official docs:
 * - Chat: kira-mini-1.0 (free), kira-3.5-pro, kira-3.5-flash, kira-2.5-pro, kira-2.5-flash
 * - Image: kira-3.0-image (high speed), kira-2.0-image (stable)
 * - Video: kira-3.0-video, kira-3.0-video-flash
 * - TTS: kira-3.0-flash-tts (studio Vietnamese), kira-2.0-flash-tts (low latency)
 * - Voices: Kore, Fenrir, Puck, Charon, Aoede + OpenAI mapping alloy->Kore etc.
 *
 * Endpoints:
 * - POST /chat/completions
 * - POST /images/generations with {model, prompt, aspect_ratio} -> data[0].b64_json
 * - POST /audio/speech with {model, input, voice} -> binary mp3
 * - POST /videos/generations -> {id} then GET /videos/operations/:id polling -> done + data[0].b64_json mp4
 */

import type { Bindings } from '../types.js'

// ------------------------------------------------------------------ Chat models (official)
export const KIRA_MODELS: Record<string, string> = {
  'kira-3.5-pro': 'kira-3.5-pro',
  'kira-3.5-flash': 'kira-3.5-flash',
  'kira-2.5-pro': 'kira-2.5-pro',
  'kira-2.5-flash': 'kira-2.5-flash',
  'kira-mini-1.0': 'kira-mini-1.0',
  // aliases for compatibility
  'kira-auto': 'kira-3.5-flash',
  'kira-3.0': 'kira-3.5-flash',
  'kira-2.0': 'kira-2.5-flash',
  'kira-2.5': 'kira-2.5-flash',
  'kira-3.0-pro': 'kira-3.5-pro',
}

export const DEFAULT_KIRA_MODEL = 'kira-3.5-flash'

// ------------------------------------------------------------------ Image models (official)
export const KIRA_IMAGE_MODELS = ['kira-3.0-image', 'kira-2.0-image'] as const
export const DEFAULT_KIRA_IMAGE_MODEL = 'kira-3.0-image'
export const KIRA_IMAGE_ASPECT_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4'] as const

// ------------------------------------------------------------------ TTS models (official)
export const KIRA_TTS_MODELS = ['kira-3.0-flash-tts', 'kira-2.0-flash-tts'] as const
export const DEFAULT_KIRA_TTS_MODEL = 'kira-3.0-flash-tts'

// Voices official + OpenAI mapping
export const KIRA_VOICES = [
  'Kore',
  'Fenrir',
  'Puck',
  'Charon',
  'Aoede',
  // OpenAI compatible aliases
  'alloy', // -> Kore
  'echo', // -> Fenrir
  'fable', // -> Puck
  'onyx', // -> Charon
  'nova', // -> Aoede
] as const

export const KIRA_VOICE_MAP: Record<string, string> = {
  alloy: 'Kore',
  echo: 'Fenrir',
  fable: 'Puck',
  onyx: 'Charon',
  nova: 'Aoede',
  // allow lowercase input
  kore: 'Kore',
  fenrir: 'Fenrir',
  puck: 'Puck',
  charon: 'Charon',
  aoede: 'Aoede',
}

export const DEFAULT_KIRA_VOICE = 'Kore'

// ------------------------------------------------------------------ Video models (official)
export const KIRA_VIDEO_MODELS = ['kira-3.0-video', 'kira-3.0-video-flash'] as const
export const DEFAULT_KIRA_VIDEO_MODEL = 'kira-3.0-video'
export const KIRA_VIDEO_ASPECT_RATIOS = ['16:9', '9:16', '1:1'] as const
export const KIRA_VIDEO_DURATIONS = [4, 6, 8] as const

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
  // if requested is already a known official id, keep it
  if (requested && Object.values(KIRA_MODELS).includes(requested)) return requested
  return DEFAULT_KIRA_MODEL
}

export function getKiraImageModel(requested?: string): string {
  if (!requested) return DEFAULT_KIRA_IMAGE_MODEL
  const lower = requested.toLowerCase()
  if ((KIRA_IMAGE_MODELS as readonly string[]).includes(lower)) return lower
  if ((KIRA_IMAGE_MODELS as readonly string[]).includes(requested)) return requested
  // legacy aliases mapping to official
  if (lower.includes('3.0') || lower.includes('image-1') || lower.includes('image-pro') || lower.includes('flux') || lower.includes('dall-e')) {
    return 'kira-3.0-image'
  }
  return DEFAULT_KIRA_IMAGE_MODEL
}

export function getKiraTTSModel(requested?: string): string {
  if (!requested) return DEFAULT_KIRA_TTS_MODEL
  const lower = requested.toLowerCase()
  if ((KIRA_TTS_MODELS as readonly string[]).includes(lower)) return lower
  if ((KIRA_TTS_MODELS as readonly string[]).includes(requested)) return requested
  if (lower.includes('2.0')) return 'kira-2.0-flash-tts'
  return DEFAULT_KIRA_TTS_MODEL
}

export function getKiraVoice(requested?: string): string {
  if (!requested) return DEFAULT_KIRA_VOICE
  const mapped = KIRA_VOICE_MAP[requested] || KIRA_VOICE_MAP[requested.toLowerCase()]
  if (mapped) return mapped
  if ((KIRA_VOICES as readonly string[]).includes(requested)) return requested
  // case-insensitive check for official voices
  const lower = requested.toLowerCase()
  for (const v of KIRA_VOICES) {
    if (v.toLowerCase() === lower) return v
  }
  return DEFAULT_KIRA_VOICE
}

export function getKiraVideoModel(requested?: string): string {
  if (!requested) return DEFAULT_KIRA_VIDEO_MODEL
  if ((KIRA_VIDEO_MODELS as readonly string[]).includes(requested)) return requested
  const lower = requested.toLowerCase()
  if ((KIRA_VIDEO_MODELS as readonly string[]).includes(lower)) return lower
  if (lower.includes('flash')) return 'kira-3.0-video-flash'
  return DEFAULT_KIRA_VIDEO_MODEL
}

export function getKiraAspectRatio(requested?: string, fallback: string = '9:16'): string {
  if (!requested) return fallback
  if ((KIRA_IMAGE_ASPECT_RATIOS as readonly string[]).includes(requested)) return requested
  if ((KIRA_VIDEO_ASPECT_RATIOS as readonly string[]).includes(requested)) return requested
  // map width/height to closest ratio
  return fallback
}

// ------------------------------------------------------------------ helpers
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

// ------------------------------------------------------------------ Chat
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

// ================================================================== Media: Image (official docs)
// POST /images/generations {model: kira-3.0-image, prompt, aspect_ratio} -> {data:[{b64_json}]}

export async function generateKiraImage(
  env: Bindings,
  prompt: string,
  opts: {
    model?: string
    width?: number
    height?: number
    aspect_ratio?: string
    n?: number
  } = {},
  timeoutMs = 50_000
): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  const resolved = resolveKira(env)
  if (!resolved) throw new KiraError('Chưa cấu hình KIRA_API_KEY')

  const model = getKiraImageModel(opts.model)

  // Convert width/height to aspect_ratio if provided, else use explicit aspect_ratio or default 9:16
  let aspect_ratio = opts.aspect_ratio || '9:16'
  if (opts.width && opts.height) {
    const ratio = opts.width / opts.height
    if (ratio > 1.5) aspect_ratio = '16:9'
    else if (ratio < 0.7) aspect_ratio = '9:16'
    else if (Math.abs(ratio - 1) < 0.1) aspect_ratio = '1:1'
    else if (ratio > 1) aspect_ratio = '4:3'
    else aspect_ratio = '3:4'
  }
  if (!(KIRA_IMAGE_ASPECT_RATIOS as readonly string[]).includes(aspect_ratio)) {
    aspect_ratio = '9:16'
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const payload: any = {
      model,
      prompt,
      aspect_ratio,
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
      throw new KiraError(`Kira Image ${res.status}: ${detail.slice(0, 500)}`)
    }

    const data = (await res.json()) as any
    const first = data?.data?.[0]
    if (!first) throw new KiraError('Kira Image trả về rỗng')

    if (first.b64_json) {
      const bytes = b64ToBytes(first.b64_json)
      return { bytes: bytes.buffer as ArrayBuffer, contentType: first.mime_type || guessImageContentType(bytes) }
    }

    if (first.url) {
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

// ================================================================== Media: Speech / TTS (official)
// POST /audio/speech {model: kira-3.0-flash-tts, input, voice} -> binary mp3

export async function generateKiraSpeech(
  env: Bindings,
  text: string,
  opts: { voice?: string; model?: string; format?: string } = {},
  timeoutMs = 50_000
): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  const resolved = resolveKira(env)
  if (!resolved) throw new KiraError('Chưa cấu hình KIRA_API_KEY')

  const voice = getKiraVoice(opts.voice)
  const model = getKiraTTSModel(opts.model)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const payload: any = {
      model,
      input: text,
      voice,
    }

    const res = await fetch(`${resolved.baseURL}/audio/speech`, {
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
      throw new KiraError(`Kira Speech ${res.status}: ${detail.slice(0, 500)}`)
    }

    const ct = res.headers.get('content-type') || ''
    if (ct.includes('application/json')) {
      const data = (await res.json()) as any
      let b64: string | undefined
      if (data?.data?.[0]?.b64_json) b64 = data.data[0].b64_json
      else if (data?.b64_json) b64 = data.b64_json
      else if (data?.audio) b64 = data.audio
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

    const buf = await res.arrayBuffer()
    if (buf.byteLength < 100) throw new KiraError('Kira Speech trả về quá nhỏ')
    const contentType = ct || 'audio/mpeg'
    return { bytes: buf, contentType }
  } catch (err: any) {
    if (err?.name === 'AbortError') throw new KiraError('Kira Speech quá thời gian chờ')
    throw err instanceof KiraError ? err : new KiraError(String(err?.message || err))
  } finally {
    clearTimeout(timer)
  }
}

// ================================================================== Media: Video (official)
// POST /videos/generations {prompt, model, aspect_ratio, duration_seconds} -> {id}
// GET /videos/operations/:id -> {done, data:[{b64_json}]}

export async function generateKiraVideoStart(
  env: Bindings,
  prompt: string,
  opts: {
    model?: string
    aspect_ratio?: string
    duration_seconds?: number
  } = {},
  timeoutMs = 50_000
): Promise<{ operationId: string; model: string }> {
  const resolved = resolveKira(env)
  if (!resolved) throw new KiraError('Chưa cấu hình KIRA_API_KEY')

  const model = getKiraVideoModel(opts.model)
  const aspect_ratio = getKiraAspectRatio(opts.aspect_ratio, '16:9')
  const duration_seconds = opts.duration_seconds && KIRA_VIDEO_DURATIONS.includes(opts.duration_seconds as any) ? opts.duration_seconds : 6

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const payload: any = {
      model,
      prompt,
      aspect_ratio,
      duration_seconds,
    }

    const res = await fetch(`${resolved.baseURL}/videos/generations`, {
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
      throw new KiraError(`Kira Video ${res.status}: ${detail.slice(0, 500)}`)
    }

    const data = (await res.json()) as any
    const id = data?.id || data?.operation || data?.operation_id || data?.data?.id
    if (!id) throw new KiraError('Kira Video không trả về operation id')
    return { operationId: String(id), model }
  } catch (err: any) {
    if (err?.name === 'AbortError') throw new KiraError('Kira Video quá thời gian chờ')
    throw err instanceof KiraError ? err : new KiraError(String(err?.message || err))
  } finally {
    clearTimeout(timer)
  }
}

export async function getKiraVideoOperationStatus(
  env: Bindings,
  operationId: string,
  timeoutMs = 50_000
): Promise<
  | { done: false }
  | { done: true; bytes: ArrayBuffer; contentType: string }
  | { done: true; error: string }
> {
  const resolved = resolveKira(env)
  if (!resolved) throw new KiraError('Chưa cấu hình KIRA_API_KEY')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(`${resolved.baseURL}/videos/operations/${encodeURIComponent(operationId)}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${resolved.apiKey}`,
      },
      signal: controller.signal,
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new KiraError(`Kira Video status ${res.status}: ${detail.slice(0, 500)}`)
    }

    const data = (await res.json()) as any

    if (data?.error) {
      return { done: true, error: String(data.error?.message || data.error).slice(0, 500) }
    }

    if (!data?.done) {
      return { done: false }
    }

    // done true
    if (data?.error) {
      return { done: true, error: String(data.error).slice(0, 500) }
    }

    const first = data?.data?.[0]
    if (!first?.b64_json) {
      // Some APIs return url
      if (first?.url) {
        const vRes = await fetch(first.url, { signal: controller.signal })
        if (!vRes.ok) throw new KiraError(`Kira Video URL fetch ${vRes.status}`)
        const buf = await vRes.arrayBuffer()
        return { done: true, bytes: buf, contentType: vRes.headers.get('content-type') || 'video/mp4' }
      }
      throw new KiraError('Kira Video done nhưng không có b64_json')
    }

    const bytes = b64ToBytes(first.b64_json)
    return { done: true, bytes: bytes.buffer as ArrayBuffer, contentType: first.mime_type || 'video/mp4' }
  } catch (err: any) {
    if (err?.name === 'AbortError') throw new KiraError('Kira Video status quá thời gian chờ')
    throw err instanceof KiraError ? err : new KiraError(String(err?.message || err))
  } finally {
    clearTimeout(timer)
  }
}

// Convenience: generate full video with polling (for server usage, but careful with timeout)
export async function generateKiraVideo(
  env: Bindings,
  prompt: string,
  opts: {
    model?: string
    aspect_ratio?: string
    duration_seconds?: number
    pollIntervalMs?: number
    maxWaitMs?: number
  } = {}
): Promise<{ bytes: ArrayBuffer; contentType: string; operationId: string }> {
  const { operationId } = await generateKiraVideoStart(env, prompt, opts)
  const pollInterval = opts.pollIntervalMs || 5000
  const maxWait = opts.maxWaitMs || 8 * 60 * 1000
  const start = Date.now()

  while (Date.now() - start < maxWait) {
    await new Promise((r) => setTimeout(r, pollInterval))
    const status = await getKiraVideoOperationStatus(env, operationId)
    if (!status.done) continue
    if ('error' in status) throw new KiraError(`Kira Video lỗi: ${status.error}`)
    return { bytes: status.bytes, contentType: status.contentType, operationId }
  }

  throw new KiraError('Kira Video quá thời gian chờ (polling timeout)')
}
