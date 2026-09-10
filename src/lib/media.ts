/**
 * Media library — tạo ảnh, tạo giọng đọc, lưu trên Vercel Blob.
 * Thay cho filesystem/R2 của bản cũ để chạy được trên Vercel Functions.
 */
import { del, put } from '@vercel/blob'
import type { Bindings } from '../types.js'

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
  if (!env.BLOB_READ_WRITE_TOKEN) {
    throw new Error('Chưa cấu hình BLOB_READ_WRITE_TOKEN (Vercel Blob)')
  }
  const size = body instanceof Uint8Array ? body.byteLength : body.byteLength
  const blob = await put(key, body, {
    access: 'public',
    addRandomSuffix: false,
    contentType,
    token: env.BLOB_READ_WRITE_TOKEN,
  })
  // Lưu URL trực tiếp: Vercel Blob CDN phục vụ file lớn tốt hơn việc proxy qua Function.
  return { key: blob.url, size, url: blob.url }
}

function toBase64(body: ArrayBuffer | Uint8Array): string {
  const u8 = body instanceof Uint8Array ? body : new Uint8Array(body)
  const g = globalThis as { Buffer?: { from(b: Uint8Array): { toString(e: string): string } } }
  if (typeof g.Buffer?.from === 'function') return g.Buffer.from(u8).toString('base64')
  let bin = ''
  for (let i = 0; i < u8.length; i += 8192) {
    bin += String.fromCharCode(...u8.subarray(i, i + 8192))
  }
  return btoa(bin)
}

/**
 * Giống putAsset nhưng khi chưa cấu hình Blob (preview/local) thì trả data URL,
 * giúp toàn bộ dây chuyền vẫn chạy được thay vì 502.
 */
export async function putAssetSmart(
  env: Bindings,
  key: string,
  body: ArrayBuffer | Uint8Array,
  contentType: string
): Promise<{ key: string; size: number; url: string; inline?: boolean }> {
  const size = body instanceof Uint8Array ? body.byteLength : body.byteLength
  if (env.BLOB_READ_WRITE_TOKEN) return putAsset(env, key, body, contentType)
  // Chế độ inline dùng data-URL qua JSON: giữ dưới ~4.3MB sau base64 để an toàn
  // với giới hạn response ~4.5MB của Vercel Function.
  if (size > 3 * 1024 * 1024) {
    throw new Error('Chưa cấu hình BLOB_READ_WRITE_TOKEN và dữ liệu quá lớn để trả trực tiếp')
  }
  return {
    key: `inline:${key}`,
    size,
    url: `data:${contentType};base64,${toBase64(body)}`,
    inline: true,
  }
}

export function assetUrl(key: string): string {
  return /^(https:|data:|blob:)/i.test(key) ? key : `/api/media/${encodeURIComponent(key)}`
}

export async function deleteAsset(env: Bindings, key: string): Promise<void> {
  if (!env.BLOB_READ_WRITE_TOKEN || !/^https:\/\//i.test(key)) return
  await del(key, { token: env.BLOB_READ_WRITE_TOKEN })
}

// ---------------------------------------------------------------- ảnh

export const IMAGE_MODELS = ['flux', 'turbo', 'flux-realism'] as const

/** PRNG nhỏ để fallback ảnh khác nhau theo seed. */
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Ảnh SVG dự phòng khi dịch vụ ảnh AI không truy cập được (gradient nghệ thuật). */
export function fallbackImageSVG(prompt: string, width: number, height: number, seed: number): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const rnd = mulberry32(seed || 7)
  const hue = Math.floor(rnd() * 360)
  const hue2 = (hue + 40 + Math.floor(rnd() * 80)) % 360
  const words = prompt.split(/\s+/).filter((w) => /[\p{L}]/u.test(w))
  const label = esc(words.slice(4, 9).join(' ').slice(0, 64) || 'faceless forge')

  const circles = Array.from({ length: 5 }, () => {
    const cx = Math.round(rnd() * width)
    const cy = Math.round(rnd() * height)
    const r = Math.round(120 + rnd() * 340)
    const c = `hsl(${Math.floor((hue2 + rnd() * 60) % 360)} 70% ${Math.round(45 + rnd() * 25)}%)`
    const o = (0.08 + rnd() * 0.16).toFixed(2)
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${c}" opacity="${o}" filter="url(#blur)"/>`
  }).join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl(${hue} 62% 16%)"/>
      <stop offset="0.55" stop-color="hsl(${(hue + 24) % 360} 66% 26%)"/>
      <stop offset="1" stop-color="hsl(${hue2} 70% 12%)"/>
    </linearGradient>
    <filter id="blur" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="90"/></filter>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#g)"/>
  ${circles}
  <rect width="${width}" height="${height}" fill="none" stroke="hsl(${hue2} 80% 70% / .25)" stroke-width="2"/>
  <text x="${width / 2}" y="${height - 110}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="26" font-weight="700" fill="hsl(${hue2} 90% 85% / .85)">${label}</text>
  <text x="${width / 2}" y="${height - 70}" text-anchor="middle" font-family="ui-monospace, monospace" font-size="15" fill="hsl(0 0% 100% / .45)">FALLBACK PREVIEW · AI IMAGE OFFLINE</text>
</svg>`
}

/**
 * Sinh ảnh dọc 9:16 từ prompt (Pollinations — không cần key).
 * Trả về bytes PNG/JPEG.
 */
export async function generateImageBytes(
  prompt: string,
  opts: { model?: string; width?: number; height?: number; seed?: number } = {}
): Promise<{ bytes: ArrayBuffer; contentType: string; fallback?: boolean }> {
  const width = opts.width || 768
  const height = opts.height || 1344
  const model = opts.model && IMAGE_MODELS.includes(opts.model as any) ? opts.model : 'flux'
  const seed = opts.seed ?? Math.floor(Math.random() * 1_000_000)

  // Pollinations hay lỗi lẻ (429/5xx): thử tối đa 2 lần, lần 2 đổi seed.
  let lastErr: any = null
  for (let attempt = 0; attempt < 2; attempt++) {
    const attemptSeed = seed + attempt * 7919
    const url =
      `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt.slice(0, 900))}` +
      `?width=${width}&height=${height}&model=${model}&seed=${attemptSeed}&nologo=true&safe=true`

    const controller = new AbortController()
    // Keep remote generation below the Function execution ceiling on Vercel.
    const timer = setTimeout(() => controller.abort(), 50_000)
    try {
      const res = await fetch(url, { signal: controller.signal })
      if (!res.ok) throw new Error(`Image API ${res.status}`)
      const contentType = res.headers.get('content-type') || 'image/jpeg'
      if (!/^image\//.test(contentType)) throw new Error('Phản hồi không phải ảnh')
      const bytes = await res.arrayBuffer()
      if (bytes.byteLength < 1024) throw new Error('Ảnh trả về không hợp lệ')
      return { bytes, contentType }
    } catch (err) {
      lastErr = err
      if (attempt === 0) await new Promise((r) => setTimeout(r, 600))
    } finally {
      clearTimeout(timer)
    }
  }

  // Dịch vụ ảnh AI hoàn toàn không truy cập được → vẫn trả ảnh placeholder
  // để dây chuyền (ảnh → video) chạy được end-to-end. Client thấy cờ fallback.
  console.warn('image AI unavailable, using SVG fallback:', String(lastErr?.message || lastErr))
  const svg = fallbackImageSVG(prompt, width, height, seed)
  const bytes = new TextEncoder().encode(svg)
  return {
    bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    contentType: 'image/svg+xml',
    fallback: true,
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

  // Timeout riêng từng chunk: không có AbortController, một request treo
  // sẽ kéo cả Function theo.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15_000)
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        Referer: 'https://translate.google.com/',
      },
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`TTS ${res.status}`)
    const bytes = await res.arrayBuffer()
    if (bytes.byteLength < 200) throw new Error('TTS trả về dữ liệu trống')
    return bytes
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Audio WAV dự phòng khi TTS không truy cập được: chuỗi tone êm theo nhịp câu,
 * đủ dài tương đương lồng tiếng thật để dây chuyền render video vẫn đúng timing.
 */
export function fallbackToneWav(text: string): { bytes: Uint8Array; chunks: number; fallback: true } {
  const SAMPLE_RATE = 16_000
  const parts = chunkText(text)
  const segments = parts.map((p) => Math.max(0.9, Math.min(8, p.length / 14)))
  const gap = 0.16
  // Giới hạn tổng mẫu để payload data-URL nằm dưới cap 3MB của putAssetSmart
  // (PCM16 16kHz = 32KB/s → ~47s audio ≈ 3MB PCM → ~4MB sau base64).
  const MAX_SAMPLES = 1_500_000
  let totalSec = segments.reduce((s, d) => s + d + gap, 0.25)
  if (totalSec * SAMPLE_RATE > MAX_SAMPLES) {
    // trừ phần gap ra trước khi nhân tỉ lệ để tổng cuối không vượt ngân sách
    const speechSec = segments.reduce((s, d) => s + d, 0)
    const room = MAX_SAMPLES / SAMPLE_RATE - gap * (segments.length + 1) - 0.25
    const scale = Math.min(1, Math.max(0.05, room / Math.max(1, speechSec)))
    for (let i = 0; i < segments.length; i++) {
      segments[i] = Math.max(0.3, segments[i] * scale)
    }
    totalSec = segments.reduce((s, d) => s + d + gap, 0.25)
  }
  const totalSamples = Math.ceil(totalSec * SAMPLE_RATE)
  const pcm = new Int16Array(Math.min(totalSamples, MAX_SAMPLES))

  let cursor = Math.floor(0.25 * SAMPLE_RATE)
  segments.forEach((dur, i) => {
    const n = Math.floor(dur * SAMPLE_RATE)
    const freq = 420 + (i % 6) * 47
    for (let s = 0; s < n && cursor + s < pcm.length; s++) {
      const t = s / SAMPLE_RATE
      // envelope êm + hoà hai hoạ âm cho đỡ chói
      const env = Math.sin(Math.PI * Math.min(1, s / n)) ** 0.5
      const v =
        Math.sin(2 * Math.PI * freq * t) * 0.22 +
        Math.sin(2 * Math.PI * freq * 1.5 * t) * 0.09
      pcm[cursor + s] = Math.round(v * env * 32767)
    }
    cursor += n + Math.floor(gap * SAMPLE_RATE)
  })

  const dataLen = pcm.length * 2
  const buf = new ArrayBuffer(44 + dataLen)
  const view = new DataView(buf)
  const writeStr = (off: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)) }
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + dataLen, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, SAMPLE_RATE, true)
  view.setUint32(28, SAMPLE_RATE * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeStr(36, 'data')
  view.setUint32(40, dataLen, true)
  new Int16Array(buf, 44).set(pcm)
  return { bytes: new Uint8Array(buf), chunks: parts.length, fallback: true }
}

/**
 * Tạo giọng đọc cho toàn bộ script.
 * Nối các đoạn MP3 lại — MP3 là stream frame nên nối trực tiếp phát được bình thường.
 */
export async function generateSpeech(
  text: string,
  lang = 'vi'
): Promise<{ bytes: Uint8Array; chunks: number; chars: number; fallback?: boolean; missing?: number }> {
  const parts = chunkText(text)
  if (!parts.length) throw new Error('Nội dung đọc trống')
  // ~190 ký tự/chunk; 12.000 ký tự (cap endpoint) có thể vỡ tới ~68 chunk
  // do phần ghép câu — dư địa chỉ tránh 502 oan.
  if (parts.length > 72) throw new Error('Kịch bản quá dài (tối đa ~12.000 ký tự)')

  const buffers: ArrayBuffer[] = []
  let missing = 0
  let consecutiveFail = 0
  for (let i = 0; i < parts.length; i++) {
    let ok = false
    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      try {
        buffers.push(await ttsChunk(parts[i], lang, i, parts.length))
        ok = true
      } catch (err) {
        if (attempt < 2) await new Promise((r) => setTimeout(r, 250 * (attempt + 1)))
        else console.warn(`tts chunk ${i} failed:`, String((err as any)?.message || err))
      }
    }
    if (ok) {
      consecutiveFail = 0
    } else {
      missing++
      consecutiveFail++
      // Fail-fast: TTS chết hẳn (offline/bị chặn) thì không retry nốt
      // hàng chục chunk còn lại — bỏ qua để fallback WAV ngay.
      if (consecutiveFail >= 3) {
        missing += parts.length - i - 1
        break
      }
    }
  }

  // TTS chết hoàn toàn (offline / bị chặn) → phát WAV tone để dây chuyền
  // vẫn chạy được, thay vì 502 làm gãy toàn bộ pipeline.
  if (!buffers.length) {
    const wav = fallbackToneWav(text)
    return { ...wav, bytes: wav.bytes, chunks: parts.length, chars: text.length }
  }

  const total = buffers.reduce((sum, b) => sum + b.byteLength, 0)
  const merged = new Uint8Array(total)
  let offset = 0
  for (const buf of buffers) {
    merged.set(new Uint8Array(buf), offset)
    offset += buf.byteLength
  }
  return { bytes: merged, chunks: parts.length, chars: text.length, missing }
}
