/**
 * Faceless Studio — 5 tính năng gốc chạy WebAssembly trong browser.
 *  01 STT      : Whisper (transformers.js + ONNX Runtime Web) → SRT
 *  02 Dịch SRT : LLM theo lô 25 dòng (server) — giữ nguyên timing
 *  03 Video Dub: ffmpeg.wasm tách audio → Whisper → dịch → TTS → trộn → ghép
 *  04 Băm      : ffmpeg.wasm segment -c copy
 *  05 RAG      : pdf.js/docx đọc trong browser → TF-IDF trên D1 → LLM có citation
 */

/* ============================================================ tiện ích chung */

const $ = (id) => document.getElementById(id)
const qs = (sel, root = document) => root.querySelector(sel)
const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel))

let toastTimer
function toast(msg, kind = 'ok') {
  const el = $('toast')
  if (!el) return
  el.textContent = msg
  el.className = `toast show ${kind}`
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (el.className = 'toast'), 4200)
}

function fmtBytes(n) {
  if (!n) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), u.length - 1)
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`
}

function fmtDur(s) {
  s = Math.max(0, Math.round(s || 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = s % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${m}:${String(ss).padStart(2, '0')}`
}

function escapeHTML(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (m) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m],
  )
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
  })
  let data = null
  try {
    data = await res.json()
  } catch {
    /* ignore */
  }
  if (!res.ok) throw new Error((data && data.error) || `HTTP ${res.status}`)
  return data
}

/** Thanh tiến độ dùng chung cho mọi tab */
function makeProgress(prefix) {
  const job = $(`${prefix}-job`)
  const msg = $(`${prefix}-msg`)
  const pct = $(`${prefix}-pct`)
  const bar = $(`${prefix}-bar`)
  return {
    show() {
      job?.classList.remove('hidden', 'error')
    },
    set(p, text) {
      job?.classList.remove('hidden', 'error')
      const v = Math.max(0, Math.min(100, Math.round(p)))
      if (pct) pct.textContent = `${v}%`
      if (bar) bar.style.width = `${v}%`
      if (text && msg) msg.textContent = text
    },
    error(text) {
      job?.classList.add('error')
      if (msg) msg.textContent = text
      if (pct) pct.textContent = 'Lỗi'
    },
    done(text = 'Hoàn tất') {
      this.set(100, text)
    },
    hide() {
      job?.classList.add('hidden')
    },
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

/* ============================================================ SRT helper (client) */

function srtTimestamp(seconds) {
  const s = Math.max(0, seconds)
  const p = (n, w = 2) => String(n).padStart(w, '0')
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(Math.floor(s % 60))},${p(
    Math.round((s - Math.floor(s)) * 1000),
    3,
  )}`
}

function composeSRT(cues) {
  return cues
    .map((c, i) => `${i + 1}\n${srtTimestamp(c.start)} --> ${srtTimestamp(Math.max(c.end, c.start + 0.2))}\n${(c.text || '').trim()}\n`)
    .join('\n')
}

function parseTimestamp(raw) {
  const m = String(raw).trim().match(/(\d+):(\d{1,2}):(\d{1,2})[,.](\d{1,3})/)
  if (!m) return 0
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, '0')) / 1000
}

function parseSRT(content) {
  const text = String(content || '').replace(/\r\n/g, '\n').replace(/^\uFEFF/, '').trim()
  if (!text) return []
  const cues = []
  for (const block of text.split(/\n{2,}/)) {
    const lines = block.split('\n').filter((l) => l.trim())
    if (!lines.length) continue
    let cursor = /^\d+$/.test(lines[0].trim()) ? 1 : 0
    const timeLine = lines[cursor]
    if (!timeLine || !timeLine.includes('-->')) continue
    const [a, b] = timeLine.split('-->')
    const body = lines.slice(cursor + 1).join('\n').trim()
    if (!body) continue
    cues.push({ start: parseTimestamp(a), end: parseTimestamp(b || a), text: body })
  }
  return cues
}

/* ============================================================ ffmpeg.wasm */

// Worker của @ffmpeg/ffmpeg được tạo dạng *module worker* → không có importScripts,
// nên nó luôn rơi vào nhánh `await import(coreURL)`. Vì vậy coreURL PHẢI là bản ESM
// (có `export default createFFmpegCore`), bản UMD sẽ báo "failed to import ffmpeg-core.js".
const FF_CORE = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm'
const FF_DIST = 'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/umd'
let ffmpegInstance = null
let ffmpegLoading = null

function setWasmStatus(text, state = '') {
  const t = $('wasm-text')
  const s = $('wasm-status')
  if (t) t.textContent = text
  if (s) s.dataset.state = state
}

async function getFFmpeg(onProgress) {
  if (ffmpegInstance) return ffmpegInstance
  if (ffmpegLoading) return ffmpegLoading

  ffmpegLoading = (async () => {
    if (!window.FFmpegWASM || !window.FFmpegUtil) {
      throw new Error('Không tải được ffmpeg.wasm từ CDN — kiểm tra kết nối mạng rồi thử lại')
    }
    setWasmStatus('WASM: đang tải ffmpeg…', 'loading')
    onProgress?.('Đang tải ffmpeg.wasm (~32MB, chỉ lần đầu)…')

    const { FFmpeg } = window.FFmpegWASM
    const { toBlobURL } = window.FFmpegUtil
    const ff = new FFmpeg()

    ff.on('log', ({ message }) => {
      if (/error|invalid|failed/i.test(message)) console.warn('[ffmpeg]', message)
    })

    // Worker của @ffmpeg/ffmpeg nằm trên CDN → browser chặn cross-origin Worker.
    // Phải chuyển cả classWorkerURL sang blob URL cùng origin.
    const [coreURL, wasmURL, classWorkerURL] = await Promise.all([
      toBlobURL(`${FF_CORE}/ffmpeg-core.js`, 'text/javascript'),
      toBlobURL(`${FF_CORE}/ffmpeg-core.wasm`, 'application/wasm'),
      toBlobURL(`${FF_DIST}/814.ffmpeg.js`, 'text/javascript'),
    ])
    await ff.load({ coreURL, wasmURL, classWorkerURL })

    ffmpegInstance = ff
    setWasmStatus('WASM: ffmpeg đã sẵn sàng', 'ready')
    return ff
  })().catch((e) => {
    ffmpegLoading = null
    setWasmStatus('WASM: lỗi tải ffmpeg', 'error')
    throw e
  })

  return ffmpegLoading
}

/** Chạy ffmpeg với file input, trả về Uint8Array của file output */
async function ffRun(file, args, inName, outName, onProgress) {
  const ff = await getFFmpeg(onProgress)
  const { fetchFile } = window.FFmpegUtil
  await ff.writeFile(inName, file instanceof Uint8Array ? file : await fetchFile(file))
  const fullArgs = ['-i', inName, ...args, outName]
  await ff.exec(fullArgs)
  const data = await ff.readFile(outName)
  await ff.deleteFile(inName).catch(() => {})
  await ff.deleteFile(outName).catch(() => {})
  return data instanceof Uint8Array ? data : new Uint8Array(data)
}

/** Đọc thời lượng + có video stream không, bằng cách decode nhẹ */
async function probeMedia(file) {
  const info = { duration: 0, hasVideo: false, width: 0, height: 0 }
  const isVideo = (file.type || '').startsWith('video') || /\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(file.name)
  const el = document.createElement(isVideo ? 'video' : 'audio')
  el.preload = 'metadata'
  const url = URL.createObjectURL(file)
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), 20000)
      el.onloadedmetadata = () => {
        clearTimeout(timer)
        resolve()
      }
      el.onerror = () => {
        clearTimeout(timer)
        reject(new Error('Không đọc được metadata của file'))
      }
      el.src = url
    })
    info.duration = Number.isFinite(el.duration) ? el.duration : 0
    if (isVideo) {
      info.width = el.videoWidth || 0
      info.height = el.videoHeight || 0
      info.hasVideo = info.width > 0
    }
  } catch {
    /* để ffmpeg tự xử lý */
  } finally {
    URL.revokeObjectURL(url)
  }
  return info
}

/* ============================================================ Whisper WASM */

let transformersMod = null
const whisperPipes = new Map()

async function getTransformers(onProgress) {
  if (transformersMod) return transformersMod
  onProgress?.('Đang tải thư viện Whisper (transformers.js)…')
  const mod = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.2/dist/transformers.min.js')
  mod.env.allowLocalModels = false
  // transformers.js 3.5.2 pin onnxruntime-web 1.22.0-dev và tự bundle file wasm khớp
  // phiên bản trong dist/. Trỏ sang bản onnxruntime-web release khác sẽ gây lỗi
  // "_OrtGetInputOutputMetadata is not a function" (ABI lệch) → dùng dist của chính nó.
  mod.env.backends.onnx.wasm.wasmPaths =
    'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.2/dist/'
  mod.env.backends.onnx.wasm.numThreads = 1
  transformersMod = mod
  return mod
}

async function getWhisper(modelId, onProgress) {
  if (whisperPipes.has(modelId)) return whisperPipes.get(modelId)
  const { pipeline } = await getTransformers(onProgress)
  setWasmStatus('WASM: đang tải model Whisper…', 'loading')
  const pipe = await pipeline('automatic-speech-recognition', modelId, {
    dtype: 'q8',
    device: 'wasm',
    progress_callback: (p) => {
      if (p && p.status === 'progress' && p.total) {
        const pct = Math.round((p.loaded / p.total) * 100)
        onProgress?.(`Đang tải model ${modelId.split('/').pop()}: ${pct}%`)
      }
    },
  })
  whisperPipes.set(modelId, pipe)
  setWasmStatus('WASM: Whisper đã sẵn sàng', 'ready')
  return pipe
}

/** Tách audio 16k mono WAV bằng ffmpeg.wasm rồi decode thành Float32Array */
async function extractAudio16k(file, onProgress) {
  onProgress?.('Đang tách audio 16kHz mono (ffmpeg.wasm)…')
  const inName = `in_${Date.now()}.${(file.name.split('.').pop() || 'bin').slice(0, 5)}`
  const wav = await ffRun(
    file,
    ['-vn', '-ac', '1', '-ar', '16000', '-f', 'wav', '-acodec', 'pcm_s16le'],
    inName,
    'out16k.wav',
    onProgress,
  )
  const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 })
  const buf = await ctx.decodeAudioData(wav.buffer.slice(0))
  const pcm = buf.getChannelData(0)
  const copy = new Float32Array(pcm.length)
  copy.set(pcm)
  await ctx.close()
  return { pcm: copy, duration: buf.duration, wav }
}

/** Chạy Whisper → mảng segment {start, end, text} */
async function transcribeWASM(pcm, { model, language, onProgress, signal }) {
  const pipe = await getWhisper(model, onProgress)
  onProgress?.('Đang nhận diện giọng nói (Whisper WASM)…')

  const opts = {
    chunk_length_s: 30,
    stride_length_s: 5,
    return_timestamps: true,
  }
  if (language && language !== 'auto') opts.language = language
  if (signal?.aborted) throw new Error('Đã dừng')

  const out = await pipe(pcm, opts)
  const chunks = (out && out.chunks) || []
  let segments = chunks
    .filter((c) => (c.text || '').trim())
    .map((c) => ({
      start: Number(c.timestamp?.[0]) || 0,
      end: Number(c.timestamp?.[1]) || 0,
      text: String(c.text || '').trim(),
    }))

  // Whisper đôi khi để end = null ở chunk cuối
  for (let i = 0; i < segments.length; i++) {
    if (!segments[i].end || segments[i].end <= segments[i].start) {
      segments[i].end = i + 1 < segments.length ? segments[i + 1].start : segments[i].start + 3
    }
  }
  if (!segments.length) {
    const text = String(out?.text || '').trim()
    if (!text) throw new Error('Không nhận diện được giọng nói trong file')
    segments = [{ start: 0, end: 5, text }]
  }
  return segments
}

/* ============================================================ trạng thái chung */

const state = {
  langs: [],
  voices: [],
  models: [],
  defaultModel: '',
  files: { stt: null, dub: null, bam: null },
  sttSegments: [],
  docs: [],
  aborts: {},
}

async function bootstrap() {
  try {
    const [cfg, langs] = await Promise.all([api('/api/config'), api('/api/studio/langs')])
    state.models = cfg.text_models || []
    state.defaultModel = cfg.default_model || (state.models[0] && state.models[0].key) || ''
    state.langs = langs.langs || []
    state.voices = langs.voices || []
  } catch (e) {
    console.error('bootstrap', e)
    toast('Không tải được cấu hình — một số tuỳ chọn có thể trống', 'warn')
  }

  // model selects
  const modelHTML = state.models
    .map((m) => `<option value="${escapeHTML(m.key)}"${m.key === state.defaultModel ? ' selected' : ''}>${escapeHTML(m.label || m.key)}</option>`)
    .join('')
  ;['srt-model', 'dub-model', 'rag-model', 'rag-script-model'].forEach((id) => {
    const el = $(id)
    if (el) el.innerHTML = modelHTML || '<option value="">(chưa cấu hình AI)</option>'
  })

  // language selects
  const langHTML = state.langs
    .map((l) => `<option value="${escapeHTML(l.code)}">${escapeHTML(l.label)}</option>`)
    .join('')
  const sttLang = $('stt-lang')
  if (sttLang) sttLang.innerHTML = `<option value="auto" selected>Tự nhận diện</option>${langHTML}`
  const dubSource = $('dub-source')
  if (dubSource) dubSource.innerHTML = `<option value="auto" selected>Tự nhận diện</option>${langHTML}`
  ;['srt-target', 'dub-target'].forEach((id) => {
    const el = $(id)
    if (el) {
      el.innerHTML = langHTML
      el.value = 'vi'
    }
  })

  // voice select
  const voiceEl = $('dub-voice')
  if (voiceEl) {
    voiceEl.innerHTML = state.voices
      .map((v) => `<option value="${escapeHTML(v.code || v.value)}"${(v.code || v.value) === 'vi' ? ' selected' : ''}>${escapeHTML(v.label || v.name || v.code)}</option>`)
      .join('')
  }

  setWasmStatus('WASM: sẵn sàng tải khi cần', 'idle')
  loadDocs()
  loadHistory()
}

/* ============================================================ điều hướng tab */

function initTabs() {
  qsa('.studio-tab').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab))
  })
  qsa('.sub-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      qsa('.sub-tab').forEach((b) => b.classList.toggle('active', b === btn))
      qsa('.sub-panel').forEach((p) => p.classList.toggle('active', p.id === `sub-${btn.dataset.sub}`))
    })
  })
}

function switchTab(tab) {
  if (!tab) return
  qsa('.studio-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab))
  qsa('.studio-panel').forEach((p) => p.classList.toggle('active', p.id === `panel-${tab}`))
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

/* ============================================================ drop zone */

function initDropZone(zoneId, inputId, onFile, multiple = false) {
  const zone = $(zoneId)
  const input = $(inputId)
  if (!zone || !input) return
  zone.addEventListener('click', () => input.click())
  zone.addEventListener('dragover', (e) => {
    e.preventDefault()
    zone.classList.add('dragging')
  })
  zone.addEventListener('dragleave', () => zone.classList.remove('dragging'))
  zone.addEventListener('drop', (e) => {
    e.preventDefault()
    zone.classList.remove('dragging')
    const files = Array.from(e.dataTransfer?.files || [])
    if (files.length) onFile(multiple ? files : files[0])
  })
  input.addEventListener('change', () => {
    const files = Array.from(input.files || [])
    if (files.length) onFile(multiple ? files : files[0])
    input.value = ''
  })
}

async function showFileInfo(prefix, file) {
  const box = $(`${prefix}-info`)
  if (!box) return null
  box.classList.remove('hidden')
  box.innerHTML = `<b><i class="fas fa-file"></i> ${escapeHTML(file.name)}</b><span class="meta">${fmtBytes(file.size)} · đang đọc thời lượng…</span>`
  const info = await probeMedia(file)
  const bits = [fmtBytes(file.size)]
  if (info.duration) bits.push(`${fmtDur(info.duration)}`)
  if (info.hasVideo) bits.push(`${info.width}×${info.height}`)
  else bits.push('chỉ audio')
  box.innerHTML = `<b><i class="fas fa-file"></i> ${escapeHTML(file.name)}</b><span class="meta">${bits.join(' · ')}</span>`
  return info
}

/* ============================================================ 01 · STT */

function initSTT() {
  initDropZone('stt-drop', 'stt-file', async (file) => {
    state.files.stt = file
    state.files.sttInfo = await showFileInfo('stt', file)
  })

  $('stt-run')?.addEventListener('click', runSTT)
  $('stt-cancel')?.addEventListener('click', () => {
    state.aborts.stt?.abort()
    toast('Đã yêu cầu dừng — sẽ ngắt sau bước hiện tại', 'warn')
  })

  $('stt-to-srt-tab')?.addEventListener('click', () => {
    const srt = $('stt-srt')?.value || ''
    if (!srt.trim()) return toast('Chưa có phụ đề để dịch', 'warn')
    $('srt-input').value = srt
    switchTab('srt')
    toast('Đã chuyển phụ đề sang tab dịch')
  })

  $('stt-to-rag')?.addEventListener('click', async () => {
    const srt = $('stt-srt')?.value || ''
    if (!srt.trim()) return toast('Chưa có phụ đề', 'warn')
    const text = parseSRT(srt).map((c) => c.text.replace(/\n/g, ' ')).join(' ')
    const name = `phu-de-${(state.files.stt?.name || 'video').replace(/\.[^.]+$/, '')}.txt`
    try {
      await api('/api/rag/docs', {
        method: 'POST',
        body: JSON.stringify({ name, text, source: 'stt' }),
      })
      toast('Đã nạp phụ đề vào thư viện RAG')
      switchTab('rag')
      loadDocs()
    } catch (e) {
      toast(e.message, 'error')
    }
  })
}

async function runSTT() {
  const file = state.files.stt
  if (!file) return toast('Hãy chọn file video/audio trước', 'warn')

  const p = makeProgress('stt')
  const runBtn = $('stt-run')
  const cancelBtn = $('stt-cancel')
  const ac = new AbortController()
  state.aborts.stt = ac
  runBtn.disabled = true
  cancelBtn.disabled = false
  $('stt-result')?.classList.add('hidden')

  try {
    p.set(5, 'Đang khởi động ffmpeg.wasm…')
    const { pcm, duration } = await extractAudio16k(file, (m) => p.set(22, m))
    if (ac.signal.aborted) throw new Error('Đã dừng')

    p.set(38, 'Đang chuẩn bị model Whisper…')
    const segments = await transcribeWASM(pcm, {
      model: $('stt-model').value,
      language: $('stt-lang').value,
      onProgress: (m) => p.set(52, m),
      signal: ac.signal,
    })

    p.set(92, 'Đang tạo file SRT…')
    const srt = composeSRT(segments)
    state.sttSegments = segments

    $('stt-srt').value = srt
    $('stt-count').textContent = String(segments.length)
    $('stt-result')?.classList.remove('hidden')
    p.done(`Xong — ${segments.length} câu, ${fmtDur(duration)}`)
    toast(`Đã tạo phụ đề: ${segments.length} câu`)

    saveJob('stt', `${file.name} → ${segments.length} câu phụ đề`, {
      file: file.name,
      duration: Math.round(duration),
      segments: segments.length,
      model: $('stt-model').value,
      srt: srt.slice(0, 15000),
    })
  } catch (e) {
    console.error(e)
    p.error(String(e.message || e).slice(0, 160))
    toast(`Nhận diện thất bại: ${e.message}`, 'error')
  } finally {
    runBtn.disabled = false
    cancelBtn.disabled = true
    state.aborts.stt = null
  }
}

/* ============================================================ 02 · DỊCH SRT */

function initSRT() {
  $('srt-load-file')?.addEventListener('click', () => $('srt-file').click())
  $('srt-file')?.addEventListener('change', async () => {
    const f = $('srt-file').files?.[0]
    if (!f) return
    const text = await f.text()
    $('srt-input').value = text
    const cues = parseSRT(text)
    toast(cues.length ? `Đã nạp ${cues.length} câu phụ đề` : 'File không đúng định dạng SRT', cues.length ? 'ok' : 'warn')
    $('srt-file').value = ''
  })

  $('srt-run')?.addEventListener('click', runTranslateSRT)
  $('srt-to-voice')?.addEventListener('click', srtToVoice)
}

async function runTranslateSRT() {
  const srt = $('srt-input')?.value || ''
  const cues = parseSRT(srt)
  if (!cues.length) return toast('SRT nguồn trống hoặc sai định dạng', 'warn')
  if (cues.length > 400) return toast('Quá 400 câu — hãy chia nhỏ file phụ đề', 'warn')

  const p = makeProgress('srt')
  const btn = $('srt-run')
  btn.disabled = true
  $('srt-meta')?.classList.add('hidden')

  try {
    p.set(15, `Đang dịch ${cues.length} câu theo lô 25 dòng…`)
    const res = await api('/api/studio/srt/translate', {
      method: 'POST',
      body: JSON.stringify({
        srt,
        target_lang: $('srt-target').value,
        model: $('srt-model').value,
      }),
    })
    $('srt-output').value = res.srt
    p.done(`Xong — dịch ${res.translated_lines}/${res.cue_count} câu`)

    const pills = [
      `<span class="stat-pill">${res.cue_count} câu</span>`,
      `<span class="stat-pill">${res.batches} lô</span>`,
      `<span class="stat-pill">Dịch được ${res.translated_lines}</span>`,
    ]
    if (!res.llm) pills.push('<span class="stat-pill warn">Chưa cấu hình AI — giữ nguyên bản gốc</span>')
    else if (res.translated_lines < res.cue_count)
      pills.push(`<span class="stat-pill warn">${res.cue_count - res.translated_lines} câu giữ nguyên</span>`)

    const meta = $('srt-meta')
    meta.innerHTML = `<div class="stat-row">${pills.join('')}</div>`
    meta.classList.remove('hidden')
    toast(`Đã dịch ${res.translated_lines}/${res.cue_count} câu`)

    saveJob('srt-translate', `Dịch ${res.cue_count} câu → ${res.target_lang}`, {
      cue_count: res.cue_count,
      translated: res.translated_lines,
      target: res.target_lang,
      srt: String(res.srt).slice(0, 15000),
    })
  } catch (e) {
    p.error(String(e.message || e).slice(0, 160))
    toast(`Dịch thất bại: ${e.message}`, 'error')
  } finally {
    btn.disabled = false
  }
}

async function srtToVoice() {
  const srt = $('srt-output')?.value || $('srt-input')?.value || ''
  const cues = parseSRT(srt)
  if (!cues.length) return toast('Chưa có phụ đề để đọc', 'warn')
  const text = cues.map((c) => c.text.replace(/\n/g, ' ')).join(' ')
  if (text.length > 12000) return toast('Nội dung quá 12.000 ký tự — hãy chia nhỏ', 'warn')

  const p = makeProgress('srt')
  try {
    p.set(30, 'Đang tạo giọng đọc…')
    const res = await api('/api/media/speech', {
      method: 'POST',
      body: JSON.stringify({ text, voice: $('srt-target').value }),
    })
    p.done(`Xong — ${res.chunks} đoạn, ${fmtBytes(res.size)}`)
    const meta = $('srt-meta')
    meta.innerHTML = `
      <div class="result-head"><h3><i class="fas fa-microphone-lines"></i> Giọng đọc</h3>
        <div class="result-actions"><a class="button micro" href="${res.url}?download=1">Tải MP3</a></div></div>
      <audio class="media-preview" controls src="${res.url}"></audio>`
    meta.classList.remove('hidden')
    toast('Đã tạo giọng đọc từ phụ đề')
  } catch (e) {
    p.error(String(e.message || e).slice(0, 160))
    toast(`Tạo giọng đọc thất bại: ${e.message}`, 'error')
  }
}

/* ============================================================ 03 · VIDEO DUB */

const MAX_DUB_SEGMENTS = 300

function setStage(stage, cls) {
  qsa('.flow-node').forEach((n) => {
    if (n.dataset.stage === stage) {
      n.classList.remove('active', 'done')
      if (cls) n.classList.add(cls)
    }
  })
}

function markStageDone(stage) {
  setStage(stage, 'done')
}

function resetStages() {
  qsa('.flow-node').forEach((n) => n.classList.remove('active', 'done'))
}

function initDub() {
  initDropZone('dub-drop', 'dub-file', async (file) => {
    state.files.dub = file
    state.files.dubInfo = await showFileInfo('dub', file)
  })
  $('dub-run')?.addEventListener('click', runDub)
  $('dub-cancel')?.addEventListener('click', () => {
    state.aborts.dub?.abort()
    toast('Đã yêu cầu dừng', 'warn')
  })
}

/** Tăng tốc audio nếu dài hơn khung phụ đề (port _fit_segment_audio, max 2x) */
async function fitSegmentAudio(ff, name, actualDur, slotSeconds) {
  if (actualDur <= 0 || slotSeconds <= 0.2 || actualDur <= slotSeconds * 1.05) return name
  const ratio = Math.min(actualDur / slotSeconds, 2.0)
  const out = name.replace(/\.mp3$/, '_fit.wav')
  try {
    await ff.exec(['-i', name, '-filter:a', `atempo=${ratio.toFixed(3)}`, '-ar', '44100', '-ac', '2', out])
    return out
  } catch {
    return name
  }
}

/** Trộn timeline (port _mix_timeline): adelay + amix theo lô 20 */
async function mixTimeline(ff, segFiles, totalDuration, outName, onProgress) {
  const MIX_BATCH = 20
  const intermediates = []

  for (let b = 0; b < segFiles.length; b += MIX_BATCH) {
    const batch = segFiles.slice(b, b + MIX_BATCH)
    const args = []
    const filters = []
    batch.forEach(([name, start], i) => {
      args.push('-i', name)
      const delayMs = Math.max(0, Math.round(start * 1000))
      filters.push(`[${i}:a]aresample=44100,adelay=${delayMs}|${delayMs}[a${i}]`)
    })
    const joined = batch.map((_, i) => `[a${i}]`).join('')
    filters.push(`${joined}amix=inputs=${batch.length}:duration=longest:normalize=0[out]`)
    const inter = `mix_${b}.wav`
    await ff.exec([...args, '-filter_complex', filters.join(';'), '-map', '[out]', '-ar', '44100', '-ac', '2', inter])
    intermediates.push(inter)
    onProgress?.(`Đang trộn timeline… (${Math.min(b + MIX_BATCH, segFiles.length)}/${segFiles.length})`)
  }

  // nền im lặng đúng độ dài + amix tất cả
  const dur = Math.max(totalDuration, 0.5).toFixed(2)
  const args = ['-f', 'lavfi', '-t', dur, '-i', 'anullsrc=r=44100:cl=stereo']
  intermediates.forEach((name) => args.push('-i', name))
  const n = intermediates.length + 1
  const joined = Array.from({ length: n }, (_, i) => `[${i}:a]`).join('')
  await ff.exec([
    ...args,
    '-filter_complex',
    `${joined}amix=inputs=${n}:duration=first:normalize=0[out]`,
    '-map', '[out]', '-b:a', '192k', outName,
  ])
  for (const name of intermediates) await ff.deleteFile(name).catch(() => {})
  return outName
}

async function runDub() {
  const file = state.files.dub
  if (!file) return toast('Hãy chọn video cần thuyết minh lại', 'warn')

  const p = makeProgress('dub')
  const runBtn = $('dub-run')
  const cancelBtn = $('dub-cancel')
  const ac = new AbortController()
  state.aborts.dub = ac
  runBtn.disabled = true
  cancelBtn.disabled = false
  resetStages()
  $('dub-result')?.classList.add('hidden')

  const check = () => {
    if (ac.signal.aborted) throw new Error('Đã dừng theo yêu cầu')
  }

  try {
    // --- 1. tách audio
    setStage('extract', 'active')
    p.set(5, 'Đang tách audio từ file…')
    const { pcm, duration, wav } = await extractAudio16k(file, (m) => p.set(10, m))
    const totalDuration = duration || state.files.dubInfo?.duration || 0
    markStageDone('extract')
    check()

    // --- 2. Whisper
    setStage('stt', 'active')
    p.set(14, 'Đang nhận diện giọng nói (Whisper WASM)…')
    const segments = await transcribeWASM(pcm, {
      model: $('dub-whisper').value,
      language: $('dub-source').value,
      onProgress: (m) => p.set(18, m),
      signal: ac.signal,
    })
    if (segments.length > MAX_DUB_SEGMENTS) {
      throw new Error(`Video quá dài (${segments.length} câu) — giới hạn ${MAX_DUB_SEGMENTS} câu`)
    }
    const srtOriginal = composeSRT(segments)
    markStageDone('stt')
    p.set(34, `Đã nhận diện ${segments.length} câu`)
    check()

    // --- 3. dịch
    setStage('translate', 'active')
    p.set(36, 'Đang dịch phụ đề…')
    const tr = await api('/api/studio/srt/translate', {
      method: 'POST',
      body: JSON.stringify({
        segments,
        target_lang: $('dub-target').value,
        model: $('dub-model').value,
      }),
    })
    const translated = tr.segments || []
    const srtTranslated = tr.srt
    markStageDone('translate')
    p.set(55, `Đã dịch ${tr.translated_lines}/${segments.length} câu`)
    check()

    // --- 4. TTS từng câu
    setStage('tts', 'active')
    const voice = $('dub-voice').value || $('dub-target').value
    const ff = await getFFmpeg()
    const segFiles = []
    for (let i = 0; i < translated.length; i++) {
      check()
      const text = String(translated[i].text || '').trim()
      if (!text) continue
      const slot = Number(translated[i].end) - Number(translated[i].start)
      let bytes
      try {
        const res = await fetch('/api/media/speech', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, voice }),
        })
        if (!res.ok) throw new Error('tts failed')
        const data = await res.json()
        const audio = await fetch(data.url)
        bytes = new Uint8Array(await audio.arrayBuffer())
      } catch (e) {
        console.warn('TTS segment', i, 'failed', e)
        continue
      }
      // Đo thời lượng thực TRƯỚC khi writeFile — writeFile transfer buffer sang worker,
      // sau đó bytes.buffer bị detach nên decodeAudioData sẽ luôn thất bại (dur = 0).
      let actualDur = 0
      try {
        const copy = bytes.slice().buffer
        const ctx = new (window.AudioContext || window.webkitAudioContext)()
        const buf = await ctx.decodeAudioData(copy)
        actualDur = buf.duration
        await ctx.close()
      } catch {
        actualDur = 0
      }

      const name = `seg_${String(i).padStart(4, '0')}.mp3`
      await ff.writeFile(name, bytes)
      const fitted = await fitSegmentAudio(ff, name, actualDur, slot)
      segFiles.push([fitted, Number(translated[i].start) || 0])

      if (i % 5 === 0 || i === translated.length - 1) {
        const pct = 55 + Math.round(22 * ((i + 1) / translated.length))
        p.set(pct, `Đang tạo giọng… (${i + 1}/${translated.length} câu)`)
      }
    }
    if (!segFiles.length) throw new Error('Không tạo được đoạn TTS nào')
    markStageDone('tts')
    check()

    // --- 5. trộn timeline
    setStage('mix', 'active')
    p.set(80, 'Đang ghép audio thuyết minh…')
    await mixTimeline(ff, segFiles, totalDuration, 'dubbed.mp3', (m) => p.set(84, m))
    const dubbedData = await ff.readFile('dubbed.mp3')
    const dubbedBytes = dubbedData instanceof Uint8Array ? dubbedData : new Uint8Array(dubbedData)
    // QUAN TRỌNG: ff.writeFile() *transfer* ArrayBuffer sang worker khiến Uint8Array gốc
    // bị detach (byteLength = 0). Vì vậy phải tạo Blob audio NGAY tại đây, trước bước merge.
    const audioBlob = new Blob([dubbedBytes.slice()], { type: 'audio/mpeg' })
    for (const [name] of segFiles) await ff.deleteFile(name).catch(() => {})
    markStageDone('mix')
    check()

    // --- 6. ghép vào video
    let videoBlob = null
    const wantVideo = $('dub-keep-video').checked && state.files.dubInfo?.hasVideo
    if (wantVideo) {
      setStage('merge', 'active')
      p.set(90, 'Đang ghép audio vào video…')
      try {
        const { fetchFile } = window.FFmpegUtil
        const vIn = `vin.${(file.name.split('.').pop() || 'mp4').slice(0, 5)}`
        await ff.writeFile(vIn, await fetchFile(file))
        await ff.writeFile('dubbed_in.mp3', dubbedBytes)
        await ff.exec([
          '-i', vIn, '-i', 'dubbed_in.mp3',
          '-map', '0:v:0', '-map', '1:a:0',
          '-c:v', 'copy', '-c:a', 'aac', '-shortest', 'dubbed.mp4',
        ])
        const vData = await ff.readFile('dubbed.mp4')
        videoBlob = new Blob([vData instanceof Uint8Array ? vData : new Uint8Array(vData)], { type: 'video/mp4' })
        await ff.deleteFile(vIn).catch(() => {})
        await ff.deleteFile('dubbed_in.mp3').catch(() => {})
        await ff.deleteFile('dubbed.mp4').catch(() => {})
        markStageDone('merge')
      } catch (e) {
        console.warn('merge video failed', e)
        toast('Không ghép được vào video (codec không hỗ trợ copy) — vẫn có file audio', 'warn')
      }
    }
    await ff.deleteFile('dubbed.mp3').catch(() => {})

    p.done(`Hoàn tất — ${segFiles.length} câu thuyết minh`)
    renderDubResult({ audioBlob, videoBlob, srtOriginal, srtTranslated, segments: segments.length, file })

    saveJob('video-dub', `${file.name} → ${$('dub-target').value} (${segments.length} câu)`, {
      file: file.name,
      segments: segments.length,
      target: $('dub-target').value,
      srt_original: srtOriginal.slice(0, 8000),
      srt_translated: String(srtTranslated).slice(0, 8000),
    })
    toast('Thuyết minh lại hoàn tất')
  } catch (e) {
    console.error(e)
    p.error(String(e.message || e).slice(0, 180))
    toast(`Video Dub thất bại: ${e.message}`, 'error')
  } finally {
    runBtn.disabled = false
    cancelBtn.disabled = true
    state.aborts.dub = null
  }
}

function renderDubResult({ audioBlob, videoBlob, srtOriginal, srtTranslated, segments, file }) {
  const box = $('dub-result')
  const base = file.name.replace(/\.[^.]+$/, '')
  const audioURL = URL.createObjectURL(audioBlob)
  const videoURL = videoBlob ? URL.createObjectURL(videoBlob) : null

  box.innerHTML = `
    <div class="stat-row">
      <span class="stat-pill">${segments} câu</span>
      <span class="stat-pill">Audio ${fmtBytes(audioBlob.size)}</span>
      ${videoBlob ? `<span class="stat-pill">Video ${fmtBytes(videoBlob.size)}</span>` : '<span class="stat-pill warn">Chỉ có audio</span>'}
    </div>
    ${videoURL ? `<video class="media-preview" controls src="${videoURL}"></video>` : `<audio class="media-preview" controls src="${audioURL}"></audio>`}
    <div class="result-actions" style="margin-bottom:12px">
      <button class="button micro" id="dub-dl-audio">Tải audio MP3</button>
      ${videoBlob ? '<button class="button micro accent" id="dub-dl-video">Tải video MP4</button>' : ''}
      <button class="button micro" id="dub-dl-srt-o">Tải SRT gốc</button>
      <button class="button micro" id="dub-dl-srt-t">Tải SRT đã dịch</button>
      <button class="button micro" id="dub-upload">Lưu lên cloud</button>
    </div>
    <div class="split-2">
      <div><label class="area-label">SRT gốc</label>
        <textarea class="mono-area" rows="9" readonly>${escapeHTML(srtOriginal)}</textarea></div>
      <div><label class="area-label">SRT đã dịch</label>
        <textarea class="mono-area" rows="9" readonly>${escapeHTML(srtTranslated)}</textarea></div>
    </div>`
  box.classList.remove('hidden')

  $('dub-dl-audio').onclick = () => downloadBlob(audioBlob, `${base}-thuyetminh.mp3`)
  if (videoBlob) $('dub-dl-video').onclick = () => downloadBlob(videoBlob, `${base}-thuyetminh.mp4`)
  $('dub-dl-srt-o').onclick = () => downloadBlob(new Blob([srtOriginal], { type: 'text/plain' }), `${base}-goc.srt`)
  $('dub-dl-srt-t').onclick = () => downloadBlob(new Blob([srtTranslated], { type: 'text/plain' }), `${base}-dich.srt`)
  $('dub-upload').onclick = async () => {
    const btn = $('dub-upload')
    btn.disabled = true
    btn.textContent = 'Đang tải lên…'
    try {
      const blob = videoBlob || audioBlob
      const kind = videoBlob ? 'videos' : 'audio'
      const name = videoBlob ? `${base}-thuyetminh.mp4` : `${base}-thuyetminh.mp3`
      const res = await uploadToCloud(blob, kind, name)
      btn.outerHTML = `<a class="button micro accent" href="${res.url}?download=1" target="_blank">Link cloud ↗</a>`
      toast('Đã lưu lên cloud')
    } catch (e) {
      btn.disabled = false
      btn.textContent = 'Lưu lên cloud'
      toast(`Lưu thất bại: ${e.message}`, 'error')
    }
  }
}

async function uploadToCloud(blob, kind, name) {
  const res = await fetch(`/api/studio/upload/${kind}?name=${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { 'Content-Type': blob.type || 'application/octet-stream' },
    body: blob,
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error((data && data.error) || `HTTP ${res.status}`)
  return data
}

/* ============================================================ 04 · BĂM STUDIO */

function initBam() {
  initDropZone('bam-drop', 'bam-file', async (file) => {
    state.files.bam = file
    state.files.bamInfo = await showFileInfo('bam', file)
  })

  $('bam-mode')?.addEventListener('change', () => {
    const isCount = $('bam-mode').value === 'count'
    const label = $('bam-value-label')
    const input = $('bam-value')
    label.childNodes[0].nodeValue = isCount ? 'Số đoạn muốn cắt' : 'Thời lượng mỗi đoạn (giây)'
    input.value = isCount ? '5' : '60'
    input.min = '1'
  })

  $('bam-run')?.addEventListener('click', runBam)
  $('bam-cancel')?.addEventListener('click', () => {
    state.aborts.bam?.abort()
    toast('Đã yêu cầu dừng', 'warn')
  })
}

async function runBam() {
  const file = state.files.bam
  if (!file) return toast('Hãy chọn file cần băm', 'warn')

  const mode = $('bam-mode').value
  const value = Number($('bam-value').value) || (mode === 'count' ? 5 : 60)
  const wantUpload = $('bam-upload').value === 'yes'

  const p = makeProgress('bam')
  const runBtn = $('bam-run')
  const cancelBtn = $('bam-cancel')
  const ac = new AbortController()
  state.aborts.bam = ac
  runBtn.disabled = true
  cancelBtn.disabled = false
  $('bam-result')?.classList.add('hidden')

  try {
    p.set(5, 'Đang đọc thông tin file…')
    const info = state.files.bamInfo || (await probeMedia(file))
    const total = info.duration
    if (!total || total <= 0) throw new Error('Không đọc được thời lượng file')

    // port bam_worker: seg_time
    let segTime
    if (mode === 'count') {
      const count = Math.max(1, Math.floor(value))
      segTime = Math.ceil((total / count) * 100) / 100
    } else {
      segTime = Math.max(1.0, value)
    }
    const expected = Math.max(1, Math.ceil(total / segTime))
    if (expected > 200) throw new Error(`Sẽ tạo ${expected} đoạn — quá nhiều, hãy tăng thời lượng mỗi đoạn`)

    p.set(15, 'Đang khởi động ffmpeg.wasm…')
    const ff = await getFFmpeg((m) => p.set(15, m))
    const { fetchFile } = window.FFmpegUtil

    const isVideo = info.hasVideo
    const ext = isVideo ? 'mp4' : 'mp3'
    const inExt = (file.name.split('.').pop() || 'bin').slice(0, 5)
    const inName = `bam_in.${inExt}`

    p.set(28, 'Đang nạp file vào WASM…')
    await ff.writeFile(inName, await fetchFile(file))
    if (ac.signal.aborted) throw new Error('Đã dừng')

    p.set(38, `Đang cắt thành ~${expected} đoạn (-c copy)…`)
    // ffmpeg.wasm không hỗ trợ tốt output pattern %03d ở mọi build → cắt từng đoạn bằng -ss/-t
    const segments = []
    for (let i = 0; i < expected; i++) {
      if (ac.signal.aborted) throw new Error('Đã dừng')
      const start = i * segTime
      if (start >= total - 0.05) break
      const dur = Math.min(segTime, total - start)
      const outName = `part_${String(i + 1).padStart(3, '0')}.${ext}`
      try {
        await ff.exec([
          '-ss', start.toFixed(3),
          '-i', inName,
          '-t', dur.toFixed(3),
          '-c', 'copy',
          '-avoid_negative_ts', 'make_zero',
          '-reset_timestamps', '1',
          outName,
        ])
      } catch (e) {
        // fallback: re-encode nếu copy không được
        try {
          await ff.exec([
            '-ss', start.toFixed(3), '-i', inName, '-t', dur.toFixed(3),
            ...(isVideo ? ['-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac'] : ['-c:a', 'libmp3lame']),
            outName,
          ])
        } catch (e2) {
          console.warn('segment', i, 'failed', e2)
          continue
        }
      }
      const data = await ff.readFile(outName)
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
      if (bytes.byteLength > 512) {
        segments.push({
          filename: outName,
          blob: new Blob([bytes], { type: isVideo ? 'video/mp4' : 'audio/mpeg' }),
          duration: dur,
          size: bytes.byteLength,
          start,
        })
      }
      await ff.deleteFile(outName).catch(() => {})
      p.set(38 + Math.round(45 * ((i + 1) / expected)), `Đã cắt ${segments.length}/${expected} đoạn…`)
    }
    await ff.deleteFile(inName).catch(() => {})
    if (!segments.length) throw new Error('Không tạo được đoạn nào — thử chế độ khác hoặc file khác')

    // upload nếu chọn
    if (wantUpload) {
      for (let i = 0; i < segments.length; i++) {
        p.set(83 + Math.round(14 * ((i + 1) / segments.length)), `Đang tải lên cloud ${i + 1}/${segments.length}…`)
        try {
          const res = await uploadToCloud(segments[i].blob, 'segments', segments[i].filename)
          segments[i].url = res.url
        } catch (e) {
          console.warn('upload segment failed', e)
        }
      }
    }

    p.done(`Xong — ${segments.length} đoạn, mỗi đoạn ~${segTime.toFixed(2)}s`)
    renderBamResult(segments, { total, segTime, file, isVideo })

    saveJob('bam', `${file.name} → ${segments.length} đoạn (${segTime.toFixed(1)}s/đoạn)`, {
      file: file.name,
      total_duration: Math.round(total),
      segment_time: segTime,
      count: segments.length,
      urls: segments.filter((s) => s.url).map((s) => ({ name: s.filename, url: s.url })),
    })
    toast(`Đã băm thành ${segments.length} đoạn`)
  } catch (e) {
    console.error(e)
    p.error(String(e.message || e).slice(0, 180))
    toast(`Băm thất bại: ${e.message}`, 'error')
  } finally {
    runBtn.disabled = false
    cancelBtn.disabled = true
    state.aborts.bam = null
  }
}

function renderBamResult(segments, { total, segTime, file, isVideo }) {
  const box = $('bam-result')
  const base = file.name.replace(/\.[^.]+$/, '')
  const totalSize = segments.reduce((s, x) => s + x.size, 0)

  box.innerHTML = `
    <div class="stat-row">
      <span class="stat-pill">${segments.length} đoạn</span>
      <span class="stat-pill">${fmtDur(total)} tổng</span>
      <span class="stat-pill">${segTime.toFixed(2)}s / đoạn</span>
      <span class="stat-pill">${fmtBytes(totalSize)}</span>
    </div>
    <div class="result-actions" style="margin-bottom:12px">
      <button class="button micro accent" id="bam-dl-all">Tải tất cả (${segments.length} file)</button>
    </div>
    <div class="seg-list">
      ${segments
        .map(
          (s, i) => `<div class="seg-item">
            <b>${escapeHTML(s.filename)}</b>
            <span class="meta">${fmtDur(s.start)} → ${fmtDur(s.start + s.duration)} · ${fmtBytes(s.size)}</span>
            <div class="row">
              <button class="button micro" data-seg="${i}">Tải về</button>
              ${s.url ? `<a class="button micro accent" href="${s.url}" target="_blank">Xem ↗</a>` : ''}
            </div>
          </div>`,
        )
        .join('')}
    </div>`
  box.classList.remove('hidden')

  box.querySelectorAll('[data-seg]').forEach((btn) => {
    btn.onclick = () => {
      const s = segments[Number(btn.dataset.seg)]
      downloadBlob(s.blob, `${base}-${s.filename}`)
    }
  })
  $('bam-dl-all').onclick = async () => {
    for (const s of segments) {
      downloadBlob(s.blob, `${base}-${s.filename}`)
      await new Promise((r) => setTimeout(r, 350)) // tránh browser chặn
    }
    toast(`Đang tải ${segments.length} file`)
  }
}

/* ============================================================ 05 · RAG */

let pdfjsLib = null

async function getPdfjs() {
  if (pdfjsLib) return pdfjsLib
  const mod = await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.6.82/build/pdf.min.mjs')
  mod.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.6.82/build/pdf.worker.min.mjs'
  pdfjsLib = mod
  return mod
}

/** Đọc text từ file ngay trong browser (pdf.js WASM / unzip docx / plain) */
async function extractDocText(file, onProgress) {
  const ext = (file.name.split('.').pop() || '').toLowerCase()

  if (['txt', 'md', 'markdown', 'srt', 'csv', 'json', 'vtt'].includes(ext)) {
    const raw = await file.text()
    return ext === 'srt' || ext === 'vtt'
      ? parseSRT(raw).map((c) => c.text.replace(/\n/g, ' ')).join(' ') || raw
      : raw
  }

  if (ext === 'pdf') {
    onProgress?.('Đang đọc PDF bằng pdf.js (WASM)…')
    const pdfjs = await getPdfjs()
    const buf = await file.arrayBuffer()
    const pdf = await pdfjs.getDocument({ data: buf }).promise
    const parts = []
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      const content = await page.getTextContent()
      parts.push(content.items.map((it) => it.str).join(' '))
      onProgress?.(`Đang đọc PDF: trang ${i}/${pdf.numPages}`)
    }
    return parts.join('\n\n')
  }

  if (ext === 'docx') {
    onProgress?.('Đang đọc DOCX…')
    const JSZipMod = await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js')
    const JSZip = JSZipMod.default || window.JSZip
    const zip = await JSZip.loadAsync(await file.arrayBuffer())
    const xml = await zip.file('word/document.xml')?.async('string')
    if (!xml) throw new Error('Không đọc được nội dung DOCX')
    return xml
      .replace(/<w:p[^>]*>/g, '\n')
      .replace(/<w:tab[^>]*\/>/g, '\t')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }

  throw new Error(`Định dạng .${ext} chưa hỗ trợ (dùng pdf/docx/txt/md/srt/csv/json)`)
}

function initRag() {
  initDropZone('rag-drop', 'rag-file', (files) => ingestFiles(files), true)
  $('rag-ask')?.addEventListener('click', runRagAsk)
  $('rag-script')?.addEventListener('click', runRagScript)
}

async function ingestFiles(files) {
  const p = makeProgress('rag')
  const list = Array.isArray(files) ? files : [files]

  for (let i = 0; i < list.length; i++) {
    const file = list[i]
    const base = Math.round((i / list.length) * 100)
    try {
      p.set(base + 5, `Đang đọc ${file.name}…`)
      const text = await extractDocText(file, (m) => p.set(base + 20, m))
      if (!text || text.trim().length < 20) throw new Error('Tài liệu trống hoặc không đọc được nội dung')

      p.set(base + 55, `Đang lập chỉ mục ${file.name}…`)
      const res = await api('/api/rag/docs', {
        method: 'POST',
        body: JSON.stringify({ name: file.name, text, source: 'upload' }),
      })
      toast(`Đã nạp ${file.name} — ${res.doc.chunk_count} đoạn`)
    } catch (e) {
      console.error(e)
      toast(`${file.name}: ${e.message}`, 'error')
    }
  }
  p.done(`Đã xử lý ${list.length} tài liệu`)
  setTimeout(() => p.hide(), 2500)
  loadDocs()
}

async function loadDocs() {
  const box = $('rag-docs')
  if (!box) return
  try {
    const res = await api('/api/rag/docs')
    state.docs = res.docs || []
  } catch {
    state.docs = []
  }

  if (!state.docs.length) {
    box.innerHTML = '<div class="empty-line">Chưa có tài liệu — hãy upload để bắt đầu hỏi đáp</div>'
    return
  }
  box.innerHTML = state.docs
    .map(
      (d) => `<div class="doc-item">
        <input type="checkbox" data-doc="${escapeHTML(d.id)}" checked />
        <div class="body">
          <b>${escapeHTML(d.name)}</b>
          <span class="meta">${d.chunk_count} đoạn · ${fmtBytes(d.size)} · ${escapeHTML(String(d.created_at).slice(0, 16).replace('T', ' '))}</span>
        </div>
        <button data-del="${escapeHTML(d.id)}" title="Xoá"><i class="fas fa-trash"></i></button>
      </div>`,
    )
    .join('')

  box.querySelectorAll('[data-del]').forEach((btn) => {
    btn.onclick = async () => {
      if (!confirm('Xoá tài liệu này khỏi chỉ mục?')) return
      try {
        await api(`/api/rag/docs/${btn.dataset.del}`, { method: 'DELETE' })
        toast('Đã xoá tài liệu')
        loadDocs()
      } catch (e) {
        toast(e.message, 'error')
      }
    }
  })
}

function selectedDocIds() {
  return qsa('[data-doc]', $('rag-docs') || document)
    .filter((el) => el.checked)
    .map((el) => el.dataset.doc)
}

function renderCitedAnswer(text) {
  return escapeHTML(text).replace(/\[(C\d+)\]/g, '<span class="cite">$1</span>')
}

async function runRagAsk() {
  const question = ($('rag-question')?.value || '').trim()
  if (question.length < 3) return toast('Hãy nhập câu hỏi', 'warn')
  if (!state.docs.length) return toast('Chưa có tài liệu nào — hãy upload trước', 'warn')

  const btn = $('rag-ask')
  const box = $('rag-answer')
  btn.disabled = true
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Đang tìm trong tài liệu…'

  try {
    const res = await api('/api/rag/ask', {
      method: 'POST',
      body: JSON.stringify({
        question,
        doc_ids: selectedDocIds(),
        top_k: Number($('rag-topk').value) || 5,
        model: $('rag-model').value,
      }),
    })
    box.innerHTML = `
      <div class="result-head">
        <h3><i class="fas fa-lightbulb"></i> Trả lời</h3>
        <div class="result-actions">
          <button class="button micro" id="rag-copy-answer">Copy</button>
          ${res.citations.length ? '<button class="button micro accent" id="rag-answer-to-voice">Đọc thành audio</button>' : ''}
        </div>
      </div>
      <div class="answer-text">${renderCitedAnswer(res.answer)}</div>
      ${
        res.citations.length
          ? `<h3 style="font-size:13px;margin:0 0 8px;color:var(--muted)">Nguồn trích dẫn</h3>
             <div class="citation-list">${res.citations
               .map(
                 (ci) => `<div class="citation"><b>[${escapeHTML(ci.label)}]</b>
                   <span class="src"> ${escapeHTML(ci.doc_name)} · điểm ${ci.score}</span><br />
                   ${escapeHTML(ci.snippet)}…</div>`,
               )
               .join('')}</div>`
          : ''
      }
      ${!res.llm ? '<div class="stat-row" style="margin-top:10px"><span class="stat-pill warn">Chưa cấu hình AI — hiển thị trích đoạn thô</span></div>' : ''}`
    box.classList.remove('hidden')

    $('rag-copy-answer').onclick = () => {
      navigator.clipboard.writeText(res.answer)
      toast('Đã copy câu trả lời')
    }
    const voiceBtn = $('rag-answer-to-voice')
    if (voiceBtn) voiceBtn.onclick = () => speakText(res.answer, voiceBtn)

    saveJob('rag-ask', question.slice(0, 120), {
      question,
      answer: String(res.answer).slice(0, 6000),
      citations: res.citations.length,
    })
  } catch (e) {
    toast(`Hỏi đáp thất bại: ${e.message}`, 'error')
  } finally {
    btn.disabled = false
    btn.innerHTML = '<i class="fas fa-comments"></i> Hỏi tài liệu'
  }
}

async function runRagScript() {
  if (!state.docs.length) return toast('Chưa có tài liệu nào — hãy upload trước', 'warn')
  const btn = $('rag-script')
  const box = $('rag-script-out')
  btn.disabled = true
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Đang viết lời bình…'

  try {
    const res = await api('/api/rag/video-script', {
      method: 'POST',
      body: JSON.stringify({
        doc_ids: selectedDocIds(),
        topic: $('rag-topic').value,
        style: $('rag-style').value,
        duration_sec: Number($('rag-duration').value) || 60,
        model: $('rag-script-model').value,
      }),
    })
    box.innerHTML = `
      <div class="stat-row">
        <span class="stat-pill">${res.word_count} từ</span>
        <span class="stat-pill">~${res.est_duration_sec}s đọc</span>
        ${res.sources.length ? `<span class="stat-pill">Nguồn: ${escapeHTML(res.sources.join(', ')).slice(0, 60)}</span>` : ''}
        ${!res.llm ? '<span class="stat-pill warn">Chưa cấu hình AI — ghép trích đoạn</span>' : ''}
      </div>
      <div class="result-head">
        <h3><i class="fas fa-file-signature"></i> Lời bình video</h3>
        <div class="result-actions">
          <button class="button micro" id="rag-copy-script">Copy</button>
          <button class="button micro" id="rag-script-voice">Đọc thành audio</button>
          <button class="button micro accent" id="rag-script-to-forge">Dùng làm ý tưởng →</button>
        </div>
      </div>
      <div class="answer-text">${escapeHTML(res.script)}</div>`
    box.classList.remove('hidden')

    $('rag-copy-script').onclick = () => {
      navigator.clipboard.writeText(res.script)
      toast('Đã copy lời bình')
    }
    $('rag-script-voice').onclick = (ev) => speakText(res.script, ev.currentTarget)
    $('rag-script-to-forge').onclick = () => {
      try {
        sessionStorage.setItem('forge_topic', res.script.slice(0, 600))
      } catch {}
      window.location.href = '/#step-1'
    }

    saveJob('rag-script', `Kịch bản ${res.word_count} từ (~${res.est_duration_sec}s)`, {
      topic: $('rag-topic').value,
      style: $('rag-style').value,
      script: String(res.script).slice(0, 8000),
      word_count: res.word_count,
    })
    toast(`Đã sinh lời bình ${res.word_count} từ`)
  } catch (e) {
    toast(`Sinh kịch bản thất bại: ${e.message}`, 'error')
  } finally {
    btn.disabled = false
    btn.innerHTML = '<i class="fas fa-file-signature"></i> Sinh lời bình'
  }
}

async function speakText(text, btn) {
  const clean = String(text || '').replace(/\[C\d+\]/g, '').trim()
  if (!clean) return
  const original = btn.innerHTML
  btn.disabled = true
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Đang tạo…'
  try {
    const res = await api('/api/media/speech', {
      method: 'POST',
      body: JSON.stringify({ text: clean.slice(0, 12000), voice: 'vi' }),
    })
    const audio = $('studio-audio')
    audio.src = res.url
    audio.classList.remove('hidden')
    audio.controls = true
    btn.parentElement.appendChild(audio)
    await audio.play().catch(() => {})
    toast('Đã tạo giọng đọc')
  } catch (e) {
    toast(`Tạo giọng đọc thất bại: ${e.message}`, 'error')
  } finally {
    btn.disabled = false
    btn.innerHTML = original
  }
}

/* ============================================================ lịch sử */

async function saveJob(kind, title, meta) {
  try {
    await api('/api/studio/jobs', { method: 'POST', body: JSON.stringify({ kind, title, meta }) })
    loadHistory()
  } catch (e) {
    console.warn('save job failed', e)
  }
}

const KIND_LABEL = {
  stt: 'Nhận diện giọng nói',
  'srt-translate': 'Dịch phụ đề',
  'video-dub': 'Video Dub',
  bam: 'Băm Studio',
  'rag-ask': 'RAG hỏi đáp',
  'rag-script': 'RAG kịch bản',
}

async function loadHistory() {
  const box = $('history-list')
  if (!box) return
  try {
    const res = await api('/api/studio/jobs?limit=24')
    const jobs = res.jobs || []
    if (!jobs.length) {
      box.innerHTML = '<div class="empty-line">Chưa có phiên nào — kết quả sẽ tự lưu tại đây</div>'
      return
    }
    box.innerHTML = jobs
      .map((j) => {
        const m = j.meta || {}
        const text = m.srt || m.srt_translated || m.answer || m.script || ''
        return `<div class="history-item">
          <span class="kind">${escapeHTML(KIND_LABEL[j.kind] || j.kind)}</span>
          <b>${escapeHTML(j.title || '(không tiêu đề)')}</b>
          <span class="meta">${escapeHTML(String(j.created_at).slice(0, 16).replace('T', ' '))}</span>
          <div class="row">
            ${text ? `<button class="button micro" data-hist-text="${escapeHTML(j.id)}">Xem nội dung</button>` : ''}
            <button class="button micro" data-hist-del="${escapeHTML(j.id)}">Xoá</button>
          </div>
        </div>`
      })
      .join('')

    box.querySelectorAll('[data-hist-text]').forEach((btn) => {
      btn.onclick = () => {
        const job = jobs.find((j) => j.id === btn.dataset.histText)
        const m = job?.meta || {}
        const text = m.srt || m.srt_translated || m.answer || m.script || ''
        if (!text) return
        if (m.srt || m.srt_translated) {
          $('srt-input').value = text
          switchTab('srt')
          toast('Đã nạp vào tab dịch phụ đề')
        } else {
          alert(text.slice(0, 4000))
        }
      }
    })
    box.querySelectorAll('[data-hist-del]').forEach((btn) => {
      btn.onclick = async () => {
        try {
          await api(`/api/studio/jobs/${btn.dataset.histDel}`, { method: 'DELETE' })
          loadHistory()
        } catch (e) {
          toast(e.message, 'error')
        }
      }
    })
  } catch (e) {
    box.innerHTML = '<div class="empty-line">Không tải được lịch sử</div>'
  }
}

/* ============================================================ copy / download chung */

function initGlobalActions() {
  document.addEventListener('click', (e) => {
    const copyBtn = e.target.closest('[data-copy]')
    if (copyBtn) {
      const el = $(copyBtn.dataset.copy)
      if (el && el.value) {
        navigator.clipboard.writeText(el.value)
        toast('Đã copy vào clipboard')
      } else {
        toast('Chưa có nội dung để copy', 'warn')
      }
      return
    }
    const dlBtn = e.target.closest('[data-download]')
    if (dlBtn) {
      const el = $(dlBtn.dataset.download)
      if (el && el.value) {
        downloadBlob(new Blob([el.value], { type: 'text/plain;charset=utf-8' }), dlBtn.dataset.name || 'file.txt')
      } else {
        toast('Chưa có nội dung để tải', 'warn')
      }
    }
  })
  $('history-refresh')?.addEventListener('click', loadHistory)
}

/* ============================================================ khởi động */

function init() {
  initTabs()
  initGlobalActions()
  initSTT()
  initSRT()
  initDub()
  initBam()
  initRag()
  bootstrap()
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init)
} else {
  init()
}
