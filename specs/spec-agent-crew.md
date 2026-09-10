# SPEC: Agent Crew — Đội tác nhân tự động hóa dây chuyền faceless

## Tên tính năng (Feature)
Agent Crew — hệ đa tác nhân điều phối theo mô hình Coordinator: một cú bấm chạy trọn dây chuyền
ý tưởng → trinh sát xu hướng → blueprint → kiểm duyệt (QA) → ảnh 9:16 → giọng đọc → gói phân phối,
hướng tới kênh faceless bền vững, kiếm tiền thụ động, không cần lộ mặt.

## Đường dẫn dịch vụ (Endpoint)
- `GET  /agents` — trang web "Đội tác nhân" (UI tiếng Việt, style neon teal hiện có)
- `POST /api/agents/trends` — Trend Scout Agent: đề xuất góc nội dung bám xu hướng theo ngách
- `POST /api/agents/review` — QA Agent: kiểm duyệt blueprint, trả quyết định approve / revise
- `GET  /api/agents/jobs` — danh sách lần chạy gần nhất (tối đa 20)
- `POST /api/agents/jobs` — tạo / cập nhật trạng thái lần chạy (job persistence vào bảng `jobs` có sẵn)

## Tham số đầu vào (Inputs)

### POST /api/agents/trends
| Tham số | Kiểu dữ liệu | Bắt buộc | Mô tả |
|---|---|---|---|
| niche | chuỗi | Có | Ngách nội dung, vd "Tài chính cá nhân" |
| audience | chuỗi | Không | Mặc định "18–34 tuổi" |
| platform | chuỗi | Không | Mặc định "TikTok & YouTube Shorts" |
| language | chuỗi | Không | Mặc định "Tiếng Việt" |
| count | số | Không | 3–6 (mặc định 5) |
| model | chuỗi | Không | Model text (mặc định DEFAULT_TEXT_MODEL) |

### POST /api/agents/review
| Tham số | Kiểu dữ liệu | Bắt buộc | Mô tả |
|---|---|---|---|
| blueprint | object | Có | Blueprint đầy đủ (kết quả /api/forge/blueprint) |
| language | chuỗi | Không | Mặc định "Tiếng Việt" |
| model | chuỗi | Không | Model text |

### POST /api/agents/jobs
| Tham số | Kiểu dữ liệu | Bắt buộc | Mô tả |
|---|---|---|---|
| id | chuỗi | Có (khi cập nhật) | Id job (`job_...`); thiếu id = tạo mới |
| status | chuỗi | Không | `running` / `done` / `error` |
| progress | số | Không | 0–100 |
| message | chuỗi | Không | Bước hiện tại |
| params_json / result_json / error | object/chuỗi | Không | Brief, tổng kết cuối, thông báo lỗi |

### Coordinator (browser, trang /agents)
| Tham số | Kiểu dữ liệu | Bắt buộc | Mô tả |
|---|---|---|---|
| niche | chuỗi | Có | Ngách nội dung |
| audience, language, duration_sec, model, voice | hỗn hợp | Không | Brief sản xuất (mặc định như trang chính) |

## Ràng buộc nghiệp vụ (Business Rules)

1. **BR1 — Tuần tự có gate:** Coordinator chạy theo thứ tự cố định
   `trends → blueprint → review → images → voice → distribution`; bước `review` phải đạt
   `decision = "approve"` (hoặc hết 1 vòng chỉnh sửa) thì mới được sang bước `images`.
2. **BR2 — Không có AI vẫn chạy được:** khi `OPENAI_API_KEY` chưa cấu hình,
   `/api/agents/trends` trả góc nội dung fallback định sẵn (ai=false), `/api/agents/review`
   trả quyết định `approve` kèm ghi chú "kiểm duyệt thủ công" (ai=false). Không được lỗi 500.
3. **BR3 — Giới hạn vòng sửa:** review tối đa 2 lượt (1 vòng revise). Sau 2 lượt mà vẫn
   `revise` → Coordinator dừng với trạng thái error và ghi rõ lý do vào job.
4. **BR4 — Job bền vững:** mọi thay đổi tiến độ được lưu bảng `jobs` (type = `agent_crew`);
   `GET /api/agents/jobs` trả về lịch sử mới nhất để tái hiện kết quả. Job lỗi KHÔNG bị xoá.
5. **BR5 — Thân thiện Function 60s:** mỗi request HTTP đơn lẻ chỉ thực hiện MỘT nhiệm vụ tác nhân
   (1 lần gọi LLM hoặc 1 ảnh hoặc 1 TTS hoặc 1 gói phân phối) — Coordinator ghép các bước ở browser,
   đúng kiến trúc hiện có ("việc nặng chạy tại browser").
6. **BR6 — Trung thực nội dung:** prompt của các tác nhân cấm hứa hẹn view/doanh thu, cấm advice
   y tế/tài chính/legal cá nhân, nhắc quyền sử dụng tư liệu — khớp tone an toàn hiện có của app.
7. **BR7 — Input validation:** niche cho trends tối thiểu 2 ký tự; blueprint cho review phải có
   `shots` là mảng khác rỗng; `count` ngoài 3–6 được kẹp lại vào biên; `progress` ngoài 0–100 bị kẹp.

## Kịch bản kiểm thử (Test Cases)

- **TC1 (Happy Path — review approve):** blueprint đạt chuẩn → `/api/agents/review` (mock LLM trả
  JSON hợp lệ) → `decision="approve"`, có `score` 1–100 và `issues` là mảng.
- **TC2 (Edge — review revise → dừng sau 2 lượt):** planner của Coordinator nhận 2 kết quả review
  liên tiếp `decision="revise"` → `nextAction` trả `{ action: "abort", reason }`, không bao giờ
  cho phép vòng thứ 3.
- **TC3 (Edge — fallback không AI):** `normaliseTrends(null)` → mảng ≥ 3 góc nội dung hợp lệ, mỗi
  phần tử có `topic` (≥2 ký tự), `angle`, `score` trong 1–100, `ai=false` không xuất hiện trong
  từng phần tử (cờ AI nằm ở tầng response).
- **TC4 (Edge — kẹp biên đầu vào):** `clampCount(1)=3`, `clampCount(99)=6`, `clampProgress(-5)=0`,
  `clampProgress(150)=100`.
- **TC5 (Happy Path — planner tuần tự):** cho state trống → planner trả bước `trends`; cho state
  đã có trends + blueprint approved → planner trả bước `images` với đúng danh sách shot index.
- **TC6 (Edge — review nhận dữ liệu rác):** `normaliseReview(null)` hoặc JSON sai schema → quyết
  định an toàn `approve` với `ai=false` và `issues` chứa cảnh báo "không kiểm duyệt được bằng AI"
  (không được ném exception).
- **TC7 (BR5 — một nhiệm vụ mỗi request):** bản thân `/api/agents/*` không chứa vòng lặp gọi ảnh/TTS
  — kiểm chứng bằng đọc cấu trúc: ảnh & TTS do Coordinator gọi lẻ từng request tới endpoint cũ.
