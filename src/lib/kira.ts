/**
 * Kira AI integration — https://kiraai.vn
 * OpenAI-compatible endpoint: https://kiraai.vn/api/v1
 * Docs: https://kiraai.vn/guide/chatgpt/ , https://kiraai.vn/models/
 *
 * Hỗ trợ hơn 100+ model qua một key: kira-auto, kira-2.0, deepseek, qwen, gpt, claude...
 * Tích hợp như provider fallback thứ 3 sau primary (Genspark/OpenAI) và Explabs.
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

export class KiraError extends Error {}

type KiraResolved = { apiKey: string; baseURL: string }

function resolveKira(env: Bindings): KiraResolved | null {
  const apiKey = (env as any).KIRA_API_KEY?.trim() || (env as any).KIRA_API_KEY?.trim()
  // Support both KIRA_API_KEY and legacy env
  const rawKey = env.KIRA_API_KEY?.trim() || (env as any).KIRA_API_KEY?.trim()
  const key = rawKey || (env as any).KIRA_API_KEY
  if (!key) return null
  const rawBase = (env as any).KIRA_BASE_URL || env.KIRA_BASE_URL || 'https://kiraai.vn/api/v1'
  const baseURL = String(rawBase).replace(/\/$/, '')
  return { apiKey: String(key), baseURL }
}

export function hasKira(env: Bindings): boolean {
  return Boolean(resolveKira(env))
}

export function getKiraModel(requested?: string, env?: Bindings): string {
  // Nếu env có KIRA_MODEL override, ưu tiên
  if (env?.KIRA_MODEL) return env.KIRA_MODEL
  if (requested && KIRA_MODELS[requested]) return KIRA_MODELS[requested]
  // Nếu requested là model OpenAI (gpt-5-mini...), map sang kira-auto
  return DEFAULT_KIRA_MODEL
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
    // Kira supports both chat.completions and responses API; try to extract text robustly
    let text: string | undefined
    if (typeof data?.choices?.[0]?.message?.content === 'string') {
      text = data.choices[0].message.content
    } else if (typeof data?.choices?.[0]?.text === 'string') {
      text = data.choices[0].text
    } else if (typeof data?.output?.[0]?.content?.[0]?.text === 'string') {
      // Responses API shape
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
// Dùng trong llm.ts fallback chain: thử Kira khi primary + explabs lỗi

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
