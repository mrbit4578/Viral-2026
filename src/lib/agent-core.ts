/**
 * Agent Crew — lõi quyết định THUẦN (không I/O, không import).
 *
 * Tách riêng để Test Agent kiểm tra độc lập bằng `node --test` (Node đọc thẳng
 * file .ts erasable-syntax) và để Coordinator ở browser tái sử dụng cùng một
 * state machine với server. Chỉ dùng cú pháp erasable: không enum, không namespace.
 */

export const MAX_REVIEW_ROUNDS = 2

export type CrewStep =
  | 'trends'
  | 'blueprint'
  | 'review'
  | 'revise'
  | 'images'
  | 'voice'
  | 'distribution'
  | 'finish'
  | 'abort'

export type CrewDecision = 'approve' | 'revise' | null

export type CrewState = {
  trendsDone: boolean
  blueprintDone: boolean
  /** Số lượt QA review đã chạy (mỗi lượt tăng 1). */
  reviewRounds: number
  lastDecision: CrewDecision
  /** Shot index chưa có ảnh thành công. */
  pendingShots: number[]
  voiceDone: boolean
  distributionDone: boolean
}

export type CrewPlan = {
  step: CrewStep
  reason?: string
}

export const STEP_WEIGHTS: Record<CrewStep, number> = {
  trends: 5,
  blueprint: 10,
  review: 10,
  revise: 10,
  images: 50,
  voice: 15,
  distribution: 10,
  finish: 0,
  abort: 0,
}

/** Kẹp số lượng trend vào biên 3–6, đầu vào rác/vắng → mặc định 5 (Spec BR7). */
export function clampCount(value: unknown): number {
  if (value === null || value === undefined || value === '') return 5
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) return 5
  return Math.max(3, Math.min(6, n))
}

/** Kẹp tiến độ vào biên 0–100 số nguyên (Spec BR7). */
export function clampProgress(value: unknown): number {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(100, n))
}

/**
 * State machine thuần: trả về bước kế tiếp cần chạy.
 * - BR1: tuần tự trends → blueprint → review → images → voice → distribution → finish.
 * - BR3: QA review tối đa MAX_REVIEW_ROUNDS lượt; quá đó → abort kèm lý do.
 * - "revise" nghĩa là tạo lại blueprint từ góp ý của QA; sau đó lastDecision
 *   được Coordinator đặt lại null để vòng review tiếp theo diễn ra.
 */
export function planNext(state: CrewState): CrewPlan {
  if (!state.trendsDone) return { step: 'trends' }
  if (!state.blueprintDone) return { step: 'blueprint' }

  if (state.lastDecision === null) return { step: 'review' }

  if (state.lastDecision === 'revise') {
    if (state.reviewRounds >= MAX_REVIEW_ROUNDS) {
      return {
        step: 'abort',
        reason:
          `QA từ chối sau ${state.reviewRounds} lượt kiểm duyệt (giới hạn ${MAX_REVIEW_ROUNDS}). ` +
          'Hãy đổi chủ đề/niche hoặc tự chỉnh blueprint rồi chạy lại.',
      }
    }
    return { step: 'revise' }
  }

  // lastDecision === 'approve' → vào sản xuất
  if (state.pendingShots.length) return { step: 'images' }
  if (!state.voiceDone) return { step: 'voice' }
  if (!state.distributionDone) return { step: 'distribution' }
  return { step: 'finish' }
}

/** Tổng trọng số các bước đã xong, kẹp 0–100. Ảnh làm tròn bằng imagesFrac (0–1). */
export function weightProgress(doneSteps: CrewStep[], imagesFrac = 1): number {
  const frac = Math.max(0, Math.min(1, Number.isFinite(Number(imagesFrac)) ? Number(imagesFrac) : 1))
  let total = 0
  let hasImages = false
  for (const step of doneSteps) {
    if (step === 'images') {
      hasImages = true
      continue
    }
    total += STEP_WEIGHTS[step] || 0
  }
  if (hasImages) total += STEP_WEIGHTS.images * frac
  return clampProgress(total)
}

/** Chọn trend điểm cao nhất (hoà điểm → phần tử đầu). Danh sách rác → null. */
export function pickBestTrend<T extends { score: unknown }>(trends: T[] | null | undefined): T | null {
  if (!Array.isArray(trends) || !trends.length) return null
  let best: T | null = null
  let bestScore = -Infinity
  for (const item of trends) {
    if (!item || typeof item !== 'object') continue
    const score = Number(item.score)
    if (!Number.isFinite(score)) continue
    if (!best || score > bestScore) {
      best = item
      bestScore = score
    }
  }
  return best
}

// ---------------------------------------------------------------- normalisers
// Bản thuần hoá dữ liệu AI/fallback — dùng chung cho server (agents.ts) và test.

export type TrendAngle = {
  topic: string
  angle: string
  hook: string
  why: string
  trend_driver: string
  format: string
  score: number
}

export type TrendsPayload = { trends: TrendAngle[]; ai: boolean; note?: string }

export type ReviewVerdict = {
  decision: 'approve' | 'revise'
  score: number
  issues: string[]
  suggestions: string[]
  ai: boolean
  note?: string
}

function cleanString(value: unknown, fallback = ''): string {
  const s = String(value ?? '').trim()
  return s || fallback
}

function cleanStringArray(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((v) => String(v ?? '').trim())
    .filter(Boolean)
    .slice(0, limit)
}

/** Khuôn mẫu nội dung bền vững khi không có AI (BR2). */
export function fallbackTrends(niche: string, count: number): TrendAngle[] {
  const n = cleanString(niche, 'Kiến thức tổng hợp')
  const templates: Omit<TrendAngle, 'score'>[] = [
    {
      topic: `3 điều nhiều người hiểu sai về ${n}`,
      angle: 'Đảo ngược một niềm tin phổ biến rồi chứng minh bằng ví dụ đời thường',
      hook: `Nếu bạn vẫn tin điều này về ${n}, 30 giây tới sẽ khiến bạn phải suy nghĩ lại.`,
      why: 'Mở đầu tạo khoảng trống tò mò; nội dung phản biện có ví dụ dễ giữ người xem tới cuối.',
      trend_driver: 'Dạng video myth-buster luôn nằm trong nhóm được lưu lại nhiều',
      format: 'Myth-buster',
    },
    {
      topic: `5 chi tiết nhỏ trong ${n} tạo khác biệt lớn`,
      angle: 'Gom các chi tiết ít ai để ý thành danh sách đếm ngược',
      hook: 'Chi tiết số 3 gần như không ai nói đến, nhưng nó quyết định tất cả.',
      why: 'Listicle có nhịp nhanh, dễ cắt scene và dễ bấm xem lại.',
      trend_driver: 'Định dạng đếm ngược giúp giữ retention ở nửa sau video',
      format: 'Listicle',
    },
    {
      topic: `Một thay đổi nhỏ trong ${n} và kết quả sau 30 ngày`,
      angle: 'Kể theo dòng thời gian trước – sau, không tô hồng',
      hook: 'Mình đã thử điều này trong 30 ngày, đây là những gì thật sự xảy ra.',
      why: 'Cấu trúc trước–sau tạo lý do xem hết để biết kết quả.',
      trend_driver: 'Dạng thử thách 30 ngày luôn có lượt tìm kiếm ổn định',
      format: 'Story',
    },
    {
      topic: `${n} hoạt động thế nào — giải thích trong 60 giây`,
      angle: 'Dùng một ẩn dụ đời thường xuyên suốt để giải thích nguyên lý',
      hook: 'Hãy tưởng tượng ${n} giống như một thứ bạn thấy mỗi ngày — đây là cách nó vận hành.',
      why: 'Explainer có ẩn dụ rõ dễ hiểu, phù hợp khán giả mới.',
      trend_driver: 'Nội dung giải thích nhanh được nền tảng đề xuất cho người mới vào chủ đề',
      format: 'Explainer',
    },
    {
      topic: `Checklist trước khi bắt đầu với ${n}`,
      angle: 'Biến kiến thức thành danh sách kiểm tra làm được ngay',
      hook: 'Trước khi bắt đầu với ' + n + ', hãy kiểm tra 5 điều này.',
      why: 'Checklist có giá trị lưu lại — tín hiệu mạnh với thuật toán.',
      trend_driver: 'Nội dung có tỷ lệ lưu cao thường được đẩy tiếp',
      format: 'Checklist',
    },
    {
      topic: `Cách làm cũ vs cách làm mới trong ${n}`,
      angle: 'So sánh song song trực quan, không bênh bên nào vô căn cứ',
      hook: 'Cùng một việc, hai cách làm — kết quả khác nhau từ lúc nào không hay biết.',
      why: 'So sánh trực quan tạo tranh luận lành mạnh trong phần bình luận.',
      trend_driver: 'Video so sánh dễ nhận tương tác bình luận',
      format: 'Comparison',
    },
  ]
  return templates.slice(0, Math.max(3, Math.min(6, count))).map((tpl, i) => ({
    ...tpl,
    score: Math.max(1, Math.min(100, 78 - i * 3)),
  }))
}

/** Hợp nhất JSON của AI với fallback; mục rác bị loại, score kẹp 1–100 (TC3). */
export function normaliseTrends(data: unknown, niche: string, count: number): TrendsPayload {
  const wanted = clampCount(count)
  const raw = data && typeof data === 'object' ? (data as { trends?: unknown }) : null
  const list = Array.isArray(raw?.trends) ? raw!.trends : []
  const cleaned: TrendAngle[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    const topic = cleanString(rec.topic)
    if (topic.length < 2) continue
    const score = Math.round(Number(rec.score))
    cleaned.push({
      topic: topic.slice(0, 160),
      angle: cleanString(rec.angle, 'Góc tiếp cận chưa rõ — hãy tự kiểm tra lại'),
      hook: cleanString(rec.hook),
      why: cleanString(rec.why),
      trend_driver: cleanString(rec.trend_driver),
      format: cleanString(rec.format, 'Explainer'),
      score: Number.isFinite(score) ? Math.max(1, Math.min(100, score)) : 60,
    })
    if (cleaned.length >= wanted) break
  }
  if (cleaned.length >= 3) return { trends: cleaned, ai: true }
  return {
    trends: fallbackTrends(niche, wanted),
    ai: false,
    note: 'Không đọc được góc xu hướng từ AI — dùng khuôn mẫu nội dung bền vững có sẵn.',
  }
}

/** Quyết định QA an toàn: dữ liệu không đọc được → approve kèm cảnh báo (TC6, BR2). */
export function normaliseReview(data: unknown): ReviewVerdict {
  const safeApprove = (issues: string[]): ReviewVerdict => ({
    decision: 'approve',
    score: 70,
    issues,
    suggestions: [],
    ai: false,
    note: 'Không kiểm duyệt được bằng AI — hãy tự rà checklist trước khi đăng.',
  })

  if (!data || typeof data !== 'object') {
    return safeApprove(['Phản hồi kiểm duyệt trống hoặc sai định dạng.'])
  }
  const rec = data as Record<string, unknown>
  const decisionRaw = cleanString(rec.decision).toLowerCase()
  if (decisionRaw !== 'approve' && decisionRaw !== 'revise') {
    return safeApprove([`Quyết định không hợp lệ ("${cleanString(rec.decision).slice(0, 40)}") — mặc định cho qua kèm cảnh báo.`])
  }

  const score = Math.round(Number(rec.score))
  return {
    decision: decisionRaw as 'approve' | 'revise',
    score: Number.isFinite(score) ? Math.max(1, Math.min(100, score)) : 70,
    issues: cleanStringArray(rec.issues, 10),
    suggestions: cleanStringArray(rec.suggestions, 10),
    ai: true,
  }
}
