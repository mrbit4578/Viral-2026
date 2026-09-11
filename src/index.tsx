/**
 * Faceless Forge — Video Production OS on the edge.
 * Hono + Vercel Functions (Neon Postgres + Vercel Blob).
 */
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Bindings, Blueprint, IdeaBrief, Platform } from './types.js'
import { PLATFORMS } from './types.js'
import { DEFAULT_TEXT_MODEL, TEXT_MODELS, hasLLM } from './lib/llm.js'
import { generateBlueprint, fallbackBlueprint, shotsToSRT } from './lib/forge.js'
import { generateIdeas, refineIdea } from './lib/ideas.js'
import {
  IMAGE_MODELS,
  VOICES,
  assetUrl,
  deleteAsset,
  generateImageBytes,
  generateSpeech,
  putAsset,
  putAssetSmart,
  uid,
} from './lib/media.js'
import { createDatabase, ensureSchema, isMissingTableError } from './lib/db.js'
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client'
import { PLATFORM_SPECS, buildDistributionPacks, buildRevenueModel } from './lib/distribution.js'
import { parseSRT, composeSRT } from './lib/srt.js'
import { TRANSLATE_LANGS, translateTexts, translateSRT } from './lib/translate.js'
import {
  askDocs,
  deleteDocument,
  generateVideoScript,
  ingestDocument,
  listDocuments,
} from './lib/rag.js'
import {
  GEMINI_IMAGE_MODELS,
  VEO_MODELS,
  downloadVeoVideo,
  generateGeminiImage,
  getVeoOperationStatus,
  hasGemini,
  startVeoOperation,
} from './lib/gemini.js'
import {
  DEFAULT_KIRA_IMAGE_MODEL,
  DEFAULT_KIRA_MODEL,
  DEFAULT_KIRA_TTS_MODEL,
  DEFAULT_KIRA_VIDEO_MODEL,
  DEFAULT_KIRA_VOICE,
  KIRA_IMAGE_MODELS,
  KIRA_MODELS,
  KIRA_TTS_MODELS,
  KIRA_VIDEO_MODELS,
  KIRA_VOICES,
  askKira,
  generateKiraImage,
  generateKiraSpeech,
  generateKiraVideoStart,
  getKiraVideoOperationStatus,
  hasKira,
} from './lib/kira.js'
import { renderPage } from './page.js'
import { renderStudio } from './studio-page.js'

const app = new Hono<{ Bindings: Bindings }>()

app.use('/api/*', cors())

// Tự tạo schema DB một lần mỗi cold start nếu có DATABASE_URL
let dbInitPromise: Promise<any> | null = null
app.use('/api/*', async (c, next) => {
  if (!dbInitPromise && c.env.DATABASE_URL) {
    dbInitPromise = ensureSchema(c.env.DATABASE_URL).catch((e) => {
      console.warn('[db] auto init failed:', String((e as any)?.message || e).slice(0, 200))
    })
    // Không block request — chạy nền, health sẽ retry nếu cần
    // Nhưng với /api/health và /api/db/init thì chờ luôn để phản hồi chính xác
    if (c.req.path === '/api/health' || c.req.path === '/api/db/init') {
      await dbInitPromise
    }
  }
  await next()
})

const now = () => new Date().toISOString()
const bad = (msg: string, status = 400) => ({ error: msg, status })
const safeJSON = (raw: any) => {
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw || {}
  } catch {
    return {}
  }
}

// ------------------------------------------------------------------ health + db auto-init

app.get('/api/health', async (c) => {
  let db = false
  let autoCreated = false
  try {
    await c.env.DB.prepare('SELECT 1').first()
    db = true
  } catch (e) {
    // Nếu bảng chưa tồn tại, thử tự tạo schema rồi retry
    if (isMissingTableError(e) && c.env.DATABASE_URL) {
      try {
        const res = await ensureSchema(c.env.DATABASE_URL)
        if (res.ok) {
          autoCreated = true
          await c.env.DB.prepare('SELECT 1').first()
          db = true
        }
      } catch {
        db = false
      }
    } else {
      db = false
    }
  }
  const blob = Boolean(c.env.BLOB_READ_WRITE_TOKEN)
  return c.json({
    status: 'ok',
    db,
    db_auto_created: autoCreated,
    blob,
    llm: hasLLM(c.env),
    kira: hasKira(c.env),
    gemini: hasGemini(c.env),
    engines: { image: true, tts: true, video: 'browser-canvas' },
    time: now(),
  })
})

// Tự tạo schema DB — không cần chạy migration thủ công
app.get('/api/db/init', async (c) => {
  if (!c.env.DATABASE_URL) return c.json(bad('Chưa cấu hình DATABASE_URL', 503), 503)
  const res = await ensureSchema(c.env.DATABASE_URL)
  return c.json({ ...res, time: now() }, res.ok ? 200 : 500)
})

app.post('/api/db/init', async (c) => {
  if (!c.env.DATABASE_URL) return c.json(bad('Chưa cấu hình DATABASE_URL', 503), 503)
  const res = await ensureSchema(c.env.DATABASE_URL)
  return c.json({ ...res, time: now() }, res.ok ? 200 : 500)
})

app.get('/api/config', (c) =>
  c.json({
    text_models: Object.keys(TEXT_MODELS),
    default_text_model: DEFAULT_TEXT_MODEL,
    image_models: IMAGE_MODELS,
    voices: VOICES,
    platforms: PLATFORMS.map((p) => ({ key: p, ...PLATFORM_SPECS[p] })),
    llm: hasLLM(c.env),
    kira: hasKira(c.env),
    kira_models: Object.keys(KIRA_MODELS),
    default_kira_model: DEFAULT_KIRA_MODEL,
    kira_image_models: KIRA_IMAGE_MODELS,
    default_kira_image_model: DEFAULT_KIRA_IMAGE_MODEL,
    kira_tts_models: KIRA_TTS_MODELS,
    default_kira_tts_model: DEFAULT_KIRA_TTS_MODEL,
    kira_voices: KIRA_VOICES,
    default_kira_voice: DEFAULT_KIRA_VOICE,
    kira_video_models: KIRA_VIDEO_MODELS,
    default_kira_video_model: DEFAULT_KIRA_VIDEO_MODEL,
    gemini: hasGemini(c.env),
    gemini_image_models: GEMINI_IMAGE_MODELS,
    veo_models: VEO_MODELS,
  })
)

// Kira AI direct endpoint — cho phép test riêng Kira mà không qua fallback chain
app.post('/api/kira/chat', async (c) => {
  if (!hasKira(c.env)) return c.json(bad('Chưa cấu hình KIRA_API_KEY', 503), 503)
  const body = await c.req.json().catch(() => ({}))
  const system = String(body.system || 'Bạn là trợ lý AI hữu ích').slice(0, 2000)
  const user = String(body.user || body.prompt || '').trim()
  if (!user) return c.json(bad('Thiếu nội dung user'), 400)
  try {
    const text = await askKira(c.env, system, user, String(body.model || DEFAULT_KIRA_MODEL))
    return c.json({ text, model: String(body.model || DEFAULT_KIRA_MODEL), provider: 'kira', ai: true })
  } catch (e: any) {
    return c.json(bad(`Kira thất bại: ${String(e?.message || e).slice(0, 300)}`, 502), 502)
  }
})

app.get('/api/kira/models', (c) =>
  c.json({
    models: Object.entries(KIRA_MODELS).map(([k, v]) => ({ id: k, name: v })),
    image_models: KIRA_IMAGE_MODELS,
    tts_models: KIRA_TTS_MODELS,
    video_models: KIRA_VIDEO_MODELS,
    voices: KIRA_VOICES,
    default: DEFAULT_KIRA_MODEL,
    default_image: DEFAULT_KIRA_IMAGE_MODEL,
    default_tts: DEFAULT_KIRA_TTS_MODEL,
    default_video: DEFAULT_KIRA_VIDEO_MODEL,
    default_voice: DEFAULT_KIRA_VOICE,
    has_key: hasKira(c.env),
  })
)

app.post('/api/kira/image', async (c) => {
  if (!hasKira(c.env)) return c.json(bad('Chưa cấu hình KIRA_API_KEY', 503), 503)
  const body = await c.req.json().catch(() => ({}))
  const prompt = String(body.prompt || '').trim()
  if (!prompt) return c.json(bad('Prompt trống'), 400)
  try {
    const img = await generateKiraImage(c.env, prompt, {
      model: String(body.model || body.kira_model || ''),
      width: Number(body.width) || 768,
      height: Number(body.height) || 1344,
      aspect_ratio: String(body.aspect_ratio || '9:16'),
    })
    const key = `images/kira_${uid('img_')}.png`
    const saved = await putAssetSmart(c.env, key, img.bytes, img.contentType)
    const assetId = uid('as_')
    if (body.blueprint_id) {
      try {
        await c.env.DB.prepare(
          `INSERT INTO assets (id, blueprint_id, kind, shot_index, r2_key, content_type, size, prompt, created_at) VALUES (?,?,?,?,?,?,?,?,?)`
        )
          .bind(assetId, String(body.blueprint_id), 'image', Number(body.shot_index) || 0, saved.key, img.contentType, saved.size, prompt.slice(0, 800), now())
          .run()
      } catch {}
    }
    return c.json({ id: assetId, url: saved.url, key, size: saved.size, content_type: img.contentType, provider: 'kira' })
  } catch (e: any) {
    return c.json(bad(`Kira Image thất bại: ${String(e?.message || e).slice(0, 300)}`, 502), 502)
  }
})

app.post('/api/kira/speech', async (c) => {
  if (!hasKira(c.env)) return c.json(bad('Chưa cấu hình KIRA_API_KEY', 503), 503)
  const body = await c.req.json().catch(() => ({}))
  const text = String(body.text || '').trim()
  if (!text) return c.json(bad('Thiếu text'), 400)
  try {
    const aud = await generateKiraSpeech(c.env, text, {
      voice: String(body.voice || ''),
      model: String(body.model || ''),
    })
    const key = `audio/kira_${uid('tts_')}.mp3`
    const saved = await putAssetSmart(c.env, key, aud.bytes, aud.contentType)
    const assetId = uid('as_')
    if (body.blueprint_id) {
      try {
        await c.env.DB.prepare(
          `INSERT INTO assets (id, blueprint_id, kind, shot_index, r2_key, content_type, size, prompt, meta_json, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`
        )
          .bind(assetId, String(body.blueprint_id), 'audio', 0, saved.key, aud.contentType, saved.size, text.slice(0, 500), JSON.stringify({ voice: body.voice || DEFAULT_KIRA_VOICE, provider: 'kira' }), now())
          .run()
      } catch {}
    }
    return c.json({ id: assetId, url: saved.url, key, size: saved.size, content_type: aud.contentType, provider: 'kira' })
  } catch (e: any) {
    return c.json(bad(`Kira Speech thất bại: ${String(e?.message || e).slice(0, 300)}`, 502), 502)
  }
})

app.post('/api/kira/video', async (c) => {
  if (!hasKira(c.env)) return c.json(bad('Chưa cấu hình KIRA_API_KEY', 503), 503)
  const body = await c.req.json().catch(() => ({}))
  const prompt = String(body.prompt || '').trim()
  if (prompt.length < 8) return c.json(bad('Prompt video quá ngắn (tối thiểu 8 ký tự)'), 400)
  try {
    const { operationId, model } = await generateKiraVideoStart(c.env, prompt, {
      model: String(body.model || ''),
      aspect_ratio: String(body.aspect_ratio || '9:16'),
      duration_seconds: Number(body.duration_seconds) || 6,
    })
    return c.json({ operation: operationId, operationId, model, provider: 'kira' })
  } catch (e: any) {
    return c.json(bad(`Kira Video thất bại: ${String(e?.message || e).slice(0, 300)}`, 502), 502)
  }
})

app.get('/api/kira/video/status', async (c) => {
  if (!hasKira(c.env)) return c.json(bad('Chưa cấu hình KIRA_API_KEY', 503), 503)
  const id = String(c.req.query('id') || c.req.query('operation') || '')
  const blueprintId = String(c.req.query('blueprint_id') || '')
  if (!id) return c.json(bad('Thiếu operation id'), 400)
  try {
    const status = await getKiraVideoOperationStatus(c.env, id)
    if (!status.done) return c.json({ done: false })
    if ('error' in status) return c.json({ done: true, error: status.error })
    // save to blob if possible
    if (c.env.BLOB_READ_WRITE_TOKEN) {
      const key = `videos/kira_${uid('v_')}.mp4`
      const saved = await putAsset(c.env, key, status.bytes, status.contentType)
      const assetId = uid('as_')
      if (blueprintId) {
        try {
          await c.env.DB.prepare(
            `INSERT INTO assets (id, blueprint_id, kind, shot_index, r2_key, content_type, size, prompt, created_at) VALUES (?,?,?,?,?,?,?,?,?)`
          )
            .bind(assetId, blueprintId, 'video', 0, saved.key, status.contentType, saved.size, `kira-video:${id}`.slice(0, 500), now())
            .run()
          await c.env.DB.prepare(`UPDATE blueprints SET status = 'rendered', updated_at = ? WHERE id = ?`)
            .bind(now(), blueprintId)
            .run()
        } catch {}
      }
      return c.json({ done: true, id: assetId, url: saved.url, key, size: saved.size, provider: 'kira' })
    }
    // if no blob, return temporary handling note — client should download from b64? We already have bytes but need to return via data url? For now return note
    // Convert to base64 data url for immediate preview if needed
    return c.json({ done: true, provider: 'kira', note: 'Video sẵn sàng nhưng chưa lưu cloud — cần BLOB_READ_WRITE_TOKEN', bytes_length: status.bytes.byteLength })
  } catch (e: any) {
    return c.json(bad(`Kira Video status thất bại: ${String(e?.message || e).slice(0, 300)}`, 502), 502)
  }
})

// ------------------------------------------------------------------ BƯỚC 1: Ý tưởng

app.post('/api/ideas/generate', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const niche = String(body.niche || '').trim()
  if (!niche) return c.json(bad('Hãy nhập ngách nội dung (niche)'), 400)

  const ideas = await generateIdeas(c.env, {
    niche,
    audience: String(body.audience || '18–34 tuổi'),
    platform: String(body.platform || 'TikTok & YouTube Shorts'),
    language: String(body.language || 'Tiếng Việt'),
    count: Number(body.count || 5),
    model: String(body.model || DEFAULT_TEXT_MODEL),
  })
  return c.json({ ideas, ai: hasLLM(c.env) })
})

// ------------------------------------------------------------------ BƯỚC 2: Cải tiến ý tưởng

app.post('/api/ideas/refine', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const topic = String(body.topic || '').trim()
  if (topic.length < 3) return c.json(bad('Chủ đề quá ngắn'), 400)

  const refined = await refineIdea(c.env, {
    topic,
    niche: String(body.niche || 'Giáo dục / kiến thức'),
    audience: String(body.audience || '18–34 tuổi'),
    platform: String(body.platform || 'TikTok & YouTube Shorts'),
    language: String(body.language || 'Tiếng Việt'),
    model: String(body.model || DEFAULT_TEXT_MODEL),
  })

  const ideaId = uid('idea_')
  try {
    await c.env.DB.prepare(
      `INSERT INTO ideas (id, raw_topic, niche, audience, platform, language, tone, duration_sec, goal, refined_json, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    )
      .bind(
        ideaId,
        topic,
        String(body.niche || ''),
        String(body.audience || ''),
        String(body.platform || ''),
        String(body.language || 'Tiếng Việt'),
        String(body.tone || ''),
        Number(body.duration_sec || 45),
        String(body.goal || ''),
        JSON.stringify(refined),
        now()
      )
      .run()
  } catch (e) {
    console.error('save idea failed', e)
  }

  return c.json({ idea_id: ideaId, refined, ai: hasLLM(c.env) })
})

// ------------------------------------------------------------------ BƯỚC 3: Blueprint

app.post('/api/forge/blueprint', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const topic = String(body.topic || '').trim()
  if (topic.length < 3) return c.json(bad('Hãy nhập chủ đề cụ thể hơn (tối thiểu 3 ký tự)'), 400)

  const brief: IdeaBrief = {
    topic: topic.slice(0, 300),
    niche: String(body.niche || 'Giáo dục / kiến thức'),
    audience: String(body.audience || '18–34 tuổi'),
    platform: String(body.platform || 'TikTok & YouTube Shorts'),
    duration_sec: Math.max(15, Math.min(180, Number(body.duration_sec) || 45)),
    tone: String(body.tone || 'Kể chuyện giàu nhịp'),
    language: String(body.language || 'Tiếng Việt'),
    goal: String(body.goal || 'Tăng khán giả cho kênh'),
    model: String(body.model || DEFAULT_TEXT_MODEL),
  }

  const blueprint = await generateBlueprint(c.env, brief)
  const id = uid('bp_')

  // Chặn idea_id "ma": nếu idea chưa được lưu thì gắn NULL, tránh lỗi FK
  // khiến blueprint mất bản ghi DB dù API vẫn trả về thành công.
  let ideaId: string | null = null
  if (body.idea_id) {
    try {
      const exists = await c.env.DB.prepare(`SELECT 1 FROM ideas WHERE id = ?`)
        .bind(String(body.idea_id))
        .first()
      ideaId = exists ? String(body.idea_id) : null
    } catch {
      ideaId = null
    }
  }

  try {
    await c.env.DB.prepare(
      `INSERT INTO blueprints (id, idea_id, title, concept, viral_score, duration_sec, language, platform, data_json, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    )
      .bind(
        id,
        ideaId,
        blueprint.titles?.[0] || blueprint.concept.slice(0, 120),
        blueprint.concept,
        blueprint.viral_score,
        brief.duration_sec,
        brief.language,
        brief.platform,
        JSON.stringify(blueprint),
        'draft',
        now(),
        now()
      )
      .run()
  } catch (e) {
    console.error('save blueprint failed', e)
  }

  return c.json({ id, blueprint, srt: shotsToSRT(blueprint.shots), ai: !blueprint.fallback })
})

app.get('/api/forge/blueprints', async (c) => {
  const limit = Math.min(50, Number(c.req.query('limit')) || 20)
  try {
    const { results } = await c.env.DB.prepare(
      `SELECT id, title, concept, viral_score, duration_sec, platform, status, created_at
       FROM blueprints ORDER BY created_at DESC LIMIT ?`
    )
      .bind(limit)
      .all()
    return c.json({ blueprints: results || [] })
  } catch {
    return c.json({ blueprints: [] })
  }
})

app.get('/api/forge/blueprints/:id', async (c) => {
  const id = c.req.param('id')
  const row = await c.env.DB.prepare(`SELECT * FROM blueprints WHERE id = ?`).bind(id).first<any>()
  if (!row) return c.json(bad('Không tìm thấy blueprint', 404), 404)
  const { results: assets } = await c.env.DB.prepare(
    `SELECT id, kind, shot_index, r2_key, content_type, size, prompt, created_at
     FROM assets WHERE blueprint_id = ? ORDER BY kind, shot_index`
  )
    .bind(id)
    .all()
  let blueprint: Blueprint | null = null
  try {
    blueprint = JSON.parse(row.data_json)
  } catch {
    blueprint = null
  }
  return c.json({
    ...row,
    blueprint,
    assets: (assets || []).map((a: any) => ({ ...a, url: assetUrl(a.r2_key) })),
  })
})

app.delete('/api/forge/blueprints/:id', async (c) => {
  const id = c.req.param('id')
  const { results } = await c.env.DB.prepare(`SELECT r2_key FROM assets WHERE blueprint_id = ?`).bind(id).all()
  for (const row of (results || []) as any[]) {
    try {
      await deleteAsset(c.env, row.r2_key)
    } catch {
      /* bỏ qua */
    }
  }
  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM assets WHERE blueprint_id = ?`).bind(id),
    c.env.DB.prepare(`DELETE FROM distributions WHERE blueprint_id = ?`).bind(id),
    c.env.DB.prepare(`DELETE FROM metrics WHERE blueprint_id = ?`).bind(id),
    c.env.DB.prepare(`DELETE FROM blueprints WHERE id = ?`).bind(id),
  ])
  return c.json({ deleted: true })
})

// ------------------------------------------------------------------ BƯỚC 4: Ảnh (Kira media integration)

app.post('/api/media/image', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const prompt = String(body.prompt || '').trim()
  if (!prompt) return c.json(bad('Prompt trống'), 400)

  // provider: 'auto' (mặc định — ưu tiên Gemini -> Kira -> Pollinations),
  //           'gemini', 'kira', 'pollinations', 'placeholder'
  const provider = String(body.provider || 'auto').toLowerCase()

  try {
    let bytes: ArrayBuffer
    let contentType: string
    let fallback = false
    let usedProvider: string

    if (provider === 'kira') {
      if (!hasKira(c.env)) return c.json(bad('Chưa cấu hình KIRA_API_KEY', 503), 503)
      try {
        const kira = await generateKiraImage(c.env, prompt, {
          model: String(body.kira_model || body.model || ''),
          width: Number(body.width) || 768,
          height: Number(body.height) || 1344,
        })
        bytes = kira.bytes
        contentType = kira.contentType
        usedProvider = 'kira'
      } catch (e: any) {
        return c.json(bad(`Kira Image thất bại: ${String(e?.message || e).slice(0, 300)}`, 502), 502)
      }
    } else if (provider === 'gemini') {
      if (!hasGemini(c.env)) return c.json(bad('Chưa cấu hình GEMINI_API_KEY', 503), 503)
      const gem = await generateGeminiImage(c.env, prompt, {
        model: String(body.gemini_model || ''),
        aspectRatio: '9:16',
      })
      bytes = gem.bytes
      contentType = gem.contentType
      usedProvider = 'gemini'
    } else if (provider === 'pollinations') {
      const pol = await generateImageBytes(prompt, {
        model: String(body.model || 'flux'),
        width: Number(body.width) || 768,
        height: Number(body.height) || 1344,
        seed: body.seed !== undefined ? Number(body.seed) : undefined,
      })
      bytes = pol.bytes
      contentType = pol.contentType
      fallback = Boolean(pol.fallback)
      usedProvider = pol.fallback ? 'placeholder' : 'pollinations'
    } else {
      // auto: Gemini -> Kira -> Pollinations -> placeholder
      if (hasGemini(c.env)) {
        try {
          const gem = await generateGeminiImage(c.env, prompt, {
            model: String(body.gemini_model || ''),
            aspectRatio: '9:16',
          })
          bytes = gem.bytes
          contentType = gem.contentType
          usedProvider = 'gemini'
        } catch (e: any) {
          console.error('gemini image failed, try kira:', String(e?.message || e).slice(0, 200))
          if (hasKira(c.env)) {
            try {
              const kira = await generateKiraImage(c.env, prompt, {
                model: String(body.kira_model || ''),
                width: Number(body.width) || 768,
                height: Number(body.height) || 1344,
              })
              bytes = kira.bytes
              contentType = kira.contentType
              usedProvider = 'kira'
            } catch (e2: any) {
              console.error('kira image failed, fallback to pollinations:', String(e2?.message || e2).slice(0, 200))
              const pol = await generateImageBytes(prompt, {
                model: String(body.model || 'flux'),
                width: Number(body.width) || 768,
                height: Number(body.height) || 1344,
                seed: body.seed !== undefined ? Number(body.seed) : undefined,
              })
              bytes = pol.bytes
              contentType = pol.contentType
              fallback = Boolean(pol.fallback)
              usedProvider = pol.fallback ? 'placeholder' : 'pollinations'
            }
          } else {
            const pol = await generateImageBytes(prompt, {
              model: String(body.model || 'flux'),
              width: Number(body.width) || 768,
              height: Number(body.height) || 1344,
              seed: body.seed !== undefined ? Number(body.seed) : undefined,
            })
            bytes = pol.bytes
            contentType = pol.contentType
            fallback = Boolean(pol.fallback)
            usedProvider = pol.fallback ? 'placeholder' : 'pollinations'
          }
        }
      } else if (hasKira(c.env)) {
        try {
          const kira = await generateKiraImage(c.env, prompt, {
            model: String(body.kira_model || ''),
            width: Number(body.width) || 768,
            height: Number(body.height) || 1344,
          })
          bytes = kira.bytes
          contentType = kira.contentType
          usedProvider = 'kira'
        } catch (e: any) {
          console.error('kira image failed, fallback to pollinations:', String(e?.message || e).slice(0, 200))
          const pol = await generateImageBytes(prompt, {
            model: String(body.model || 'flux'),
            width: Number(body.width) || 768,
            height: Number(body.height) || 1344,
            seed: body.seed !== undefined ? Number(body.seed) : undefined,
          })
          bytes = pol.bytes
          contentType = pol.contentType
          fallback = Boolean(pol.fallback)
          usedProvider = pol.fallback ? 'placeholder' : 'pollinations'
        }
      } else {
        const pol = await generateImageBytes(prompt, {
          model: String(body.model || 'flux'),
          width: Number(body.width) || 768,
          height: Number(body.height) || 1344,
          seed: body.seed !== undefined ? Number(body.seed) : undefined,
        })
        bytes = pol.bytes
        contentType = pol.contentType
        fallback = Boolean(pol.fallback)
        usedProvider = pol.fallback ? 'placeholder' : 'pollinations'
      }
    }

    const ext = contentType.includes('png') ? 'png' : contentType.includes('svg') ? 'svg' : 'jpg'
    const key = `images/${uid('img_')}.${ext}`
    const saved = await putAssetSmart(c.env, key, bytes, contentType)

    const assetId = uid('as_')
    if (body.blueprint_id) {
      try {
        await c.env.DB.prepare(
          `INSERT INTO assets (id, blueprint_id, kind, shot_index, r2_key, content_type, size, prompt, created_at)
           VALUES (?,?,?,?,?,?,?,?,?)`
        )
          .bind(
            assetId,
            String(body.blueprint_id),
            'image',
            Number(body.shot_index) || 0,
            saved.key,
            contentType,
            saved.size,
            prompt.slice(0, 800),
            now()
          )
          .run()
      } catch (e) {
        console.error('save image asset failed', e)
      }
    }
    return c.json({
      id: assetId,
      url: saved.url,
      key,
      size: saved.size,
      content_type: contentType,
      fallback: Boolean(fallback),
      provider: usedProvider,
    })
  } catch (e: any) {
    return c.json(bad(`Tạo ảnh thất bại: ${String(e?.message || e).slice(0, 200)}`, 502), 502)
  }
})

// Import ảnh có sẵn (do AI bên ngoài hoặc ngườidùng tự tạo) vào gallery của một shot.
// Nhận data URL (png/jpg/webp) — client tự chuyển base64, server không cần egress.
app.post('/api/media/import-image', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const m = /^data:(image\/(?:png|jpe?g|webp));base64,([A-Za-z0-9+/=\r\n]+)$/.exec(String(body.data || ''))
  if (!m) return c.json(bad('Cần data URL ảnh hợp lệ (png/jpg/webp)'), 400)
  const contentType = m[1] === 'image/jpg' ? 'image/jpeg' : m[1]
  let bytes: Uint8Array
  try {
    const bin = atob(m[2].replace(/\s+/g, ''))
    bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  } catch {
    return c.json(bad('Data URL không hợp lệ (base64 lỗi)'), 400)
  }
  if (bytes.byteLength < 1024) return c.json(bad('Ảnh quá nhỏ hoặc không hợp lệ'), 400)
  if (bytes.byteLength > 3 * 1024 * 1024) return c.json(bad('Ảnh vượt quá 3MB'), 413)

  try {
    const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg'
    const key = `images/${uid('img_')}.${ext}`
    const saved = await putAssetSmart(c.env, key, bytes, contentType)
    const assetId = uid('as_')
    if (body.blueprint_id) {
      try {
        await c.env.DB.prepare(
          `INSERT INTO assets (id, blueprint_id, kind, shot_index, r2_key, content_type, size, prompt, created_at)
           VALUES (?,?,?,?,?,?,?,?,?)`
        )
          .bind(
            assetId,
            String(body.blueprint_id),
            'image',
            Number(body.shot_index) || 0,
            saved.key,
            contentType,
            saved.size,
            String(body.prompt || 'imported').slice(0, 800),
            now()
          )
          .run()
      } catch (e) {
        console.error('save imported asset failed', e)
      }
    }
    return c.json({ id: assetId, url: saved.url, key, size: saved.size, content_type: contentType, provider: 'import' })
  } catch (e: any) {
    return c.json(bad(`Import ảnh thất bại: ${String(e?.message || e).slice(0, 200)}`, 502), 502)
  }
})

// Import voice-over có sẵn (ghi âm tay hoặc TTS chạy nơi khác) — đưa thẳng vào bước dựng video.
// Nhận data URL audio (mp3/wav/ogg/m4a) — hoạt động cả khi server không có egress.
app.post('/api/media/import-audio', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const m = /^data:(audio\/(?:mpeg|mp3|wav|x-wav|wave|ogg|m4a|mp4|aac));base64,([A-Za-z0-9+/=\r\n]+)$/.exec(String(body.data || ''))
  if (!m) return c.json(bad('Cần data URL audio hợp lệ (mp3/wav/ogg/m4a)'), 400)
  const contentType = m[1]
    .replace('audio/mp3', 'audio/mpeg')
    .replace('audio/x-wav', 'audio/wav')
    .replace('audio/wave', 'audio/wav')
    .replace('audio/mp4', 'audio/m4a')
  let bytes: Uint8Array
  try {
    const bin = atob(m[2].replace(/\s+/g, ''))
    bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  } catch {
    return c.json(bad('Data URL không hợp lệ (base64 lỗi)'), 400)
  }
  if (bytes.byteLength < 512) return c.json(bad('Audio quá nhỏ hoặc không hợp lệ'), 400)
  if (bytes.byteLength > 3 * 1024 * 1024) return c.json(bad('Audio vượt quá 3MB'), 413)

  try {
    const ext = contentType.includes('wav') ? 'wav' : contentType.includes('ogg') ? 'ogg' : contentType.includes('aac') || contentType.includes('m4a') ? 'm4a' : 'mp3'
    const key = `audio/${uid('aud_')}.${ext}`
    const saved = await putAssetSmart(c.env, key, bytes, contentType)
    const assetId = uid('as_')
    if (body.blueprint_id) {
      try {
        await c.env.DB.prepare(
          `INSERT INTO assets (id, blueprint_id, kind, shot_index, r2_key, content_type, size, prompt, created_at)
           VALUES (?,?,?,?,?,?,?,?,?)`
        )
          .bind(assetId, String(body.blueprint_id), 'audio', 0, saved.key, contentType, saved.size, 'imported voice-over', now())
          .run()
      } catch (e) {
        console.error('save imported audio failed', e)
      }
    }
    return c.json({ id: assetId, url: saved.url, key, size: saved.size, content_type: contentType, provider: 'import' })
  } catch (e: any) {
    return c.json(bad(`Import audio thất bại: ${String(e?.message || e).slice(0, 200)}`, 502), 502)
  }
})

// ------------------------------------------------------------------ BƯỚC 5: Giọng đọc (Kira media integration)

app.post('/api/media/speech', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const text = String(body.text || '').trim()
  if (!text) return c.json(bad('Nội dung đọc trống'), 400)
  if (text.length > 12000) return c.json(bad('Kịch bản quá dài (tối đa 12.000 ký tự)'), 400)

  const provider = String(body.provider || 'auto').toLowerCase()

  try {
    let bytes: Uint8Array | ArrayBuffer
    let audioType: string
    let chunks: number
    let chars: number
    let fallback = false
    let missing = 0
    let usedProvider = 'google'

    if (provider === 'kira') {
      if (!hasKira(c.env)) return c.json(bad('Chưa cấu hình KIRA_API_KEY', 503), 503)
      const kira = await generateKiraSpeech(c.env, text, {
        voice: String(body.voice || body.kira_voice || ''),
        model: String(body.kira_model || ''),
      })
      bytes = kira.bytes
      audioType = kira.contentType
      chunks = 1
      chars = text.length
      usedProvider = 'kira'
    } else if (provider === 'google' || provider === 'gtts') {
      const res = await generateSpeech(text, String(body.voice || 'vi'))
      bytes = res.bytes
      audioType = res.fallback ? 'audio/wav' : 'audio/mpeg'
      chunks = res.chunks
      chars = res.chars
      fallback = Boolean(res.fallback)
      missing = res.missing || 0
      usedProvider = 'google'
    } else {
      // auto: Kira -> Google -> fallback WAV
      if (hasKira(c.env)) {
        try {
          const kira = await generateKiraSpeech(c.env, text, {
            voice: String(body.voice || body.kira_voice || ''),
            model: String(body.kira_model || ''),
          })
          bytes = kira.bytes
          audioType = kira.contentType
          chunks = 1
          chars = text.length
          usedProvider = 'kira'
        } catch (e: any) {
          console.error('kira speech failed, fallback to google:', String(e?.message || e).slice(0, 200))
          const res = await generateSpeech(text, String(body.voice || 'vi'))
          bytes = res.bytes
          audioType = res.fallback ? 'audio/wav' : 'audio/mpeg'
          chunks = res.chunks
          chars = res.chars
          fallback = Boolean(res.fallback)
          missing = res.missing || 0
          usedProvider = 'google'
        }
      } else {
        const res = await generateSpeech(text, String(body.voice || 'vi'))
        bytes = res.bytes
        audioType = res.fallback ? 'audio/wav' : 'audio/mpeg'
        chunks = res.chunks
        chars = res.chars
        fallback = Boolean(res.fallback)
        missing = res.missing || 0
        usedProvider = 'google'
      }
    }

    const key = `audio/${uid('tts_')}.${audioType.includes('wav') ? 'wav' : 'mp3'}`
    const saved = await putAssetSmart(c.env, key, bytes as any, audioType)

    const assetId = uid('as_')
    if (body.blueprint_id) {
      try {
        await c.env.DB.prepare(
          `INSERT INTO assets (id, blueprint_id, kind, shot_index, r2_key, content_type, size, prompt, meta_json, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?)`
        )
          .bind(
            assetId,
            String(body.blueprint_id),
            'audio',
            Number(body.shot_index) || 0,
            saved.key,
            audioType,
            saved.size,
            text.slice(0, 500),
            JSON.stringify({ voice: body.voice || 'vi', chunks, chars, fallback: Boolean(fallback), missing: missing || 0 }),
            now()
          )
          .run()
      } catch (e) {
        console.error('save audio asset failed', e)
      }
    }
    return c.json({ id: assetId, url: saved.url, key, size: saved.size, chunks, chars, fallback: Boolean(fallback), missing: missing || 0, provider: usedProvider })
  } catch (e: any) {
    return c.json(bad(`Tạo giọng đọc thất bại: ${String(e?.message || e).slice(0, 200)}`, 502), 502)
  }
})

// ------------------------------------------------------------------ BƯỚC 6: Lưu video render từ browser

app.post('/api/media/video/:blueprintId', async (c) => {
  const blueprintId = c.req.param('blueprintId')
  const body = await c.req.json().catch(() => ({}))
  const url = String(body.url || '')
  const contentType = String(body.content_type || 'video/mp4')
  const size = Math.max(0, Number(body.size) || 0)
  if (!/^https:\/\/[^/]+\.public\.blob\.vercel-storage\.com\//.test(url)) {
    return c.json(bad('URL Vercel Blob không hợp lệ'), 400)
  }
  if (size && size > 120 * 1024 * 1024) return c.json(bad('Video quá lớn (tối đa 120MB)'), 400)

  const assetId = uid('as_')
  try {
    await c.env.DB.prepare(
      `INSERT INTO assets (id, blueprint_id, kind, shot_index, r2_key, content_type, size, created_at)
       VALUES (?,?,?,?,?,?,?,?)`
    )
      .bind(assetId, blueprintId, 'video', 0, url, contentType, size, now())
      .run()
    await c.env.DB.prepare(`UPDATE blueprints SET status = 'rendered', updated_at = ? WHERE id = ?`)
      .bind(now(), blueprintId)
      .run()
  } catch (e) {
    console.error('save video asset failed', e)
  }
  return c.json({ id: assetId, url, key: url, size })
})

// ------------------------------------------------------------------ BƯỚC 6b: Video AI bằng Veo (phương án 2)

app.post('/api/media/ai-video', async (c) => {
  if (!hasGemini(c.env)) return c.json(bad('Chưa cấu hình GEMINI_API_KEY (AI Studio)'), 503)
  const body = await c.req.json().catch(() => ({}))
  let prompt = String(body.prompt || '').trim()
  if (prompt.length < 8) return c.json(bad('Prompt video quá ngắn (tối thiểu 8 ký tự)'), 400)

  // Voice đọc theo Veo: Veo 3 tự tạo audio gốc — lồng thoại đọc (câu trong ngoặc kép)
  // thẳng vào prompt. Clip Veo ~8s nên chỉ đưa đoạn mở đầu kịch bản để vừa nhịp đọc.
  const voRaw = String(body.voiceover || '')
    .replace(/\s+/g, ' ')
    .replace(/["“”]/g, "'")
    .trim()
  let spoken = false
  if (voRaw) {
    let vo = voRaw.slice(0, 260)
    const cut = vo.lastIndexOf(' ')
    if (voRaw.length > 260 && cut > 120) vo = vo.slice(0, cut)
    if (vo.length >= 8) {
      prompt +=
        ` Audio: a warm, natural Vietnamese narrator says exactly: "${vo}".` +
        ' Clear storytelling pace; subtle ambient sound matching the visuals;' +
        ' the voice is louder than any music; no subtitles or on-screen captions.'
      spoken = true
    }
  }
  if (prompt.length > 1400) prompt = prompt.slice(0, 1400)

  try {
    const operation = await startVeoOperation(c.env, prompt, {
      model: String(body.model || ''),
      aspectRatio: String(body.aspect_ratio || '9:16'),
    })
    return c.json({ operation, model: VEO_MODELS.includes(body.model) ? body.model : VEO_MODELS[0], spoken })
  } catch (e: any) {
    return c.json(bad(`Không khởi động được Veo: ${String(e?.message || e).slice(0, 300)}`, 502), 502)
  }
})

app.get('/api/media/ai-video/status', async (c) => {
  if (!hasGemini(c.env)) return c.json(bad('Chưa cấu hình GEMINI_API_KEY (AI Studio)'), 503)
  const name = String(c.req.query('name') || '')
  const blueprintId = String(c.req.query('blueprint_id') || '')
  try {
    const status = await getVeoOperationStatus(c.env, name)
    if (!status.done) return c.json({ done: false })
    if ('error' in status && status.error) return c.json({ done: true, error: status.error })

    const uri = (status as { videoUri: string }).videoUri
    // Có Blob → tải về và lưu lâu dài; chưa có Blob → client xem/tải trực tiếp
    // từ URI Google (hết hạn ~vài ngày).
    if (c.env.BLOB_READ_WRITE_TOKEN) {
      const bytes = await downloadVeoVideo(c.env, uri)
      const key = `videos/veo_${uid('v_')}.mp4`
      const saved = await putAsset(c.env, key, bytes, 'video/mp4')
      const assetId = uid('as_')
      if (blueprintId) {
        try {
          await c.env.DB.prepare(
            `INSERT INTO assets (id, blueprint_id, kind, shot_index, r2_key, content_type, size, prompt, created_at)
             VALUES (?,?,?,?,?,?,?,?,?)`
          )
            .bind(assetId, blueprintId, 'video', 0, saved.key, 'video/mp4', saved.size, `veo:${name}`.slice(0, 500), now())
            .run()
          await c.env.DB.prepare(`UPDATE blueprints SET status = 'rendered', updated_at = ? WHERE id = ?`)
            .bind(now(), blueprintId)
            .run()
        } catch (e) {
          console.error('save veo asset failed', e)
        }
      }
      return c.json({ done: true, id: assetId, url: saved.url, key, size: saved.size, provider: 'veo' })
    }
    return c.json({ done: true, url: uri, provider: 'veo', note: 'URI Google tạm thởi — hãy tải về sớm', expires_source: true })
  } catch (e: any) {
    return c.json(bad(`Kiểm tra trạng thái Veo thất bại: ${String(e?.message || e).slice(0, 300)}`, 502), 502)
  }
})

// ------------------------------------------------------------------ Vercel Blob upload & legacy media endpoint

app.post('/api/blob/upload', async (c) => {
  if (!c.env.BLOB_READ_WRITE_TOKEN) return c.json(bad('Chưa cấu hình Vercel Blob'), 503)
  try {
    const body = (await c.req.json()) as HandleUploadBody
    const response = await handleUpload({
      body,
      request: c.req.raw,
      token: c.env.BLOB_READ_WRITE_TOKEN,
      onBeforeGenerateToken: async (pathname) => {
        if (!/^(videos|audio|segments|images)\//.test(pathname) || pathname.includes('..')) {
          throw new Error('Đường dẫn upload không hợp lệ')
        }
        return {
          addRandomSuffix: false,
          maximumSizeInBytes: 120 * 1024 * 1024,
          tokenPayload: JSON.stringify({ pathname }),
        }
      },
      onUploadCompleted: async () => {
        // Client xác nhận metadata tại endpoint video sau khi Blob hoàn thành.
      },
    })
    return c.json(response)
  } catch (e: any) {
    return c.json(bad(`Không tạo được quyền upload Blob: ${String(e?.message || e).slice(0, 200)}`, 400), 400)
  }
})

app.get('/api/media/*', async (c) => {
  return c.json(bad('Media mới được phục vụ trực tiếp qua Vercel Blob URL'), 404)
})

// ------------------------------------------------------------------ BƯỚC 7: Phân phối MXH

app.post('/api/distribution/build', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const blueprintId = String(body.blueprint_id || '')
  let blueprint: Blueprint | null = body.blueprint || null

  if (!blueprint && blueprintId) {
    const row = await c.env.DB.prepare(`SELECT data_json FROM blueprints WHERE id = ?`).bind(blueprintId).first<any>()
    if (row) {
      try {
        blueprint = JSON.parse(row.data_json)
      } catch {
        blueprint = null
      }
    }
  }
  if (!blueprint) return c.json(bad('Cần blueprint để tạo gói phân phối'), 400)

  const requested: Platform[] = Array.isArray(body.platforms) && body.platforms.length
    ? body.platforms.map((p: any) => String(p).toLowerCase()).filter((p: string) => PLATFORMS.includes(p as Platform))
    : ['tiktok', 'facebook', 'instagram', 'x']

  const packs = await buildDistributionPacks(
    c.env,
    blueprint,
    requested as Platform[],
    String(body.language || 'Tiếng Việt'),
    String(body.model || DEFAULT_TEXT_MODEL)
  )

  if (blueprintId) {
    for (const pack of packs) {
      try {
        await c.env.DB.prepare(
          `INSERT INTO distributions (id, blueprint_id, platform, caption, hashtags, best_time, pack_json, status, created_at)
           VALUES (?,?,?,?,?,?,?,?,?)`
        )
          .bind(
            uid('dist_'),
            blueprintId,
            pack.platform,
            pack.caption,
            pack.hashtags.join(' '),
            pack.best_time,
            JSON.stringify(pack),
            'ready',
            now()
          )
          .run()
      } catch (e) {
        console.error('save distribution failed', e)
      }
    }
    try {
      await c.env.DB.prepare(`UPDATE blueprints SET status = 'published', updated_at = ? WHERE id = ?`)
        .bind(now(), blueprintId)
        .run()
    } catch {
      /* bỏ qua */
    }
  }

  return c.json({ packs, ai: hasLLM(c.env) })
})

app.get('/api/distribution', async (c) => {
  const blueprintId = c.req.query('blueprint_id')
  const query = blueprintId
    ? c.env.DB.prepare(
        `SELECT * FROM distributions WHERE blueprint_id = ? ORDER BY created_at DESC LIMIT 50`
      ).bind(blueprintId)
    : c.env.DB.prepare(`SELECT * FROM distributions ORDER BY created_at DESC LIMIT 50`)
  const { results } = await query.all()
  return c.json({ distributions: results || [] })
})

app.patch('/api/distribution/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json().catch(() => ({}))
  await c.env.DB.prepare(
    `UPDATE distributions SET status = COALESCE(?, status), post_url = COALESCE(?, post_url), published_at = COALESCE(?, published_at) WHERE id = ?`
  )
    .bind(
      body.status ? String(body.status) : null,
      body.post_url ? String(body.post_url) : null,
      body.status === 'published' ? now() : null,
      id
    )
    .run()
  return c.json({ updated: true })
})

// ------------------------------------------------------------------ Thu nhập thụ động

app.post('/api/revenue/model', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const model = await buildRevenueModel(c.env, {
    niche: String(body.niche || 'Giáo dục / kiến thức'),
    platform: String(body.platform || 'TikTok, Facebook, Instagram, X'),
    audience: String(body.audience || '18–34 tuổi'),
    language: String(body.language || 'Tiếng Việt'),
    model: String(body.model || DEFAULT_TEXT_MODEL),
  })
  return c.json({ ...model, ai: hasLLM(c.env) })
})

app.post('/api/metrics', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const platform = String(body.platform || '').toLowerCase()
  if (!PLATFORMS.includes(platform as Platform)) return c.json(bad('Nền tảng không hợp lệ'), 400)

  const id = uid('m_')
  await c.env.DB.prepare(
    `INSERT INTO metrics (id, distribution_id, blueprint_id, platform, views, likes, comments, shares, followers_gained, revenue_usd, revenue_source, recorded_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  )
    .bind(
      id,
      body.distribution_id ? String(body.distribution_id) : null,
      body.blueprint_id ? String(body.blueprint_id) : null,
      platform,
      Math.max(0, Number(body.views) || 0),
      Math.max(0, Number(body.likes) || 0),
      Math.max(0, Number(body.comments) || 0),
      Math.max(0, Number(body.shares) || 0),
      Math.max(0, Number(body.followers_gained) || 0),
      Math.max(0, Number(body.revenue_usd) || 0),
      String(body.revenue_source || 'creator_fund'),
      now()
    )
    .run()
  return c.json({ id, saved: true })
})

app.get('/api/metrics/summary', async (c) => {
  // Neon trả SUM/COUNT dưới dạng string (int8/numeric) — ép ::float8/::int
  // để JSON ra số thật và client không phải tự coerce.
  const totals = await c.env.DB.prepare(
    `SELECT COUNT(*)::int AS entries,
            COALESCE(SUM(views),0)::float8 AS views,
            COALESCE(SUM(likes),0)::float8 AS likes,
            COALESCE(SUM(comments),0)::float8 AS comments,
            COALESCE(SUM(shares),0)::float8 AS shares,
            COALESCE(SUM(followers_gained),0)::float8 AS followers,
            COALESCE(SUM(revenue_usd),0)::float8 AS revenue
     FROM metrics`
  ).first<any>()

  const { results: byPlatform } = await c.env.DB.prepare(
    `SELECT platform,
            COALESCE(SUM(views),0)::float8 AS views,
            COALESCE(SUM(revenue_usd),0)::float8 AS revenue,
            COALESCE(SUM(followers_gained),0)::float8 AS followers,
            COUNT(*)::int AS posts
     FROM metrics GROUP BY platform ORDER BY revenue DESC`
  ).all()

  const { results: bySource } = await c.env.DB.prepare(
    `SELECT revenue_source, COALESCE(SUM(revenue_usd),0)::float8 AS revenue
     FROM metrics GROUP BY revenue_source ORDER BY revenue DESC`
  ).all()

  const { results: recent } = await c.env.DB.prepare(
    `SELECT id, platform, views, revenue_usd, revenue_source, recorded_at
     FROM metrics ORDER BY recorded_at DESC LIMIT 15`
  ).all()

  const counts = await c.env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM blueprints)::int AS blueprints,
            (SELECT COUNT(*) FROM assets WHERE kind='video')::int AS videos,
            (SELECT COUNT(*) FROM distributions)::int AS packs`
  ).first<any>()

  const views = Number(totals?.views || 0)
  const revenue = Number(totals?.revenue || 0)
  return c.json({
    totals: {
      ...totals,
      rpm: views > 0 ? Number(((revenue / views) * 1000).toFixed(3)) : 0,
    },
    by_platform: byPlatform || [],
    by_source: bySource || [],
    recent: recent || [],
    counts: counts || {},
  })
})

app.delete('/api/metrics/:id', async (c) => {
  await c.env.DB.prepare(`DELETE FROM metrics WHERE id = ?`).bind(c.req.param('id')).run()
  return c.json({ deleted: true })
})

// ------------------------------------------------------------------ SRT tiện ích

app.post('/api/forge/srt', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const shots = Array.isArray(body.shots) ? body.shots : body?.blueprint?.shots
  if (!Array.isArray(shots) || !shots.length) return c.json(bad('Không có shot để tạo SRT'), 400)
  return c.json({ srt: shotsToSRT(shots) })
})

// ================================================================== STUDIO (WASM)
// 5 tính năng gốc chạy WebAssembly trong browser; Function chỉ lo LLM + lưu trữ.

// ---- fallback cho file nhỏ do WASM tạo ra; file lớn upload trực tiếp lên Vercel Blob.
app.put('/api/studio/upload/:kind', async (c) => {
  const kind = c.req.param('kind')
  const allowed = ['audio', 'videos', 'segments', 'docs', 'images']
  const folder = allowed.includes(kind) ? kind : 'segments'
  const contentType = c.req.header('content-type') || 'application/octet-stream'
  const name = (c.req.query('name') || '').replace(/[^\w.\-]/g, '_').slice(0, 80)
  const bytes = await c.req.arrayBuffer()
  if (!bytes || bytes.byteLength < 64) return c.json(bad('Dữ liệu file không hợp lệ'), 400)
  if (bytes.byteLength > 4 * 1024 * 1024) {
    return c.json(bad('File trên 4MB phải upload trực tiếp lên Vercel Blob'), 413)
  }

  const ext =
    (name.includes('.') ? name.split('.').pop() : '') ||
    (contentType.includes('mp4') ? 'mp4' : contentType.includes('mpeg') ? 'mp3' : 'bin')
  const key = `${folder}/${uid('st_')}.${ext}`
  const saved = await putAsset(c.env, key, bytes, contentType)
  return c.json({ url: saved.url, key, size: saved.size, name: name || key })
})

// ---- lịch sử phiên Studio
app.post('/api/studio/jobs', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const kind = String(body.kind || '').slice(0, 30)
  if (!kind) return c.json(bad('Thiếu kind'), 400)
  const id = uid('sj_')
  await c.env.DB.prepare(
    `INSERT INTO studio_jobs (id, kind, title, status, meta, created_at) VALUES (?,?,?,?,?,?)`
  )
    .bind(
      id,
      kind,
      String(body.title || '').slice(0, 200),
      String(body.status || 'done').slice(0, 20),
      JSON.stringify(body.meta || {}).slice(0, 20000),
      now()
    )
    .run()
  return c.json({ id })
})

app.get('/api/studio/jobs', async (c) => {
  const kind = c.req.query('kind')
  const limit = Math.min(Number(c.req.query('limit')) || 30, 100)
  const q = kind
    ? c.env.DB.prepare(
        `SELECT * FROM studio_jobs WHERE kind = ? ORDER BY created_at DESC LIMIT ?`
      ).bind(kind, limit)
    : c.env.DB.prepare(`SELECT * FROM studio_jobs ORDER BY created_at DESC LIMIT ?`).bind(limit)
  const { results } = await q.all()
  return c.json({
    jobs: (results || []).map((r: any) => ({ ...r, meta: safeJSON(r.meta) })),
  })
})

app.delete('/api/studio/jobs/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM studio_jobs WHERE id = ?').bind(c.req.param('id')).run()
  return c.json({ ok: true })
})

// ---- TÍNH NĂNG 1+2: SRT utilities & dịch phụ đề
app.post('/api/studio/srt/parse', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const cues = parseSRT(String(body.srt || ''))
  if (!cues.length) return c.json(bad('File SRT không hợp lệ — kiểm tra định dạng/UTF-8'), 400)
  return c.json({ cues, count: cues.length, duration: cues[cues.length - 1].end })
})

app.post('/api/studio/srt/compose', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const segs = Array.isArray(body.segments) ? body.segments : []
  if (!segs.length) return c.json(bad('Không có segment nào'), 400)
  return c.json({ srt: composeSRT(segs), count: segs.length })
})

app.post('/api/studio/srt/translate', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const target = String(body.target_lang || 'vi')
  const model = body.model ? String(body.model) : undefined
  try {
    if (Array.isArray(body.segments) && body.segments.length) {
      // đường dùng cho Video Dub: dịch từng segment, giữ timing
      const segs = body.segments.slice(0, 400)
      const res = await translateTexts(
        c.env,
        segs.map((s: any) => String(s.text || '').replace(/\n/g, ' ')),
        target,
        model
      )
      const out = segs.map((s: any, i: number) => ({
        start: Number(s.start) || 0,
        end: Number(s.end) || 0,
        text: res.texts[i],
      }))
      return c.json({
        segments: out,
        srt: composeSRT(out),
        cue_count: out.length,
        translated_lines: res.translated_lines,
        batches: res.batches,
        llm: res.llm,
        target_lang: target,
      })
    }
    const srt = String(body.srt || '')
    if (!srt.trim()) return c.json(bad('Chưa có nội dung SRT'), 400)
    const res = await translateSRT(c.env, srt, target, model)
    return c.json(res)
  } catch (e: any) {
    return c.json(bad(`Dịch thất bại: ${String(e?.message || e).slice(0, 200)}`, 502), 502)
  }
})

app.get('/api/studio/langs', (c) =>
  c.json({
    langs: Object.entries(TRANSLATE_LANGS).map(([code, label]) => ({ code, label })),
    voices: VOICES,
  })
)

// ---- TÍNH NĂNG 5: RAG
app.post('/api/rag/docs', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const text = String(body.text || '')
  const name = String(body.name || 'tai-lieu.txt').slice(0, 160)
  if (text.trim().length < 20) return c.json(bad('Nội dung tài liệu quá ngắn (tối thiểu 20 ký tự)'), 400)
  if (text.length > 900_000) return c.json(bad('Tài liệu quá lớn (tối đa ~900.000 ký tự)'), 400)
  try {
    const doc = await ingestDocument(c.env, name, text, String(body.source || 'upload'))
    return c.json({ doc })
  } catch (e: any) {
    return c.json(bad(`Nạp tài liệu thất bại: ${String(e?.message || e).slice(0, 200)}`), 400)
  }
})

app.get('/api/rag/docs', async (c) => c.json({ docs: await listDocuments(c.env) }))

app.delete('/api/rag/docs/:id', async (c) => {
  await deleteDocument(c.env, c.req.param('id'))
  return c.json({ ok: true })
})

app.post('/api/rag/ask', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const question = String(body.question || '').trim()
  if (question.length < 3) return c.json(bad('Câu hỏi quá ngắn'), 400)
  try {
    const res = await askDocs(
      c.env,
      question,
      Array.isArray(body.doc_ids) && body.doc_ids.length ? body.doc_ids.map(String) : null,
      Math.min(Number(body.top_k) || 5, 12),
      body.model ? String(body.model) : undefined
    )
    return c.json(res)
  } catch (e: any) {
    return c.json(bad(`Hỏi đáp thất bại: ${String(e?.message || e).slice(0, 200)}`, 502), 502)
  }
})

app.post('/api/rag/video-script', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  try {
    const res = await generateVideoScript(c.env, {
      docIds: Array.isArray(body.doc_ids) && body.doc_ids.length ? body.doc_ids.map(String) : null,
      topic: String(body.topic || ''),
      style: String(body.style || 'storytelling'),
      durationSec: Number(body.duration_sec) || 60,
      model: body.model ? String(body.model) : undefined,
    })
    return c.json(res)
  } catch (e: any) {
    return c.json(bad(`Tạo kịch bản thất bại: ${String(e?.message || e).slice(0, 200)}`), 400)
  }
})

// ------------------------------------------------------------------ frontend

app.get('/', (c) => c.html(renderPage()))
app.get('/app', (c) => c.html(renderPage()))
app.get('/studio', (c) => c.html(renderStudio()))

app.notFound((c) => {
  if (c.req.path.startsWith('/api/')) return c.json(bad('Endpoint không tồn tại', 404), 404)
  return c.html(renderPage())
})

app.onError((err, c) => {
  console.error('unhandled', err)
  return c.json(bad(`Lỗi hệ thống: ${String(err?.message || err).slice(0, 200)}`, 500), 500)
})

export function createBindings(environment: Record<string, string | undefined>): Bindings {
  const databaseUrl = environment.DATABASE_URL || environment.POSTGRES_URL || environment.NEON_DATABASE_URL
  return {
    DB: createDatabase(databaseUrl),
    DATABASE_URL: databaseUrl,
    BLOB_READ_WRITE_TOKEN: environment.BLOB_READ_WRITE_TOKEN,
    OPENAI_API_KEY: environment.OPENAI_API_KEY,
    OPENAI_BASE_URL: environment.OPENAI_BASE_URL,
    GEMINI_API_KEY: environment.GEMINI_API_KEY || environment.GOOGLE_API_KEY,
    EXPLABS_API_KEY: environment.EXPLABS_API_KEY,
    EXPLABS_BASE_URL: environment.EXPLABS_BASE_URL,
    EXPLABS_MODEL: environment.EXPLABS_MODEL,
    KIRA_API_KEY: environment.KIRA_API_KEY,
    KIRA_BASE_URL: environment.KIRA_BASE_URL,
    KIRA_MODEL: environment.KIRA_MODEL,
  }
}

export default app
