# Faceless Forge — Video Production OS

Web app tạo video faceless: **ý tưởng → blueprint → ảnh → voice-over → video dọc → gói đăng bài → theo dõi doanh thu**. UI là tiếng Việt và vẫn có fallback cục bộ khi chưa cấu hình AI.

## Kiến trúc deploy Vercel

| Thành phần | Dịch vụ | Mục đích |
|---|---|---|
| Web + API | Hono trên **Vercel Functions** | `api/[[...path]].ts` là entrypoint; cùng một Function xử lý UI và `/api/*` |
| Dữ liệu quan hệ | **Neon Postgres** | ideas, blueprints, assets, distribution, metrics, Studio/RAG |
| Ảnh / audio / video | **Vercel Blob** (Public) | CDN cho media; browser upload thẳng các file lớn |
| Dựng video / Studio | Browser Canvas + WebAssembly | Không dùng FFmpeg hay filesystem trong Function |

Vercel không còn tạo Vercel Postgres mới; hãy kết nối **Neon** qua Vercel Marketplace hoặc tự tạo Neon database rồi đặt `DATABASE_URL`.

### Vì sao bản này không còn 404 khi deploy

Bản cũ chỉ build Cloudflare Pages Worker (`dist/_worker.js`), nên Vercel không có route `/` để phục vụ. Bản này có [`api/[[...path]].ts`](./api/[[...path]].ts), export Web `fetch` handler của Hono; [`vercel.json`](./vercel.json) rewrite `/` và `/studio` vào Function đó.

## Luồng media

```text
Ảnh / voice-over do Function tạo  → Vercel Blob → URL Blob trong bảng assets
Video / segment tạo ở browser     → direct upload → Vercel Blob → POST metadata vào Function
```

Direct upload là bắt buộc cho video lớn: request body của Vercel Function có giới hạn nhỏ hơn file MP4. Token upload chỉ được tạo tại `/api/blob/upload`, giới hạn các thư mục `videos/`, `audio/`, `segments/`, `images/` và tối đa 120 MB.

> Cột `assets.r2_key` giữ tên cũ để tương thích dữ liệu/logic hiện có, nhưng giờ lưu **Vercel Blob URL**, không phải R2 key.

## Chức năng

| Bước | Chức năng |
|---|---|
| 01–03 | Gợi ý, cải tiến ý tưởng, tạo viral blueprint, shot list và SRT |
| 04 | Tạo ảnh 9:16 từ visual prompt, lưu Blob |
| 05 | Tạo neural voice-over đa ngôn ngữ, lưu Blob |
| 06 | Dựng MP4 720×1280 trong browser: Ken Burns, phụ đề, progress, watermark |
| 07 | Caption riêng TikTok, Facebook, Instagram, X |
| 08 | Dashboard views / likes / followers / doanh thu / RPM |
| Studio | STT, dịch SRT, dub, cắt video và RAG: media chạy WebAssembly tại browser |

## API chính

| Method | Path | Mô tả |
|---|---|---|
| GET | `/` | Web app |
| GET | `/studio` | Faceless Studio |
| GET | `/api/health` | Kiểm tra Postgres, Blob và AI |
| POST | `/api/ideas/generate` | Gợi ý ý tưởng theo niche |
| POST | `/api/ideas/refine` | Cải tiến ý tưởng thành 3 hướng |
| POST | `/api/forge/blueprint` | Tạo kịch bản, shot list, SRT, SEO và revenue model |
| GET/DELETE | `/api/forge/blueprints[/:id]` | Thư viện blueprint và media |
| POST | `/api/media/image` | Tạo ảnh và lưu Blob |
| POST | `/api/media/speech` | Tạo voice-over và lưu Blob |
| POST | `/api/blob/upload` | Handshake để browser upload Blob trực tiếp |
| POST | `/api/media/video/:blueprintId` | Lưu metadata URL video Blob sau upload |
| POST | `/api/distribution/build` | Tạo gói đăng đa nền tảng |
| GET/POST/DELETE | `/api/studio/jobs[/:id]` | Lịch sử Studio |
| GET/POST/DELETE | `/api/rag/docs[/:id]` | Tài liệu RAG |

## Deploy lên Vercel

### 1. Kết nối database và Blob

Trong project Vercel:

1. Vào **Storage → Create → Blob**, chọn **Public**. Vercel sẽ tạo `BLOB_READ_WRITE_TOKEN`.
2. Vào **Integrations → Neon** (hoặc tạo database tại Neon), kết nối project. Đảm bảo project có `DATABASE_URL`.
3. Thêm các biến dưới đây ở **Production**, và thêm Preview/Development nếu bạn muốn dùng ở các môi trường đó.

```dotenv
# Bắt buộc
DATABASE_URL=postgresql://...                 # URL Neon, có SSL
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_...

# Không bắt buộc: thiếu key app vẫn dùng fallback cục bộ
OPENAI_API_KEY=...
OPENAI_BASE_URL=https://www.genspark.ai/api/llm_proxy/v1
```

### 2. Tạo schema Neon

Mở **Neon SQL Editor** (hoặc dùng `psql`) và chạy theo thứ tự nội dung hai file sau:

1. [`migrations/0001_initial_schema.sql`](./migrations/0001_initial_schema.sql)
2. [`migrations/0002_studio.sql`](./migrations/0002_studio.sql)

Các migration dùng PostgreSQL và có thể chạy an toàn lại nhờ `IF NOT EXISTS`.

### 3. Cấu hình Build Settings

- **Root Directory**: để trống vì [`package.json`](./package.json) nằm ở root repository.
- **Framework Preset**: Other (hoặc để Vercel tự nhận Hono).
- **Build Command**: `npm run build` hoặc Default.
- **Output Directory**: để trống.
- **Node.js**: 20.x hoặc mới hơn.

Sau đó push lên nhánh `main`; Vercel tự deploy. Truy cập `/api/health`: `db: true` và `blob: true` nghĩa là backend/storage đã sẵn sàng.

## Chạy local

```powershell
npm install
npx vercel env pull .env.local
npm run dev
```

Khởi động xong, mở `http://localhost:3000` hoặc URL Vercel Dev CLI in ra. Không commit `.env.local` hay thư mục `.vercel`.

## Các tối ưu đã áp dụng (bản hiện tại)

- **Studio sửa lỗi dropdown Model AI**: `/api/config` trả `default_text_model` + mảng tên model (string); trạng thái Studio hiện đọc đúng định dạng này (bản cũ đọc `{key, label}` → hiển thị "undefined").
- **Routing toàn diện**: ngoài `/` và `/studio`, `vercel.json` có rewrite catch-all cho mọi đường dẫn không phải `/api/*` hay file tĩnh → SPA fallback hoạt động khi mở trực tiếp bất kỳ URL nào.
- **Entry Function cứng hơn**: `api/[[...path]].js` chấp nhận cả 2 dạng export của bundle CJS (tránh 500 khi interop khác kỳ vọng).
- **Dịch phụ đề nhanh gấp ~3 lần**: các lô 25 dòng chạy song song (giới hạn 3 lô) thay vì tuần tự — tránh vượt 60 giây của Vercel Hobby với SRT dài.
- **Nạp tài liệu RAG nhanh ~20 lần**: chunk được ghi bằng multi-row INSERT (1 query / 20 chunk) thay vì 1 query/chunk.
- **Tạo ảnh tin cậy hơn**: server retry khi dịch vụ ảnh flake (đổi seed, kiểm tra content-type); khi dịch vụ ảnh AI hoàn toàn ngoại tuyến, server dựng **ảnh SVG placeholder** có cờ `fallback` để dây chuyền chạy tiếp.
- **Giọng đọc có fallback**: TTS retry từng chunk (có timeout 15s/chunk), fail-fast sau 3 chunk lỗi liên tiếp; khi TTS chết hẳn, server phát **audio WAV tone** cùng thởi lượng lồng tiếng (cờ `fallback`) thay vì 502 → render video vẫn đúng timing. Chunk nào lỗi lẻ được đếm vào `missing` thay vì làm gãy cả kịch bản.
- **Không còn gãy luồng khi chưa có Blob**: ảnh/audio server-side được trả dạng data-URL khi thiếu `BLOB_READ_WRITE_TOKEN` (tối đa 3MB để an toàn giới hạn response); video render ở browser rơi về chế độ xem/tải local khi upload Blob không khả dụng.
- **Số liệu đúng kiểu**: các truy vấn tổng hợp ép `::float8`/`::int` vì Neon trả `SUM`/`COUNT` dạng string.
- **Tránh bản ghi "ma"**: blueprint chỉ gắn `idea_id` khi idea thực sự tồn tại (tránh lỗi FK âm thầm khiến blueprint không được lưu).
- **UX liền mạch**: nút "Dùng làm ý tưởng →" trong Studio nạp kịch bản vào ô chủ đề của dây chuyền; xoá blueprint đang mở sẽ reset workspace; đã bổ sung favicon và header cache/bảo mật (`X-Frame-Options`, `nosniff`, cache `/static/*`).

## Lưu ý vận hành

- Vercel Hobby có thời lượng Function hữu hạn; các gọi AI/ảnh được giới hạn 50 giây để tránh request treo.
- Giữ tab mở trong khi render video, STT, Dub hoặc Băm: công việc nặng chạy tại browser.
- App không tự đăng bài. Tự động đăng cần OAuth app và quy trình review của từng nền tảng.
- Bạn chịu trách nhiệm kiểm chứng nội dung, quyền dùng tư liệu và yêu cầu disclosure nội dung AI của từng nền tảng.

## Nguồn tham khảo

- [Hono trên Vercel](https://vercel.com/docs/frameworks/backend/hono)
- [Vercel Functions](https://vercel.com/docs/functions)
- [Vercel Blob client uploads](https://vercel.com/docs/vercel-blob/client-upload)
- [Neon integration trên Vercel](https://vercel.com/marketplace/neon)
