#!/usr/bin/env node
/**
 * Runtime smoke — 18 checks for full app runtime readiness
 * Includes Blob private-store fix + Kira media + core endpoints
 */
import fs from 'fs'
import path from 'path'

const root = path.resolve(import.meta.dirname ? path.join(import.meta.dirname, '..') : '.')
let passed = 0
let failed = 0

function check(name, fn) {
  try {
    const ok = fn()
    if (ok) {
      console.log(`✅ ${name}`)
      passed++
    } else {
      console.log(`❌ ${name} — returned falsy`)
      failed++
    }
  } catch (e) {
    console.log(`❌ ${name} — ${e.message}`)
    failed++
  }
}

const vercelJson = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'))
const indexTs = fs.readFileSync(path.join(root, 'src/index.tsx'), 'utf8')
const mediaTs = fs.existsSync(path.join(root, 'src/lib/media.ts')) ? fs.readFileSync(path.join(root, 'src/lib/media.ts'), 'utf8') : ''
const kiraTs = fs.existsSync(path.join(root, 'src/lib/kira.ts')) ? fs.readFileSync(path.join(root, 'src/lib/kira.ts'), 'utf8') : ''
const dbTs = fs.readFileSync(path.join(root, 'src/lib/db.ts'), 'utf8')
const llmTs = fs.readFileSync(path.join(root, 'src/lib/llm.ts'), 'utf8')
const bundleExists = fs.existsSync(path.join(root, 'server/function-bundle.cjs'))
const appJs = fs.readFileSync(path.join(root, 'public/static/app.js'), 'utf8')

// 1 — vercel rewrites exist
check('vercel.json has api rewrite + SPA fallback', () => {
  return vercelJson.rewrites?.some(r => r.source === '/api/(.*)') && vercelJson.rewrites?.some(r => r.source === '/' && r.destination.includes('/api/index'))
})

// 2 — health endpoint
check('src/index.tsx has /api/health with db+blob+kira+gemini', () => {
  return indexTs.includes('/api/health') && indexTs.includes('BLOB_READ_WRITE_TOKEN') && indexTs.includes('hasKira') && indexTs.includes('hasGemini')
})

// 3 — db init endpoint
check('src/index.tsx has /api/db/init + ensureSchema', () => {
  return indexTs.includes('/api/db/init') && indexTs.includes('ensureSchema')
})

// 4 — config endpoint has kira + gemini + veo
check('src/index.tsx /api/config has kira_models + gemini + veo', () => {
  return indexTs.includes('kira_models') && indexTs.includes('kira_image_models') && indexTs.includes('kira_tts_models') && indexTs.includes('kira_video_models') && indexTs.includes('gemini') && indexTs.includes('veo_models')
})

// 5 — blob upload endpoint
check('src/index.tsx has /api/blob/upload with handleUpload', () => {
  return indexTs.includes('/api/blob/upload') && indexTs.includes('handleUpload') && indexTs.includes('BLOB_READ_WRITE_TOKEN')
})

// 6 — media image auto fallback chain
check('src/index.tsx /api/media/image auto Gemini->Kira->Pollinations', () => {
  return indexTs.includes('/api/media/image') && indexTs.includes('provider') && indexTs.includes('generateKiraImage') && indexTs.includes('generateImageBytes') && indexTs.includes('generateGeminiImage')
})

// 7 — media speech auto Kira->Google
check('src/index.tsx /api/media/speech auto Kira->Google', () => {
  return indexTs.includes('/api/media/speech') && indexTs.includes('generateKiraSpeech') && indexTs.includes('generateSpeech')
})

// 8 — media video endpoint with private-store fix
check('src/index.tsx /api/media/video/:blueprintId with private-store fix', () => {
  return indexTs.includes('/api/media/video/:blueprintId') && indexTs.includes('isBlobUrl') && indexTs.includes('isPathname')
})

// 9 — media ai-video Veo
check('src/index.tsx has /api/media/ai-video + /ai-video/status', () => {
  return indexTs.includes('/api/media/ai-video') && indexTs.includes('/api/media/ai-video/status') && indexTs.includes('startVeoOperation') && indexTs.includes('getVeoOperationStatus')
})

// 10 — media proxy endpoint fixed (not 404)
check('src/index.tsx /api/media/* proxies private blob via get(access:private)', () => {
  return indexTs.includes('/api/media/*') && indexTs.includes("access: 'private'") && indexTs.includes("import('@vercel/blob')")
})

// 11 — kira endpoints complete
check('src/index.tsx has /api/kira/chat + /image + /speech + /video + /status + /models', () => {
  return indexTs.includes('/api/kira/chat') && indexTs.includes('/api/kira/image') && indexTs.includes('/api/kira/speech') && indexTs.includes('/api/kira/video') && indexTs.includes('/api/kira/video/status') && indexTs.includes('/api/kira/models')
})

// 12 — media.ts putAssetSmart + assetUrl + deleteAsset private-store
check('src/lib/media.ts has putAssetSmart + assetUrl private-store + deleteAsset', () => {
  return mediaTs.includes('putAssetSmart') && mediaTs.includes('assetUrl') && mediaTs.includes('deleteAsset') && mediaTs.includes('Fix Blob private-store')
})

// 13 — media.ts image + speech generation
check('src/lib/media.ts has generateImageBytes + generateSpeech + fallback', () => {
  return mediaTs.includes('generateImageBytes') && mediaTs.includes('generateSpeech') && mediaTs.includes('fallbackImageSVG') && mediaTs.includes('fallbackToneWav')
})

// 14 — kira.ts official models + video polling
check('src/lib/kira.ts has official models + video polling (generateKiraVideoStart)', () => {
  return kiraTs.includes('kira-3.5-flash') && kiraTs.includes('kira-3.0-image') && kiraTs.includes('kira-3.0-flash-tts') && kiraTs.includes('kira-3.0-video') && kiraTs.includes('generateKiraVideoStart') && kiraTs.includes('getKiraVideoOperationStatus')
})

// 15 — db.ts ensureSchema + SCHEMA_SQL
check('src/lib/db.ts has ensureSchema + SCHEMA_SQL + tables', () => {
  return dbTs.includes('ensureSchema') && dbTs.includes('SCHEMA_SQL') && dbTs.includes('CREATE TABLE IF NOT EXISTS blueprints')
})

// 16 — llm.ts fallback chain includes Kira official
check('src/lib/llm.ts has Kira official default + fallback chain', () => {
  return llmTs.includes('kira-3.5-flash') && llmTs.includes('KIRA_API_KEY') && llmTs.includes('resolveKira')
})

// 17 — build artifact exists
check('server/function-bundle.cjs exists (build xanh)', () => {
  return bundleExists
})

// 18 — app.js has Kira UI + upload + video
check('public/static/app.js has Kira media UI + upload buttons + video', () => {
  return appJs.includes('Kira') && appJs.includes('Tải ảnh lên') && appJs.includes('kira-video') && appJs.includes('/api/kira/video')
})

console.log(`\n--- Runtime smoke: ${passed}/18 passed, ${failed} failed ---`)
if (failed > 0) process.exit(1)
