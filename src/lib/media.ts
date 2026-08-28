/**
 * Media library — tạo ảnh, tạo giọng đọc, lưu lên R2.
 * Thay cho ai_engine.generate_images / tts_engine.generate_tts của bản FastAPI,
 * dùng HTTP API thuần để chạy được trên Cloudflare Workers.
 */
import type { Bindings } from '../types'

// ---------------------------------------------------------------- helpers

export function uid(prefix = ''): string {
  return prefix + crypto.randomUUID().replace(/-/g, '').slice(0, 16)
}

export async function putAsset(
  env: Bindings,
  key: string,
  body: ArrayBuffer | Uint8Array,
  contentType: string
): Promise<{ key: string; size: number; url: string }> {
  await env.R2.put(key, body, { httpMetadata: { contentType } })
  const size = body instanceof Uint8Array ? body.byteLength : body.byteLength
  return { key, size, url: `/api/media/${key}` }
}

// ---------------------------------------------------------------- ảnh

export const IMAGE_MODELS = ['flux', 'turbo', 'flux-realism'] as const

/**
 * Sinh ảnh dọc 9:16 từ prompt (Pollinations — không cần key).
 * Trả về bytes PNG/JPEG.
 */
export async function generateImageBytes(
  prompt: string,
  opts: { model?: string; width?: number; height?: number; seed?: number } = {}
): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  const width = opts.width || 768
  const height = opts.height || 1344
  const model = opts.model && IMAGE_MODELS.includes(opts.model as any) ? opts.model : 'flux'
  const seed = opts.seed ?? Math.floor(Math.random() * 1_000_000)

  const url =
    `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt.slice(0, 900))}` +
    `?width=${width}&height=${height}&model=${model}&seed=${seed}&nologo=true&safe=true`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 90_000)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) throw new Error(`Image API ${res.status}`)
    const contentType = res.headers.get('content-type') || 'image/jpeg'
    const bytes = await res.arrayBuffer()
    if (bytes.byteLength < 1024) throw new Error('Ảnh trả về không hợp lệ')
    return { bytes, contentType }
  } finally {
    clearTimeout(timer)
  }
}

// ---------------------------------------------------------------- giọng đọc (TTS)

/** Danh sách giọng — mã ngôn ngữ Google TTS. */
export const VOICES = [
  { code: 'vi', name: 'Tiếng Việt', flag: '🇻🇳' },
  { code: 'en', name: 'English (US)', flag: '🇺🇸' },
  { code: 'en-GB', name: 'English (UK)', flag: '🇬🇧' },
  { code: 'ja', name: '日本語', flag: '🇯🇵' },
  { code: 'ko', name: '한국어', flag: '🇰🇷' },
  { code: 'zh-CN', name: '中文 (简体)', flag: '🇨🇳' },
  { code: 'th', name: 'ไทย', flag: '🇹🇭' },
  { code: 'id', name: 'Bahasa Indonesia', flag: '🇮🇩' },
  { code: 'fr', name: 'Français', flag: '🇫🇷' },
  { code: 'es', name: 'Español', flag: '🇪🇸' },
  { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
  { code: 'pt', name: 'Português', flag: '🇵🇹' },
  { code: 'ru', name: 'Русский', flag: '🇷🇺' },
  { code: 'hi', name: 'हिन्दी', flag: '🇮🇳' },
  { code: 'ar', name: 'العربية', flag: '🇸🇦' },
]

/**
 * Chia text thành các đoạn <= 190 ký tự, cắt theo ranh giới câu/từ.
 * Google TTS giới hạn độ dài mỗi request.
 */
export function chunkText(text: string, limit = 190): string[] {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return []
  if (clean.length <= limit) return [clean]

  const chunks: string[] = []
  // tách theo câu trước
  const sentences = clean.match(/[^.!?…]+[.!?…]*\s*/g) || [clean]
  let buffer = ''
  for (const sentence of sentences) {
    const piece = sentence.trim()
    if (!piece) continue
    if (piece.length > limit) {
      if (buffer) {
        chunks.push(buffer.trim())
        buffer = ''
      }
      // câu quá dài -> cắt theo từ
      const words = piece.split(' ')
      let line = ''
      for (const word of words) {
        if ((line + ' ' + word).trim().length > limit) {
          if (line) chunks.push(line.trim())
          line = word
        } else {
          line = (line + ' ' + word).trim()
        }
      }
      if (line) buffer = line
      continue
    }
    if ((buffer + ' ' + piece).trim().length > limit) {
      chunks.push(buffer.trim())
      buffer = piece
    } else {
      buffer = (buffer + ' ' + piece).trim()
    }
  }
  if (buffer.trim()) chunks.push(buffer.trim())
  return chunks.filter(Boolean)
}

/** Lấy một đoạn MP3 từ Google Translate TTS. */
async function ttsChunk(text: string, lang: string, index: number, total: number): Promise<ArrayBuffer> {
  const url =
    'https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob' +
    `&q=${encodeURIComponent(text)}&tl=${encodeURIComponent(lang)}` +
    `&total=${total}&idx=${index}&textlen=${text.length}`

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      Referer: 'https://translate.google.com/',
    },
  })
  if (!res.ok) throw new Error(`TTS ${res.status}`)
  const bytes = await res.arrayBuffer()
  if (bytes.byteLength < 200) throw new Error('TTS trả về dữ liệu trống')
  return bytes
}

/**
 * Tạo giọng đọc cho toàn bộ script.
 * Nối các đoạn MP3 lại — MP3 là stream frame nên nối trực tiếp phát được bình thường.
 */
export async function generateSpeech(
  text: string,
  lang = 'vi'
): Promise<{ bytes: Uint8Array; chunks: number; chars: number }> {
  const parts = chunkText(text)
  if (!parts.length) throw new Error('Nội dung đọc trống')
  if (parts.length > 60) throw new Error('Kịch bản quá dài (tối đa ~11.000 ký tự)')

  const buffers: ArrayBuffer[] = []
  for (let i = 0; i < parts.length; i++) {
    let lastErr: any = null
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        buffers.push(await ttsChunk(parts[i], lang, i, parts.length))
        lastErr = null
        break
      } catch (err) {
        lastErr = err
        await new Promise((r) => setTimeout(r, 250 * (attempt + 1)))
      }
    }
    if (lastErr) throw lastErr
  }

  const total = buffers.reduce((sum, b) => sum + b.byteLength, 0)
  const merged = new Uint8Array(total)
  let offset = 0
  for (const buf of buffers) {
    merged.set(new Uint8Array(buf), offset)
    offset += buf.byteLength
  }
  return { bytes: merged, chunks: parts.length, chars: text.length }
}
