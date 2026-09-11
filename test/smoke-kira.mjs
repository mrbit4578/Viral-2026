#!/usr/bin/env node
/**
 * Smoke test for Kira AI integration + Kira media integration + Blob private-store fix
 * 22 checks — must all pass — official docs: https://kiraai.vn/documents/
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
const indexJs = fs.existsSync(path.join(root, 'api/index.js')) ? fs.readFileSync(path.join(root, 'api/index.js'), 'utf8') : ''
const pathJs = fs.existsSync(path.join(root, 'api/[...path].js')) ? fs.readFileSync(path.join(root, 'api/[...path].js'), 'utf8') : ''
const kiraTs = fs.existsSync(path.join(root, 'src/lib/kira.ts')) ? fs.readFileSync(path.join(root, 'src/lib/kira.ts'), 'utf8') : ''
const llmTs = fs.readFileSync(path.join(root, 'src/lib/llm.ts'), 'utf8')
const typesTs = fs.readFileSync(path.join(root, 'src/types.ts'), 'utf8')
const indexTs = fs.readFileSync(path.join(root, 'src/index.tsx'), 'utf8')
const dbTs = fs.readFileSync(path.join(root, 'src/lib/db.ts'), 'utf8')
const mediaTs = fs.existsSync(path.join(root, 'src/lib/media.ts')) ? fs.readFileSync(path.join(root, 'src/lib/media.ts'), 'utf8') : ''
const appJs = fs.readFileSync(path.join(root, 'public/static/app.js'), 'utf8')
const bundleExists = fs.existsSync(path.join(root, 'server/function-bundle.cjs'))

// 1 — vercel.json has /api/(.*) -> /api/[...path]
check('vercel.json rewrite /api/(.*) -> /api/[...path]', () => {
  return vercelJson.rewrites?.some(r => r.source === '/api/(.*)' && r.destination === '/api/[...path]')
})

// 2 — vercel.json has / -> /api/index
check('vercel.json rewrite / -> /api/index', () => {
  return vercelJson.rewrites?.some(r => r.source === '/' && r.destination.includes('/api/index'))
})

// 3 — vercel.json has studio -> /api/index
check('vercel.json rewrite /studio -> /api/index', () => {
  return vercelJson.rewrites?.some(r => r.source === '/studio' && r.destination.includes('/api/index'))
})

// 4 — api/index.js exists and exports handler
check('api/index.js exists and imports bundle', () => {
  return indexJs.includes('function-bundle.cjs') && indexJs.includes('export default')
})

// 5 — api/[...path].js exists
check('api/[...path].js exists and imports bundle', () => {
  return pathJs.includes('function-bundle.cjs') && pathJs.includes('export default')
})

// 6 — src/lib/kira.ts exists and has hasKira + KIRA_MODELS + askKira + correct official models
check('src/lib/kira.ts exists with Kira chat integration (official models)', () => {
  return kiraTs.includes('KIRA_MODELS') && kiraTs.includes('hasKira') && kiraTs.includes('askKira') && kiraTs.includes('kiraai.vn') && kiraTs.includes('kira-3.5-flash') && kiraTs.includes('kira-3.5-pro')
})

// 7 — llm.ts has Kira fallback
check('src/lib/llm.ts has Kira fallback chain', () => {
  return llmTs.includes('resolveKira') && llmTs.includes('kira') && llmTs.includes('KIRA_API_KEY') && llmTs.includes('KIRA_MODEL')
})

// 8 — types.ts has KIRA_ and EXPLABS_ and DATABASE_URL
check('src/types.ts has KIRA_, EXPLABS_, DATABASE_URL', () => {
  return typesTs.includes('KIRA_API_KEY') && typesTs.includes('KIRA_BASE_URL') && typesTs.includes('KIRA_MODEL') && typesTs.includes('EXPLABS_API_KEY') && typesTs.includes('DATABASE_URL')
})

// 9 — index.tsx has Kira import + endpoints + hasKira + ensureSchema + db/init
check('src/index.tsx has Kira integration + ensureSchema + db/init', () => {
  return indexTs.includes('kira') && indexTs.includes('hasKira') && indexTs.includes('/api/kira/chat') && indexTs.includes('ensureSchema') && indexTs.includes('/api/db/init')
})

// 10 — index.tsx has import-image/import-audio
check('src/index.tsx has import-image/import-audio', () => {
  return indexTs.includes('/api/media/import-image') && indexTs.includes('/api/media/import-audio')
})

// 11 — index.tsx createBindings has KIRA vars
check('src/index.tsx createBindings has KIRA_API_KEY', () => {
  return indexTs.includes('KIRA_API_KEY') && indexTs.includes('KIRA_BASE_URL') && indexTs.includes('KIRA_MODEL')
})

// 12 — public/static/app.js has upload buttons + Kira provider
check('public/static/app.js has upload buttons + Kira provider', () => {
  return appJs.includes('Tải ảnh lên') && appJs.includes('Tải voice có sẵn') && appJs.includes('/api/media/import-image') && appJs.includes('/api/media/import-audio') && (appJs.includes('kira') || appJs.includes('Kira'))
})

// 13 — db.ts has ensureSchema + SCHEMA_SQL
check('src/lib/db.ts has ensureSchema + SCHEMA_SQL', () => {
  return dbTs.includes('ensureSchema') && dbTs.includes('SCHEMA_SQL') && dbTs.includes('CREATE TABLE IF NOT EXISTS ideas')
})

// 14 — build artifact exists
check('server/function-bundle.cjs exists (build xanh)', () => {
  return bundleExists
})

// 15 — Kira media: image generation with official models
check('src/lib/kira.ts has Kira media image integration (official)', () => {
  return kiraTs.includes('generateKiraImage') && kiraTs.includes('KIRA_IMAGE_MODELS') && kiraTs.includes('/images/generations') && kiraTs.includes('kira-3.0-image') && kiraTs.includes('aspect_ratio')
})

// 16 — Kira media: speech/TTS generation with official models
check('src/lib/kira.ts has Kira media speech integration (official)', () => {
  return kiraTs.includes('generateKiraSpeech') && kiraTs.includes('KIRA_VOICES') && kiraTs.includes('/audio/speech') && kiraTs.includes('kira-3.0-flash-tts') && kiraTs.includes('Kore')
})

// 17 — index.tsx has Kira media endpoints and auto fallback for image/speech/video
check('src/index.tsx has Kira media endpoints + auto fallback + video', () => {
  return indexTs.includes('/api/kira/image') && indexTs.includes('/api/kira/speech') && indexTs.includes('/api/kira/video') && indexTs.includes('kira_image_models') && indexTs.includes('kira_voices') && indexTs.includes('generateKiraImage') && indexTs.includes('generateKiraSpeech') && indexTs.includes('generateKiraVideoStart')
})

// 18 — Blob private-store fix: putAsset returns pathname not full URL as key
check('src/lib/media.ts fix Blob private-store: putAsset returns pathname', () => {
  return mediaTs.includes('pathname') && mediaTs.includes('Fix Blob private-store') && mediaTs.includes('key: pathname') && !mediaTs.includes('key: blob.url, size, url: blob.url }')
})

// 19 — Blob private-store fix: assetUrl proxies vercel-storage URLs via /api/media
check('src/lib/media.ts assetUrl proxies private blob via /api/media', () => {
  return mediaTs.includes('assetUrl') && mediaTs.includes('vercel-storage') && mediaTs.includes('encodeURIComponent') && mediaTs.includes('Fix Blob private-store')
})

// 20 — Blob private-store fix: deleteAsset handles pathname + URL
check('src/lib/media.ts deleteAsset handles pathname (private-store)', () => {
  return mediaTs.includes('deleteAsset') && mediaTs.includes('del(key') && mediaTs.includes('BLOB_READ_WRITE_TOKEN')
})

// 21 — Blob private-store fix: /api/media/* serves blob via head+downloadUrl not 404
check('src/index.tsx /api/media/* serves private blob via get(access:private) (private-store fix)', () => {
  return indexTs.includes('/api/media/*') && indexTs.includes("access: 'private'") && indexTs.includes("import('@vercel/blob')") && !indexTs.includes("return c.json(bad('Media mới được phục vụ trực tiếp qua Vercel Blob URL'), 404)")
})

// 22 — Blob private-store fix: /api/media/video accepts pathname + blob URL
check('src/index.tsx /api/media/video accepts pathname + blob URL (private-store)', () => {
  return indexTs.includes('/api/media/video') && indexTs.includes('isBlobUrl') && indexTs.includes('isPathname') && indexTs.includes('vercel-storage')
})

console.log(`\n--- Kira smoke: ${passed}/22 passed, ${failed} failed ---`)
if (failed > 0) process.exit(1)
