/**
 * Dịch phụ đề theo lô — port của backend/ai_engine.py :: translate_texts()
 * Giữ nguyên định dạng `<number>||<translation>` và lô 25 dòng.
 */
import { ask, hasLLM } from './llm.js'
import type { Bindings } from '../types.js'
import { parseSRT, composeSRT } from './srt.js'

const BATCH_SIZE = 25
const LINE_RE = /^\s*(\d+)\s*\|\|\s*(.*)$/

export const TRANSLATE_LANGS: Record<string, string> = {
  vi: 'Vietnamese',
  en: 'English',
  ja: 'Japanese',
  ko: 'Korean',
  'zh-CN': 'Chinese (Simplified)',
  th: 'Thai',
  id: 'Indonesian',
  fr: 'French',
  de: 'German',
  es: 'Spanish',
  pt: 'Portuguese',
  ru: 'Russian',
  hi: 'Hindi',
  ar: 'Arabic',
  it: 'Italian',
}

export function langLabel(code: string): string {
  return TRANSLATE_LANGS[code] || code
}

const SYSTEM = (target: string) =>
  'You are a professional subtitle translator. Translate each numbered line into ' +
  `${target}. Preserve meaning, tone and approximate length. ` +
  'Reply with ONLY lines in the exact format: <number>||<translation>. ' +
  'One line per input line. No commentary, no markdown.'

export interface TranslateResult {
  texts: string[]
  translated_lines: number
  batches: number
  llm: boolean
}

/** Dịch mảng chuỗi, giữ đúng thứ tự. Dòng nào lỗi thì giữ nguyên bản gốc. */
export async function translateTexts(
  env: Bindings,
  texts: string[],
  targetLang: string,
  model?: string,
): Promise<TranslateResult> {
  const results = [...texts]
  const target = langLabel(targetLang)
  const batches: number[][] = []
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    batches.push(
      Array.from({ length: Math.min(BATCH_SIZE, texts.length - i) }, (_, k) => i + k),
    )
  }

  if (!hasLLM(env)) {
    return { texts: results, translated_lines: 0, batches: batches.length, llm: false }
  }

  let translated = 0
  for (const idxs of batches) {
    const payload = idxs.map((idx, j) => `${j + 1}||${texts[idx]}`).join('\n')
    let answer = ''
    try {
      answer = await ask(env, SYSTEM(target), payload, model)
    } catch {
      continue // giữ nguyên lô này
    }
    const parsed = new Map<number, string>()
    for (const line of answer.split('\n')) {
      const m = LINE_RE.exec(line)
      if (m) parsed.set(Number(m[1]), m[2].trim())
    }
    idxs.forEach((idx, j) => {
      const v = parsed.get(j + 1)
      if (v) {
        results[idx] = v
        translated++
      }
    })
  }
  return { texts: results, translated_lines: translated, batches: batches.length, llm: true }
}

/** Dịch trực tiếp một chuỗi SRT → chuỗi SRT mới (giữ nguyên timing). */
export async function translateSRT(
  env: Bindings,
  srtContent: string,
  targetLang: string,
  model?: string,
) {
  const cues = parseSRT(srtContent)
  if (!cues.length) throw new Error('File SRT không hợp lệ — kiểm tra định dạng/UTF-8')
  const res = await translateTexts(
    env,
    cues.map((c) => c.text.replace(/\n/g, ' ')),
    targetLang,
    model,
  )
  const out = cues.map((c, i) => ({ start: c.start, end: c.end, text: res.texts[i] }))
  return {
    srt: composeSRT(out),
    cue_count: cues.length,
    translated_lines: res.translated_lines,
    batches: res.batches,
    llm: res.llm,
    target_lang: targetLang,
  }
}
