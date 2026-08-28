/**
 * Forge engine — sinh Viral Blueprint.
 * Port từ backend/forge_engine.py, giữ nguyên fallback tất định để app vẫn
 * hoạt động khi không có API key.
 */
import { askJSON, DEFAULT_TEXT_MODEL } from './llm.js'
import type { Bindings, Blueprint, IdeaBrief, Shot } from '../types.js'

function cleanList(value: any, fallback: string[], limit: number): string[] {
  if (!Array.isArray(value)) return fallback
  const cleaned = value.map((v) => String(v ?? '').trim()).filter(Boolean)
  return cleaned.length ? cleaned.slice(0, limit) : fallback
}

/** Blueprint dự phòng — không cần AI, luôn dùng được. */
export function fallbackBlueprint(req: IdeaBrief): Blueprint {
  const topic = (req.topic || '').trim()
  const duration = Number(req.duration_sec || 45)
  const platform = req.platform || 'TikTok & YouTube Shorts'
  const tone = req.tone || 'Kể chuyện giàu nhịp'
  const opening = `Bạn có từng tự hỏi vì sao ${topic} lại khiến nhiều người bỏ lỡ điều quan trọng nhất?`
  const script = [
    `${opening} Chỉ trong vài giây tới, bạn sẽ thấy một góc nhìn khác.`,
    `${topic} không chỉ là một chi tiết thú vị; nó có thể thay đổi cách chúng ta nhìn vấn đề.`,
    'Đầu tiên, hãy bắt đầu từ điều ít người để ý nhất. Tiếp theo, kết nối nó với một tình huống rất quen thuộc trong đời sống.',
    'Và đây là điểm mấu chốt: khi hiểu nguyên lý phía sau, bạn có thể áp dụng ngay thay vì chỉ xem rồi quên.',
    'Nếu bạn muốn phần tiếp theo sâu hơn, hãy lưu video này và theo dõi để không bỏ lỡ.',
  ].join(' ')

  const shotCount = Math.max(4, Math.min(7, Math.round(duration / 8)))
  const phases = [
    'Câu móc mở đầu', 'Đặt vấn đề', 'Bật mí insight',
    'Ví dụ trực quan', 'Điểm then chốt', 'Kết & CTA', 'Kết & CTA',
  ]
  const narrations = [
    opening,
    'Đây là điều phần lớn mọi người thường bỏ qua.',
    'Hãy nhìn vào chi tiết này để thấy khác biệt.',
    'Đặt nó vào một ví dụ đơn giản, dễ nhớ.',
    'Điểm quan trọng là biến kiến thức thành hành động.',
    'Lưu lại và theo dõi để xem phần tiếp theo.',
  ]
  const overlays = [
    'DỪNG LẠI 3 GIÂY', 'ÍT AI ĐỂ Ý', 'ĐIỂM MẤU CHỐT',
    'VÍ DỤ THỰC TẾ', 'ÁP DỤNG NGAY', 'LƯU VIDEO NÀY',
  ]

  const shots: Shot[] = []
  for (let i = 0; i < shotCount; i++) {
    const start = Math.round((i * duration) / shotCount)
    const end = Math.round(((i + 1) * duration) / shotCount)
    const phase = phases[Math.min(i, phases.length - 1)]
    shots.push({
      start_sec: start,
      end_sec: end,
      purpose: phase,
      visual: `Cảnh faceless giàu chuyển động minh hoạ ${topic}, bố cục dọc 9:16.`,
      narration: narrations[Math.min(i, narrations.length - 1)],
      on_screen_text: overlays[Math.min(i, overlays.length - 1)],
      image_prompt:
        `Vertical 9:16 cinematic editorial illustration about ${topic}, ${phase.toLowerCase()}, ` +
        'faceless storytelling, strong subject separation, premium lighting, clean center space for captions, no text, no watermark',
    })
  }

  return {
    viral_score: 72,
    concept: `Một video ${tone.toLowerCase()} giải mã ${topic} bằng nhịp nhanh, hình ảnh rõ ý và CTA tự nhiên.`,
    why_it_can_work: [
      'Mở bằng một câu hỏi tạo khoảng trống tò mò.',
      'Mỗi đoạn đều có một thay đổi hình ảnh để giữ nhịp xem.',
      'Kết thúc tạo lý do để lưu và quay lại xem phần tiếp theo.',
    ],
    titles: [
      `Sự thật về ${topic} mà nhiều người bỏ lỡ`,
      `Đừng lướt: hiểu ${topic} trong ${duration} giây`,
      `Tại sao ${topic} quan trọng hơn bạn nghĩ?`,
    ],
    thumbnail_text: 'ĐỪNG BỎ QUA',
    hook: opening,
    script,
    shots,
    seo: {
      description: `Một góc nhìn ngắn, dễ hiểu về ${topic}. Xem đến cuối và lưu lại nếu bạn thấy hữu ích.`,
      hashtags: ['#faceless', '#shorts', '#learnontiktok', '#contentcreator', '#viralvideo'],
      pinned_comment: 'Bạn muốn mình làm video tiếp theo về khía cạnh nào?',
    },
    monetization: {
      angle: 'Xây dựng series cùng một niche để tăng độ tin cậy và cơ hội xem lại; chỉ dùng nguồn tư liệu có quyền sử dụng.',
      cta: 'Lưu video và theo dõi để xem phần tiếp theo.',
      disclosure: 'Không cam kết view hoặc doanh thu. Kiểm tra chính sách kiếm tiền, bản quyền và nội dung tổng hợp của nền tảng trước khi đăng.',
      streams: [
        'Quỹ sáng tạo của nền tảng (khi đủ điều kiện)',
        'Tiếp thị liên kết đúng chủ đề, có công bố rõ ràng',
        'Sản phẩm số của riêng bạn (ebook, template, khoá học ngắn)',
        'Hợp tác thương hiệu khi kênh có tệp khán giả rõ nét',
      ],
    },
    production_checklist: [
      'Kiểm chứng mọi số liệu/câu khẳng định trước khi thu âm.',
      'Dùng hình, nhạc và footage bạn có quyền sử dụng thương mại.',
      'Giữ chữ trên màn hình dưới 7 từ mỗi cảnh và đủ tương phản.',
      `Xuất 9:16, xem lại phụ đề và đăng thử trên ${platform}.`,
    ],
    fallback: true,
  }
}

/** Chuẩn hoá dữ liệu AI trả về, hợp nhất với fallback. */
export function normaliseBlueprint(data: any, req: IdeaBrief): Blueprint {
  const fb = fallbackBlueprint(req)
  if (!data || typeof data !== 'object') return fb

  const bp: Blueprint = { ...fb, ...data }

  const score = Number(data.viral_score)
  bp.viral_score = Number.isFinite(score) ? Math.max(1, Math.min(100, Math.round(score))) : fb.viral_score

  bp.concept = String(data.concept || fb.concept).trim()
  bp.hook = String(data.hook || fb.hook).trim()
  bp.script = String(data.script || fb.script).trim()
  bp.thumbnail_text = String(data.thumbnail_text || fb.thumbnail_text).trim().slice(0, 48)
  bp.titles = cleanList(data.titles, fb.titles, 5)
  bp.why_it_can_work = cleanList(data.why_it_can_work, fb.why_it_can_work, 5)
  bp.production_checklist = cleanList(data.production_checklist, fb.production_checklist, 7)

  const seo = typeof data.seo === 'object' && data.seo ? data.seo : {}
  bp.seo = {
    description: String(seo.description || fb.seo.description).trim(),
    hashtags: cleanList(seo.hashtags, fb.seo.hashtags, 12),
    pinned_comment: String(seo.pinned_comment || fb.seo.pinned_comment).trim(),
  }

  const mon = typeof data.monetization === 'object' && data.monetization ? data.monetization : {}
  bp.monetization = {
    angle: String(mon.angle || fb.monetization.angle).trim(),
    cta: String(mon.cta || fb.monetization.cta).trim(),
    disclosure: String(mon.disclosure || fb.monetization.disclosure).trim(),
    streams: cleanList(mon.streams, fb.monetization.streams || [], 6),
  }

  if (Array.isArray(data.shots) && data.shots.length) {
    const cleaned: Shot[] = []
    data.shots.slice(0, 12).forEach((shot: any, index: number) => {
      if (!shot || typeof shot !== 'object') return
      const fbShot = fb.shots[Math.min(index, fb.shots.length - 1)]
      const start = Number(shot.start_sec)
      const end = Number(shot.end_sec)
      cleaned.push({
        start_sec: Number.isFinite(start) ? start : fbShot.start_sec,
        end_sec: Number.isFinite(end) ? end : fbShot.end_sec,
        purpose: String(shot.purpose || fbShot.purpose).trim(),
        visual: String(shot.visual || fbShot.visual).trim(),
        narration: String(shot.narration || fbShot.narration).trim(),
        on_screen_text: String(shot.on_screen_text || fbShot.on_screen_text).trim(),
        image_prompt: String(shot.image_prompt || fbShot.image_prompt).trim(),
      })
    })
    bp.shots = cleaned.length ? cleaned : fb.shots
  } else {
    bp.shots = fb.shots
  }

  bp.fallback = false
  return bp
}

const BLUEPRINT_SYSTEM = `You are Faceless Forge's senior short-form video strategist. Create original, useful,
truthful video plans that help a creator make a polished faceless video. Never promise views,
revenue, monetisation acceptance, or algorithmic reach. Do not invent facts, testimonials,
medical/legal/financial advice, or copyrighted characters. Recommend licensed/original assets.

Return ONLY valid JSON. No markdown and no text before or after it. The JSON schema is:
{
  "viral_score": 1-100,
  "concept": "one concise sentence",
  "why_it_can_work": ["3 concise reasons"],
  "titles": ["3 platform-safe title options"],
  "thumbnail_text": "2-5 impactful words",
  "hook": "first spoken sentence",
  "script": "a complete natural voice-over in the requested language; no headings or production notes",
  "shots": [{"start_sec":0,"end_sec":7,"purpose":"...","visual":"...","narration":"...","on_screen_text":"...","image_prompt":"detailed English, vertical 9:16, no text, no watermark"}],
  "seo": {"description":"...","hashtags":["#..."],"pinned_comment":"..."},
  "monetization": {"angle":"ethical series or product-fit idea without promises","cta":"...","disclosure":"short rights/policy reminder","streams":["3-4 realistic income streams"]},
  "production_checklist": ["4-6 practical checks"]
}
Use fresh, specific wording. Make one shot about every 5-9 seconds, retain a fast visual rhythm,
and ensure the spoken script follows the shots. The narration of all shots concatenated must
closely match the script.`

export async function generateBlueprint(env: Bindings, req: IdeaBrief): Promise<Blueprint> {
  const user = [
    `Topic: ${req.topic}`,
    `Niche: ${req.niche || 'General'}`,
    `Audience: ${req.audience || 'General'}`,
    `Platform: ${req.platform || 'Short-form'}`,
    `Target duration: ${req.duration_sec || 45} seconds`,
    `Tone: ${req.tone || 'Storytelling'}`,
    `Language: ${req.language || 'Vietnamese'}`,
    `Monetisation goal: ${req.goal || 'Build a sustainable audience'}`,
  ].join('\n')

  try {
    const data = await askJSON(env, BLUEPRINT_SYSTEM, user, req.model || DEFAULT_TEXT_MODEL)
    return normaliseBlueprint(data, req)
  } catch {
    return fallbackBlueprint(req)
  }
}

/** shots -> SRT (port từ forge_app._shots_to_srt + stt_engine.segments_to_srt) */
function srtTime(seconds: number): string {
  const total = Math.max(0, seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = Math.floor(total % 60)
  const ms = Math.round((total - Math.floor(total)) * 1000)
  const pad = (n: number, len = 2) => String(n).padStart(len, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`
}

export function shotsToSRT(shots: Shot[]): string {
  const lines: string[] = []
  let index = 1
  shots.forEach((shot, i) => {
    let start = Number(shot.start_sec)
    let end = Number(shot.end_sec)
    if (!Number.isFinite(start)) start = i * 6
    if (!Number.isFinite(end) || end <= start) end = start + 6
    const text = String(shot.narration || shot.on_screen_text || '').trim()
    if (!text) return
    lines.push(String(index++), `${srtTime(start)} --> ${srtTime(end)}`, text, '')
  })
  return lines.join('\n')
}
