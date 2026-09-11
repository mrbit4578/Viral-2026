#!/usr/bin/env node
/**
 * Smoke test for Kira AI integration + Kira media integration + previous fixes
 * 17 checks — must all pass
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

// 6 — src/lib/kira.ts exists and has hasKira + KIRA_MODELS + askKira
check('src/lib/kira.ts exists with Kira chat integration', () => {
  return kiraTs.includes('KIRA_MODELS') && kiraTs.includes('hasKira') && kiraTs.includes('askKira') && kiraTs.includes('kiraai.vn')
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

// 12 — public/static/app.js has upload buttons
check('public/static/app.js has upload buttons', () => {
  return appJs.includes('Tải ảnh lên') && appJs.includes('Tải voice có sẵn') && appJs.includes('/api/media/import-image') && appJs.includes('/api/media/import-audio')
})

// 13 — db.ts has ensureSchema + SCHEMA_SQL
check('src/lib/db.ts has ensureSchema + SCHEMA_SQL', () => {
  return dbTs.includes('ensureSchema') && dbTs.includes('SCHEMA_SQL') && dbTs.includes('CREATE TABLE IF NOT EXISTS ideas')
})

// 14 — build artifact exists
check('server/function-bundle.cjs exists (build xanh)', () => {
  return bundleExists
})

// 15 — Kira media: image generation
check('src/lib/kira.ts has Kira media image integration', () => {
  return kiraTs.includes('generateKiraImage') && kiraTs.includes('KIRA_IMAGE_MODELS') && kiraTs.includes('/images/generations') && kiraTs.includes('kira-image')
})

// 16 — Kira media: speech/TTS generation
check('src/lib/kira.ts has Kira media speech integration', () => {
  return kiraTs.includes('generateKiraSpeech') && kiraTs.includes('KIRA_VOICES') && kiraTs.includes('/audio/speech') && kiraTs.includes('kira-female-1')
})

// 17 — index.tsx has Kira media endpoints and auto fallback for image/speech
check('src/index.tsx has Kira media endpoints + auto fallback', () => {
  return indexTs.includes('/api/kira/image') && indexTs.includes('/api/kira/speech') && indexTs.includes('kira_image_models') && indexTs.includes('kira_voices') && indexTs.includes('generateKiraImage') && indexTs.includes('generateKiraSpeech')
})

console.log(`\n--- Kira smoke: ${passed}/17 passed, ${failed} failed ---`)
if (failed > 0) process.exit(1)
