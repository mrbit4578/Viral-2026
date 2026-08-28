/**
 * Distribution engine — sinh gói đăng bài riêng cho từng nền tảng MXH
 * và mô hình hoá thu nhập thụ động (không cam kết kết quả).
 */
import { askJSON, DEFAULT_TEXT_MODEL } from './llm.js'
import type { Bindings, Blueprint, Platform } from '../types.js'

export const PLATFORM_SPECS: Record<
  Platform,
  {
    label: string
    icon: string
    color: string
    caption_limit: number
    hashtag_count: [number, number]
    aspect: string
    max_duration: string
    best_times: string[]
    notes: string
  }
> = {
  tiktok: {
    label: 'TikTok',
    icon: 'fab fa-tiktok',
    color: '#25f4ee',
    caption_limit: 2200,
    hashtag_count: [3, 5],
    aspect: '9:16',
    max_duration: '10 phút (tối ưu 21–34 giây)',
    best_times: ['11:00–13:00', '19:00–22:00'],
    notes: 'Hook phải nằm trong 1 giây đầu. Text overlay lớn, tránh để chữ sát mép dưới (bị UI che).',
  },
  facebook: {
    label: 'Facebook Reels',
    icon: 'fab fa-facebook',
    color: '#0866ff',
    caption_limit: 2200,
    hashtag_count: [2, 4],
    aspect: '9:16',
    max_duration: '90 giây',
    best_times: ['06:00–08:00', '12:00–14:00', '20:00–22:00'],
    notes: 'Caption nên có câu hỏi mở để tăng bình luận. Tránh link ngoài trong caption đầu tiên.',
  },
  instagram: {
    label: 'Instagram Reels',
    icon: 'fab fa-instagram',
    color: '#e1306c',
    caption_limit: 2200,
    hashtag_count: [5, 10],
    aspect: '9:16',
    max_duration: '3 phút',
    best_times: ['09:00–11:00', '19:00–21:00'],
    notes: 'Dùng hashtag phân tầng: rộng + trung + ngách. Thêm alt text để tăng khả năng tiếp cận.',
  },
  x: {
    label: 'X (Twitter)',
    icon: 'fab fa-x-twitter',
    color: '#e7e9ea',
    caption_limit: 280,
    hashtag_count: [1, 2],
    aspect: '9:16 hoặc 1:1',
    max_duration: '2 phút 20 giây',
    best_times: ['08:00–10:00', '17:00–19:00'],
    notes: 'Caption cực ngắn, đặt hook làm câu đầu. Thread bổ sung dưới post gốc để tăng thời gian đọc.',
  },
  youtube: {
    label: 'YouTube Shorts',
    icon: 'fab fa-youtube',
    color: '#ff0033',
    caption_limit: 5000,
    hashtag_count: [3, 5],
    aspect: '9:16',
    max_duration: '3 phút',
    best_times: ['12:00–14:00', '18:00–21:00'],
    notes: 'Tiêu đề nên có #Shorts. Mô tả 2 dòng đầu quan trọng nhất cho tìm kiếm.',
  },
}

export type PlatformPack = {
  platform: Platform
  label: string
  caption: string
  hashtags: string[]
  first_comment: string
  best_time: string
  tips: string[]
  alt_text: string
  char_count: number
}

const DIST_SYSTEM = `You are a social distribution specialist for faceless short-form video.
Write native, platform-appropriate copy. Be truthful and policy-safe: never promise views,
income or virality; no invented statistics; no engagement-bait that violates platform rules
(e.g. "comment or you'll have bad luck"). Disclose AI-generated visuals when relevant.

Return ONLY valid JSON:
{"packs":[{"platform":"tiktok|facebook|instagram|x|youtube","caption":"native caption respecting the character limit","hashtags":["#tag"],"first_comment":"pinned first comment","tips":["2-3 platform-specific posting tips"],"alt_text":"short accessibility description"}]}
Write captions in the requested language. Respect each platform's caption limit and hashtag count.`

/** Gói dự phòng khi không có AI. */
function fallbackPack(platform: Platform, bp: Blueprint): PlatformPack {
  const spec = PLATFORM_SPECS[platform]
  const title = bp.titles?.[0] || bp.concept
  const hooks = bp.hook || ''
  const desc = bp.seo?.description || ''
  const tagPool = bp.seo?.hashtags?.length ? bp.seo.hashtags : ['#faceless', '#shorts', '#viral']
  const [minTag, maxTag] = spec.hashtag_count
  const hashtags = tagPool.slice(0, Math.max(minTag, Math.min(maxTag, tagPool.length)))

  let caption: string
  if (platform === 'x') {
    caption = `${hooks}`.slice(0, 240)
  } else if (platform === 'youtube') {
    caption = `${title}\n\n${desc}\n\n${bp.monetization?.cta || ''}`.trim()
  } else {
    caption = `${hooks}\n\n${desc}\n\n${bp.monetization?.cta || ''}`.trim()
  }
  caption = caption.slice(0, spec.caption_limit)

  return {
    platform,
    label: spec.label,
    caption,
    hashtags,
    first_comment: bp.seo?.pinned_comment || 'Bạn muốn phần tiếp theo về khía cạnh nào?',
    best_time: spec.best_times.join(' · '),
    tips: [spec.notes, `Tỷ lệ khung hình: ${spec.aspect}`, `Độ dài tối đa: ${spec.max_duration}`],
    alt_text: `Video dọc minh hoạ: ${bp.concept}`.slice(0, 180),
    char_count: caption.length,
  }
}

export async function buildDistributionPacks(
  env: Bindings,
  bp: Blueprint,
  platforms: Platform[],
  language = 'Tiếng Việt',
  model = DEFAULT_TEXT_MODEL
): Promise<PlatformPack[]> {
  const targets = platforms.filter((p) => PLATFORM_SPECS[p])
  if (!targets.length) return []

  const specLines = targets
    .map((p) => {
      const s = PLATFORM_SPECS[p]
      return `- ${p}: caption limit ${s.caption_limit} chars, ${s.hashtag_count[0]}-${s.hashtag_count[1]} hashtags. Notes: ${s.notes}`
    })
    .join('\n')

  const user = [
    `Language: ${language}`,
    `Video concept: ${bp.concept}`,
    `Hook: ${bp.hook}`,
    `Best title: ${bp.titles?.[0] || ''}`,
    `Script summary: ${(bp.script || '').slice(0, 700)}`,
    `Base description: ${bp.seo?.description || ''}`,
    `Base hashtags: ${(bp.seo?.hashtags || []).join(' ')}`,
    `CTA: ${bp.monetization?.cta || ''}`,
    '',
    'Platforms and their constraints:',
    specLines,
  ].join('\n')

  try {
    const data = await askJSON<{ packs: any[] }>(env, DIST_SYSTEM, user, model)
    const list = Array.isArray(data?.packs) ? data.packs : []
    const byPlatform = new Map<string, any>()
    list.forEach((p) => {
      const key = String(p?.platform || '').toLowerCase()
      if (targets.includes(key as Platform)) byPlatform.set(key, p)
    })

    return targets.map((platform) => {
      const raw = byPlatform.get(platform)
      const fb = fallbackPack(platform, bp)
      if (!raw) return fb
      const spec = PLATFORM_SPECS[platform]
      const caption = String(raw.caption || fb.caption).slice(0, spec.caption_limit)
      const hashtags = Array.isArray(raw.hashtags)
        ? raw.hashtags.map((t: any) => String(t).trim()).filter(Boolean).slice(0, spec.hashtag_count[1])
        : fb.hashtags
      const tips = Array.isArray(raw.tips)
        ? raw.tips.map((t: any) => String(t).trim()).filter(Boolean).slice(0, 4)
        : fb.tips
      return {
        platform,
        label: spec.label,
        caption,
        hashtags: hashtags.length ? hashtags : fb.hashtags,
        first_comment: String(raw.first_comment || fb.first_comment).trim(),
        best_time: spec.best_times.join(' · '),
        tips: tips.length ? tips : fb.tips,
        alt_text: String(raw.alt_text || fb.alt_text).slice(0, 200),
        char_count: caption.length,
      }
    })
  } catch {
    return targets.map((p) => fallbackPack(p, bp))
  }
}

// ------------------------------------------------------------ thu nhập thụ động

export type RevenueModel = {
  streams: {
    name: string
    how_it_works: string
    requirement: string
    effort: string
    realistic_note: string
  }[]
  scaling_plan: string[]
  disclosure: string
}

const REV_SYSTEM = `You are a creator-economy advisor. Explain realistic, policy-compliant ways a faceless
short-form channel in the given niche can earn recurring income. Be strictly honest: state real
eligibility requirements, never guarantee amounts, never suggest engagement farming, view-buying,
reposting others' content, or anything violating platform terms. Prefer durable assets over hacks.

Return ONLY valid JSON:
{"streams":[{"name":"...","how_it_works":"...","requirement":"actual eligibility bar or setup needed","effort":"Thấp|Trung bình|Cao","realistic_note":"honest expectation without numbers promised"}],"scaling_plan":["4-6 sequential steps to build a repeatable publishing system"],"disclosure":"one short compliance reminder"}
4-6 streams. Answer in the requested language.`

export function fallbackRevenueModel(niche: string): RevenueModel {
  return {
    streams: [
      {
        name: 'Quỹ sáng tạo / chia sẻ doanh thu của nền tảng',
        how_it_works: 'Nền tảng chia một phần doanh thu quảng cáo theo lượt xem đủ điều kiện.',
        requirement: 'Phải đạt ngưỡng người theo dõi và lượt xem của từng nền tảng, nội dung phải gốc và tuân thủ chính sách.',
        effort: 'Trung bình',
        realistic_note: 'Doanh thu biến động mạnh theo thị trường và chủ đề; không nên coi là nguồn thu duy nhất.',
      },
      {
        name: 'Tiếp thị liên kết (affiliate)',
        how_it_works: 'Gắn link sản phẩm liên quan trong bio hoặc mô tả, nhận hoa hồng khi có đơn.',
        requirement: 'Sản phẩm phải liên quan tới ' + niche + ' và bắt buộc công bố quan hệ liên kết.',
        effort: 'Thấp',
        realistic_note: 'Tỷ lệ chuyển đổi phụ thuộc mức độ tin cậy của kênh, thường cần thời gian tích luỹ.',
      },
      {
        name: 'Sản phẩm số của riêng bạn',
        how_it_works: 'Bán ebook, template, checklist hoặc khoá học ngắn xây từ chính nội dung đã làm.',
        requirement: 'Cần thời gian tạo sản phẩm và một kênh thanh toán hợp pháp.',
        effort: 'Cao',
        realistic_note: 'Lợi nhuận trên mỗi đơn cao nhất và bạn giữ toàn quyền, nhưng cần tệp khán giả rõ nét.',
      },
      {
        name: 'Hợp tác thương hiệu',
        how_it_works: 'Thương hiệu trả phí cho nội dung tài trợ đúng ngách.',
        requirement: 'Cần số liệu kênh ổn định và phải gắn nhãn nội dung tài trợ theo quy định.',
        effort: 'Trung bình',
        realistic_note: 'Giá phụ thuộc chất lượng khán giả hơn là tổng số người theo dõi.',
      },
      {
        name: 'Tái sử dụng nội dung đa nền tảng',
        how_it_works: 'Một video gốc được cắt/điều chỉnh cho TikTok, Reels, Shorts và X để tăng tổng lượt xem.',
        requirement: 'Cần quy trình xuất bản lặp lại được và tôn trọng đặc thù mỗi nền tảng.',
        effort: 'Thấp',
        realistic_note: 'Không phải nền tảng nào cũng cho kết quả giống nhau; nên đo rồi tập trung vào nơi hiệu quả.',
      },
    ],
    scaling_plan: [
      'Chốt một ngách hẹp và bám theo trong ít nhất 30 video.',
      'Chuẩn hoá quy trình: brief → blueprint → ảnh → giọng đọc → video → gói đăng bài.',
      'Xuất bản đều đặn theo lịch cố định thay vì đăng dồn.',
      'Ghi lại số liệu từng nền tảng, giữ lại định dạng cho kết quả tốt nhất.',
      'Chỉ thêm nguồn thu mới khi đã có tệp khán giả trung thành.',
      'Xây một tài sản bạn sở hữu (danh sách email hoặc sản phẩm số) để không phụ thuộc thuật toán.',
    ],
    disclosure:
      'Đây là thông tin tham khảo, không phải tư vấn tài chính. Mọi nền tảng đều có thể thay đổi điều kiện kiếm tiền; hãy đọc chính sách chính thức và chỉ dùng tư liệu bạn có quyền sử dụng.',
  }
}

export async function buildRevenueModel(
  env: Bindings,
  opts: { niche: string; platform: string; audience: string; language?: string; model?: string }
): Promise<RevenueModel> {
  const user = [
    `Niche: ${opts.niche}`,
    `Platforms: ${opts.platform}`,
    `Audience: ${opts.audience}`,
    `Language: ${opts.language || 'Tiếng Việt'}`,
  ].join('\n')
  try {
    const data = await askJSON<RevenueModel>(env, REV_SYSTEM, user, opts.model || DEFAULT_TEXT_MODEL)
    const streams = Array.isArray(data?.streams) ? data.streams : []
    if (!streams.length) return fallbackRevenueModel(opts.niche)
    return {
      streams: streams.slice(0, 6).map((s: any) => ({
        name: String(s?.name || '').trim() || 'Nguồn thu',
        how_it_works: String(s?.how_it_works || '').trim(),
        requirement: String(s?.requirement || '').trim(),
        effort: String(s?.effort || 'Trung bình').trim(),
        realistic_note: String(s?.realistic_note || '').trim(),
      })),
      scaling_plan: Array.isArray(data.scaling_plan)
        ? data.scaling_plan.map((s: any) => String(s).trim()).filter(Boolean).slice(0, 8)
        : fallbackRevenueModel(opts.niche).scaling_plan,
      disclosure: String(data.disclosure || fallbackRevenueModel(opts.niche).disclosure).trim(),
    }
  } catch {
    return fallbackRevenueModel(opts.niche)
  }
}
