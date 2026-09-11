import type { AppDatabase } from './lib/db.js'

export type Bindings = {
  DB: AppDatabase
  BLOB_READ_WRITE_TOKEN?: string
  OPENAI_API_KEY?: string
  OPENAI_BASE_URL?: string
  GEMINI_API_KEY?: string
  EXPLABS_API_KEY?: string
  EXPLABS_BASE_URL?: string
  EXPLABS_MODEL?: string
  KIRA_API_KEY?: string
  KIRA_BASE_URL?: string
  KIRA_MODEL?: string
  DATABASE_URL?: string
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
