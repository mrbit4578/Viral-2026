# BÁO CÁO NGHIỆM THU — Agent Crew (Đa tác nhân SDD)

- **Ngày:** 2026-09-10
- **Dự án:** Faceless Forge (`E:\AI\Video-viral\faceless-forge`)
- **Tính năng:** Agent Crew — dây chuyền đa tác nhân điều phối theo mô hình Coordinator
- **Spec:** [`specs/spec-agent-crew.md`](../specs/spec-agent-crew.md)

## 1. Tổng kết xác minh (KẾT QUẢ: XANH)

| Hạng mục | Kết quả | Chi tiết |
|---|---|---|
| Unit test agent-core | ✅ 21/21 pass | `node --test tests/agents-core.test.mjs` |
| Smoke test API | ✅ 8/8 pass | `tests/smoke-agents-api.test.mjs` (không cần AI key) |
| **Tổng test** | **✅ 29/29 pass (100%)** | `npm test` |
| Typecheck | ✅ 0 lỗi | `npx tsc --noEmit` |
| Build | ✅ | bundle 2.1 MB (server) + 10.7 KB (agent-core client) |
| SDD tool verify | ✅ 6/6 pass | `python sdd.py verify` — pipeline mẫu workspace |

## 2. Phạm vi triển khai

### Dev Agent đã giao
- `src/lib/agent-core.ts` — logic thuần: `clampCount`, `clampProgress`, `weightProgress`,
  `fallbackTrends`, `normaliseTrends`, `normaliseReview`, `nextAction` (planner tuần tự có gate),
  hằng số `MAX_REVIEW_ROUNDS = 2`.
- `src/lib/agents.ts` — 2 tác nhân LLM phía server: Trend Scout + QA Reviewer, mỗi request
  đúng MỘT nhiệm vụ LLM (BR5), kèm fallback khi thiếu key (BR2).
- `src/agents-page.tsx` + `public/static/agent-core.js` — trang `/agents` (UI tiếng Việt,
  style neon teal hiện có) và Coordinator chạy tại browser.
- Endpoint: `GET /agents`, `POST /api/agents/trends`, `POST /api/agents/review`,
  `GET/POST /api/agents/jobs` (job persistence bảng `jobs`, type `agent_crew`).

### Test Agent đã giao (độc lập, chỉ đọc Spec)
- `tests/agents-core.test.mjs` — bao phủ TC1–TC7 và BR1–BR7 của Spec.
- `tests/smoke-agents-api.test.mjs` — dựng app Hono thật, kiểm chứng HTTP status,
  validation 400 (BR7), fallback không-500 (BR2/BR4).

## 3. Đối chiếu Spec → Test → Kết quả

| Spec | Nội dung | Test | Kết quả |
|---|---|---|---|
| BR1 | Thứ tự tuần tự có gate `review` | planner state tests | ✅ |
| BR2 | Không AI vẫn chạy, không 500 | smoke trends/review | ✅ |
| BR3 | Tối đa 2 lượt review, không vòng 3 | planner revise×2 → abort | ✅ |
| BR4 | Job bền vững, GET jobs không 500 khi thiếu DB | smoke GET /api/agents/jobs | ✅ |
| BR5 | Một nhiệm vụ mỗi request | review + cấu trúc phân phối tách request | ✅ |
| BR6 | Prompt cấm hứa view/thu nhập, cấm advice y tế/tài chính | system prompt trong `agents.ts` | ✅ |
| BR7 | Validation & kẹp biên (niche ≥2, shots rỗng → 400, count 3–6, progress 0–100) | unit + smoke | ✅ |
| TC1–TC7 | Happy path + edge cases | toàn bộ xanh | ✅ |

## 4. Kiến trúc đã giữ nguyên

- Hono trên Vercel Functions (`api/[[...path]].ts`), Neon Postgres, Vercel Blob.
- "Việc nặng chạy tại browser": Coordinator ghép bước, server mỗi request một nhiệm vụ.
- Không dùng `dangerously skip permission`; mọi thao tác trong thư mục dự án.

## 5. Việc cần con người duyệt

1. Đọc báo cáo này — mọi test đã xanh, không còn việc làm tay nào trong luồng Agent Crew.
2. Tuỳ chọn: deploy Vercel và bấm thử "Chạy dây chuyền" tại `/agents` với AI key thật.
