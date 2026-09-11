/**
 * LLM helper — cổng gọi model text.
 * Port từ backend/ai_engine.py của faceless-forge (Emergent key -> OpenAI proxy).
 * Thêm fallback Explabs + Kira AI để tăng độ sẵn sàng khi primary (Genspark/OpenAI) lỗi.
 */
import type { Bindings } from '../types.js'

export const TEXT_MODELS: Record<string, string> = {
  'gpt-5-mini': 'gpt-5-mini',
  'gpt-5': 'gpt-5',
  'gpt-5.1': 'gpt-5.1',
  'gpt-5-nano': 'gpt-5-nano',
  // Kira models cũng map vào đây để UI chọn được
  'kira-auto': 'kira-auto',
  'kira-2.0': 'kira-2.0',
  'kira-3.0': 'kira-3.0',
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
  const rawBase = (env as any).EXPLABS_BASE_URL || env.EXPLABS_BASE_URL || 'https://api.explabs.ai/v1'
  const baseURL = String(rawBase).replace(/\/$/, '')
  return { apiKey, baseURL, label: 'explabs' }
}

function resolveKira(env: Bindings): ResolvedKey | null {
  const apiKey = env.KIRA_API_KEY?.trim() || (env as any).KIRA_API_KEY?.trim()
  if (!apiKey) return null
  const rawBase = env.KIRA_BASE_URL || (env as any).KIRA_BASE_URL || 'https://kiraai.vn/api/v1'
  const baseURL = String(rawBase).replace(/\/$/, '')
  return { apiKey, baseURL, label: 'kira' }
}

function resolveAll(env: Bindings): ResolvedKey[] {
  const list: ResolvedKey[] = []
  const p = resolvePrimary(env)
  if (p) list.push(p)
  const e = resolveExplabs(env)
  if (e) list.push(e)
  const k = resolveKira(env)
  if (k) list.push(k)
  return list
}

export function hasLLM(env: Bindings): boolean {
  return resolveAll(env).length > 0
}

export function hasKiraLLM(env: Bindings): boolean {
  return Boolean(resolveKira(env))
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
    let chosen = TEXT_MODELS[model] || model || DEFAULT_TEXT_MODEL

    // Nếu là Explabs/Kira và có MODEL override, dùng override
    // @ts-ignore
    if (key.label === 'explabs' && (globalThis as any).process?.env?.EXPLABS_MODEL) {
      // giữ logic cũ
    }

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
      throw new LLMError(`LLM ${key.label} ${res.status}: ${detail.slice(0, 400)}`)
    }
    const data = (await res.json()) as any
    // Hỗ trợ cả Responses API (Kira) và Chat Completions
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

/** Gọi chat completion, trả về text thuần — có fallback Explabs + Kira. */
export async function ask(
  env: Bindings,
  system: string,
  user: string,
  model = DEFAULT_TEXT_MODEL,
  timeoutMs = 50_000
): Promise<string> {
  const keys = resolveAll(env)
  if (!keys.length) throw new LLMError('Chưa cấu hình OPENAI_API_KEY, EXPLABS_API_KEY hoặc KIRA_API_KEY')

  let lastError: unknown = null
  const perProviderTimeout = keys.length > 1 ? Math.floor(timeoutMs / keys.length) : timeoutMs

  for (const k of keys) {
    try {
      let effectiveModel = model
      if (k.label === 'explabs' && env.EXPLABS_MODEL) {
        effectiveModel = env.EXPLABS_MODEL
      }
      if (k.label === 'kira' && env.KIRA_MODEL) {
        effectiveModel = env.KIRA_MODEL
      }
      // Nếu model yêu cầu là gpt-5-* mà đang dùng Kira, map sang kira-auto nếu không có override
      if (k.label === 'kira' && !env.KIRA_MODEL && model.startsWith('gpt-')) {
        effectiveModel = 'kira-auto'
      }
      const result = await callChatCompletion(k, system, user, effectiveModel, perProviderTimeout)
      if (k.label !== 'primary') {
        console.log(`[llm] fallback success via ${k.label}`)
      }
      return result
    } catch (e) {
      lastError = e
      console.warn(`[llm] ${k.label} failed:`, String((e as any)?.message || e).slice(0, 300))
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
