/**
 * Agent Crew — các tác nhân chạy phía server (mỗi lần gọi MỘT nhiệm vụ LLM,
 * giữ dưới trần 60s của Vercel Function — Spec BR5).
 *
 * - Trend Scout: đề xuất góc nội dung bám xu hướng theo ngách.
 * - QA Reviewer: kiểm duyệt blueprint (gate trước khi sản xuất media).
 * Không có API key vẫn chạy được nhờ fallback thuần (BR2).
 */
import { askJSON, DEFAULT_TEXT_MODEL, hasLLM } from './llm.js'
import type { Bindings, Blueprint } from '../types.js'
import {
  clampCount,
  fallbackTrends,
  normaliseReview,
  normaliseTrends,
  type ReviewVerdict,
  type TrendsPayload,
} from './agent-core.js'

const TREND_SYSTEM = `You are the Trend Scout of a faceless short-form video studio.
Research-style task: propose video angles that ride CURRENT platform momentum for the given niche
(patterns that reliably trend: myth-busting, 30-day results, counter-intuitive lists, beginner
explainers, checklists, comparisons). Ground every idea in evergreen search behaviour and honest
framing. STRICT RULES: no invented statistics or fake "trending now" claims, no medical/legal/
financial advice, no promises of views or income, no copyrighted characters, faceless-friendly
(stock/AI visuals + voice-over only).

Return ONLY valid JSON:
{"trends":[{"topic":"specific video topic, max 90 chars","angle":"the momentum angle","hook":"first spoken line","why":"why this can hold attention","trend_driver":"which trend pattern/behaviour this rides","format":"Listicle / Story / Myth-buster / Explainer / Checklist / Comparison","score":1-100}]}
Return exactly the requested number of items. Answer in the requested language.`

const REVIEW_SYSTEM = `You are the QA Review Agent gating a faceless short-form video before production.
Audit the given blueprint strictly but fairly, as an independent reviewer who has NOT seen how it
was made. Check: (1) hook creates curiosity within 3 seconds; (2) pacing — roughly one shot every
5-9 seconds, shots' timings are contiguous and cover the duration; (3) each on_screen_text is under
7 words; (4) narration flows naturally when shots are concatenated and matches the script;
(5) works faceless — no shot requires a real person's face; (6) image_prompt is detailed English,
vertical 9:16, no text/watermark; (7) CTA exists; (8) policy safety — no medical/legal/financial
advice, no invented facts, no revenue/view promises, licensed-asset reminders present.
Be specific: quote the exact shot index or text you flag. Never rewrite the whole blueprint.

Return ONLY valid JSON:
{"decision":"approve"|"revise","score":1-100,"issues":["specific problems, empty if approve"],"suggestions":["concrete fixes for the top problems"]}
Approve when only cosmetic issues remain. Answer issue text in the requested language.`

export type TrendsResult = TrendsPayload

export type ReviewResult = ReviewVerdict

function clampReviewScore(value: unknown): number {
  const score = Math.round(Number(value))
  return Number.isFinite(score) ? Math.max(1, Math.min(100, score)) : 70
}

/** Trend Scout — luôn trả kết quả dùng được (AI lỗi → fallback, BR2). */
export async function fetchTrends(
  env: Bindings,
  opts: {
    niche: string
    audience?: string
    platform?: string
    language?: string
    count?: number
    model?: string
  }
): Promise<TrendsResult> {
  const niche = opts.niche.trim()
  const count = clampCount(opts.count)
  const language = opts.language || 'Tiếng Việt'

  if (!hasLLM(env)) {
    return {
      trends: fallbackTrends(niche, count),
      ai: false,
      note: 'Chưa cấu hình OPENAI_API_KEY — dùng khuôn mẫu nội dung bền vững có sẵn.',
    }
  }

  const user = [
    `Niche: ${niche}`,
    `Audience: ${opts.audience || '18–34 tuổi'}`,
    `Platform: ${opts.platform || 'TikTok & YouTube Shorts'}`,
    `Language for output: ${language}`,
    `Number of angles: ${count}`,
  ].join('\n')

  try {
    const data = await askJSON(env, TREND_SYSTEM, user, opts.model || DEFAULT_TEXT_MODEL)
    const result = normaliseTrends(data, niche, count)
    return result.ai ? result : { ...result, note: result.note || 'AI trả về không đạt khuôn dạng — dùng fallback.' }
  } catch {
    return {
      trends: fallbackTrends(niche, count),
      ai: false,
      note: 'Gọi AI thất bại — dùng khuôn mẫu nội dung bền vững có sẵn.',
    }
  }
}

/** QA Reviewer — lỗi AI → approve an toàn kèm cảnh báo, không chặn dây chuyền (TC6). */
export async function reviewBlueprint(
  env: Bindings,
  blueprint: Blueprint,
  opts: { language?: string; model?: string } = {}
): Promise<ReviewResult> {
  const language = opts.language || 'Tiếng Việt'

  if (!hasLLM(env)) {
    return {
      decision: 'approve',
      score: clampReviewScore(blueprint?.viral_score),
      issues: [],
      suggestions: [],
      ai: false,
      note: 'Chưa cấu hình OPENAI_API_KEY — bỏ qua kiểm duyệt AI, hãy tự rà production checklist.',
    }
  }

  const user = JSON.stringify(
    {
      viral_score: blueprint.viral_score,
      duration_sec_target: blueprint.shots?.[blueprint.shots.length - 1]?.end_sec,
      hook: blueprint.hook,
      script: blueprint.script,
      shots: blueprint.shots,
      seo: blueprint.seo,
      monetization: blueprint.monetization,
    },
    null,
    1
  ).slice(0, 24_000)

  try {
    const data = await askJSON(env, REVIEW_SYSTEM, user, opts.model || DEFAULT_TEXT_MODEL)
    const review = normaliseReview(data)
    return review.ai ? review : { ...review, note: 'AI trả về không đọc được — cho qua kèm cảnh báo.' }
  } catch {
    return {
      decision: 'approve',
      score: clampReviewScore(blueprint?.viral_score),
      issues: [],
      suggestions: [],
      ai: false,
      note: 'Gọi AI kiểm duyệt thất bại — cho qua kèm cảnh báo, hãy tự rà checklist.',
    }
  }
}

// Re-export để tầng API dùng một nguồn duy nhất.
export { normaliseReview, normaliseTrends }
