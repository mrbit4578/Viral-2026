/**
 * Faceless Studio — 5 tính năng gốc chạy WebAssembly trong browser:
 * STT (Whisper WASM), Dịch SRT, Video Dub, Băm Studio, RAG hỏi đáp.
 */
export function renderStudio(): string {
  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Faceless Studio — STT · Dịch SRT · Dub · Băm · RAG (WebAssembly)</title>
<meta name="description" content="5 công cụ media chạy hoàn toàn bằng WebAssembly trong trình duyệt: nhận diện giọng nói, dịch phụ đề, thuyết minh lại video, băm video, hỏi đáp tài liệu." />
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<link rel="preconnect" href="https://cdn.jsdelivr.net" />
<script src="https://cdn.tailwindcss.com"></script>
<link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet" />
<link href="/static/style.css" rel="stylesheet" />
<link href="/static/studio.css" rel="stylesheet" />
</head>
<body class="studio-body">

<header class="topbar">
  <a class="brand" href="/">
    <span class="brand-mark"><i class="fas fa-bolt"></i></span>
    <span class="brand-text"><b>Faceless Forge</b><small>Studio WebAssembly</small></span>
  </a>
  <nav class="topnav">
    <a href="/" class="nav-link"><i class="fas fa-diagram-project"></i> Dây chuyền 8 bước</a>
    <a href="/studio" class="nav-link active"><i class="fas fa-microchip"></i> Studio WASM</a>
  </nav>
  <span class="status" id="wasm-status"><i></i> <span id="wasm-text">WASM: chờ tải</span></span>
</header>

<main class="shell studio-shell">

  <section class="hero studio-hero">
    <p class="eyebrow"><i class="fas fa-microchip"></i> 100% xử lý trong trình duyệt</p>
    <h1>5 công cụ media chạy <span class="grad">WebAssembly</span></h1>
    <p class="lede">
      Nhận diện giọng nói, dịch phụ đề, thuyết minh lại video, băm video thành nhiều đoạn và hỏi đáp tài liệu.
      Video và âm thanh <b>không rời khỏi máy bạn</b> — ffmpeg.wasm và Whisper chạy ngay trên CPU của bạn, chỉ phần
      văn bản mới gửi tới AI để dịch/trả lời.
    </p>
    <div class="hero-badges">
      <span class="badge"><i class="fas fa-shield-halved"></i> Không upload video</span>
      <span class="badge"><i class="fas fa-gauge-high"></i> Không giới hạn CPU edge</span>
      <span class="badge"><i class="fas fa-wifi"></i> Chạy được offline (sau khi tải model)</span>
    </div>
  </section>

  <section class="studio-tabs" role="tablist" aria-label="Công cụ Studio">
    <button class="studio-tab active" data-tab="stt" role="tab"><b>01</b><span>Nhận diện giọng nói</span><em>Whisper WASM</em></button>
    <button class="studio-tab" data-tab="srt" role="tab"><b>02</b><span>Dịch phụ đề SRT</span><em>LLM theo lô 25</em></button>
    <button class="studio-tab" data-tab="dub" role="tab"><b>03</b><span>Video Dub</span><em>Thuyết minh lại</em></button>
    <button class="studio-tab" data-tab="bam" role="tab"><b>04</b><span>Băm Studio</span><em>Cắt nhiều đoạn</em></button>
    <button class="studio-tab" data-tab="rag" role="tab"><b>05</b><span>RAG hỏi đáp</span><em>TF-IDF + AI</em></button>
  </section>

  <!-- ============================================= 01 STT -->
  <section class="studio-panel active" id="panel-stt" role="tabpanel">
    <div class="panel studio-card">
      <div class="card-head">
        <div><span class="step">01</span><h2>Nhận diện giọng nói → phụ đề SRT</h2></div>
        <p class="hint">Whisper chạy bằng WebAssembly (transformers.js + ONNX Runtime Web). Lần đầu sẽ tải model
        (~40–200MB) và được cache lại trong trình duyệt.</p>
      </div>

      <div class="drop-zone" id="stt-drop">
        <i class="fas fa-file-audio"></i>
        <b>Kéo thả video/audio vào đây</b>
        <span>hoặc bấm để chọn — mp4, mov, mkv, mp3, wav, m4a…</span>
        <input type="file" id="stt-file" accept="video/*,audio/*" hidden />
      </div>
      <div class="file-info hidden" id="stt-info"></div>

      <div class="field-grid">
        <label>Model Whisper
          <select id="stt-model">
            <option value="Xenova/whisper-tiny">tiny — nhanh nhất (~40MB)</option>
            <option value="Xenova/whisper-base" selected>base — cân bằng (~80MB)</option>
            <option value="Xenova/whisper-small">small — chính xác hơn (~250MB)</option>
          </select>
        </label>
        <label>Ngôn ngữ nguồn
          <select id="stt-lang"></select>
        </label>
      </div>

      <div class="btn-row">
        <button class="button primary solid" id="stt-run"><i class="fas fa-wand-magic-sparkles"></i> Tạo phụ đề</button>
        <button class="button ghost" id="stt-cancel" disabled><i class="fas fa-stop"></i> Dừng</button>
      </div>

      <div class="job hidden" id="stt-job">
        <div class="job-line"><span id="stt-msg">Sẵn sàng</span><b id="stt-pct">0%</b></div>
        <div class="bar"><i id="stt-bar"></i></div>
      </div>

      <div class="result-block hidden" id="stt-result">
        <div class="result-head">
          <h3><i class="fas fa-closed-captioning"></i> Phụ đề (<span id="stt-count">0</span> câu)</h3>
          <div class="result-actions">
            <button class="button micro" data-copy="stt-srt">Copy SRT</button>
            <button class="button micro" data-download="stt-srt" data-name="phu-de.srt">Tải .srt</button>
            <button class="button micro accent" id="stt-to-srt-tab">Chuyển sang tab dịch →</button>
            <button class="button micro accent" id="stt-to-rag">Nạp vào RAG →</button>
          </div>
        </div>
        <textarea id="stt-srt" class="mono-area" rows="14" spellcheck="false"></textarea>
      </div>
    </div>
  </section>

  <!-- ============================================= 02 DỊCH SRT -->
  <section class="studio-panel" id="panel-srt" role="tabpanel">
    <div class="panel studio-card">
      <div class="card-head">
        <div><span class="step">02</span><h2>Dịch phụ đề SRT</h2></div>
        <p class="hint">Giữ nguyên mốc thời gian, dịch theo lô 25 dòng như bản gốc. Dòng nào AI trả lỗi sẽ giữ nguyên
        văn bản ban đầu để không mất phụ đề.</p>
      </div>

      <div class="split-2">
        <div>
          <label class="area-label">SRT nguồn
            <div class="area-tools">
              <button class="button micro" id="srt-load-file">Chọn file .srt</button>
              <input type="file" id="srt-file" accept=".srt,.vtt,.txt" hidden />
            </div>
          </label>
          <textarea id="srt-input" class="mono-area" rows="16" spellcheck="false" placeholder="1&#10;00:00:00,000 --> 00:00:03,000&#10;Nội dung câu đầu tiên…"></textarea>
        </div>
        <div>
          <label class="area-label">SRT đã dịch
            <div class="area-tools">
              <button class="button micro" data-copy="srt-output">Copy</button>
              <button class="button micro" data-download="srt-output" data-name="phu-de-dich.srt">Tải .srt</button>
            </div>
          </label>
          <textarea id="srt-output" class="mono-area" rows="16" spellcheck="false" readonly></textarea>
        </div>
      </div>

      <div class="field-grid">
        <label>Dịch sang<select id="srt-target"></select></label>
        <label>Model AI<select id="srt-model"></select></label>
      </div>

      <div class="btn-row">
        <button class="button primary solid" id="srt-run"><i class="fas fa-language"></i> Dịch phụ đề</button>
        <button class="button ghost" id="srt-to-voice"><i class="fas fa-microphone-lines"></i> Đọc thành audio</button>
      </div>

      <div class="job hidden" id="srt-job">
        <div class="job-line"><span id="srt-msg">Sẵn sàng</span><b id="srt-pct">0%</b></div>
        <div class="bar"><i id="srt-bar"></i></div>
      </div>
      <div class="result-block hidden" id="srt-meta"></div>
    </div>
  </section>

  <!-- ============================================= 03 VIDEO DUB -->
  <section class="studio-panel" id="panel-dub" role="tabpanel">
    <div class="panel studio-card">
      <div class="card-head">
        <div><span class="step">03</span><h2>Video Dub — thuyết minh lại video</h2></div>
        <p class="hint">Dây chuyền: tách audio (ffmpeg.wasm) → nhận diện giọng nói (Whisper WASM) → dịch phụ đề →
        tạo giọng đọc → tăng tốc từng câu cho khớp khung thời gian → trộn timeline → ghép lại vào video.</p>
      </div>

      <div class="dub-flow">
        <span class="flow-node" data-stage="extract"><i class="fas fa-scissors"></i> Tách audio</span>
        <span class="flow-node" data-stage="stt"><i class="fas fa-waveform-lines"></i> Whisper</span>
        <span class="flow-node" data-stage="translate"><i class="fas fa-language"></i> Dịch</span>
        <span class="flow-node" data-stage="tts"><i class="fas fa-microphone-lines"></i> Giọng đọc</span>
        <span class="flow-node" data-stage="mix"><i class="fas fa-sliders"></i> Trộn</span>
        <span class="flow-node" data-stage="merge"><i class="fas fa-film"></i> Ghép video</span>
      </div>

      <div class="drop-zone" id="dub-drop">
        <i class="fas fa-file-video"></i>
        <b>Kéo thả video cần thuyết minh lại</b>
        <span>hoặc bấm để chọn — nên dưới 10 phút để nhanh</span>
        <input type="file" id="dub-file" accept="video/*,audio/*" hidden />
      </div>
      <div class="file-info hidden" id="dub-info"></div>

      <div class="field-grid three">
        <label>Ngôn ngữ nguồn<select id="dub-source"></select></label>
        <label>Dịch sang<select id="dub-target"></select></label>
        <label>Giọng đọc<select id="dub-voice"></select></label>
        <label>Model Whisper
          <select id="dub-whisper">
            <option value="Xenova/whisper-tiny">tiny</option>
            <option value="Xenova/whisper-base" selected>base</option>
            <option value="Xenova/whisper-small">small</option>
          </select>
        </label>
        <label>Model AI dịch<select id="dub-model"></select></label>
        <label class="check-label">
          <input type="checkbox" id="dub-keep-video" checked />
          <span>Ghép audio vào video gốc (MP4)</span>
        </label>
      </div>

      <div class="btn-row">
        <button class="button primary solid" id="dub-run"><i class="fas fa-clone"></i> Bắt đầu thuyết minh</button>
        <button class="button ghost" id="dub-cancel" disabled><i class="fas fa-stop"></i> Dừng</button>
      </div>

      <div class="job hidden" id="dub-job">
        <div class="job-line"><span id="dub-msg">Sẵn sàng</span><b id="dub-pct">0%</b></div>
        <div class="bar"><i id="dub-bar"></i></div>
      </div>

      <div class="result-block hidden" id="dub-result"></div>
    </div>
  </section>

  <!-- ============================================= 04 BĂM STUDIO -->
  <section class="studio-panel" id="panel-bam" role="tabpanel">
    <div class="panel studio-card">
      <div class="card-head">
        <div><span class="step">04</span><h2>Băm Studio — cắt video thành nhiều đoạn</h2></div>
        <p class="hint">Cắt theo thời lượng mỗi đoạn hoặc theo số đoạn mong muốn. Dùng ffmpeg.wasm với chế độ
        <code>-c copy</code> nên rất nhanh và không giảm chất lượng.</p>
      </div>

      <div class="drop-zone" id="bam-drop">
        <i class="fas fa-cut"></i>
        <b>Kéo thả video/audio cần băm</b>
        <span>hoặc bấm để chọn</span>
        <input type="file" id="bam-file" accept="video/*,audio/*" hidden />
      </div>
      <div class="file-info hidden" id="bam-info"></div>

      <div class="field-grid three">
        <label>Chế độ
          <select id="bam-mode">
            <option value="duration" selected>Theo thời lượng mỗi đoạn (giây)</option>
            <option value="count">Theo số đoạn</option>
          </select>
        </label>
        <label id="bam-value-label">Thời lượng mỗi đoạn (giây)
          <input type="number" id="bam-value" min="1" step="1" value="60" />
        </label>
        <label>Ghi lên cloud
          <select id="bam-upload">
            <option value="no" selected>Không — chỉ tải về máy</option>
            <option value="yes">Có — lưu vào Vercel Blob để chia sẻ</option>
          </select>
        </label>
      </div>

      <div class="btn-row">
        <button class="button primary solid" id="bam-run"><i class="fas fa-scissors"></i> Băm file</button>
        <button class="button ghost" id="bam-cancel" disabled><i class="fas fa-stop"></i> Dừng</button>
      </div>

      <div class="job hidden" id="bam-job">
        <div class="job-line"><span id="bam-msg">Sẵn sàng</span><b id="bam-pct">0%</b></div>
        <div class="bar"><i id="bam-bar"></i></div>
      </div>

      <div class="result-block hidden" id="bam-result"></div>
    </div>
  </section>

  <!-- ============================================= 05 RAG -->
  <section class="studio-panel" id="panel-rag" role="tabpanel">
    <div class="studio-grid">
      <div class="panel studio-card">
        <div class="card-head">
          <div><span class="step">05</span><h2>Tài liệu</h2></div>
          <p class="hint">PDF/DOCX được đọc ngay trong trình duyệt (pdf.js WASM), chỉ phần văn bản đã tách mới gửi lên
          để lập chỉ mục TF-IDF trên Neon Postgres.</p>
        </div>

        <div class="drop-zone compact" id="rag-drop">
          <i class="fas fa-file-lines"></i>
          <b>Kéo thả tài liệu</b>
          <span>pdf, docx, txt, md, srt, csv, json</span>
          <input type="file" id="rag-file" accept=".pdf,.docx,.txt,.md,.markdown,.srt,.csv,.json" multiple hidden />
        </div>

        <div class="job hidden" id="rag-job">
          <div class="job-line"><span id="rag-msg">Sẵn sàng</span><b id="rag-pct">0%</b></div>
          <div class="bar"><i id="rag-bar"></i></div>
        </div>

        <div class="doc-list" id="rag-docs"></div>
      </div>

      <div class="panel studio-card">
        <div class="card-head">
          <div><span class="step">05</span><h2>Hỏi đáp &amp; kịch bản video</h2></div>
        </div>

        <div class="sub-tabs">
          <button class="sub-tab active" data-sub="ask">Hỏi đáp</button>
          <button class="sub-tab" data-sub="script">Sinh kịch bản video</button>
        </div>

        <div class="sub-panel active" id="sub-ask">
          <label>Câu hỏi
            <textarea id="rag-question" rows="3" placeholder="Ví dụ: Tài liệu này khuyến nghị những bước nào để tăng tỉ lệ giữ người xem?"></textarea>
          </label>
          <div class="field-grid three">
            <label>Số trích đoạn<input type="number" id="rag-topk" min="1" max="12" value="5" /></label>
            <label>Model AI<select id="rag-model"></select></label>
          </div>
          <button class="button primary solid" id="rag-ask"><i class="fas fa-comments"></i> Hỏi tài liệu</button>
          <div class="result-block hidden" id="rag-answer"></div>
        </div>

        <div class="sub-panel" id="sub-script">
          <label>Chủ đề trọng tâm (tuỳ chọn)
            <input id="rag-topic" placeholder="Ví dụ: 3 sai lầm khiến video không lên xu hướng" />
          </label>
          <div class="field-grid three">
            <label>Phong cách
              <select id="rag-style">
                <option value="storytelling">Kể chuyện</option>
                <option value="educational">Giảng giải</option>
                <option value="listicle">Danh sách</option>
                <option value="hot-take">Góc nhìn thẳng</option>
              </select>
            </label>
            <label>Thời lượng (giây)<input type="number" id="rag-duration" min="15" max="600" step="15" value="60" /></label>
            <label>Model AI<select id="rag-script-model"></select></label>
          </div>
          <button class="button primary solid" id="rag-script"><i class="fas fa-file-signature"></i> Sinh lời bình</button>
          <div class="result-block hidden" id="rag-script-out"></div>
        </div>
      </div>
    </div>
  </section>

  <section class="wide-panel" id="studio-history">
    <div class="wide-head">
      <div><h2><i class="fas fa-clock-rotate-left"></i> Lịch sử phiên Studio</h2>
      <p class="hint">Kết quả văn bản (SRT, câu trả lời, kịch bản) được lưu để dùng lại. File media chỉ lưu khi bạn chọn ghi lên cloud.</p></div>
      <button class="button ghost" id="history-refresh"><i class="fas fa-rotate"></i> Làm mới</button>
    </div>
    <div id="history-list" class="history-list"></div>
  </section>

</main>

<div id="toast" class="toast" role="status"></div>
<audio id="studio-audio" class="hidden"></audio>

<script src="https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/umd/ffmpeg.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/dist/umd/index.js"></script>
<script type="module" src="/static/studio.js"></script>
</body>
</html>`
}
