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
