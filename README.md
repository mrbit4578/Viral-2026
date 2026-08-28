# Faceless Forge — Video Production OS

Dây chuyền sản xuất video faceless hoàn chỉnh chạy trên web: **Ý tưởng → Cải tiến → Kịch bản → Hình ảnh → Âm thanh → Video → Đẩy viral đa nền tảng → Theo dõi thu nhập thụ động**.

Được port từ dự án gốc `faceless-forge` (FastAPI + MongoDB + FFmpeg + faster-whisper) sang kiến trúc **edge-native** để chạy online 24/7 mà không cần server riêng.

---

## 1. Tổng quan

- **Tên**: Faceless Forge
- **Mục tiêu**: Biến một ý tưởng thô thành video dọc 9:16 sẵn sàng đăng, kèm caption riêng cho từng nền tảng và bảng theo dõi doanh thu.
- **Ngôn ngữ UI**: Tiếng Việt
- **Theme**: Dark neon teal glassmorphism (giữ nguyên design tokens của bản gốc)
- **Không cần đăng nhập**, dùng được ngay.

---

## 2. Dây chuyền 8 bước

| Bước | Tên | Việc hệ thống làm |
|---|---|---|
| **01** | Ý tưởng | Gợi ý 3–8 ý tưởng cụ thể theo ngách, kèm góc tiếp cận + hook + điểm mạnh |
| **02** | Cải tiến ý tưởng | Viết lại ý tưởng thô thành **3 hướng** sắc hơn: thu hẹp phạm vi / đảo ngược kỳ vọng / biến thành hành động |
| **03** | Viral Blueprint | Sinh concept, viral score, 3 tiêu đề, thumbnail text, hook, lời bình đầy đủ, **shot list 5–9 giây/cảnh**, visual prompt, SEO pack, mô hình kiếm tiền, checklist trước khi đăng, file **SRT** |
| **04** | Hình ảnh | Tạo ảnh dọc **9:16** cho từng shot từ visual prompt, lưu lên R2 |
| **05** | Âm thanh | Tạo voice-over neural (15 ngôn ngữ), tự chia đoạn dài và nối lại thành MP3 |
| **06** | Video | Dựng **MP4 720×1280** ngay trong trình duyệt: Ken Burns zoom/pan + text overlay + phụ đề động + thanh tiến trình + watermark, đồng bộ theo độ dài audio thật |
| **07** | Đẩy viral | Sinh caption **native riêng cho TikTok · Facebook · Instagram · X**, tôn trọng giới hạn ký tự / số hashtag / giờ đăng tốt của từng nền tảng |
| **08** | Thu nhập thụ động | Phân tích các nguồn thu khả thi theo ngách + lộ trình mở rộng, và dashboard ghi nhận view/like/follow/doanh thu theo nền tảng và theo nguồn thu (tự tính RPM) |

Mỗi bước đều có **fallback tất định**: nếu không có AI key, app vẫn tạo được blueprint, caption và mô hình thu nhập ở chế độ local.

---

## 3. URL & API

### Trang web
- `GET /` — giao diện chính (SPA một trang)
- `GET /studio` — Faceless Studio: 5 công cụ WebAssembly chạy trong trình duyệt

### Health & cấu hình
| Method | Path | Mô tả |
|---|---|---|
| GET | `/api/health` | Trạng thái DB / R2 / LLM |
| GET | `/api/config` | Danh sách model, giọng đọc, thông số từng nền tảng |

### Bước 1–3: Ý tưởng & Blueprint
| Method | Path | Body chính |
|---|---|---|
| POST | `/api/ideas/generate` | `niche`, `audience`, `platform`, `language`, `count` |
| POST | `/api/ideas/refine` | `topic`, `niche`, `audience`, `platform`, `language` |
| POST | `/api/forge/blueprint` | `topic`, `niche`, `audience`, `platform`, `duration_sec`, `tone`, `language`, `goal`, `model` |
| GET | `/api/forge/blueprints?limit=20` | — |
| GET | `/api/forge/blueprints/:id` | trả blueprint + toàn bộ asset |
| DELETE | `/api/forge/blueprints/:id` | xoá blueprint + media trên R2 |
| POST | `/api/forge/srt` | `shots[]` → SRT |

### Bước 4–6: Media
| Method | Path | Body / mô tả |
|---|---|---|
| POST | `/api/media/image` | `prompt`, `blueprint_id`, `shot_index`, `width`, `height`, `model`, `seed` |
| POST | `/api/media/speech` | `text`, `voice` (mã ngôn ngữ), `blueprint_id` |
| PUT | `/api/media/video/:blueprintId` | body = binary video từ browser |
| GET | `/api/media/*` | Serve file từ R2, hỗ trợ **HTTP Range** (tua video) và `?download=1` |

### Bước 7: Phân phối
| Method | Path | Body chính |
|---|---|---|
| POST | `/api/distribution/build` | `blueprint_id`, `platforms[]`, `language` |
| GET | `/api/distribution?blueprint_id=` | — |
| PATCH | `/api/distribution/:id` | `status`, `post_url` |

### Bước 8: Thu nhập
| Method | Path | Body chính |
|---|---|---|
| POST | `/api/revenue/model` | `niche`, `platform`, `audience` |
| POST | `/api/metrics` | `platform`, `views`, `likes`, `followers_gained`, `revenue_usd`, `revenue_source` |
| GET | `/api/metrics/summary` | tổng hợp + theo nền tảng + theo nguồn thu + RPM |
| DELETE | `/api/metrics/:id` | — |

### Faceless Studio: WebAssembly
| Method | Path | Mô tả |
|---|---|---|
| POST | `/api/studio/srt/parse` | Kiểm tra và tách cue từ SRT |
| POST | `/api/studio/srt/translate` | Dịch SRT hoặc segments theo lô 25, giữ nguyên timing |
| POST | `/api/rag/docs` | Lập chỉ mục tài liệu đã được tách text tại browser |
| GET/DELETE | `/api/rag/docs[/:id]` | Danh sách hoặc xoá tài liệu RAG |
| POST | `/api/rag/ask` | Hỏi đáp TF-IDF + citation |
| POST | `/api/rag/video-script` | Tạo lời bình video dựa trên tài liệu |
| GET/POST/DELETE | `/api/studio/jobs[/:id]` | Lịch sử STT, dịch, Dub, Băm và RAG |
| PUT | `/api/studio/upload/:kind` | Lưu kết quả media do browser tạo lên R2 khi người dùng chọn |

---

## 4. Kiến trúc dữ liệu

### Storage
- **Cloudflare D1** (SQLite) — toàn bộ dữ liệu quan hệ
- **Cloudflare R2** — ảnh, audio, video (serve qua `/api/media/*`)

### Bảng D1
| Bảng | Nội dung |
|---|---|
| `ideas` | ý tưởng thô + 3 bản cải tiến (JSON) |
| `blueprints` | blueprint đầy đủ (JSON) + viral score + status |
| `assets` | ảnh / audio / video / srt → trỏ tới `r2_key` |
| `distributions` | gói đăng bài từng nền tảng |
| `metrics` | view, like, follow, doanh thu theo nguồn |
| `jobs` | theo dõi tiến trình dài |
| `kv` | key-value (thay Cloudflare KV, vì hosted deploy không hỗ trợ KV) |

### Luồng dữ liệu
```
Người dùng nhập brief
  → /api/ideas/refine        → lưu ideas
  → /api/forge/blueprint     → lưu blueprints (LLM)
  → /api/media/image  ×N     → R2 + assets
  → /api/media/speech        → R2 + assets
  → Browser Canvas + MediaRecorder → PUT /api/media/video → R2 + assets
  → /api/distribution/build  → lưu distributions (LLM)
  → /api/metrics             → lưu metrics → /api/metrics/summary
```

---

## 5. Điểm khác so với bản gốc

Bản gốc dùng FastAPI + MongoDB + FFmpeg + faster-whisper — những thứ **không chạy được trên edge runtime**. Các thay thế:

| Bản gốc | Bản này | Lý do |
|---|---|---|
| MongoDB (motor) | Cloudflare D1 | Không có TCP driver trên Workers |
| Media trên disk | Cloudflare R2 | Không có filesystem runtime |
| Edge TTS (websocket Python) | Google Neural TTS qua `fetch` | Không chạy được thư viện Python |
| gpt-image-1 / Nano Banana (Emergent key) | Pollinations image API | Không cần key riêng |
| **FFmpeg** render MP4 | **Canvas + MediaRecorder trong browser** | FFmpeg không tồn tại trên Workers |
| Emergent LLM key | OpenAI-compatible proxy | Dùng key có sẵn của nền tảng |

**Logic nghiệp vụ được port nguyên vẹn**: `forge_engine.py` (blueprint + fallback tất định), `_normalise_blueprint`, `_extract_json`, `segments_to_srt`, cùng theme CSS.

Nhóm tính năng trước đây không phù hợp với edge (STT, dịch SRT, Video Dub, Băm Studio và RAG) nay có tại **`/studio`**: media chạy bằng WebAssembly trong browser, còn Worker chỉ xử lý text, D1/R2 và lịch sử. Xem mục 8.

---

## 6. Hướng dẫn sử dụng

1. **Nhập ngách** vào ô *Niche*, bấm **Gợi ý 5 ý tưởng** → chọn một ý tưởng (hoặc tự nhập chủ đề).
2. Bấm **Cải tiến ý tưởng** → chọn 1 trong 3 hướng.
3. Bấm **Tạo Viral Blueprint** → nhận kịch bản, shot list, SEO, mô hình kiếm tiền.
4. Bước 04: bấm **Tạo ảnh cho tất cả shot** (hoặc chỉ ảnh bìa cho nhanh).
5. Bước 05: chọn ngôn ngữ đọc ở cột trái → bấm **Tạo voice-over**.
6. Bước 06: bấm **Dựng video 9:16** → chờ render → tải MP4.
   - ⚠️ Giữ tab đang mở khi render (dùng tài nguyên trình duyệt).
7. Bước 07: bấm **Tạo gói đăng bài 4 nền tảng** → bấm **COPY** ở nền tảng cần đăng.
8. Bước 08: sau khi đăng, nhập số liệu thực từ dashboard nền tảng để theo dõi RPM và doanh thu.

Blueprint được lưu tự động — mở lại bất kỳ lúc nào ở mục **Thư viện** (kèm ảnh/audio/video đã tạo).

---

## 7. Phát triển

```bash
# Cài & build
npm install
npm run build

# Migration D1 (local)
npx wrangler d1 migrations apply webapp-production --local

# Chạy local
pm2 start ecosystem.config.cjs
curl http://localhost:3000/api/health

# Xem log
pm2 logs webapp --nostream
```

Biến môi trường (`.dev.vars` cho local, secret cho production):
```
OPENAI_API_KEY=...
OPENAI_BASE_URL=https://www.genspark.ai/api/llm_proxy/v1
```

---

## 8. Chưa hoàn thiện & bước tiếp theo

**Đã có trong `/studio`**
- **STT / phụ đề tự động**: ffmpeg.wasm tách audio 16 kHz; Whisper chạy bằng transformers.js + ONNX Runtime Web; xuất SRT.
- **Dịch SRT**: giữ timing, dịch theo lô 25 dòng đúng định dạng `số||bản dịch`; nếu một dòng/lô lỗi sẽ giữ nguyên phụ đề nguồn.
- **Video Dub**: tách audio → STT → dịch → TTS → căn thời lượng từng câu → trộn timeline → ghép audio vào video gốc khi codec cho phép.
- **Băm Studio**: cắt theo thời lượng hoặc số đoạn bằng ffmpeg.wasm; ưu tiên `-c copy`, tự fallback encode lại khi cần.
- **RAG hỏi đáp**: PDF/DOCX/TXT được tách text ở browser; TF-IDF cosine retrieval trên D1; câu trả lời có citation và có thể sinh lời bình video.

Các file video/audio được xử lý cục bộ trong browser. Chỉ nội dung text của SRT/RAG được gửi đến Worker (và đến LLM khi có cấu hình key). Lần đầu dùng STT, Dub hoặc Băm, trình duyệt cần tải engine/model WASM nên sẽ chậm hơn các lần sau.

**Chưa có**
- **Đăng bài tự động** — hiện chỉ tạo gói caption để copy thủ công; mỗi nền tảng cần OAuth app và quy trình duyệt riêng để tự đăng.

**Đề xuất tiếp theo**
1. Đăng tự động qua official API của từng nền tảng (cần OAuth app + review của nền tảng).
2. Nhạc nền: thêm track vào bước render (mix qua Web Audio API).
3. Ảnh cho mọi shot chạy song song để rút ngắn thời gian bước 04.
4. Chuyển transition giữa các shot (fade/slide) trong renderer.
5. Nhập số liệu tự động qua API analytics của nền tảng.
6. A/B test tiêu đề: lưu nhiều biến thể và so sánh hiệu suất.

---

## 9. Lưu ý tuân thủ

- App **không cam kết** lượt xem, doanh thu hay việc được bật kiếm tiền. Mọi nội dung là **đề xuất**.
- Prompt hệ thống được thiết kế để tránh: số liệu bịa, lời khuyên y tế/tài chính/pháp lý cá nhân hoá, nhân vật có bản quyền, chiêu tăng tương tác vi phạm chính sách.
- Bạn chịu trách nhiệm kiểm chứng nội dung, quyền sử dụng tư liệu, và công bố nội dung do AI tạo theo yêu cầu của từng nền tảng.
- Phần thu nhập là thông tin tham khảo, **không phải tư vấn tài chính**.

---

## 10. Deployment

- **Platform**: Cloudflare Pages (Hono + D1 + R2)
- **Tech Stack**: Hono · TypeScript · Vanilla JS · Canvas/MediaRecorder · Cloudflare D1 · R2
- **Status**: ✅ Đã test end-to-end (8/8 bước, 0 lỗi console)
- **Last Updated**: 2026-08-28
