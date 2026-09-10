# DESIGN: Agent Crew — Đội tác nhân tự động hóa dây chuyền faceless

> Thiết kế cho [SPEC](../specs/spec-agent-crew.md) — viết TRƯỚC khi code, KHÔNG viết code ở bước này.

## Kiến trúc tổng quan (Architecture Overview)

Mô hình Coordinator → tác nhân chuyên biệt (theo sơ đồ Multi-Agent Research System):

```text
                    ┌────────────────────────────┐
                    │   COORDINATOR (browser)    │  public/static/agents.js
                    │  state machine + retry +   │
                    │  job persistence + UI      │
                    └─────────────┬──────────────┘
        ┌───────────────┬─────────┼───────────────┬──────────────┐
        ▼               ▼         ▼               ▼              ▼
  Trend Scout    Strategist   QA Reviewer   Art Director   Voice + Publisher
  /agents/trends  (endpoint    /agents/review (endpoint     (endpoint hiện có
  (LLM mới)       hiện có      (LLM mới)      /media/image  /media/speech,
                  /forge/                     lặp per shot) /distribution/build)
                  blueprint)
```

Luồng dữ liệu: brief nhập ở `/agents` → Coordinator lần lượt gọi từng endpoint (mỗi request một
nhiệm vụ — BR5) → sau mỗi mốc gọi `POST /api/agents/jobs` lưu tiến độ vào bảng `jobs` → kết quả
cuối (blueprint_id, ảnh, audio, packs) hiển thị + nút "Mở lại trong dây chuyền" để render video
bằng canvas (tính năng 06 hiện có).

## Thiết kế Cơ sở dữ liệu (Database Schema)

Dùng lại bảng `jobs` của migration 0001 (không cần migration mới):
- `id` TEXT PK — `job_<uid>`
- `type` TEXT — cố định `'agent_crew'`
- `status` TEXT — `running` | `done` | `error`
- `progress` INTEGER 0–100
- `message` TEXT — bước hiện tại (vd "QA Reviewer: vòng 1")
- `params_json` TEXT — brief đã nhập
- `result_json` TEXT — tổng kết (blueprint_id, số ảnh, audio url, số pack, trends đã chọn)
- `error` TEXT, `created_at`, `updated_at`

## Thiết kế API / Hàm xử lý (API/Function Design)

Mới trong `src/lib/agents.ts`:
- `TREND_SYSTEM`, `REVIEW_SYSTEM` — system prompt (BR6: trung thực, không hứa hẹn)
- `normaliseTrends(data, opts)` — thuần, không I/O: hợp nhất JSON AI với fallback, kẹp score 1–100
- `normaliseReview(data)` — thuần, không I/O: JSON rác → approve an toàn kèm cảnh báo (TC6)
- `fetchTrends(env, opts)` / `reviewBlueprint(env, blueprint, opts)` — gọi `askJSON` qua `llm.ts`
- `fallbackTrends(niche, count)` — không AI vẫn chạy (BR2)

Mới trong `src/lib/agent-core.ts` (thuần 100%, KHÔNG import gì — để Test Agent chạy độc lập bằng node):
- `clampCount(n)`, `clampProgress(n)` — BR7
- `planNext(state)` — state machine thuần trả bước kế tiếp: `trends|blueprint|review|revise|images|voice|distribution|finish|abort` (TC2, TC5)
- `weightProgress(stepDone)` — mốc tiến độ % theo trọng số (ảnh chiếm ~50%)

Sửa `src/index.tsx` — 4 endpoint mới (mỗi endpoint một nhiệm vụ, BR5):
- `POST /api/agents/trends` → validate niche ≥ 2 ký tự (BR7) → `fetchTrends` → `{trends, ai}`
- `POST /api/agents/review` → validate `blueprint.shots` mảng khác rỗng (BR7) → `reviewBlueprint` → `{review, ai}`
- `GET /api/agents/jobs` → 20 job `agent_crew` mới nhất
- `POST /api/agents/jobs` → tạo mới nếu thiếu `id`, ngược lại UPDATE có kẹp `progress` 0–100 (BR4, BR7)
- `GET /agents` → `renderAgents()` + thêm rewrite `/agents` trong `vercel.json`

Mới `src/agents-page.tsx` — trang UI tiếng Việt phong cách neon teal hiện có: thẻ brief, 7 thẻ tác
nhân (icon + trạng thái idle/running/done/error + output rút gọn), thanh tiến độ tổng, log trực
tiếp, khu kết quả (nút mở blueprint), lịch sử job.

Mới `public/static/agents.js` — Coordinator state machine chạy `planNext()` của `agent-core`
(ghi state vào localStorage để F5 không mất), retry 1 lần mỗi ảnh, dừng an toàn theo BR3.

## Chiến lược xử lý lỗi (Error Handling)

- LLM lỗi/timeout → `trends` trả fallback (HTTP 200, `ai:false`); `review` trả approve an toàn kèm
  cảnh báo (HTTP 200) — không bao giờ làm chết dây chuyền vì thiếu AI (BR2, TC6).
- Ảnh 1 shot lỗi → Coordinator retry đúng 1 lần; vẫn lỗi → đánh dấu shot fail và **tiếp tục** các
  shot khác (job không chết); tổng kết hiển thị số shot thiếu.
- Validate input sai → HTTP 400 kèm thông điệp tiếng Việt như endpoint hiện có.
- Lỗi không lường trước → `app.onError` hiện có trả 500 có message; Coordinator cố đánh dấu job
  `error` rồi giữ state trong localStorage để người dùng bấm chạy lại từ bước đó. Nếu không tạo/lưu
  được job, Coordinator dừng trước khi gọi tác nhân để không tạo một lần chạy không thể tái hiện.

## Đề xuất Công nghệ (Tech Stack Recommendation)

- Không thêm dependency nào: dùng lại Hono, `askJSON` (llm.ts), Node test runner (`node --test`,
  Node 24 đọc thẳng `.ts` erasable-syntax) — phù hợp Vercel Hobby 60s và bundle esbuild hiện có.
- Tests thuần: `tests/agents-core.test.mjs` import `agent-core.ts` (không DOM, không network) —
  Test Agent viết độc lập theo Spec, không đọc code Dev ngoài contract hàm trong Spec/Design.
