export type Bindings = {
  DB: D1Database
  R2: R2Bucket
  OPENAI_API_KEY?: string
  OPENAI_BASE_URL?: string
}

export type Shot = {
  start_sec: number
  end_sec: number
  purpose: string
  visual: string
  narration: string
  on_screen_text: string
  image_prompt: string
}

export type Blueprint = {
  viral_score: number
  concept: string
  why_it_can_work: string[]
  titles: string[]
  thumbnail_text: string
  hook: string
  script: string
  shots: Shot[]
  seo: {
    description: string
    hashtags: string[]
    pinned_comment: string
  }
  monetization: {
    angle: string
    cta: string
    disclosure: string
    streams?: string[]
  }
  production_checklist: string[]
  fallback?: boolean
}

export type IdeaBrief = {
  topic: string
  niche: string
  audience: string
  platform: string
  duration_sec: number
  tone: string
  language: string
  goal: string
  model?: string
}

export const PLATFORMS = ['tiktok', 'facebook', 'instagram', 'x', 'youtube'] as const
export type Platform = (typeof PLATFORMS)[number]
