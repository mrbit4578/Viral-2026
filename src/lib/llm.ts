/**
 * LLM helper — cổng gọi model text.
 * Port từ backend/ai_engine.py của faceless-forge (Emergent key -> OpenAI proxy).
 * Thêm fallback Explabs để tăng độ sẵn sàng khi primary (Genspark/OpenAI) lỗi.
 */
import type { Bindings } from '../types.js'

export const TEXT_MODELS: Record<string, string> = {
  'gpt-5-mini': 'gpt-5-mini',
  'gpt-5': 'gpt-5',
  'gpt-5.1': 'gpt-5.1',
  'gpt-5-nano': 'gpt-5-nano',
}

export const DEFAULT_TEXT_MODEL = 'gpt-5-mini'

export class LLMError extends Error {}

type ResolvedKey = { apiKey: string; baseURL: string; label: string }

function resolvePrimary(env: Bindings): ResolvedKey | null {
  const apiKey = env.OPENAI_API_KEY?.trim()
  if (!apiKey) return null
  const baseURL = (env.OPENAI_BASE_URL || 'https://www.genspark.ai/api/llm_proxy/v1').replace(/\/$/, '')
  return { apiKey, baseURL, label: 'primary' }
}

function resolveExplabs(env: Bindings): ResolvedKey | null {
  const apiKey = (env as any).EXPLABS_API_KEY?.trim() || env.EXPLABS_API_KEY?.trim()
  if (!apiKey) return null
  // Cho phép cấu hình base URL riêng, mặc định dùng endpoint OpenAI-compatible của Explabs
  const rawBase = (env as any).EXPLABS_BASE_URL || env.EXPLABS_BASE_URL || 'https://api.explabs.ai/v1'
  const baseURL = String(rawBase).replace(/\/$/, '')
  return { apiKey, baseURL, label: 'explabs' }
}

function resolveAll(env: Bindings): ResolvedKey[] {
  const list: ResolvedKey[] = []
  const p = resolvePrimary(env)
  if (p) list.push(p)
  const e = resolveExplabs(env)
  if (e) list.push(e)
  return list
}

export function hasLLM(env: Bindings): boolean {
  return resolveAll(env).length > 0
}

function getModelForProvider(requested: string, provider: string): string {
  const chosen = TEXT_MODELS[requested] || DEFAULT_TEXT_MODEL
  // Nếu Explabs dùng model name khác, cho phép override qua EXPLABS_MODEL
  if (provider === 'explabs') {
    const override = (globalThis as any).process?.env?.EXPLABS_MODEL || ''
    // env passed via Bindings may contain EXPLABS_MODEL
    // @ts-ignore
    const envModel = (globalThis as any).__EXPLABS_MODEL__ as string | undefined
    // Try to read from Bindings in caller context — handled via closure
    return chosen
  }
  return chosen
}

async function callChatCompletion(
  key: ResolvedKey,
  system: string,
  user: string,
  model: string,
  timeoutMs: number
): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const chosen = TEXT_MODELS[model] || DEFAULT_TEXT_MODEL
    // Nếu là Explabs và có EXPLABS_MODEL cấu hình, ưu tiên dùng model đó khi model yêu cầu là default
    // Việc map model cụ thể do env quyết định — giữ tương thích OpenAI.
    const res = await fetch(`${key.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key.apiKey}`,
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
      throw new LLMError(`LLM ${key.label} ${res.status}: ${detail.slice(0, 300)}`)
    }
    const data = (await res.json()) as any
    const text = data?.choices?.[0]?.message?.content
    if (typeof text !== 'string' || !text.trim()) {
      throw new LLMError(`LLM ${key.label} trả về nội dung trống`)
    }
    return text.trim()
  } catch (err: any) {
    if (err?.name === 'AbortError') throw new LLMError(`LLM ${key.label} quá thời gian chờ`)
    throw err instanceof LLMError ? err : new LLMError(String(err?.message || err))
  } finally {
    clearTimeout(timer)
  }
}

/** Gọi chat completion, trả về text thuần — có fallback Explabs. */
export async function ask(
  env: Bindings,
  system: string,
  user: string,
  model = DEFAULT_TEXT_MODEL,
  timeoutMs = 50_000
): Promise<string> {
  const keys = resolveAll(env)
  if (!keys.length) throw new LLMError('Chưa cấu hình OPENAI_API_KEY hoặc EXPLABS_API_KEY')

  let lastError: unknown = null
  // Thử lần lượt primary -> explabs, chia timeout cho mỗi provider
  const perProviderTimeout = keys.length > 1 ? Math.floor(timeoutMs / keys.length) : timeoutMs

  for (const k of keys) {
    try {
      // Nếu env có EXPLABS_MODEL và đang dùng explabs provider, cho phép override model
      let effectiveModel = model
      if (k.label === 'explabs' && env.EXPLABS_MODEL) {
        // Nếu model yêu cầu là default hoặc không nằm trong danh sách Explabs, dùng EXPLABS_MODEL
        effectiveModel = env.EXPLABS_MODEL
      }
      const result = await callChatCompletion(k, system, user, effectiveModel, perProviderTimeout)
      if (k.label !== 'primary') {
        console.log(`[llm] fallback success via ${k.label}`)
      }
      return result
    } catch (e) {
      lastError = e
      console.warn(`[llm] ${k.label} failed:`, String((e as any)?.message || e).slice(0, 300))
      // Tiếp tục thử provider tiếp theo
      continue
    }
  }
  throw lastError instanceof LLMError ? lastError : new LLMError(String((lastError as any)?.message || lastError))
}

/** Tách JSON khỏi câu trả lời có thể bọc trong ```json — port từ forge_engine._extract_json */
export function extractJSON<T = any>(text: string): T {
  let cleaned = (text || '').trim()
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  try {
    return JSON.parse(cleaned) as T
  } catch {
    const objMatch = cleaned.match(/\{[\s\S]*\}/)
    if (objMatch) return JSON.parse(objMatch[0]) as T
    const arrMatch = cleaned.match(/\[[\s\S]*\]/)
    if (arrMatch) return JSON.parse(arrMatch[0]) as T
    throw new LLMError('Không đọc được JSON từ phản hồi AI')
  }
}

/** Hỏi AI và bắt buộc nhận JSON. */
export async function askJSON<T = any>(
  env: Bindings,
  system: string,
  user: string,
  model = DEFAULT_TEXT_MODEL
): Promise<T> {
  const raw = await ask(env, system, user, model)
  return extractJSON<T>(raw)
}
