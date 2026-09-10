/* Agent Crew — Coordinator chạy tại browser: điều phối 6 tác nhân chuyên biệt.
 * State machine dùng chung src/lib/agent-core.ts (bundle IIFE thành AgentCore).
 * Mỗi nhiệm vụ = một request HTTP riêng (giới hạn 60s Function — Spec BR5). */
'use strict';

const $ = (s) => document.querySelector(s);
const safe = (v = '') => String(v ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

const CREW_KEY = 'agent_crew_state_v1';
const IMAGE_RETRIES = 2; // 1 lần chạy + 1 lần thử lại (Design: retry 1 lần mỗi ảnh)

let stopRequested = false;
let running = false;

/* ============================== helpers ============================== */

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

let toastTimer = null;
function notify(message, isError = false) {
  const node = $('#toast');
  clearTimeout(toastTimer);
  node.textContent = message;
  node.classList.add('show');
  node.style.borderColor = isError ? 'rgba(255,139,135,.6)' : 'rgba(102,245,205,.4)';
  toastTimer = setTimeout(() => node.classList.remove('show'), 4200);
}

function card(step) {
  return document.querySelector(`.agent-card[data-agent="${step}"]`);
}

function setCard(step, state, output) {
  const node = card(step);
  if (!node) return;
  node.dataset.state = state;
  const badge = { idle: 'IDLE', running: 'RUNNING', done: 'DONE', error: 'ERROR' }[state] || state.toUpperCase();
  const badgeNode = node.querySelector('.agent-badge');
  if (badgeNode) badgeNode.textContent = badge;
  if (output !== undefined) {
    const out = node.querySelector('.agent-out');
    if (out) out.textContent = output;
  }
}

function resetCards() {
  document.querySelectorAll('.agent-card').forEach((node) => {
    node.dataset.state = 'idle';
    const badge = node.querySelector('.agent-badge');
    if (badge) badge.textContent = 'IDLE';
  });
}

function log(line, cls = '') {
  const box = $('#crew-log');
  const row = document.createElement('div');
  if (cls) row.className = cls;
  row.textContent = line;
  box.appendChild(row);
  box.scrollTop = box.scrollHeight;
}

function setProgress(pct, message) {
  $('#crew-bar').style.width = `${pct}%`;
  $('#crew-pct').textContent = `${pct}%`;
  $('#crew-msg').textContent = message;
}

function readBrief() {
  return {
    niche: $('#c-niche').value.trim(),
    audience: $('#c-audience').value.trim() || '18–34 tuổi',
    platform: $('#c-platform').value,
    duration_sec: Number($('#c-duration').value) || 45,
    tone: $('#c-tone').value,
    goal: $('#c-goal').value.trim(),
    language: 'Tiếng Việt',
    voice: $('#c-voice').value,
    model: $('#c-model').value,
  };
}

/* ============================== state ============================== */

function freshState(brief) {
  return {
    brief,
    jobId: null,
    // Các trường của state machine (agent-core.planNext)
    trendsDone: false,
    blueprintDone: false,
    reviewRounds: 0,
    lastDecision: null,
    pendingShots: [],
    voiceDone: false,
    distributionDone: false,
    // Dữ liệu phụ phục vụ UI + kết quả
    allTrends: [],
    chosenTrend: null,
    trendsAI: false,
    blueprintId: null,
    blueprint: null,
    review: null,
    images: {},       // shotIndex -> url
    failedShots: [],
    audioUrl: null,
    packs: [],
    finishedAt: null,
  };
}

function loadSavedState() {
  try {
    const raw = localStorage.getItem(CREW_KEY);
    if (!raw) return null;
    const state = JSON.parse(raw);
    return state && state.brief ? state : null;
  } catch {
    return null;
  }
}

function saveState(state) {
  try { localStorage.setItem(CREW_KEY, JSON.stringify(state)); } catch { /* hết quota — bỏ qua */ }
}

function doneSteps(state) {
  const done = [];
  if (state.trendsDone) done.push('trends');
  if (state.blueprintDone) done.push('blueprint');
  if (state.review && state.review.decision === 'approve') done.push('review');
  if (state.reviewRounds > 1 && state.lastDecision === 'approve') done.push('revise');
  done.push('images'); // trọng số ảnh luôn được tính, độ hoàn chỉnh qua imagesFrac
  if (state.voiceDone) done.push('voice');
  if (state.distributionDone) done.push('distribution');
  return done;
}

function imagesFrac(state) {
  const total = state.blueprint?.shots?.length || 0;
  if (!total) return state.voiceDone || state.distributionDone ? 1 : 0;
  const finished = total - state.pendingShots.length;
  return Math.max(0, Math.min(1, finished / total));
}

function currentProgress(state) {
  const AgentCoreRef = window.AgentCore;
  if (!AgentCoreRef) return 0;
  return AgentCoreRef.weightProgress(doneSteps(state), imagesFrac(state));
}

async function saveJob(state, patch = {}) {
  const body = {
    id: state.jobId,
    status: patch.status || 'running',
    progress: patch.progress ?? currentProgress(state),
    message: patch.message || '',
  };
  if (patch.params) body.params = patch.params;
  if (patch.result) body.result = patch.result;
  if (patch.error) body.error = patch.error;
  const res = await api('/api/agents/jobs', { method: 'POST', body: JSON.stringify(body) });
  if (!state.jobId) {
    if (!res?.id) throw new Error('Máy chủ không trả mã job — không thể bảo toàn lịch sử chạy.');
    state.jobId = res.id;
  }
  return res;
}

/* ============================== các bước tác nhân ============================== */

async function stepTrends(state) {
  setCard('trends', 'running');
  setProgress(currentProgress(state), 'Trinh sát xu hướng đang săn góc nội dung…');
  log('TREND SCOUT: phân tích đà nội dung theo ngách…');
  const res = await api('/api/agents/trends', {
    method: 'POST',
    body: JSON.stringify({
      niche: state.brief.niche,
      audience: state.brief.audience,
      platform: state.brief.platform,
      language: state.brief.language,
      count: 5,
      model: state.brief.model,
    }),
  });
  const AgentCoreRef = window.AgentCore;
  const best = AgentCoreRef
    ? AgentCoreRef.pickBestTrend(res.trends)
    : (res.trends || []).slice().sort((a, b) => (b.score || 0) - (a.score || 0))[0] || null;
  if (!best) throw new Error('Không nhận được góc xu hướng nào');
  state.allTrends = res.trends || [];
  state.chosenTrend = best;
  state.trendsAI = Boolean(res.ai);
  state.trendsDone = true;
  setCard('trends', 'done', `Chọn: "${safe(best.topic)}" (score ${best.score})${res.ai ? '' : ' · fallback'}`);
  log(`TREND SCOUT: chọn "${best.topic}" — ${best.trend_driver || best.angle || ''}`, 'log-ok');
  if (!res.ai) log('TREND SCOUT: AI chưa cấu hình — dùng khuôn mẫu bền vững.', 'log-warn');
}

function topicForBlueprint(state, extraSuggestions) {
  const base = state.chosenTrend?.topic || state.brief.niche;
  if (!extraSuggestions?.length) return base;
  const fixes = extraSuggestions.slice(0, 3).join('; ').slice(0, 300);
  return `${base}. Lưu ý chỉnh sửa từ QA: ${fixes}`;
}

async function stepBlueprint(state) {
  setCard('blueprint', 'running');
  setProgress(currentProgress(state), 'Chiến lược gia đang viết blueprint…');
  log('STRATEGIST: dựng kịch bản + shot list + SEO…');
  const res = await api('/api/forge/blueprint', {
    method: 'POST',
    body: JSON.stringify({
      topic: topicForBlueprint(state),
      niche: state.brief.niche,
      audience: state.brief.audience,
      platform: state.brief.platform,
      duration_sec: state.brief.duration_sec,
      tone: state.brief.tone,
      language: state.brief.language,
      goal: state.brief.goal,
      model: state.brief.model,
    }),
  });
  state.blueprintId = res.id;
  state.blueprint = res.blueprint;
  state.blueprintDone = true;
  state.pendingShots = (res.blueprint?.shots || []).map((_, i) => i);
  state.images = {};
  state.failedShots = [];
  setCard('blueprint', 'done', `${res.blueprint.shots.length} shot · score ${res.blueprint.viral_score}${res.ai ? '' : ' · fallback'}`);
  log(`STRATEGIST: blueprint ${res.id} với ${res.blueprint.shots.length} shot.`, 'log-ok');
}

async function stepReview(state) {
  setCard('review', 'running');
  setProgress(currentProgress(state), `QA kiểm duyệt độc lập (lượt ${state.reviewRounds + 1})…`);
  log(`QA REVIEWER: kiểm tra hook, nhịp, chính sách (lượt ${state.reviewRounds + 1})…`);
  const res = await api('/api/agents/review', {
    method: 'POST',
    body: JSON.stringify({
      blueprint: state.blueprint,
      language: state.brief.language,
      model: state.brief.model,
    }),
  });
  state.review = res.review;
  state.reviewRounds += 1;
  state.lastDecision = res.review.decision;
  const label = res.review.decision === 'approve' ? 'APPROVE' : 'REVISE';
  setCard('review', res.review.decision === 'approve' ? 'done' : 'error',
    `${label} · score ${res.review.score} · ${res.review.issues.length} vấn đề${res.ai ? '' : ' · không AI'}`);
  if (res.review.decision === 'approve') {
    log(`QA REVIEWER: APPROVE — score ${res.review.score}.`, 'log-ok');
    if (res.review.issues?.length) log(`QA lưu ý: ${res.review.issues[0]}`, 'log-warn');
  } else {
    log(`QA REVIEWER: REVISE — ${res.review.issues.slice(0, 2).join(' | ')}`, 'log-warn');
  }
}

async function stepRevise(state) {
  setCard('blueprint', 'running');
  setProgress(currentProgress(state), 'Chiến lược gia chỉnh theo góp ý của QA…');
  log('STRATEGIST: viết lại blueprint theo góp ý QA…');
  const res = await api('/api/forge/blueprint', {
    method: 'POST',
    body: JSON.stringify({
      topic: topicForBlueprint(state, state.review?.suggestions || []),
      niche: state.brief.niche,
      audience: state.brief.audience,
      platform: state.brief.platform,
      duration_sec: state.brief.duration_sec,
      tone: state.brief.tone,
      language: state.brief.language,
      goal: state.brief.goal,
      model: state.brief.model,
    }),
  });
  state.blueprintId = res.id;
  state.blueprint = res.blueprint;
  state.pendingShots = (res.blueprint?.shots || []).map((_, i) => i);
  state.images = {};
  state.failedShots = [];
  state.lastDecision = null; // cho QA duyệt lại
  setCard('blueprint', 'done', `Đã chỉnh: ${res.blueprint.shots.length} shot · score ${res.blueprint.viral_score}`);
  log(`STRATEGIST: blueprint bản chỉnh ${res.id}.`, 'log-ok');
}

async function generateOneImage(state, index) {
  const shot = state.blueprint.shots[index];
  for (let attempt = 1; attempt <= IMAGE_RETRIES; attempt++) {
    if (stopRequested) return 'stopped';
    try {
      const res = await api('/api/media/image', {
        method: 'POST',
        body: JSON.stringify({
          prompt: shot.image_prompt,
          blueprint_id: state.blueprintId,
          shot_index: index,
          width: 768,
          height: 1344,
        }),
      });
      state.images[index] = res.url;
      return 'ok';
    } catch (err) {
      log(`ART DIRECTOR: shot ${index + 1} thất bại (lần ${attempt}): ${err.message}`, attempt === IMAGE_RETRIES ? 'log-err' : 'log-warn');
      if (attempt === IMAGE_RETRIES) return 'fail';
    }
  }
  return 'fail';
}

async function stepImages(state) {
  setCard('images', 'running');
  const total = state.pendingShots.length + Object.keys(state.images).length;
  log(`ART DIRECTOR: vẽ ${state.pendingShots.length} ảnh 9:16…`);
  while (state.pendingShots.length) {
    if (stopRequested) return;
    const index = state.pendingShots[0];
    setProgress(currentProgress(state), `Giám đốc hình ảnh: shot ${index + 1}/${total}…`);
    setCard('images', 'running', `Đã xong ${Object.keys(state.images).length}/${total} shot`);
    const outcome = await generateOneImage(state, index);
    if (outcome === 'stopped') return;
    if (outcome === 'ok') {
      log(`ART DIRECTOR: shot ${index + 1} xong.`, 'log-ok');
    } else {
      state.failedShots.push(index);
    }
    state.pendingShots.shift();
    saveState(state);
    await saveJob(state, { message: `Ảnh ${Object.keys(state.images).length}/${total}` });
  }
  const missed = state.failedShots.length;
  setCard('images', missed ? 'error' : 'done',
    missed ? `Thiếu ${missed} shot (bấm chạy lại để thử tiếp)` : `Đủ ${Object.keys(state.images).length} ảnh 9:16`);
  log(missed ? `ART DIRECTOR: thiếu ${missed} ảnh — có thể bấm "chạy lại" để thử bổ sung.` : `ART DIRECTOR: đủ ảnh cho ${total} shot.`, missed ? 'log-warn' : 'log-ok');
}

async function stepVoice(state) {
  setCard('voice', 'running');
  setProgress(currentProgress(state), 'Dựng giọng: thu voice-over toàn kịch bản…');
  log('VOICE ACTOR: tổng hợp giọng đọc…');
  const res = await api('/api/media/speech', {
    method: 'POST',
    body: JSON.stringify({
      text: state.blueprint.script,
      voice: state.brief.voice,
      blueprint_id: state.blueprintId,
    }),
  });
  state.audioUrl = res.url;
  state.voiceDone = true;
  setCard('voice', 'done', `MP3 ${Math.round((res.size || 0) / 1024)}KB · ${res.chunks} đoạn`);
  log(`VOICE ACTOR: xong (${res.chunks} đoạn, ${(res.chars || 0).toLocaleString('vi-VN')} ký tự).`, 'log-ok');
}

async function stepDistribution(state) {
  setCard('distribution', 'running');
  setProgress(currentProgress(state), 'Nhà phân phối: đóng gói bài đăng…');
  log('PUBLISHER: tạo caption + hashtag cho TikTok/Facebook/Instagram/X…');
  const platforms = ['tiktok', 'facebook', 'instagram', 'x'];
  state.packs = [];
  for (const platform of platforms) {
    const res = await api('/api/distribution/build', {
      method: 'POST',
      body: JSON.stringify({
        blueprint_id: state.blueprintId,
        platforms: [platform],
        language: state.brief.language,
      }),
    });
    state.packs.push(...(res.packs || []));
    setCard('distribution', 'running', `${state.packs.length}/${platforms.length} gói nền tảng`);
    await saveJob(state, { message: `Gói phân phối ${state.packs.length}/${platforms.length}` });
  }
  state.distributionDone = true;
  setCard('distribution', 'done', `${state.packs.length} gói nền tảng`);
  log(`PUBLISHER: ${state.packs.length} gói bài đăng sẵn sàng.`, 'log-ok');
}

/* ============================== kết quả ============================== */

function renderResult(state) {
  const bp = state.blueprint;
  const review = state.review;
  const totalShots = bp?.shots?.length || 0;
  const imgCount = Object.keys(state.images).length;
  const missed = state.failedShots || [];

  const reviewHTML = review ? `
    <div class="review-box ${review.decision === 'revise' ? 'revise' : ''}">
      <b>QA: ${review.decision === 'approve' ? 'ĐẠT' : 'CẦN CHỈNH'} · score ${review.score}/100</b>${review.ai ? '' : ' <i>(không kiểm duyệt AI — hãy tự rà checklist)</i>'}
      ${review.issues?.length ? `<ul>${review.issues.map((i) => `<li>${safe(i)}</li>`).join('')}</ul>` : ''}
    </div>` : '';

  const mediaHTML = totalShots ? `
    <div class="section-title">ẢNH 9:16 · ${imgCount}/${totalShots} SHOT</div>
    <div class="result-media">${bp.shots.map((_, i) => state.images[i]
      ? `<a href="${safe(state.images[i])}" target="_blank" rel="noopener"><img src="${safe(state.images[i])}" alt="Shot ${i + 1}" loading="lazy" /></a>`
      : (missed.includes(i) ? `<div class="miss">SHOT ${i + 1}<br>THẤT BẠI</div>` : '')
    ).join('')}</div>` : '';

  const audioHTML = state.audioUrl ? `
    <div class="section-title">GIỌN ĐỌC</div>
    <audio controls style="width:100%" src="${safe(state.audioUrl)}"></audio>
    <p><a class="download" style="color:var(--mint)" href="${safe(state.audioUrl)}?download=1" download><i class="fas fa-download"></i> Tải MP3</a></p>` : '';

  const packsHTML = state.packs.length ? `
    <div class="section-title">GÓI ĐĂNG BÀI</div>
    ${state.packs.map((p) => `
      <div class="review-box" style="margin-top:8px">
        <b>${safe(String(p.platform).toUpperCase())}</b> <span style="color:var(--faint)">· giờ vàng: ${safe(p.best_time || '—')}</span>
        <p style="margin:6px 0 0">${safe(p.caption || '')}</p>
        <p style="margin:6px 0 0;color:var(--mint)">${safe((p.hashtags || []).join(' '))}</p>
      </div>`).join('')}` : '';

  $('#crew-result-body').innerHTML = `
    <p style="margin:0 0 4px"><b>${safe(bp?.titles?.[0] || bp?.concept || 'Blueprint')}</b></p>
    <p style="margin:0;color:var(--muted);font-size:13px">Blueprint ID <code>${safe(state.blueprintId)}</code> · ${totalShots} shot · đã lưu vào thư viện.</p>
    ${reviewHTML}${mediaHTML}${audioHTML}${packsHTML}
    <div style="margin-top:18px;display:flex;gap:10px;flex-wrap:wrap">
      <a class="button solid" href="/#bp=${encodeURIComponent(state.blueprintId)}"><i class="fas fa-film"></i> Mở trong dây chuyền để dựng MP4</a>
      ${state.audioUrl ? `<a class="button ghost" href="${safe(state.audioUrl)}?download=1" download><i class="fas fa-download"></i> Tải MP3</a>` : ''}
    </div>
    <p class="fineprint" style="margin-top:12px">Bước dựng video MP4 chạy bằng canvas ngay trong trình duyệt ở trang dây chuyền
    (ảnh Ken Burns + phụ đề + giọng đọc). Kiểm chứng số liệu, quyền tư liệu và chính sách nền tảng trước khi đăng.</p>`;
  $('#crew-result').classList.remove('hidden');
}

async function renderHistory() {
  try {
    const data = await api('/api/agents/jobs');
    const jobs = data.jobs || [];
    $('#crew-history').innerHTML = jobs.length ? `
      <div class="section-title">LỊCH SỬ RA LỆNH</div>
      <table class="jobs-table">
        <tr><th>THỜI GIAN</th><th>NGÁCH</th><th>TIẾN ĐỘ</th><th>TRẠNG THÁI</th></tr>
        ${jobs.map((j) => `
          <tr>
            <td>${safe(String(j.created_at || '').slice(0, 16).replace('T', ' '))}</td>
            <td>${safe(j.params?.niche || '—')}</td>
            <td>${safe(j.progress)}%</td>
            <td><span class="badge ${safe(j.status)}">${safe(String(j.status).toUpperCase())}</span></td>
          </tr>`).join('')}
      </table>` : '';
  } catch { /* bỏ qua — lịch sử chỉ là tiện ích */ }
}

/* ============================== vòng lặp Coordinator ============================== */

function setRunningUI(isRunning) {
  running = isRunning;
  $('#crew-run').disabled = isRunning;
  $('#crew-stop').disabled = !isRunning;
}

async function runCrew(state, resumed) {
  stopRequested = false;
  setRunningUI(true);
  resetCards();
  $('#crew-result').classList.add('hidden');
  if (!resumed) {
    ['trends', 'blueprint', 'review', 'images', 'voice', 'distribution'].forEach((s) => setCard(s, 'idle'));
  }
  log(resumed ? `TIẾP TỤC phiên trước — lưu ý: trạng thái thẻ có thể chưa khớp 100%.` : 'COORDINATOR: nhận lệnh. Bắt đầu điều phối…', resumed ? 'log-warn' : 'log-ok');

  try {
    if (!state.jobId) {
      await saveJob(state, { message: 'Khởi động đội tác nhân', params: state.brief, progress: 0 });
    }
    for (;;) {
      const AgentCoreRef = window.AgentCore;
      const plan = AgentCoreRef
        ? AgentCoreRef.planNext(state)
        : { step: 'abort', reason: 'Thiếu bundle AgentCore — kiểm tra build.' };

      if (stopRequested) {
        log('COORDINATOR: dừng theo yêu cầu. Trạng thái đã lưu — bấm "RA LỆNH" để chạy tiếp.', 'log-warn');
        await saveJob(state, { message: 'Tạm dừng bởi người dùng' });
        notify('Đã dừng — trạng thái được giữ để chạy tiếp');
        break;
      }

      if (plan.step === 'finish') {
        state.finishedAt = new Date().toISOString();
        const result = {
          blueprint_id: state.blueprintId,
          title: state.blueprint?.titles?.[0] || state.blueprint?.concept || '',
          trend: state.chosenTrend?.topic || '',
          review_score: state.review?.score ?? null,
          images_ok: Object.keys(state.images).length,
          images_missed: state.failedShots.length,
          audio_url: state.audioUrl,
          packs: state.packs.length,
        };
        await saveJob(state, { status: 'done', message: 'Hoàn tất — chờ bạn duyệt', result, progress: 100 });
        setProgress(100, 'Hoàn tất — duyệt kết quả bên dưới');
        log('COORDINATOR: hoàn tất. Bạn duyệt kết quả cuối cùng.', 'log-ok');
        renderResult(state);
        notify('Cả đội đã xong việc!');
        break;
      }

      if (plan.step === 'abort') {
        await saveJob(state, { status: 'error', message: 'Dừng theo gate QA', error: plan.reason });
        setProgress(currentProgress(state), 'Dừng theo gate QA');
        log(`COORDINATOR: ${plan.reason}`, 'log-err');
        notify('QA chặn dây chuyền — xem log để biết lý do', true);
        break;
      }

      setProgress(currentProgress(state), `Đang chạy: ${plan.step}…`);
      saveState(state);
      switch (plan.step) {
        case 'trends': await stepTrends(state); break;
        case 'blueprint': await stepBlueprint(state); break;
        case 'review': await stepReview(state); break;
        case 'revise': await stepRevise(state); break;
        case 'images': await stepImages(state); break;
        case 'voice': await stepVoice(state); break;
        case 'distribution': await stepDistribution(state); break;
        default:
          throw new Error(`Bước không rõ: ${plan.step}`);
      }
      saveState(state);
      await saveJob(state, { message: `Xong bước ${plan.step}` });
    }
  } catch (err) {
    log(`COORDINATOR: lỗi — ${err.message}`, 'log-err');
    if (state.jobId) {
      try {
        await saveJob(state, { status: 'error', message: 'Lỗi giữa chừng', error: err.message });
      } catch (saveErr) {
        log(`Không thể đánh dấu job lỗi: ${saveErr.message}`, 'log-err');
      }
    }
    notify(err.message, true);
  } finally {
    saveState(state);
    setRunningUI(false);
    renderHistory();
  }
}

/* ============================== boot ============================== */

async function boot() {
  try {
    const [health, config] = await Promise.all([api('/api/health'), api('/api/config')]);
    $('#c-model').innerHTML = config.text_models
      .map((m) => `<option value="${safe(m)}"${m === config.default_text_model ? ' selected' : ''}>${safe(m)}</option>`)
      .join('');
    $('#c-voice').innerHTML = config.voices
      .map((v) => `<option value="${safe(v.code)}"${v.code === 'vi' ? ' selected' : ''}>${safe(v.flag)} ${safe(v.name)}</option>`)
      .join('');
    const badge = $('#health-status');
    const text = $('#health-text');
    if (health.db && health.llm) { text.textContent = 'Crew ready · AI on'; }
    else if (health.db) { text.textContent = 'Crew ready · không AI (fallback)'; }
    else { badge.className = 'status err'; text.textContent = 'Database chưa sẵn sàng'; }
  } catch (err) {
    $('#health-text').textContent = 'Mất kết nối API';
    console.error(err);
  }
  renderHistory();

  // Phục hồi thông tin brief từ phiên trước (không tự chạy lại).
  const saved = loadSavedState();
  if (saved?.brief) {
    $('#c-niche').value = saved.brief.niche || '';
    $('#c-audience').value = saved.brief.audience || '';
    $('#c-duration').value = String(saved.brief.duration_sec || 45);
    $('#c-platform').value = saved.brief.platform || 'TikTok & YouTube Shorts';
    $('#c-tone').value = saved.brief.tone || 'Kể chuyện giàu nhịp';
    $('#c-goal').value = saved.brief.goal || '';
    if (saved.jobId && !saved.finishedAt) {
      log(`Có phiên chưa xong (job ${saved.jobId}). Nhập lại đúng ngách rồi bấm RA LỆNH để tiếp tục.`, 'log-warn');
    }
  }
}

$('#crew-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (running) return;
  const brief = readBrief();
  if (brief.niche.length < 2) return notify('Hãy nhập ngách nội dung', true);

  const saved = loadSavedState();
  const canResume = saved && !saved.finishedAt && saved.jobId
    && (saved.brief?.niche || '').toLowerCase() === brief.niche.toLowerCase()
    && !['done'].includes(saved.status || '');

  let state;
  if (canResume && confirm(`Tiếp tục phiên trước của ngách này?\n\nOK = tiếp tục từ bước đang dở\nCancel = bắt đầu lại từ đầu`)) {
    state = { ...freshState(brief), ...saved, brief: { ...saved.brief, ...brief } };
    log(`Khôi phục phiên ${state.jobId}.`, 'log-warn');
  } else {
    state = freshState(brief);
    try { localStorage.removeItem(CREW_KEY); } catch { /* bỏ qua */ }
  }
  runCrew(state, Boolean(canResume && state.jobId && state.reviewRounds > 0));
});

$('#crew-stop').addEventListener('click', () => {
  if (!running) return;
  stopRequested = true;
  $('#crew-msg').textContent = 'Đang dừng sau nhiệm vụ hiện tại…';
  log('COORDINATOR: nhận tín hiệu dừng — xong nhiệm vụ hiện tại sẽ nghỉ.', 'log-warn');
});

boot();
