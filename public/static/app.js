/* Faceless Forge — frontend controller */
'use strict';

/* ============================== helpers ============================== */
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

const safe = (v = '') => String(v ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

const nf = new Intl.NumberFormat('vi-VN');
const money = (v) => '$' + Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

let toastTimer = null;
function notify(message, isError = false) {
  const node = $('#toast');
  clearTimeout(toastTimer);
  node.textContent = message;
  node.classList.toggle('error', isError);
  node.classList.add('show');
  toastTimer = setTimeout(() => node.classList.remove('show'), 4200);
}

async function copyText(text, label = 'Đã sao chép') {
  if (!text) return notify('Chưa có nội dung để sao chép', true);
  try {
    await navigator.clipboard.writeText(text);
    notify(label);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); notify(label); }
    catch { notify('Trình duyệt không cho phép sao chép', true); }
    document.body.removeChild(ta);
  }
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) throw new Error(data?.error || `Lỗi ${res.status}`);
  return data;
}

let blobClientPromise = null;
async function uploadToVercelBlob(file, pathname, payload = {}) {
  // Blob client upload bypasses the 4.5 MB Vercel Function request limit.
  blobClientPromise ||= import('https://esm.sh/@vercel/blob@2.8.0/client');
  const { upload } = await blobClientPromise;
  return upload(pathname, file, {
    access: 'public',
    handleUploadUrl: '/api/blob/upload',
    clientPayload: JSON.stringify(payload),
  });
}

function busy(button, label) {
  if (!button) return () => {};
  const original = button.innerHTML;
  button.disabled = true;
  button.innerHTML = `<span class="spin">◌</span> ${safe(label)}`;
  return () => { button.disabled = false; button.innerHTML = original; };
}

/* ============================== state ============================== */
const state = {
  config: null,
  blueprintId: null,
  blueprint: null,
  ideas: [],
  refined: [],
  images: {},      // shotIndex -> { url, key }
  audio: null,     // { url, key }
  video: null,     // { url, key }
  packs: [],
};

function brief() {
  return {
    topic: $('#topic').value.trim(),
    niche: $('#niche').value.trim(),
    audience: $('#audience').value.trim(),
    platform: $('#platform').value,
    duration_sec: Number($('#duration').value),
    tone: $('#tone').value,
    language: 'Tiếng Việt',
    goal: $('#goal').value.trim(),
    model: $('#model').value,
  };
}

/* ============================== boot ============================== */
async function boot() {
  try {
    const [health, config] = await Promise.all([api('/api/health'), api('/api/config')]);
    state.config = config;

    const badge = $('#health-status');
    const text = $('#health-text');
    if (health.db && health.blob && health.llm) { badge.className = 'status'; text.textContent = 'Studio ready · AI on'; }
    else if (health.db && health.blob) { badge.className = 'status warn'; text.textContent = 'Studio ready · Local plan mode'; }
    else { badge.className = 'status err'; text.textContent = 'Database / Blob chưa sẵn sàng'; }

    $('#model').innerHTML = config.text_models
      .map((m) => `<option value="${safe(m)}"${m === config.default_text_model ? ' selected' : ''}>${safe(m)}</option>`)
      .join('');
    $('#voice').innerHTML = config.voices
      .map((v) => `<option value="${safe(v.code)}"${v.code === 'vi' ? ' selected' : ''}>${safe(v.flag)} ${safe(v.name)}</option>`)
      .join('');
  } catch (err) {
    $('#health-status').className = 'status err';
    $('#health-text').textContent = 'Mất kết nối API';
    console.error(err);
  }

  // Studio "Dùng làm ý tưởng →" chuyển kịch bản sang đây qua sessionStorage
  try {
    const prefilled = sessionStorage.getItem('forge_topic');
    if (prefilled) {
      sessionStorage.removeItem('forge_topic');
      $('#topic').value = prefilled;
      notify('Đã nạp kịch bản từ Studio — bấm "Cải tiến ý tưởng" hoặc "Tạo Viral Blueprint"');
      $('#topic').focus();
    }
  } catch { /* sessionStorage bị chặn */ }

  loadMetrics();
  loadLibrary();
}

/* ============================== BƯỚC 1: gợi ý ý tưởng ============================== */
$('#gen-ideas-btn').addEventListener('click', async (event) => {
  const restore = busy(event.currentTarget, 'Đang tìm…');
  try {
    const b = brief();
    const data = await api('/api/ideas/generate', {
      method: 'POST',
      body: JSON.stringify({ niche: b.niche, audience: b.audience, platform: b.platform, language: b.language, count: 5, model: b.model }),
    });
    state.ideas = data.ideas || [];
    renderIdeas();
    notify(data.ai ? `Đã gợi ý ${state.ideas.length} ý tưởng` : `Đã gợi ý ${state.ideas.length} ý tưởng (chế độ local)`);
  } catch (err) {
    notify(err.message, true);
  } finally { restore(); }
});

function renderIdeas() {
  $('#idea-list').innerHTML = state.ideas.map((idea, i) => `
    <button type="button" class="idea-item" data-idea="${i}">
      <h4>${safe(idea.topic)}</h4>
      <p>${safe(idea.angle)}</p>
      <div class="idea-meta"><span>${safe(idea.format)}</span><span>SCORE ${safe(idea.score)}</span></div>
    </button>`).join('');
}

$('#idea-list').addEventListener('click', (event) => {
  const btn = event.target.closest('[data-idea]');
  if (!btn) return;
  const idea = state.ideas[Number(btn.dataset.idea)];
  if (!idea) return;
  $('#topic').value = idea.topic;
  notify('Đã chọn ý tưởng — bấm "Cải tiến ý tưởng" để tinh chỉnh');
  $('#topic').focus();
});

/* ============================== BƯỚC 2: cải tiến ý tưởng ============================== */
$('#refine-button').addEventListener('click', async (event) => {
  const b = brief();
  if (b.topic.length < 3) return notify('Hãy nhập chủ đề cụ thể hơn', true);
  const restore = busy(event.currentTarget, 'Đang cải tiến…');
  try {
    const data = await api('/api/ideas/refine', { method: 'POST', body: JSON.stringify(b) });
    state.refined = data.refined || [];
    state.ideaId = data.idea_id;
    renderRefined();
    notify(data.ai ? 'Đã có 3 hướng cải tiến' : 'Đã có 3 hướng cải tiến (chế độ local)');
  } catch (err) {
    notify(err.message, true);
  } finally { restore(); }
});

function renderRefined() {
  $('#refine-panel').innerHTML = `
    <div class="blueprint-head">
      <div><span class="kicker">BƯỚC 02 · CẢI TIẾN Ý TƯỞNG</span>
      <h2 style="font-size:16px">Chọn hướng bạn muốn phát triển thành video</h2></div>
    </div>
    <div class="refine-grid">
      ${state.refined.map((r, i) => `
        <button type="button" class="refine-card" data-refine="${i}">
          <div class="head"><span class="tagline">${safe(r.headline)}</span><span class="mini-score">${safe(r.score)}</span></div>
          <h4>${safe(r.improved_topic)}</h4>
          <dl>
            <dt>HOOK</dt><dd>${safe(r.hook)}</dd>
            <dt>KHÁC BIỆT</dt><dd>${safe(r.differentiator)}</dd>
            <dt>GIẢI QUYẾT</dt><dd>${safe(r.audience_pain)}</dd>
          </dl>
          <span class="refine-pick">▸ DÙNG HƯỚNG NÀY</span>
        </button>`).join('')}
    </div>
    <p class="notice" style="margin-top:12px">${safe(state.refined[0]?.risk_note || '')}</p>`;
  $('#empty-state').classList.add('hidden');
  $('#refine-panel').classList.remove('hidden');
  $('#refine-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  setActiveStep('step-2');
}

$('#refine-panel').addEventListener('click', (event) => {
  const btn = event.target.closest('[data-refine]');
  if (!btn) return;
  const r = state.refined[Number(btn.dataset.refine)];
  if (!r) return;
  $('#topic').value = r.improved_topic;
  notify('Đã áp dụng — bấm "Tạo Viral Blueprint"');
  $('#blueprint-button').scrollIntoView({ behavior: 'smooth', block: 'center' });
});

/* ============================== BƯỚC 3: blueprint ============================== */
$('#brief-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const b = brief();
  if (b.topic.length < 3) return notify('Hãy nhập chủ đề cụ thể hơn', true);
  const restore = busy($('#blueprint-button'), 'Đang xây blueprint…');
  try {
    const data = await api('/api/forge/blueprint', {
      method: 'POST',
      body: JSON.stringify({ ...b, idea_id: state.ideaId || null }),
    });
    state.blueprintId = data.id;
    state.blueprint = data.blueprint;
    state.srt = data.srt;
    state.images = {};
    state.audio = null;
    state.video = null;
    state.packs = [];
    renderBlueprint();
    notify(data.ai ? 'Viral Blueprint đã sẵn sàng' : 'Đã tạo blueprint (chế độ local)');
    loadLibrary();
  } catch (err) {
    notify(err.message, true);
  } finally { restore(); }
});

function setActiveStep(id) {
  $$('.step-chip').forEach((chip) => chip.classList.toggle('active', chip.dataset.goto === id));
}

function wordCount(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

function renderBlueprint() {
  const bp = state.blueprint;
  if (!bp) return;
  const seo = bp.seo || {};
  const money_ = bp.monetization || {};

  $('#blueprint').innerHTML = `
    <div class="blueprint-head">
      <div>
        <span class="kicker">BƯỚC 03 · VIRAL BLUEPRINT ${bp.fallback ? '· LOCAL PLAN MODE' : '· AI STRATEGY'}</span>
        <h2>${safe(bp.concept)}</h2>
      </div>
      <div class="score"><b>${safe(bp.viral_score)}</b><small>fit score</small></div>
    </div>

    <div class="info-grid">
      <div class="info-card"><span class="label">HOOK · 0–3 GIÂY</span><p>${safe(bp.hook)}</p></div>
      <div class="info-card"><span class="label">THUMBNAIL TEXT</span><p class="thumb">${safe(bp.thumbnail_text)}</p></div>
    </div>

    <section class="section-card">
      <div class="section-title">3 hướng tiêu đề <small>BẤM ĐỂ COPY</small></div>
      <div class="title-grid">
        ${(bp.titles || []).map((t, i) => `<button type="button" class="copy-card" data-copy-title="${i}" data-index="TITLE 0${i + 1}">${safe(t)}</button>`).join('')}
      </div>
    </section>

    <section class="section-card">
      <div class="section-title">Lời bình hoàn chỉnh <small>${wordCount(bp.script)} TỪ</small></div>
      <p class="script">${safe(bp.script)}</p>
      <div class="tool-row">
        <button class="button ghost" type="button" data-copy-script><i class="fas fa-copy"></i> Copy voice-over</button>
        <button class="button ghost" type="button" data-copy-srt><i class="fas fa-closed-captioning"></i> Copy SRT</button>
        <button class="button ghost" type="button" data-download-srt><i class="fas fa-download"></i> Tải .srt</button>
      </div>
    </section>

    <!-- BƯỚC 4: HÌNH ẢNH -->
    <section class="section-card" id="step-4">
      <div class="section-title">Bước 04 · Hình ảnh 9:16 <small>MỖI SHOT MỘT VISUAL</small></div>
      <div class="tool-row">
        <button class="button primary" type="button" data-gen-images><i class="fas fa-images"></i> Tạo ảnh cho tất cả shot</button>
        <button class="button ghost" type="button" data-gen-cover><i class="fas fa-star"></i> Chỉ tạo ảnh bìa</button>
        ${state.config?.gemini ? `
        <select id="image-provider" title="Nguồn tạo ảnh">
          <option value="auto">Nguồn ảnh: Tự động (Gemini → Pollinations)</option>
          <option value="gemini">Gemini (Google) — bắt buộc</option>
          <option value="pollinations">Pollinations (miễn phí)</option>
        </select>` : ''}
        <label class="button ghost" style="cursor:pointer" title="Tải ảnh có sẵn lên — gán theo thứ tự shot (dùng được cả khi dịch vụ AI ngoại tuyến)">
          <i class="fas fa-cloud-arrow-up"></i> Tải ảnh lên
          <input type="file" id="upload-images" accept="image/png,image/jpeg,image/webp" multiple hidden>
        </label>
      </div>
      <div class="job" id="image-job">
        <div class="job-line"><span id="image-msg">Đang chuẩn bị…</span><b id="image-pct">0%</b></div>
        <div class="bar"><i id="image-bar"></i></div>
      </div>
      <div class="asset-strip" id="image-strip" style="margin-top:11px"></div>
    </section>

    <!-- BƯỚC 5: ÂM THANH -->
    <section class="section-card" id="step-5">
      <div class="section-title">Bước 05 · Giọng đọc AI <small>GOOGLE NEURAL TTS</small></div>
      <div class="tool-row">
        <button class="button primary" type="button" data-gen-voice><i class="fas fa-microphone-lines"></i> Tạo voice-over</button>
        <label class="button ghost" style="cursor:pointer" title="Tải voice-over của bạn lên (bỏ qua TTS — dùng được cả khi TTS ngoại tuyến)">
          <i class="fas fa-cloud-arrow-up"></i> Tải voice có sẵn
          <input type="file" id="upload-voice" accept="audio/*" hidden>
        </label>
      </div>
      <div class="job" id="audio-job">
        <div class="job-line"><span id="audio-msg">Đang chuẩn bị…</span><b id="audio-pct">0%</b></div>
        <div class="bar"><i id="audio-bar"></i></div>
      </div>
      <div id="audio-output" class="render-result"></div>
    </section>

    <!-- BƯỚC 6: VIDEO -->
    <section class="section-card production" id="step-6">
      <div class="section-title">Bước 06 · Dựng video MP4 <small>CANVAS + KEN BURNS + PHỤ ĐỀ</small></div>
      <p class="muted-note">Cần <b>ảnh</b> và <b>giọng đọc</b> trước. Video được dựng ngay trong trình duyệt của bạn rồi lưu lên cloud.</p>
      <div class="tool-row">
        <button class="button primary solid" type="button" data-open-render><i class="fas fa-film"></i> Dựng video 9:16</button>
      </div>
      <div id="video-output" class="render-result"></div>

      ${state.config?.gemini ? `
      <div class="ai-video-block" style="margin-top:16px;border-top:1px dashed rgba(102,245,205,.25);padding-top:14px">
        <div class="section-title">Phương án 2 · Video AI bằng Google Veo <small>VIDEO THẬT · CÓ AUDIO · TỐN QUOTA (CẦN BILLING)</small></div>
        <label style="display:block;margin-bottom:10px">Prompt video (từ concept — có thể chỉnh)
          <textarea id="veo-prompt" rows="3" spellcheck="false">${safe(bp.concept)}. Cinematic vertical video, smooth camera movement, high detail.</textarea>
        </label>
        <label style="display:flex;gap:8px;align-items:center;margin:-4px 0 12px;font-size:13px;color:#9fb0ad;cursor:pointer">
          <input type="checkbox" id="veo-voice" checked style="accent-color:#66f5cd">
          <span>🎙️ <b style="color:#e8f4f0">Voice đọc theo Veo</b> — Veo tự tạo audio tiếng Việt đọc đoạn mở đầu kịch bản (clip ~8s; không cần bước 05)</span>
        </label>
        <div class="tool-row">
          <button class="button primary" type="button" data-gen-ai-video><i class="fas fa-clapperboard"></i> Tạo video bằng Veo AI</button>
          <select id="veo-model" title="Model Veo">
            ${(state.config.veo_models || []).map((m) => `<option value="${safe(m)}">${safe(m)}</option>`).join('')}
          </select>
        </div>
        <div class="job" id="aivideo-job">
          <div class="job-line"><span id="aivideo-msg">Sẵn sàng</span><b id="aivideo-pct">0%</b></div>
          <div class="bar"><i id="aivideo-bar"></i></div>
        </div>
      </div>` : ''}
    </section>

    <section class="section-card">
      <div class="section-title">Shot list &amp; visual prompt <small>1 CẢNH / 5–9 GIÂY</small></div>
      <div class="shot-list">
        ${(bp.shots || []).map((shot, i) => `
          <article class="shot">
            <div class="shot-top">
              <span><span class="time">${safe(shot.start_sec)}–${safe(shot.end_sec)}s</span> <span class="purpose">${safe(shot.purpose)}</span></span>
              <button class="prompt-copy" type="button" data-copy-prompt="${i}">COPY PROMPT</button>
            </div>
            <div class="shot-grid">
              <p><span class="label">VISUAL</span>${safe(shot.visual)}</p>
              <p><span class="label">VOICE-OVER</span>${safe(shot.narration)}</p>
            </div>
            <span class="overlay">${safe(shot.on_screen_text)}</span>
          </article>`).join('')}
      </div>
    </section>

    <!-- BƯỚC 7: VIRAL / PHÂN PHỐI -->
    <section class="section-card" id="step-7">
      <div class="section-title">Bước 07 · Đẩy viral đa nền tảng <small>CAPTION RIÊNG CHO TỪNG NƠI</small></div>
      <div class="tool-row">
        <button class="button primary solid" type="button" data-build-packs><i class="fas fa-share-nodes"></i> Tạo gói đăng bài 4 nền tảng</button>
        <button class="button ghost" type="button" data-copy-publish><i class="fas fa-copy"></i> Copy gói SEO gốc</button>
      </div>
      <div class="job" id="pack-job">
        <div class="job-line"><span id="pack-msg">Đang soạn caption…</span><b id="pack-pct">0%</b></div>
        <div class="bar"><i id="pack-bar"></i></div>
      </div>
      <div class="pack-grid" id="pack-grid" style="margin-top:11px"></div>
    </section>

    <div class="bottom-grid">
      <section class="section-card">
        <div class="section-title">Gói xuất bản gốc <small>SEO DỄ ĐỌC</small></div>
        <p class="publish-copy">${safe(seo.description)}</p>
        <div class="tags">${(seo.hashtags || []).map((t) => `<span class="tag">${safe(t)}</span>`).join('')}</div>
        <p class="publish-copy"><span class="label">GHIM BÌNH LUẬN</span>${safe(seo.pinned_comment)}</p>
      </section>
      <section class="section-card">
        <div class="section-title">Đăng có trách nhiệm <small>CHECK TRƯỚC KHI POST</small></div>
        <ul class="checklist">${(bp.production_checklist || []).map((c) => `<li>${safe(c)}</li>`).join('')}</ul>
        <p class="notice">${safe(money_.disclosure)}</p>
      </section>
    </div>

    <section class="section-card">
      <div class="section-title">Vì sao hướng này có thể giữ nhịp xem <small>GỢI Ý, KHÔNG PHẢI CAM KẾT</small></div>
      <ul class="checklist">${(bp.why_it_can_work || []).map((r) => `<li>${safe(r)}</li>`).join('')}</ul>
      <p class="notice">${safe(money_.angle)}<br /><br /><b>CTA:</b> ${safe(money_.cta)}</p>
    </section>`;

  $('#empty-state').classList.add('hidden');
  $('#blueprint').classList.remove('hidden');
  $('#blueprint').scrollIntoView({ behavior: 'smooth', block: 'start' });
  setActiveStep('step-3');
  renderImageStrip();
}

/* ============================== progress helper ============================== */
function progress(prefix, pct, message) {
  const job = $(`#${prefix}-job`);
  if (!job) return;
  job.classList.add('show');
  $(`#${prefix}-msg`).textContent = message;
  $(`#${prefix}-pct`).textContent = `${Math.round(pct)}%`;
  $(`#${prefix}-bar`).style.width = `${Math.round(pct)}%`;
}

/* ============================== BƯỚC 4: tạo ảnh ============================== */
function renderImageStrip() {
  const strip = $('#image-strip');
  if (!strip || !state.blueprint) return;
  const shots = state.blueprint.shots || [];
  strip.innerHTML = shots.map((shot, i) => {
    const img = state.images[i];
    if (img) {
      const fb = img.fallback ? ' title="Ảnh dự phòng (dịch vụ ảnh AI ngoại tuyến)" style="outline:2px dashed rgba(255,211,107,.55);outline-offset:-2px"' : '';
      return `<div class="asset-cell"${fb}><img src="${safe(img.url)}" alt="Shot ${i + 1}" loading="lazy" /><span>${i + 1}</span></div>`;
    }
    return `<div class="asset-cell loading"><span>${i + 1}</span>chưa có</div>`;
  }).join('');
}

async function generateShotImage(index) {
  const shot = state.blueprint.shots[index];
  const data = await api('/api/media/image', {
    method: 'POST',
    body: JSON.stringify({
      prompt: shot.image_prompt,
      blueprint_id: state.blueprintId,
      shot_index: index,
      width: 768,
      height: 1344,
      provider: $('#image-provider')?.value || 'auto',
    }),
  });
  state.images[index] = { url: data.url, key: data.key, fallback: Boolean(data.fallback), provider: data.provider };
  renderImageStrip();
  return data;
}

async function generateAllImages(button, onlyCover = false) {
  const shots = state.blueprint?.shots || [];
  if (!shots.length) return notify('Chưa có shot list', true);
  const targets = onlyCover ? [0] : shots.map((_, i) => i).filter((i) => !state.images[i]);
  if (!targets.length) {
    progress('image', 100, 'Tất cả shot đã có ảnh');
    return notify('Tất cả shot đã có ảnh — dùng lại ảnh hiện tại');
  }
  const restore = busy(button, 'Đang tạo ảnh…');
  let done = 0;
  let failed = 0;
  let usedFallback = 0;
  try {
    // Chạy song song tối đa 3 request — nhanh gấp ~3 lần mà vẫn tránh rate limit.
    const CONCURRENCY = 3;
    const queue = [...targets];
    const worker = async () => {
      while (queue.length) {
        const index = queue.shift();
        if (index === undefined) return;
        try {
          const result = await generateShotImage(index);
          if (result.fallback) usedFallback++;
        } catch (err) {
          failed++;
          console.error('image failed', index, err);
        }
        done++;
        progress(
          'image',
          (done / targets.length) * 100,
          `Đang tạo ảnh… ${done}/${targets.length} shot`,
        );
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker));
    const okCount = done - failed;
    progress(
      'image',
      100,
      failed
        ? `Xong — ${okCount} ảnh, ${failed} lỗi`
        : usedFallback
          ? `Xong — ${usedFallback}/${okCount} ảnh dùng placeholder (dịch vụ ảnh AI offline)`
          : `Đã tạo ${okCount} ảnh 9:16`,
    );
    if (failed) notify(`Tạo được ${okCount}/${done} ảnh`, true);
    else if (usedFallback) notify(`Đã tạo ${okCount} ảnh — ${usedFallback} ảnh là placeholder vì dịch vụ ảnh AI ngoại tuyến`, true);
    else notify(`Đã tạo ${okCount} ảnh`);
  } finally { restore(); }
}

/* ============================== BƯỚC 5: tạo giọng đọc ============================== */
async function generateVoice(button) {
  const script = state.blueprint?.script;
  if (!script) return notify('Chưa có kịch bản', true);
  const restore = busy(button, 'Đang tạo giọng…');
  try {
    progress('audio', 25, 'Đang tổng hợp giọng đọc…');
    const data = await api('/api/media/speech', {
      method: 'POST',
      body: JSON.stringify({ text: script, voice: $('#voice').value, blueprint_id: state.blueprintId }),
    });
    state.audio = { url: data.url, key: data.key };
    const note = data.fallback
      ? ' · ÂM TONE DỰ PHÒNG (dịch vụ TTS đang ngoại tuyến)'
      : data.missing
        ? ` · thiếu ${data.missing}/${data.chunks} đoạn`
        : '';
    progress('audio', 100, `Đã tạo audio · ${data.chunks} đoạn · ${nf.format(data.chars)} ký tự${note}`);
    const ext = data.fallback ? 'WAV (dự phòng)' : 'MP3';
    $('#audio-output').innerHTML = `
      <audio controls src="${safe(data.url)}"></audio>
      <a class="download" href="${safe(data.url)}" download="voice-over.${data.fallback ? 'wav' : 'mp3'}"><i class="fas fa-download"></i> TẢI ${ext}</a>`;
    if (data.fallback) notify('Dịch vụ TTS ngoại tuyến — dùng âm tone dự phòng, timing vẫn đúng', true);
    else if (data.missing) notify(`Voice-over sẵn sàng nhưng thiếu ${data.missing} đoạn`, true);
    else notify('Voice-over đã sẵn sàng');
  } catch (err) {
    progress('audio', 0, 'Tạo giọng thất bại');
    notify(err.message, true);
  } finally { restore(); }
}

/* ============================== BƯỚC 6: dựng video trong browser ============================== */
const renderModal = $('#render-modal');
$('#render-close').addEventListener('click', () => renderModal.classList.add('hidden'));
renderModal.addEventListener('click', (e) => { if (e.target === renderModal) renderModal.classList.add('hidden'); });

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Không tải được ảnh'));
    img.src = url;
  });
}

/** Bọc chữ theo chiều rộng canvas */
function wrapText(ctx, text, maxWidth) {
  const words = String(text || '').split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function pickMimeType() {
  // Ưu tiên H.264 + AAC trong MP4 (tương thích tốt nhất với TikTok/Reels/X),
  // sau đó mới hạ xuống VP9/WebM.
  const candidates = [
    'video/mp4;codecs=avc1.4D401E,mp4a.40.2',
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4;codecs=avc1.42E01E,opus',
    'video/mp4;codecs=avc1.42E01E',
    'video/mp4;codecs=h264,aac',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  for (const type of candidates) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
}

async function renderVideo() {
  const bp = state.blueprint;
  if (!bp) return notify('Chưa có blueprint', true);
  if (!state.audio) return notify('Hãy tạo giọng đọc trước (Bước 05)', true);

  const imageKeys = Object.keys(state.images);
  if (!imageKeys.length) return notify('Hãy tạo ít nhất một ảnh trước (Bước 04)', true);

  if (!window.MediaRecorder) return notify('Trình duyệt không hỗ trợ MediaRecorder', true);

  renderModal.classList.remove('hidden');
  const canvas = $('#render-canvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  $('#render-output').innerHTML = '';

  try {
    /* --- 1. tải ảnh --- */
    progress('render', 5, 'Đang tải ảnh…');
    const shots = bp.shots || [];
    const images = [];
    for (let i = 0; i < shots.length; i++) {
      const asset = state.images[i] || state.images[0];
      if (!asset) { images.push(null); continue; }
      try { images.push(await loadImage(asset.url)); }
      catch { images.push(null); }
    }
    const usable = images.filter(Boolean);
    if (!usable.length) throw new Error('Không tải được ảnh nào');

    /* --- 2. chuẩn bị audio --- */
    progress('render', 18, 'Đang chuẩn bị âm thanh…');
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const audioBuffer = await fetch(state.audio.url)
      .then((r) => r.arrayBuffer())
      .then((buf) => audioCtx.decodeAudioData(buf));
    const duration = Math.max(3, audioBuffer.duration + 0.4);

    const source = audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    const dest = audioCtx.createMediaStreamDestination();
    source.connect(dest);
    // cũng phát ra loa để người dùng theo dõi
    source.connect(audioCtx.destination);

    /* --- 3. dựng stream --- */
    progress('render', 25, 'Bắt đầu ghi hình…');
    const fps = 30;
    const canvasStream = canvas.captureStream(fps);
    const mixed = new MediaStream([
      ...canvasStream.getVideoTracks(),
      ...dest.stream.getAudioTracks(),
    ]);

    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(mixed, {
      ...(mimeType ? { mimeType } : {}),
      videoBitsPerSecond: 4_000_000,
      audioBitsPerSecond: 128_000,
    });
    const chunks = [];
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };

    const finished = new Promise((resolve) => { recorder.onstop = resolve; });

    /* --- 4. vòng lặp vẽ frame --- */
    const totalShotTime = shots.length
      ? Math.max(...shots.map((s) => Number(s.end_sec) || 0))
      : duration;
    const scale = totalShotTime > 0 ? duration / totalShotTime : 1;

    recorder.start();
    source.start();
    const startedAt = performance.now();

    await new Promise((resolve) => {
      function frame() {
        const elapsed = (performance.now() - startedAt) / 1000;
        if (elapsed >= duration) return resolve();

        // shot hiện tại (thời gian shot được kéo giãn theo độ dài audio thật)
        let shotIndex = 0;
        for (let i = 0; i < shots.length; i++) {
          if (elapsed >= Number(shots[i].start_sec) * scale) shotIndex = i;
        }
        const shot = shots[shotIndex] || {};
        const img = images[shotIndex] || usable[shotIndex % usable.length];

        const shotStart = (Number(shot.start_sec) || 0) * scale;
        const shotEnd = (Number(shot.end_sec) || duration) * scale;
        const shotProgress = Math.min(1, Math.max(0, (elapsed - shotStart) / Math.max(0.1, shotEnd - shotStart)));

        // nền
        ctx.fillStyle = '#050d0d';
        ctx.fillRect(0, 0, W, H);

        // Ken Burns: zoom nhẹ + pan
        if (img) {
          const zoom = 1.06 + shotProgress * 0.1;
          const ratio = Math.max(W / img.width, H / img.height) * zoom;
          const dw = img.width * ratio;
          const dh = img.height * ratio;
          const dx = (W - dw) / 2 + Math.sin(shotProgress * Math.PI) * 14 * (shotIndex % 2 ? 1 : -1);
          const dy = (H - dh) / 2 - shotProgress * 22;
          ctx.drawImage(img, dx, dy, dw, dh);
        }

        // gradient tối 2 đầu để chữ nổi
        const gradTop = ctx.createLinearGradient(0, 0, 0, H * 0.3);
        gradTop.addColorStop(0, 'rgba(3,10,10,.78)');
        gradTop.addColorStop(1, 'rgba(3,10,10,0)');
        ctx.fillStyle = gradTop;
        ctx.fillRect(0, 0, W, H * 0.3);

        const gradBottom = ctx.createLinearGradient(0, H * 0.55, 0, H);
        gradBottom.addColorStop(0, 'rgba(3,10,10,0)');
        gradBottom.addColorStop(1, 'rgba(3,10,10,.9)');
        ctx.fillStyle = gradBottom;
        ctx.fillRect(0, H * 0.55, W, H * 0.45);

        // text overlay trên (on_screen_text) — hiệu ứng xuất hiện
        const overlay = String(shot.on_screen_text || '').toUpperCase();
        if (overlay) {
          const appear = Math.min(1, shotProgress * 6);
          ctx.save();
          ctx.globalAlpha = appear;
          ctx.font = '800 46px Manrope, system-ui, sans-serif';
          ctx.textAlign = 'center';
          const lines = wrapText(ctx, overlay, W * 0.84);
          lines.forEach((line, li) => {
            const y = 150 + li * 56 + (1 - appear) * 16;
            ctx.lineWidth = 9;
            ctx.strokeStyle = 'rgba(3,12,11,.86)';
            ctx.strokeText(line, W / 2, y);
            ctx.fillStyle = '#66f5cd';
            ctx.fillText(line, W / 2, y);
          });
          ctx.restore();
        }

        // phụ đề dưới (narration)
        const caption = String(shot.narration || '');
        if (caption) {
          ctx.save();
          ctx.font = '700 36px Manrope, system-ui, sans-serif';
          ctx.textAlign = 'center';
          const lines = wrapText(ctx, caption, W * 0.86).slice(0, 4);
          const baseY = H - 260 - (lines.length - 1) * 46;
          lines.forEach((line, li) => {
            const y = baseY + li * 46;
            ctx.lineWidth = 8;
            ctx.strokeStyle = 'rgba(3,12,11,.9)';
            ctx.strokeText(line, W / 2, y);
            ctx.fillStyle = '#ffffff';
            ctx.fillText(line, W / 2, y);
          });
          ctx.restore();
        }

        // thanh tiến trình
        ctx.fillStyle = 'rgba(255,255,255,.16)';
        ctx.fillRect(0, H - 8, W, 5);
        ctx.fillStyle = '#66f5cd';
        ctx.fillRect(0, H - 8, W * (elapsed / duration), 5);

        // watermark
        ctx.save();
        ctx.font = '600 20px "DM Mono", monospace';
        ctx.textAlign = 'right';
        ctx.fillStyle = 'rgba(230,255,248,.4)';
        ctx.fillText('FACELESS FORGE', W - 26, H - 34);
        ctx.restore();

        progress('render', 25 + (elapsed / duration) * 55, `Đang dựng video… ${elapsed.toFixed(1)}s / ${duration.toFixed(1)}s`);
        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    });

    /* --- 5. kết thúc --- */
    recorder.stop();
    try { source.stop(); } catch {}
    await finished;
    try { await audioCtx.close(); } catch {}

    progress('render', 85, 'Đang lưu video lên cloud…');
    const type = recorder.mimeType || mimeType || 'video/webm';
    const blob = new Blob(chunks, { type });
    if (blob.size < 2048) throw new Error('Video rỗng — thử lại');

    const ext = type.includes('mp4') ? 'mp4' : 'webm';
    const sizeMB = (blob.size / 1024 / 1024).toFixed(2);

    // Cố gắng upload Blob; nếu chưa cấu hình BLOB_READ_WRITE_TOKEN (hoặc Blob lỗi)
    // thì rơi về chế độ local: video hiển thị/tải về ngay, pipeline không gãy.
    let saved = null;
    try {
      const upload = await uploadToVercelBlob(
        blob,
        `videos/vid_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`,
        { blueprintId: state.blueprintId, kind: 'video' },
      );
      saved = await api(`/api/media/video/${encodeURIComponent(state.blueprintId)}`, {
        method: 'POST',
        body: JSON.stringify({ url: upload.url, size: blob.size, content_type: type }),
      });
    } catch (uploadErr) {
      console.warn('Blob upload không khả dụng, dùng chế độ local:', uploadErr);
    }

    if (saved) {
      state.video = { url: saved.url, key: saved.key };
      progress('render', 100, `Hoàn tất · ${sizeMB} MB · ${ext.toUpperCase()}`);
      const html = `
        <video controls src="${safe(saved.url)}"></video>
        <a class="download" href="${safe(saved.url)}?download=1" download="faceless-forge.${ext}"><i class="fas fa-download"></i> TẢI VIDEO ${ext.toUpperCase()} (${sizeMB} MB)</a>`;
      $('#render-output').innerHTML = html;
      $('#video-output').innerHTML = html;
      notify(`Video đã render xong · ${sizeMB} MB`);
      loadLibrary();
    } else {
      const localUrl = URL.createObjectURL(blob);
      state.video = { url: localUrl, key: null };
      progress('render', 100, `Hoàn tất · ${sizeMB} MB · CHẾ ĐỘ LOCAL (chưa lưu cloud)`);
      const html = `
        <video controls src="${localUrl}"></video>
        <a class="download" href="${localUrl}" download="faceless-forge.${ext}"><i class="fas fa-download"></i> TẢI VIDEO ${ext.toUpperCase()} (${sizeMB} MB) · BẢN LOCAL</a>`;
      $('#render-output').innerHTML = html;
      $('#video-output').innerHTML = html;
      notify('Video render xong — xem/tải ngay. Chưa lưu cloud vì thiếu BLOB_READ_WRITE_TOKEN', true);
    }
  } catch (err) {
    progress('render', 0, 'Dựng video thất bại');
    notify(err.message || 'Dựng video thất bại', true);
    console.error(err);
  }
}

/* ============================== BƯỚC 6b: video AI bằng Veo ============================== */
async function genAiVideo(button) {
  const bp = state.blueprint;
  if (!bp) return notify('Chưa có blueprint', true);
  const prompt = ($('#veo-prompt')?.value || bp.concept || '').trim();
  if (prompt.length < 8) return notify('Prompt video quá ngắn (tối thiểu 8 ký tự)', true);

  const wantVoice = $('#veo-voice') ? $('#veo-voice').checked : true;
  const voiceover = wantVoice ? String(bp.script || '').trim() : '';

  const restore = busy(button, 'Đang gửi Veo…');
  try {
    progress('aivideo', 4, wantVoice ? 'Đang khởi động Veo (kèm giọng đọc)…' : 'Đang khởi động Veo…');
    const start = await api('/api/media/ai-video', {
      method: 'POST',
      body: JSON.stringify({ prompt, model: $('#veo-model')?.value || '', blueprint_id: state.blueprintId, voiceover }),
    });
    const name = start.operation;
    if (!name) throw new Error('Veo không trả về operation');

    // Veo mất ~1–3 phút: poll mỗi 7 giây, tối đa 8 phút.
    const t0 = Date.now();
    const MAX_MS = 8 * 60 * 1000;
    const POLL_MS = 7000;
    let final = null;
    while (Date.now() - t0 < MAX_MS) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      const st = await api(
        `/api/media/ai-video/status?name=${encodeURIComponent(name)}&blueprint_id=${encodeURIComponent(state.blueprintId || '')}`,
      );
      if (st.done) { final = st; break; }
      const pct = Math.min(92, 6 + ((Date.now() - t0) / MAX_MS) * 86);
      progress('aivideo', pct, 'Veo đang tạo video (thường 1–3 phút)…');
    }
    if (!final) throw new Error('Veo mất quá nhiều thởi gian — operation vẫn chạy, hãy thử lại sau');
    if (final.error) throw new Error(`Veo báo lỗi: ${final.error}`);
    if (!final.url) throw new Error('Không nhận được URL video');

    state.video = { url: final.url, key: final.key || null };
    const warn = final.expires_source ? ' · URI Google tạm thởi — hãy tải về sớm' : '';
    progress('aivideo', 100, `Veo hoàn tất${warn}`);
    const html = `
      <video controls src="${safe(final.url)}"></video>
      <a class="download" href="${safe(final.url)}" download="veo-ai.mp4"><i class="fas fa-download"></i> TẢI VIDEO VEO${warn}</a>`;
    $('#video-output').innerHTML = html;
    notify(`Veo đã tạo video xong${warn}`, Boolean(final.expires_source));
    loadLibrary();
  } catch (err) {
    progress('aivideo', 0, 'Veo thất bại');
    notify(err.message, true);
  } finally { restore(); }
}

/* ============================== BƯỚC 7: gói phân phối ============================== */
const PLATFORM_ICON = {
  tiktok: 'fab fa-tiktok', facebook: 'fab fa-facebook',
  instagram: 'fab fa-instagram', x: 'fab fa-x-twitter', youtube: 'fab fa-youtube',
};
const PLATFORM_COLOR = {
  tiktok: '#25f4ee', facebook: '#0866ff', instagram: '#e1306c', x: '#e7e9ea', youtube: '#ff0033',
};

async function buildPacks(button) {
  if (!state.blueprint) return notify('Chưa có blueprint', true);
  const restore = busy(button, 'Đang soạn caption…');
  try {
    progress('pack', 35, 'Đang soạn caption riêng cho từng nền tảng…');
    const data = await api('/api/distribution/build', {
      method: 'POST',
      body: JSON.stringify({
        blueprint_id: state.blueprintId,
        blueprint: state.blueprint,
        platforms: ['tiktok', 'facebook', 'instagram', 'x'],
        language: 'Tiếng Việt',
        model: $('#model').value,
      }),
    });
    state.packs = data.packs || [];
    progress('pack', 100, `Đã tạo ${state.packs.length} gói đăng bài`);
    renderPacks();
    notify(data.ai ? 'Gói đăng bài đã sẵn sàng' : 'Gói đăng bài (chế độ local)');
  } catch (err) {
    progress('pack', 0, 'Tạo gói thất bại');
    notify(err.message, true);
  } finally { restore(); }
}

function renderPacks() {
  $('#pack-grid').innerHTML = state.packs.map((pack, i) => `
    <div class="pack-card">
      <div class="pack-head">
        <span class="pack-name" style="color:${PLATFORM_COLOR[pack.platform] || '#fff'}">
          <i class="${PLATFORM_ICON[pack.platform] || 'fas fa-globe'}"></i> ${safe(pack.label)}
        </span>
        <button class="button micro" type="button" data-copy-pack="${i}">COPY</button>
      </div>
      <p class="pack-caption">${safe(pack.caption)}</p>
      <div class="tags">${(pack.hashtags || []).map((t) => `<span class="tag">${safe(t)}</span>`).join('')}</div>
      <div class="pack-meta">
        <span>${safe(pack.char_count)} KÝ TỰ</span>
        <span>GIỜ TỐT: ${safe(pack.best_time)}</span>
      </div>
      <ul class="pack-tips">${(pack.tips || []).map((t) => `<li>${safe(t)}</li>`).join('')}</ul>
      <p class="pack-meta" style="margin-top:8px"><span>GHIM: ${safe(pack.first_comment)}</span></p>
    </div>`).join('');
}

function packText(pack) {
  return [pack.caption, '', (pack.hashtags || []).join(' '), '', `Bình luận ghim: ${pack.first_comment || ''}`]
    .filter((l) => l !== undefined).join('\n');
}

function publishPack() {
  const bp = state.blueprint;
  if (!bp) return '';
  const seo = bp.seo || {};
  return [bp.titles?.[0], seo.description, ...(seo.hashtags || []), '', `Bình luận ghim: ${seo.pinned_comment || ''}`]
    .filter(Boolean).join('\n');
}

/* ============================== blueprint click router ============================== */
$('#blueprint').addEventListener('click', (event) => {
  const target = event.target.closest('button');
  if (!target || !state.blueprint) return;
  const bp = state.blueprint;

  if (target.dataset.copyTitle !== undefined) return copyText(bp.titles?.[Number(target.dataset.copyTitle)], 'Đã copy title');
  if (target.dataset.copyPrompt !== undefined) return copyText(bp.shots?.[Number(target.dataset.copyPrompt)]?.image_prompt, 'Đã copy visual prompt');
  if (target.dataset.copyPack !== undefined) return copyText(packText(state.packs[Number(target.dataset.copyPack)]), 'Đã copy gói đăng bài');
  if (target.hasAttribute('data-copy-script')) return copyText(bp.script, 'Đã copy voice-over');
  if (target.hasAttribute('data-copy-srt')) return copyText(state.srt, 'Đã copy SRT');
  if (target.hasAttribute('data-copy-publish')) return copyText(publishPack(), 'Đã copy gói xuất bản');
  if (target.hasAttribute('data-download-srt')) {
    const blob = new Blob([state.srt || ''], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'faceless-forge.srt';
    a.click();
    URL.revokeObjectURL(a.href);
    return notify('Đã tải file .srt');
  }
  if (target.hasAttribute('data-gen-images')) return generateAllImages(target, false);
  if (target.hasAttribute('data-gen-cover')) return generateAllImages(target, true);
  if (target.hasAttribute('data-gen-voice')) return generateVoice(target);
  if (target.hasAttribute('data-open-render')) return renderVideo();
  if (target.hasAttribute('data-gen-ai-video')) return genAiVideo(target);
  if (target.hasAttribute('data-build-packs')) return buildPacks(target);
});

/* ============================== Tải file có sẵn (ảnh / voice) ============================== */
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Đọc file thất bại'));
    reader.readAsDataURL(file);
  });
}

async function uploadImages(fileList) {
  const shots = state.blueprint?.shots || [];
  if (!shots.length) return notify('Chưa có shot list — hãy tạo blueprint trước', true);
  const files = Array.from(fileList || []).slice(0, shots.length);
  if (!files.length) return;
  progress('image', 8, `Đang tải lên ${files.length} ảnh…`);
  let done = 0;
  try {
    for (let i = 0; i < files.length; i++) {
      const dataUrl = await fileToDataUrl(files[i]);
      const res = await api('/api/media/import-image', {
        method: 'POST',
        body: JSON.stringify({ data: dataUrl, blueprint_id: state.blueprintId, shot_index: i, prompt: files[i].name || 'user upload' }),
      });
      state.images[i] = { url: res.url, key: res.key, fallback: false, provider: 'upload' };
      done += 1;
      progress('image', Math.round((done / files.length) * 100), `Đã tải lên ${done}/${files.length} ảnh`);
      renderImageStrip();
    }
    notify(`Đã gắn ${done} ảnh tải lên vào ${done} shot đầu — Bước 06 dùng ngay được`);
  } catch (err) {
    notify(`Tải ảnh lên thất bại: ${err.message}`, true);
    renderImageStrip();
  }
}

async function uploadVoice(file) {
  if (!file) return;
  try {
    progress('audio', 15, 'Đang tải voice lên…');
    const dataUrl = await fileToDataUrl(file);
    const res = await api('/api/media/import-audio', {
      method: 'POST',
      body: JSON.stringify({ data: dataUrl, blueprint_id: state.blueprintId }),
    });
    state.audio = { url: res.url, key: res.key };
    progress('audio', 100, `Đã gắn voice tải lên · ${nf.format(res.size)} bytes`);
    $('#audio-output').innerHTML = `
      <audio controls src="${safe(res.url)}"></audio>
      <a class="download" href="${safe(res.url)}" download="voice-over-upload"><i class="fas fa-download"></i> TẢI AUDIO</a>`;
    notify('Voice-over của bạn đã sẵn sàng cho bước dựng video');
  } catch (err) {
    progress('audio', 0, 'Tải voice thất bại');
    notify(`Tải voice thất bại: ${err.message}`, true);
  }
}

document.addEventListener('change', (event) => {
  const el = event.target;
  if (!(el instanceof HTMLInputElement)) return;
  if (el.id === 'upload-images') { uploadImages(el.files); el.value = ''; }
  if (el.id === 'upload-voice') { uploadVoice(el.files?.[0]); el.value = ''; }
});

/* ============================== BƯỚC 8: thu nhập ============================== */
async function loadMetrics() {
  try {
    const data = await api('/api/metrics/summary');
    const t = data.totals || {};
    const c = data.counts || {};
    $('#kpi-grid').innerHTML = `
      <div class="kpi"><span>TỔNG DOANH THU</span><b>${money(t.revenue)}</b><small>${nf.format(t.entries || 0)} bản ghi</small></div>
      <div class="kpi"><span>TỔNG LƯỢT XEM</span><b>${nf.format(t.views || 0)}</b><small>RPM ${money(t.rpm)}/1K view</small></div>
      <div class="kpi"><span>FOLLOW MỚI</span><b>${nf.format(t.followers || 0)}</b><small>${nf.format(t.likes || 0)} lượt thích</small></div>
      <div class="kpi"><span>BLUEPRINT</span><b>${nf.format(c.blueprints || 0)}</b><small>${nf.format(c.videos || 0)} video · ${nf.format(c.packs || 0)} gói</small></div>
      ${(data.by_platform || []).map((p) => `
        <div class="kpi"><span>${safe(String(p.platform).toUpperCase())}</span><b>${money(p.revenue)}</b><small>${nf.format(p.views)} view · ${nf.format(p.posts)} bài</small></div>`).join('')}`;

    $('#metrics-recent').innerHTML = (data.recent || []).length
      ? data.recent.map((m) => `
        <div class="metric-row">
          <span><i class="${PLATFORM_ICON[m.platform] || 'fas fa-globe'}"></i> ${safe(m.platform)} · ${nf.format(m.views)} view</span>
          <b>${money(m.revenue_usd)}</b>
        </div>`).join('')
      : '<p class="muted-note">Chưa có số liệu. Nhập kết quả thực từ dashboard nền tảng để theo dõi thu nhập theo thời gian.</p>';
  } catch (err) {
    console.error(err);
  }
}

$('#metric-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.target.querySelector('button[type=submit]');
  const restore = busy(button, 'Đang lưu…');
  try {
    await api('/api/metrics', {
      method: 'POST',
      body: JSON.stringify({
        platform: $('#m-platform').value,
        revenue_source: $('#m-source').value,
        views: Number($('#m-views').value) || 0,
        likes: Number($('#m-likes').value) || 0,
        followers_gained: Number($('#m-followers').value) || 0,
        revenue_usd: Number($('#m-revenue').value) || 0,
        blueprint_id: state.blueprintId || null,
      }),
    });
    notify('Đã lưu số liệu');
    ['#m-views', '#m-likes', '#m-followers', '#m-revenue'].forEach((s) => { $(s).value = '0'; });
    loadMetrics();
  } catch (err) {
    notify(err.message, true);
  } finally { restore(); }
});

$('#metrics-refresh-btn').addEventListener('click', () => { loadMetrics(); notify('Đã làm mới số liệu'); });

$('#revenue-model-btn').addEventListener('click', async (event) => {
  const restore = busy(event.currentTarget, 'Đang phân tích…');
  try {
    const b = brief();
    const data = await api('/api/revenue/model', {
      method: 'POST',
      body: JSON.stringify({ niche: b.niche, platform: b.platform, audience: b.audience, language: b.language, model: b.model }),
    });
    $('#revenue-model-card').innerHTML = `
      <div class="section-title">Mô hình thu nhập ${data.ai ? '' : '· LOCAL'} <small>THAM KHẢO, KHÔNG PHẢI TƯ VẤN TÀI CHÍNH</small></div>
      <div class="stream-list">
        ${(data.streams || []).map((s) => `
          <div class="stream">
            <div class="stream-head"><h4>${safe(s.name)}</h4><span class="effort">${safe(s.effort)}</span></div>
            <p>${safe(s.how_it_works)}</p>
            <p><b>Điều kiện:</b> ${safe(s.requirement)}</p>
            <p><b>Thực tế:</b> ${safe(s.realistic_note)}</p>
          </div>`).join('')}
      </div>
      <div class="section-title" style="margin-top:14px">Lộ trình mở rộng <small>LÀM TUẦN TỰ</small></div>
      <ul class="checklist">${(data.scaling_plan || []).map((s) => `<li>${safe(s)}</li>`).join('')}</ul>
      <p class="notice">${safe(data.disclosure)}</p>`;
    notify('Đã dựng mô hình thu nhập');
  } catch (err) {
    notify(err.message, true);
  } finally { restore(); }
});

/* ============================== thư viện ============================== */
async function loadLibrary() {
  try {
    const data = await api('/api/forge/blueprints?limit=12');
    const list = data.blueprints || [];
    $('#library-list').innerHTML = list.length
      ? list.map((bp) => `
        <div class="library-card">
          <h4>${safe(bp.title || bp.concept)}</h4>
          <p>${safe(String(bp.concept || '').slice(0, 110))}</p>
          <div class="library-meta">
            <span>SCORE ${safe(bp.viral_score)} · ${safe(bp.duration_sec)}s</span>
            <span class="badge ${safe(bp.status)}">${safe(String(bp.status).toUpperCase())}</span>
          </div>
          <div class="tool-row">
            <button class="button micro" type="button" data-load-bp="${safe(bp.id)}">MỞ LẠI</button>
            <button class="button micro" type="button" data-del-bp="${safe(bp.id)}">XOÁ</button>
          </div>
        </div>`).join('')
      : '<p class="muted-note">Chưa có blueprint nào. Tạo blueprint đầu tiên ở khung bên trên.</p>';
  } catch (err) {
    console.error(err);
  }
}

$('#library-refresh-btn').addEventListener('click', () => { loadLibrary(); notify('Đã làm mới thư viện'); });

$('#library-list').addEventListener('click', async (event) => {
  const loadBtn = event.target.closest('[data-load-bp]');
  const delBtn = event.target.closest('[data-del-bp]');

  if (loadBtn) {
    const id = loadBtn.dataset.loadBp;
    const restore = busy(loadBtn, '…');
    try {
      const data = await api(`/api/forge/blueprints/${encodeURIComponent(id)}`);
      state.blueprintId = data.id;
      state.blueprint = data.blueprint;
      state.ideaId = null;
      state.images = {};
      state.audio = null;
      state.video = null;
      state.packs = [];
      (data.assets || []).forEach((a) => {
        if (a.kind === 'image') state.images[a.shot_index || 0] = { url: a.url, key: a.r2_key };
        if (a.kind === 'audio') state.audio = { url: a.url, key: a.r2_key };
        if (a.kind === 'video') state.video = { url: a.url, key: a.r2_key };
      });
      const srtRes = await api('/api/forge/srt', { method: 'POST', body: JSON.stringify({ shots: state.blueprint.shots }) });
      state.srt = srtRes.srt;
      renderBlueprint();
      if (state.audio) {
        $('#audio-output').innerHTML = `<audio controls src="${safe(state.audio.url)}"></audio>
          <a class="download" href="${safe(state.audio.url)}?download=1" download><i class="fas fa-download"></i> TẢI MP3</a>`;
        progress('audio', 100, 'Đã có giọng đọc từ trước');
      }
      if (state.video) {
        $('#video-output').innerHTML = `<video controls src="${safe(state.video.url)}"></video>
          <a class="download" href="${safe(state.video.url)}?download=1" download><i class="fas fa-download"></i> TẢI VIDEO</a>`;
      }
      notify('Đã mở lại blueprint');
    } catch (err) {
      notify(err.message, true);
    } finally { restore(); }
    return;
  }

  if (delBtn) {
    if (!confirm('Xoá blueprint này và toàn bộ media của nó?')) return;
    try {
      const deletedId = delBtn.dataset.delBp;
      await api(`/api/forge/blueprints/${encodeURIComponent(deletedId)}`, { method: 'DELETE' });
      notify('Đã xoá');
      // Nếu xoá chính blueprint đang mở → reset workspace về trạng thái ban đầu
      if (state.blueprintId === deletedId) {
        state.blueprintId = null;
        state.blueprint = null;
        state.ideaId = null;
        state.images = {};
        state.audio = null;
        state.video = null;
        state.packs = [];
        $('#blueprint').classList.add('hidden');
        $('#refine-panel').classList.add('hidden');
        $('#empty-state').classList.remove('hidden');
        setActiveStep('step-1');
      }
      loadLibrary();
      loadMetrics();
    } catch (err) {
      notify(err.message, true);
    }
  }
});

/* ============================== stepper nav ============================== */
$$('.step-chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    const target = document.getElementById(chip.dataset.goto);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setActiveStep(chip.dataset.goto);
    } else {
      notify('Hãy tạo blueprint trước để mở bước này');
    }
  });
});

boot();
