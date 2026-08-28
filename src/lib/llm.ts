/**
 * LLM helper — cổng gọi model text.
 * Port từ backend/ai_engine.py của faceless-forge (Emergent key -> OpenAI proxy).
 */
import type { Bindings } from '../types'

export const TEXT_MODELS: Record<string, string> = {
  'gpt-5-mini': 'gpt-5-mini',
  'gpt-5': 'gpt-5',
  'gpt-5.1': 'gpt-5.1',
  'gpt-5-nano': 'gpt-5-nano',
}

export const DEFAULT_TEXT_MODEL = 'gpt-5-mini'

export class LLMError extends Error {}

function resolveKey(env: Bindings) {
  const apiKey = env.OPENAI_API_KEY
  const baseURL = (env.OPENAI_BASE_URL || 'https://www.genspark.ai/api/llm_proxy/v1').replace(/\/$/, '')
  if (!apiKey) throw new LLMError('Chưa cấu hình OPENAI_API_KEY')
  return { apiKey, baseURL }
}

export function hasLLM(env: Bindings): boolean {
  return Boolean(env.OPENAI_API_KEY)
}

/** Gọi chat completion, trả về text thuần. */
export async function ask(
  env: Bindings,
  system: string,
  user: string,
  model = DEFAULT_TEXT_MODEL,
  // Keep calls within the 60-second Vercel Hobby Function duration.
  timeoutMs = 50_000
): Promise<string> {
  const { apiKey, baseURL } = resolveKey(env)
  const chosen = TEXT_MODELS[model] || DEFAULT_TEXT_MODEL

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
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
      throw new LLMError(`LLM ${res.status}: ${detail.slice(0, 300)}`)
    }
    const data = (await res.json()) as any
    const text = data?.choices?.[0]?.message?.content
    if (typeof text !== 'string' || !text.trim()) {
      throw new LLMError('LLM trả về nội dung trống')
    }
    return text.trim()
  } catch (err: any) {
    if (err?.name === 'AbortError') throw new LLMError('LLM quá thời gian chờ')
    throw err instanceof LLMError ? err : new LLMError(String(err?.message || err))
  } finally {
    clearTimeout(timer)
  }
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
