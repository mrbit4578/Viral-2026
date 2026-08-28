/**
 * Idea Lab — sinh ý tưởng mới và cải tiến ý tưởng thô.
 * Bước 1 & 2 của dây chuyền: Ý tưởng -> Cải tiến ý tưởng.
 */
import { askJSON, DEFAULT_TEXT_MODEL } from './llm'
import type { Bindings } from '../types'

export type IdeaSeed = {
  topic: string
  angle: string
  hook: string
  why: string
  score: number
  format: string
}

export type RefinedIdea = {
  headline: string
  improved_topic: string
  hook: string
  angle: string
  differentiator: string
  audience_pain: string
  score: number
  risk_note: string
}

const SEED_SYSTEM = `You are a short-form content researcher for faceless video channels.
Propose distinct, specific, non-clickbait video ideas that a creator can actually make with
stock/AI visuals and a voice-over. Be truthful: no medical/financial/legal advice, no fake
statistics, no promises of views or income.

Return ONLY valid JSON, an object of this shape:
{"ideas":[{"topic":"specific video topic, max 90 chars","angle":"the unusual framing","hook":"first spoken line","why":"why this can hold attention","score":1-100,"format":"e.g. Listicle / Story / Myth-buster / Explainer"}]}
Return exactly the requested number of ideas. Answer in the requested language.`

export async function generateIdeas(
  env: Bindings,
  opts: { niche: string; audience: string; platform: string; language: string; count?: number; model?: string }
): Promise<IdeaSeed[]> {
  const count = Math.max(3, Math.min(8, opts.count || 5))
  const user = [
    `Niche: ${opts.niche}`,
    `Audience: ${opts.audience}`,
    `Platform: ${opts.platform}`,
    `Language for output: ${opts.language}`,
    `Number of ideas: ${count}`,
  ].join('\n')

  try {
    const data = await askJSON<{ ideas: any[] }>(env, SEED_SYSTEM, user, opts.model || DEFAULT_TEXT_MODEL)
    const ideas = Array.isArray(data?.ideas) ? data.ideas : []
    const cleaned = ideas
      .filter((i) => i && typeof i === 'object' && String(i.topic || '').trim())
      .slice(0, count)
      .map((i) => ({
        topic: String(i.topic).trim().slice(0, 140),
        angle: String(i.angle || '').trim(),
        hook: String(i.hook || '').trim(),
        why: String(i.why || '').trim(),
        score: Math.max(1, Math.min(100, Math.round(Number(i.score) || 60))),
        format: String(i.format || 'Explainer').trim(),
      }))
    if (cleaned.length) return cleaned
  } catch {
    /* rơi xuống fallback */
  }
  return fallbackIdeas(opts.niche, count)
}

function fallbackIdeas(niche: string, count: number): IdeaSeed[] {
  const templates = [
    { f: 'Myth-buster', t: `3 điều nhiều người hiểu sai về ${niche}`, a: 'Đảo ngược một niềm tin phổ biến' },
    { f: 'Listicle', t: `5 chi tiết nhỏ trong ${niche} tạo khác biệt lớn`, a: 'Gom các chi tiết ít ai để ý' },
    { f: 'Story', t: `Một thay đổi nhỏ trong ${niche} và kết quả sau 30 ngày`, a: 'Kể theo dòng thời gian' },
    { f: 'Explainer', t: `${niche} hoạt động thế nào — giải thích trong 60 giây`, a: 'Dùng ẩn dụ đời thường' },
    { f: 'Comparison', t: `Cách làm cũ vs cách làm mới trong ${niche}`, a: 'So sánh song song trực quan' },
    { f: 'Checklist', t: `Checklist trước khi bắt đầu với ${niche}`, a: 'Biến kiến thức thành hành động' },
    { f: 'Q&A', t: `Câu hỏi được lặp lại nhiều nhất về ${niche}`, a: 'Trả lời thẳng, không lòng vòng' },
    { f: 'Behind', t: `Điều ít ai nói với bạn về ${niche}`, a: 'Góc nhìn thực tế, không tô hồng' },
  ]
  return templates.slice(0, count).map((tpl, i) => ({
    topic: tpl.t,
    angle: tpl.a,
    hook: `Nếu bạn đang quan tâm ${niche}, đây là điều nên biết trước tiên.`,
    why: 'Chủ đề cụ thể, dễ minh hoạ bằng hình ảnh và có lý do để xem hết.',
    score: 70 - i * 2,
    format: tpl.f,
  }))
}

const REFINE_SYSTEM = `You are a senior short-form content editor. The creator gives you a raw, often vague
video idea. Produce 3 sharper, more specific and more watchable versions of it. Each version must
keep the creator's intent but improve specificity, curiosity gap and clarity. Stay truthful: never
add invented statistics, never promise views or income, avoid medical/financial/legal advice.

Return ONLY valid JSON:
{"refined":[{"headline":"short label for this direction","improved_topic":"the rewritten topic, specific, max 110 chars","hook":"first spoken line","angle":"the framing that makes it different","differentiator":"what makes it stand out vs typical videos on this topic","audience_pain":"the viewer problem it addresses","score":1-100,"risk_note":"one honest caveat or policy/rights reminder"}]}
Exactly 3 items. Answer in the requested language.`

export async function refineIdea(
  env: Bindings,
  opts: { topic: string; niche: string; audience: string; platform: string; language: string; model?: string }
): Promise<RefinedIdea[]> {
  const user = [
    `Raw idea: ${opts.topic}`,
    `Niche: ${opts.niche}`,
    `Audience: ${opts.audience}`,
    `Platform: ${opts.platform}`,
    `Language for output: ${opts.language}`,
  ].join('\n')

  try {
    const data = await askJSON<{ refined: any[] }>(env, REFINE_SYSTEM, user, opts.model || DEFAULT_TEXT_MODEL)
    const list = Array.isArray(data?.refined) ? data.refined : []
    const cleaned = list
      .filter((r) => r && typeof r === 'object' && String(r.improved_topic || '').trim())
      .slice(0, 3)
      .map((r) => ({
        headline: String(r.headline || 'Hướng cải tiến').trim(),
        improved_topic: String(r.improved_topic).trim().slice(0, 160),
        hook: String(r.hook || '').trim(),
        angle: String(r.angle || '').trim(),
        differentiator: String(r.differentiator || '').trim(),
        audience_pain: String(r.audience_pain || '').trim(),
        score: Math.max(1, Math.min(100, Math.round(Number(r.score) || 65))),
        risk_note: String(r.risk_note || 'Kiểm tra bản quyền tư liệu và chính sách nền tảng trước khi đăng.').trim(),
      }))
    if (cleaned.length) return cleaned
  } catch {
    /* rơi xuống fallback */
  }
  return fallbackRefine(opts.topic)
}

function fallbackRefine(topic: string): RefinedIdea[] {
  const base = topic.trim()
  return [
    {
      headline: 'Thu hẹp phạm vi',
      improved_topic: `${base} — tập trung vào một trường hợp cụ thể duy nhất`,
      hook: `Đây là phần của ${base} mà hầu hết mọi người bỏ qua.`,
      angle: 'Chọn một khía cạnh hẹp thay vì nói chung chung.',
      differentiator: 'Càng hẹp càng dễ minh hoạ và dễ nhớ.',
      audience_pain: 'Người xem ngợp vì nội dung chung chung, thiếu ví dụ.',
      score: 74,
      risk_note: 'Chỉ dùng ví dụ có thể kiểm chứng.',
    },
    {
      headline: 'Đảo ngược kỳ vọng',
      improved_topic: `Điều ngược lại về ${base} mà ít người nói đến`,
      hook: `Có thể bạn đang hiểu ${base} theo chiều ngược lại.`,
      angle: 'Bắt đầu bằng một quan niệm phổ biến rồi phản biện có căn cứ.',
      differentiator: 'Tạo khoảng trống tò mò ngay giây đầu.',
      audience_pain: 'Người xem đã nghe quá nhiều lời khuyên giống nhau.',
      score: 71,
      risk_note: 'Phản biện cần dẫn nguồn, tránh gây tranh cãi vô căn cứ.',
    },
    {
      headline: 'Biến thành hành động',
      improved_topic: `${base}: quy trình 3 bước áp dụng được ngay hôm nay`,
      hook: `Bạn có thể bắt đầu với ${base} chỉ trong 3 bước.`,
      angle: 'Chuyển kiến thức thành checklist thực thi.',
      differentiator: 'Video có giá trị lưu lại và xem lại.',
      audience_pain: 'Biết rồi nhưng không biết bắt đầu từ đâu.',
      score: 76,
      risk_note: 'Không đưa ra lời khuyên y tế/tài chính mang tính cá nhân hoá.',
    },
  ]
}
