/**
 * SRT parse / compose — port of python `srt` library subset
 * (dùng bởi stt_engine.segments_to_srt & parse_srt trong bản gốc).
 */

export interface Cue {
  index: number
  start: number // seconds
  end: number // seconds
  text: string
}

export function srtTimestamp(seconds: number): string {
  const s = Math.max(0, seconds)
  const hh = Math.floor(s / 3600)
  const mm = Math.floor((s % 3600) / 60)
  const ss = Math.floor(s % 60)
  const ms = Math.round((s - Math.floor(s)) * 1000)
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${p(hh)}:${p(mm)}:${p(ss)},${p(ms, 3)}`
}

export function parseTimestamp(raw: string): number {
  const m = raw.trim().match(/(\d+):(\d{1,2}):(\d{1,2})[,.](\d{1,3})/)
  if (!m) return 0
  const [, h, mi, s, ms] = m
  return Number(h) * 3600 + Number(mi) * 60 + Number(s) + Number(ms.padEnd(3, '0')) / 1000
}

/** segments_to_srt() */
export function composeSRT(cues: Array<{ start: number; end: number; text: string }>): string {
  return cues
    .map((c, i) => {
      const end = Math.max(c.end, c.start + 0.2)
      return `${i + 1}\n${srtTimestamp(c.start)} --> ${srtTimestamp(end)}\n${(c.text || '').trim()}\n`
    })
    .join('\n')
}

/** parse_srt() */
export function parseSRT(content: string): Cue[] {
  const text = (content || '').replace(/\r\n/g, '\n').replace(/^\uFEFF/, '').trim()
  if (!text) return []
  const cues: Cue[] = []
  for (const block of text.split(/\n{2,}/)) {
    const lines = block.split('\n').filter((l) => l.trim() !== '')
    if (!lines.length) continue
    let cursor = 0
    let index = cues.length + 1
    if (/^\d+$/.test(lines[0].trim())) {
      index = Number(lines[0].trim())
      cursor = 1
    }
    const timeLine = lines[cursor]
    if (!timeLine || !timeLine.includes('-->')) continue
    const [rawStart, rawEnd] = timeLine.split('-->')
    const body = lines.slice(cursor + 1).join('\n').trim()
    if (!body) continue
    cues.push({
      index,
      start: parseTimestamp(rawStart),
      end: parseTimestamp(rawEnd || rawStart),
      text: body,
    })
  }
  return cues
}

export function isValidSRT(content: string): boolean {
  return parseSRT(content).length > 0
}

export function srtToPlainText(content: string): string {
  return parseSRT(content)
    .map((c) => c.text.replace(/\n/g, ' '))
    .join(' ')
}

/** Tổng thời lượng phụ đề (giây) */
export function srtDuration(content: string): number {
  const cues = parseSRT(content)
  return cues.length ? cues[cues.length - 1].end : 0
}

/** Dịch chuyển toàn bộ mốc thời gian */
export function shiftSRT(content: string, offsetSeconds: number): string {
  return composeSRT(
    parseSRT(content).map((c) => ({
      start: Math.max(0, c.start + offsetSeconds),
      end: Math.max(0, c.end + offsetSeconds),
      text: c.text,
    })),
  )
}
