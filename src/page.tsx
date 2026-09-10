/** HTML shell — giữ theme neon teal glassmorphism của bản gốc faceless-forge. */
export function renderPage(): string {
  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="theme-color" content="#071314" />
<meta name="description" content="Faceless Forge — từ ý tưởng đến video viral và thu nhập thụ động trên TikTok, Facebook, Instagram, X." />
<title>Faceless Forge — Video Production OS</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
<link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.5.2/css/all.min.css" rel="stylesheet" />
<link rel="stylesheet" href="/static/style.css" />
</head>
<body>
<div class="noise" aria-hidden="true"></div>

<header class="topbar">
  <a class="brand" href="#top" aria-label="Faceless Forge">
    <span class="brand-mark">✦</span>
    <span><b>FACELESS</b> FORGE<small>Video Production OS</small></span>
  </a>
  <nav class="topnav" aria-label="Điều hướng chính">
    <a href="#workflow" class="topnav-link">Dây chuyền</a>
    <a href="#revenue-section" class="topnav-link">Thu nhập</a>
    <a href="#library-section" class="topnav-link">Thư viện</a>
  </nav>
  <span class="status" id="health-status"><i></i> <span id="health-text">Đang kiểm tra…</span></span>
</header>

<main id="top" class="shell">

  <section class="hero" id="hero-section">
    <div class="eyebrow">IDEA → SCRIPT → IMAGE → VOICE → VIDEO → VIRAL → REVENUE</div>
    <h1>Đừng chỉ tạo video.<br /><em>Hãy xây một cỗ máy nội dung.</em></h1>
    <p>Faceless Forge biến một ý tưởng thô thành dây chuyền sản xuất hoàn chỉnh: cải tiến ý tưởng, kịch bản, shot list, hình ảnh 9:16, giọng đọc AI, video MP4, gói đăng bài riêng cho TikTok · Facebook · Instagram · X, và bảng theo dõi thu nhập thụ động.</p>
    <div class="hero-pills">
      <span><i class="fas fa-lightbulb"></i> Idea Lab</span>
      <span><i class="fas fa-wand-magic-sparkles"></i> Cải tiến ý tưởng</span>
      <span><i class="fas fa-image"></i> Ảnh 9:16</span>
      <span><i class="fas fa-microphone-lines"></i> Voice-over AI</span>
      <span><i class="fas fa-film"></i> Video + phụ đề</span>
      <span><i class="fas fa-share-nodes"></i> 4 nền tảng</span>
      <span><i class="fas fa-coins"></i> Revenue tracker</span>
    </div>
  </section>

  <!-- ======================= DÂY CHUYỀN 7 BƯỚC ======================= -->
  <section class="stepper" id="workflow" aria-label="Các bước sản xuất">
    <button class="step-chip active" data-goto="step-1"><b>01</b><span>Ý tưởng</span></button>
    <button class="step-chip" data-goto="step-2"><b>02</b><span>Cải tiến</span></button>
    <button class="step-chip" data-goto="step-3"><b>03</b><span>Blueprint</span></button>
    <button class="step-chip" data-goto="step-4"><b>04</b><span>Hình ảnh</span></button>
    <button class="step-chip" data-goto="step-5"><b>05</b><span>Âm thanh</span></button>
    <button class="step-chip" data-goto="step-6"><b>06</b><span>Video</span></button>
    <button class="step-chip" data-goto="step-7"><b>07</b><span>Viral</span></button>
  </section>

  <section class="workspace">
    <!-- ---------- CỘT TRÁI: BRIEF ---------- -->
    <aside class="brief-panel panel" id="step-1">
      <div class="panel-heading">
        <span class="step">01</span>
        <div><h2>Creative brief</h2><p>Nói cho Forge biết bạn muốn làm gì.</p></div>
      </div>

      <form id="brief-form">
        <label>Chủ đề video
          <textarea id="topic" rows="4" required minlength="3" placeholder="Ví dụ: 3 dấu hiệu bạn đang bị quá tải thông tin"></textarea>
        </label>

        <div class="idea-lab">
          <div class="idea-lab-head">
            <span><i class="fas fa-lightbulb"></i> Chưa có ý tưởng?</span>
            <button type="button" class="button micro" id="gen-ideas-btn">Gợi ý 5 ý tưởng</button>
          </div>
          <div id="idea-list" class="idea-list"></div>
        </div>

        <div class="form-grid">
          <label>Niche<input id="niche" value="Giáo dục / kiến thức" /></label>
          <label>Thời lượng
            <select id="duration">
              <option value="30">30 giây</option>
              <option value="45" selected>45 giây</option>
              <option value="60">60 giây</option>
              <option value="90">90 giây</option>
            </select>
          </label>
        </div>

        <label>Khán giả mục tiêu<input id="audience" value="18–34 tuổi, thích nội dung dễ hiểu" /></label>

        <div class="form-grid">
          <label>Nền tảng
            <select id="platform">
              <option>TikTok &amp; YouTube Shorts</option>
              <option>TikTok</option>
              <option>Facebook Reels</option>
              <option>Instagram Reels</option>
              <option>X (Twitter)</option>
              <option>Đa nền tảng</option>
            </select>
          </label>
          <label>Phong cách
            <select id="tone">
              <option>Kể chuyện giàu nhịp</option>
              <option>Bí ẩn / tò mò</option>
              <option>Giải thích dễ hiểu</option>
              <option>Tạo động lực</option>
              <option>Review chân thực</option>
            </select>
          </label>
        </div>

        <label>Mục tiêu kênh<input id="goal" value="Xây dựng tệp khán giả để phát triển kênh" /></label>

        <div class="form-grid">
          <label>Model AI<select id="model"></select></label>
          <label>Ngôn ngữ đọc<select id="voice"></select></label>
        </div>

        <button class="button primary" id="refine-button" type="button">
          <span><i class="fas fa-wand-magic-sparkles"></i></span> Cải tiến ý tưởng
        </button>
        <button class="button primary solid" id="blueprint-button" type="submit">
          <span>✦</span> Tạo Viral Blueprint
        </button>
      </form>

      <p class="fineprint">Forge đề xuất hướng làm nội dung. Không cam kết view, doanh thu hay việc được bật kiếm tiền.</p>
    </aside>

    <!-- ---------- CỘT PHẢI: OUTPUT ---------- -->
    <section class="output-panel">
      <div class="empty-state" id="empty-state">
        <div class="empty-icon">✦</div>
        <h2>Dây chuyền của bạn sẽ xuất hiện ở đây</h2>
        <p>Nhập một chủ đề cụ thể, hoặc bấm <b>Gợi ý ý tưởng</b> để Forge đề xuất. Sau đó cải tiến ý tưởng và tạo blueprint.</p>
        <div class="empty-flow">
          <span>Ý tưởng</span><b>→</b><span>Cải tiến</span><b>→</b><span>Kịch bản</span><b>→</b><span>Ảnh</span><b>→</b><span>Giọng</span><b>→</b><span>MP4</span><b>→</b><span>Viral</span>
        </div>
      </div>

      <div id="refine-panel" class="refine-panel hidden" aria-live="polite"></div>
      <div id="blueprint" class="blueprint hidden" aria-live="polite"></div>
    </section>
  </section>

  <!-- ======================= THU NHẬP THỤ ĐỘNG ======================= -->
  <section class="wide-panel" id="revenue-section">
    <div class="wide-head">
      <div><span class="kicker">BƯỚC 08 · THU NHẬP THỤ ĐỘNG</span><h2>Kiếm tiền bền vững, đúng chính sách</h2></div>
      <div class="wide-actions">
        <button class="button ghost" id="revenue-model-btn"><i class="fas fa-sitemap"></i> Xây mô hình thu nhập</button>
        <button class="button ghost" id="metrics-refresh-btn"><i class="fas fa-rotate"></i> Làm mới số liệu</button>
      </div>
    </div>

    <div class="kpi-grid" id="kpi-grid"></div>

    <div class="revenue-grid">
      <div class="section-card">
        <div class="section-title">Ghi nhận kết quả <small>NHẬP SỐ THỰC TỪ DASHBOARD NỀN TẢNG</small></div>
        <form id="metric-form" class="metric-form">
          <div class="form-grid">
            <label>Nền tảng<select id="m-platform">
              <option value="tiktok">TikTok</option>
              <option value="facebook">Facebook</option>
              <option value="instagram">Instagram</option>
              <option value="x">X (Twitter)</option>
              <option value="youtube">YouTube Shorts</option>
            </select></label>
            <label>Nguồn thu<select id="m-source">
              <option value="creator_fund">Quỹ sáng tạo</option>
              <option value="affiliate">Tiếp thị liên kết</option>
              <option value="brand">Hợp tác thương hiệu</option>
              <option value="product">Sản phẩm số</option>
              <option value="adsense">AdSense</option>
            </select></label>
          </div>
          <div class="form-grid four">
            <label>Lượt xem<input id="m-views" type="number" min="0" value="0" /></label>
            <label>Lượt thích<input id="m-likes" type="number" min="0" value="0" /></label>
            <label>Follow mới<input id="m-followers" type="number" min="0" value="0" /></label>
            <label>Doanh thu (USD)<input id="m-revenue" type="number" min="0" step="0.01" value="0" /></label>
          </div>
          <button class="button primary solid" type="submit"><i class="fas fa-floppy-disk"></i> Lưu số liệu</button>
        </form>
        <div id="metrics-recent" class="metrics-recent"></div>
      </div>

      <div class="section-card" id="revenue-model-card">
        <div class="section-title">Mô hình thu nhập <small>THAM KHẢO, KHÔNG PHẢI TƯ VẤN TÀI CHÍNH</small></div>
        <p class="muted-note">Bấm <b>Xây mô hình thu nhập</b> để Forge phân tích các nguồn thu phù hợp với ngách của bạn, kèm điều kiện thực tế của từng nền tảng.</p>
      </div>
    </div>
  </section>

  <!-- ======================= THƯ VIỆN ======================= -->
  <section class="wide-panel" id="library-section">
    <div class="wide-head">
      <div><span class="kicker">THƯ VIỆN</span><h2>Blueprint đã tạo</h2></div>
      <button class="button ghost" id="library-refresh-btn"><i class="fas fa-rotate"></i> Làm mới</button>
    </div>
    <div id="library-list" class="library-list"></div>
  </section>

  <section class="process-strip">
    <div><b>01–02</b><span>Ý tưởng &amp; cải tiến có insight</span></div>
    <div><b>03</b><span>Blueprint, kịch bản, shot list</span></div>
    <div><b>04–06</b><span>Ảnh, giọng đọc, video MP4</span></div>
    <div><b>07–08</b><span>Phân phối viral &amp; thu nhập</span></div>
  </section>
</main>

<!-- Modal render video -->
<div class="modal hidden" id="render-modal">
  <div class="modal-box">
    <div class="modal-head">
      <h3><i class="fas fa-film"></i> Dựng video 9:16</h3>
      <button class="modal-close" id="render-close" aria-label="Đóng">✕</button>
    </div>
    <div class="modal-body">
      <canvas id="render-canvas" width="720" height="1280"></canvas>
      <div class="render-side">
        <div class="job show" id="render-job">
          <div class="job-line"><span id="render-msg">Sẵn sàng dựng video</span><b id="render-pct">0%</b></div>
          <div class="bar"><i id="render-bar"></i></div>
        </div>
        <p class="muted-note">Video được dựng ngay trong trình duyệt: ảnh Ken Burns + phụ đề động + giọng đọc. Không cần cài FFmpeg.</p>
        <div id="render-output" class="render-result"></div>
      </div>
    </div>
  </div>
</div>

<div id="toast" class="toast" role="status"></div>

<script src="/static/app.js"></script>
</body>
</html>`
}
