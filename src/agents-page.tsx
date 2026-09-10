/** Trang /agents — Đội tác nhân (Coordinator + 6 tác nhân chuyên biệt). */
export function renderAgents(): string {
  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="theme-color" content="#071314" />
<meta name="description" content="Agent Crew — đội tác nhân AI tự chạy trọn dây chuyền video faceless: xu hướng, kịch bản, kiểm duyệt, ảnh, giọng đọc, phân phối." />
<title>Agent Crew — Faceless Forge</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
<link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.5.2/css/all.min.css" rel="stylesheet" />
<link rel="stylesheet" href="/static/style.css" />
<style>
  .crew-shell { width: min(1240px, calc(100% - 40px)); margin: 0 auto 80px; }
  .crew-hero { padding: 42px 0 26px; }
  .crew-hero h1 { font-size: clamp(26px, 4vw, 40px); margin: 10px 0 12px; line-height: 1.15; }
  .crew-hero h1 em { color: var(--mint); font-style: normal; }
  .crew-hero p { color: var(--muted); max-width: 860px; line-height: 1.65; }

  .crew-grid { display: grid; grid-template-columns: 380px 1fr; gap: 22px; align-items: start; }
  @media (max-width: 980px) { .crew-grid { grid-template-columns: 1fr; } }

  .panel { border: 1px solid var(--line); border-radius: 18px; background: var(--panel); padding: 22px; backdrop-filter: blur(9px); }
  .panel h2 { margin: 0 0 4px; font-size: 17px; }
  .panel-heading { display: flex; gap: 14px; align-items: flex-start; margin-bottom: 16px; }
  .panel-heading p { margin: 0; color: var(--muted); font-size: 13px; }
  .panel .step { font-family: "DM Mono", monospace; color: var(--mint); border: 1px solid rgba(102,245,205,.35); border-radius: 10px; padding: 4px 9px; font-size: 12px; }

  label { display: block; font-size: 12px; font-weight: 600; color: var(--muted); margin-bottom: 12px; }
  label input, label select, label textarea {
    width: 100%; margin-top: 6px; padding: 10px 12px; border-radius: 11px;
    border: 1px solid var(--line); background: rgba(7,19,20,.75); color: var(--ink); font: inherit; font-size: 14px;
  }
  .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 12px; }

  .button { display: inline-flex; align-items: center; gap: 9px; cursor: pointer; border-radius: 12px; border: 1px solid rgba(102,245,205,.4);
    background: transparent; color: var(--mint); font: inherit; font-weight: 700; font-size: 13px; letter-spacing: .04em; padding: 11px 16px; transition: .15s; }
  .button:hover { background: rgba(102,245,205,.09); }
  .button.solid { background: var(--mint); color: #06231d; border-color: var(--mint); }
  .button.solid:hover { background: #8cf7da; }
  .button.ghost { border-color: var(--line); color: var(--muted); }
  .button.micro { padding: 6px 10px; font-size: 11px; border-radius: 9px; }
  .button:disabled { opacity: .45; cursor: not-allowed; }
  .button.wide { width: 100%; justify-content: center; }

  .crew-flow { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
  @media (max-width: 700px) { .crew-flow { grid-template-columns: 1fr 1fr; } }
  .agent-card { border: 1px solid var(--line); border-radius: 14px; padding: 14px; background: rgba(7,19,20,.55); min-height: 118px; position: relative; transition: border-color .2s; }
  .agent-card .agent-ic { width: 34px; height: 34px; display: grid; place-items: center; border-radius: 10px; border: 1px solid var(--line); color: var(--muted); margin-bottom: 9px; font-size: 15px; }
  .agent-card h4 { margin: 0 0 3px; font-size: 13.5px; }
  .agent-card .agent-role { font-family: "DM Mono", monospace; font-size: 9.5px; color: var(--faint); letter-spacing: .08em; }
  .agent-card .agent-out { margin-top: 8px; font-size: 12px; color: var(--muted); line-height: 1.45; word-break: break-word; }
  .agent-card[data-state="running"] { border-color: rgba(102,245,205,.55); box-shadow: 0 0 22px rgba(102,245,205,.08); }
  .agent-card[data-state="running"] .agent-ic { color: var(--mint); border-color: rgba(102,245,205,.5); animation: pulse 1.1s ease-in-out infinite; }
  .agent-card[data-state="done"] { border-color: rgba(102,245,205,.35); }
  .agent-card[data-state="done"] .agent-ic { color: var(--mint); }
  .agent-card[data-state="error"] { border-color: rgba(255,139,135,.55); }
  .agent-card[data-state="error"] .agent-ic { color: var(--danger); border-color: rgba(255,139,135,.5); }
  .agent-card .agent-badge { position: absolute; top: 12px; right: 12px; font-family: "DM Mono", monospace; font-size: 9px; letter-spacing: .1em; color: var(--faint); }
  .agent-card[data-state="done"] .agent-badge { color: var(--mint); }
  .agent-card[data-state="error"] .agent-badge { color: var(--danger); }
  .agent-card[data-state="running"] .agent-badge { color: var(--amber); }
  @keyframes pulse { 50% { opacity: .45; } }

  .crew-progress { margin: 18px 0 6px; }
  .bar { height: 8px; border-radius: 99px; background: rgba(7,19,20,.9); border: 1px solid var(--line); overflow: hidden; }
  .bar i { display: block; height: 100%; width: 0%; background: linear-gradient(90deg, var(--mint-dark), var(--mint)); transition: width .35s; }
  .crew-status { display: flex; justify-content: space-between; font-family: "DM Mono", monospace; font-size: 11px; color: var(--muted); margin-top: 8px; }

  .crew-log { margin-top: 16px; border: 1px solid var(--line); border-radius: 14px; background: rgba(4,12,12,.85); padding: 14px 16px; height: 210px; overflow-y: auto; font-family: "DM Mono", monospace; font-size: 11.5px; line-height: 1.7; color: var(--muted); }
  .crew-log .log-ok { color: var(--mint); }
  .crew-log .log-err { color: var(--danger); }
  .crew-log .log-warn { color: var(--amber); }
  .crew-log div::before { content: "› "; color: var(--faint); }

  .result-media { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 10px; margin-top: 12px; }
  .result-media img { width: 100%; aspect-ratio: 9/16; object-fit: cover; border-radius: 10px; border: 1px solid var(--line); }
  .result-media .miss { aspect-ratio: 9/16; border-radius: 10px; border: 1px dashed rgba(255,139,135,.5); display: grid; place-items: center; color: var(--danger); font-size: 10px; font-family: "DM Mono", monospace; text-align: center; padding: 6px; }

  .review-box { border-left: 3px solid var(--mint); padding: 8px 14px; margin-top: 12px; background: rgba(102,245,205,.05); border-radius: 0 10px 10px 0; font-size: 13px; line-height: 1.6; }
  .review-box.revise { border-color: var(--amber); background: rgba(255,211,107,.06); }
  .review-box ul { margin: 6px 0 0; padding-left: 18px; color: var(--muted); }

  .jobs-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  .jobs-table th { text-align: left; color: var(--faint); font-family: "DM Mono", monospace; font-size: 10px; letter-spacing: .1em; padding: 8px 10px; border-bottom: 1px solid var(--line); }
  .jobs-table td { padding: 9px 10px; border-bottom: 1px solid rgba(171,255,236,.06); color: var(--muted); }
  .jobs-table .badge { font-family: "DM Mono", monospace; font-size: 10px; }
  .badge.done { color: var(--mint); } .badge.error { color: var(--danger); } .badge.running { color: var(--amber); }

  .section-title { font-family: "DM Mono", monospace; font-size: 10.5px; letter-spacing: .16em; color: var(--faint); margin: 22px 0 10px; }
  .fineprint { color: var(--faint); font-size: 11.5px; line-height: 1.6; }
  .hidden { display: none !important; }
  .toast { position: fixed; left: 50%; bottom: 26px; transform: translateX(-50%) translateY(20px); background: rgba(10,28,27,.96); border: 1px solid rgba(102,245,205,.4); color: var(--ink); border-radius: 12px; padding: 11px 18px; font-size: 13px; opacity: 0; pointer-events: none; transition: .25s; z-index: 50; }
  .toast.show { opacity: 1; transform: translateX(-50%); }
</style>
</head>
<body>
<div class="noise" aria-hidden="true"></div>

<header class="topbar">
  <a class="brand" href="/" aria-label="Faceless Forge">
    <span class="brand-mark">✦</span>
    <span><b>FACELESS</b> FORGE<small>Agent Crew</small></span>
  </a>
  <nav class="topnav" aria-label="Điều hướng chính">
    <a href="/" class="topnav-link">Dây chuyền</a>
    <a href="/studio" class="topnav-link">Studio</a>
    <a href="/agents" class="topnav-link">Đội tác nhân</a>
  </nav>
  <span class="status" id="health-status"><i></i> <span id="health-text">Đang kiểm tra…</span></span>
</header>

<main class="crew-shell">
  <section class="crew-hero">
    <div class="eyebrow">COORDINATOR → SPECIALIZED AGENTS → REVIEW GATE → FINAL OUTPUT</div>
    <h1>Một cú bấm, <em>cả đội tác nhân</em> chạy thay bạn.</h1>
    <p>Coordinator điều phối 6 tác nhân chuyên biệt: Trinh sát xu hướng chọn góc nội dung bấm mạnh,
    Chiến lược gia viết blueprint, QA kiểm duyệt độc lập (chặn đứng nếu lệch chuẩn), Giám đốc hình ảnh
    vẽ đủ shot 9:16, Dựng giọng thu âm, Nhà phân phối đóng gói bài đăng cho 4 nền tảng. Bạn chỉ duyệt kết quả cuối.</p>
  </section>

  <div class="crew-grid">
    <!-- ---------- CỘT TRÁI: BRIEF + ĐIỀU PHỐI ---------- -->
    <aside class="panel">
      <div class="panel-heading">
        <span class="step">BRIEF</span>
        <div><h2>Giao việc cho cả đội</h2><p>Một brief duy nhất — các tác nhân tự phân công.</p></div>
      </div>

      <form id="crew-form">
        <label>Ngách nội dung (niche)
          <textarea id="c-niche" rows="2" required minlength="2" placeholder="Ví dụ: Tài chính cá nhân cho người mới"></textarea>
        </label>
        <div class="form-grid">
          <label>Khán giả<input id="c-audience" value="18–34 tuổi" /></label>
          <label>Thời lượng
            <select id="c-duration">
              <option value="30">30 giây</option>
              <option value="45" selected>45 giây</option>
              <option value="60">60 giây</option>
              <option value="90">90 giây</option>
            </select>
          </label>
        </div>
        <div class="form-grid">
          <label>Kênh đăng
            <select id="c-platform">
              <option>TikTok &amp; YouTube Shorts</option>
              <option>TikTok</option>
              <option>Facebook Reels</option>
              <option>Instagram Reels</option>
              <option>X (Twitter)</option>
            </select>
          </label>
          <label>Phong cách
            <select id="c-tone">
              <option>Kể chuyện giàu nhịp</option>
              <option>Bí ẩn / tò mò</option>
              <option>Giải thích dễ hiểu</option>
              <option>Tạo động lực</option>
            </select>
          </label>
        </div>
        <label>Mục tiêu kiếm tiền<input id="c-goal" value="Xây kênh faceless và phát triển thu nhập thụ động" /></label>
        <div class="form-grid">
          <label>Model AI<select id="c-model"></select></label>
          <label>Giọng đọc<select id="c-voice"></select></label>
        </div>
        <button class="button solid wide" id="crew-run" type="submit"><span>✦</span> RA LỆNH CHO CẢ ĐỘI</button>
        <button class="button ghost wide" id="crew-stop" type="button" disabled><i class="fas fa-hand"></i> Dừng lại</button>
      </form>

      <p class="fineprint" style="margin-top:14px">QA có thể chặn dây chuyền nếu blueprint chưa đạt (tối đa 2 lượt kiểm duyệt).
      Không cam kết view/doanh thu — bạn chịu trách nhiệm kiểm chứng nội dung và quyền sử dụng tư liệu.</p>

      <div id="crew-history" style="margin-top:18px"></div>
    </aside>

    <!-- ---------- CỘT PHẢI: ĐỘI TÁC NHÂN + KẾT QUẢ ---------- -->
    <section>
      <div class="panel">
        <div class="panel-heading">
          <span class="step">CREW</span>
          <div><h2>Đội tác nhân</h2><p>Coordinator điều phối — mỗi thẻ là một tác nhân chuyên biệt.</p></div>
        </div>

        <div class="crew-flow" id="crew-flow">
          <div class="agent-card" data-agent="trends" data-state="idle">
            <span class="agent-badge">IDLE</span>
            <div class="agent-ic"><i class="fas fa-satellite-dish"></i></div>
            <h4>Trinh sát xu hướng</h4><div class="agent-role">TREND SCOUT</div>
            <div class="agent-out">Săn góc nội dung đang có đà theo ngách của bạn.</div>
          </div>
          <div class="agent-card" data-agent="blueprint" data-state="idle">
            <span class="agent-badge">IDLE</span>
            <div class="agent-ic"><i class="fas fa-scroll"></i></div>
            <h4>Chiến lược gia</h4><div class="agent-role">STRATEGIST</div>
            <div class="agent-out">Viết kịch bản, shot list, SRT, SEO, góc kiếm tiền.</div>
          </div>
          <div class="agent-card" data-agent="review" data-state="idle">
            <span class="agent-badge">IDLE</span>
            <div class="agent-ic"><i class="fas fa-shield-halved"></i></div>
            <h4>Kiểm duyệt QA</h4><div class="agent-role">QA REVIEWER</div>
            <div class="agent-out">Kiểm tra độc lập: hook, nhịp, chính sách — chặn nếu lệch.</div>
          </div>
          <div class="agent-card" data-agent="images" data-state="idle">
            <span class="agent-badge">IDLE</span>
            <div class="agent-ic"><i class="fas fa-image"></i></div>
            <h4>Giám đốc hình ảnh</h4><div class="agent-role">ART DIRECTOR</div>
            <div class="agent-out">Vẽ đủ ảnh 9:16 cho từng shot.</div>
          </div>
          <div class="agent-card" data-agent="voice" data-state="idle">
            <span class="agent-badge">IDLE</span>
            <div class="agent-ic"><i class="fas fa-microphone-lines"></i></div>
            <h4>Dựng giọng</h4><div class="agent-role">VOICE ACTOR</div>
            <div class="agent-out">Thu voice-over đa ngôn ngữ cho toàn kịch bản.</div>
          </div>
          <div class="agent-card" data-agent="distribution" data-state="idle">
            <span class="agent-badge">IDLE</span>
            <div class="agent-ic"><i class="fas fa-share-nodes"></i></div>
            <h4>Nhà phân phối</h4><div class="agent-role">PUBLISHER</div>
            <div class="agent-out">Đóng gói caption + hashtag riêng cho từng nền tảng.</div>
          </div>
        </div>

        <div class="crew-progress">
          <div class="bar"><i id="crew-bar"></i></div>
          <div class="crew-status"><span id="crew-msg">Sẵn sàng nhận lệnh</span><b id="crew-pct">0%</b></div>
        </div>

        <div class="crew-log" id="crew-log"><div>Nhập brief bên trái rồi bấm "RA LỆNH CHO CẢ ĐỘI".</div></div>
      </div>

      <div class="panel hidden" id="crew-result" style="margin-top:22px">
        <div class="panel-heading">
          <span class="step">OUT</span>
          <div><h2>Kết quả của đội</h2><p>Duyệt lần cuối trước khi đăng — bạn là người quyết.</p></div>
        </div>
        <div id="crew-result-body"></div>
      </div>
    </section>
  </div>
</main>

<div id="toast" class="toast" role="status"></div>
<script src="/static/agent-core.js"></script>
<script src="/static/agents.js"></script>
</body>
</html>`
}
