# PLAN: Agent Crew — Đội tác nhân tự động hóa dây chuyền faceless

> Kế hoạch triển khai cho [SPEC](../specs/spec-agent-crew.md) và [DESIGN](../design/design-agent-crew.md)

## Bước 1: Lõi thuần `src/lib/agent-core.ts` (không I/O)

- Phạm vi file: `src/lib/agent-core.ts`
- Tiêu chí hoàn thành (DoD): map đúng BR3/BR7 — `clampCount`, `clampProgress`, `planNext`
  (trả đúng chuỗi bước, chặn vòng revise thứ 3), `weightProgress`; không import gì cả.

## Bước 2: Server agents `src/lib/agents.ts`

- Phạm vi file: `src/lib/agents.ts` (dùng `askJSON` từ `llm.ts`)
- Tiêu chí hoàn thành (DoD): BR2 + TC1 + TC3 + TC6 — `fetchTrends`, `reviewBlueprint`,
  `normaliseTrends`, `normaliseReview`, `fallbackTrends` theo đúng schema trong Spec.

## Bước 3: API + trang + Coordinator

- Phạm vi file: `src/index.tsx` (4 endpoint + route `/agents`), `src/agents-page.tsx`,
  `public/static/agents.js`, `vercel.json` (rewrite `/agents`), `src/page.tsx` (thêm link nav)
- Tiêu chí hoàn thành (DoD): BR1, BR4, BR5 — mỗi endpoint một nhiệm vụ; Coordinator chạy tuần tự
  có gate review, lưu job sau mỗi mốc, UI 7 thẻ tác nhân + log + lịch sử.

## Bước 4: Test Agent kiểm tra chéo (độc lập với code Bước 1–3)

- Phạm vi file: `tests/agents-core.test.mjs` + script `npm test` trong `package.json`
- Tiêu chí hoàn thành (DoD): TC2, TC3, TC4, TC5, TC6 đều có test viết TỪ Spec (không đọc
  implementation), bao phủ cả Happy Path lẫn Edge Cases.

## Bước 5: Kiểm tra chéo & nghiệm thu

- Chạy `npm run typecheck` + `npm test` + `npm run build` → cả ba phải xanh.
- Chạy `python E:\AI\vibecoding\sdd-tool\sdd.py check` cho tài liệu SDD.
- Con người duyệt kết quả cuối cùng trong `reports/`.
