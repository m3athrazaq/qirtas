// Arabic-aware text normalization used by search, sorting and slash-menu filtering.
// Every normalized character keeps a pointer back to its index in the original
// string, so matches can be highlighted in the text exactly as the user wrote it.

const REMOVE = new Set<number>()
// Tashkeel, Quranic annotation marks, superscript alef, tatweel, bidi/zero-width marks
for (let c = 0x064b; c <= 0x065f; c++) REMOVE.add(c)
for (let c = 0x06d6; c <= 0x06ed; c++) REMOVE.add(c)
;[0x0670, 0x0640, 0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x061c, 0x0621].forEach((c) => REMOVE.add(c))

const MAP: Record<string, string> = {
  'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ٱ': 'ا', 'ٲ': 'ا', 'ٳ': 'ا',
  'ى': 'ي', 'ئ': 'ي', 'ی': 'ي', 'ې': 'ي',
  'ؤ': 'و',
  'ة': 'ه', 'ۃ': 'ه',
  'ک': 'ك', 'ڪ': 'ك',
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
  '٫': '.', '٬': ',',
}

export interface Normalized {
  text: string
  /** map[i] = index in the original string of normalized char i */
  map: number[]
}

/** Normalize while keeping a position map back to the source string. */
export function normalizeWithMap(input: string): Normalized {
  let text = ''
  const map: number[] = []
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    const code = ch.charCodeAt(0)
    if (REMOVE.has(code)) continue
    // Latin combining diacritics (é → e after NFD) are dropped too
    if (code >= 0x0300 && code <= 0x036f) continue
    let out = MAP[ch]
    if (out === undefined) {
      out = ch.toLowerCase()
      if (out.length > 1 || /[À-ɏ]/.test(out)) {
        out = out.normalize('NFD').replace(/[̀-ͯ]/g, '')
      }
    }
    for (let k = 0; k < out.length; k++) {
      text += out[k]
      map.push(i)
    }
  }
  return { text, map }
}

export function normalize(input: string): string {
  return normalizeWithMap(input).text
}

export interface MatchRange {
  start: number
  end: number
}

/** Find all ranges (in ORIGINAL string coordinates) where every query word occurs. */
export function findMatches(source: string, query: string, limit = 50): MatchRange[] {
  const q = normalize(query).trim()
  if (!q) return []
  const words = q.split(/\s+/).filter(Boolean)
  const { text, map } = normalizeWithMap(source)
  const ranges: MatchRange[] = []
  for (const w of words) {
    let from = 0
    while (ranges.length < limit) {
      const idx = text.indexOf(w, from)
      if (idx < 0) break
      const start = map[idx]
      const end = map[idx + w.length - 1] + 1
      ranges.push({ start, end: extendOverMarks(source, end) })
      from = idx + w.length
    }
  }
  ranges.sort((a, b) => a.start - b.start)
  return mergeRanges(ranges)
}

// Include trailing tashkeel that belongs to the last matched letter.
function extendOverMarks(s: string, end: number): number {
  while (end < s.length) {
    const c = s.charCodeAt(end)
    if ((c >= 0x064b && c <= 0x065f) || c === 0x0670 || c === 0x0640) end++
    else break
  }
  return end
}

function mergeRanges(r: MatchRange[]): MatchRange[] {
  const out: MatchRange[] = []
  for (const x of r) {
    const last = out[out.length - 1]
    if (last && x.start <= last.end) last.end = Math.max(last.end, x.end)
    else out.push({ ...x })
  }
  return out
}

/** True when every word of the query appears in the text (Arabic-insensitive). */
export function matchesAll(source: string, query: string): boolean {
  const q = normalize(query).trim()
  if (!q) return true
  const t = normalize(source)
  return q.split(/\s+/).every((w) => t.includes(w))
}

/** Score for ranking: higher is better. 0 = no match. */
export function matchScore(source: string, query: string): number {
  const q = normalize(query).trim()
  if (!q) return 0
  const t = normalize(source)
  if (t === q) return 100
  if (t.startsWith(q)) return 80
  const words = q.split(/\s+/)
  if (!words.every((w) => t.includes(w))) return 0
  // word-boundary bonus
  const boundary = words.every((w) => new RegExp(`(^|[\\s\\-_/،,.])${escapeRe(w)}`).test(t))
  return boundary ? 60 : 40
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Build a short snippet around the first match, with highlight ranges relative to the snippet. */
export function snippet(source: string, query: string, radius = 60): { text: string; ranges: MatchRange[] } | null {
  const ranges = findMatches(source, query, 10)
  if (!ranges.length) return null
  const first = ranges[0]
  let start = Math.max(0, first.start - radius)
  let end = Math.min(source.length, first.end + radius * 2)
  // Snap to whitespace so words are not cut in half
  if (start > 0) {
    const sp = source.lastIndexOf(' ', start)
    start = sp > start - 20 && sp >= 0 ? sp + 1 : start
  }
  if (end < source.length) {
    const sp = source.indexOf(' ', end)
    end = sp > 0 && sp < end + 20 ? sp : end
  }
  const text = (start > 0 ? '… ' : '') + source.slice(start, end).replace(/\s+/g, ' ') + (end < source.length ? ' …' : '')
  // Recompute ranges on the produced snippet for exact positions
  return { text, ranges: findMatches(text, query, 10) }
}

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩'
export function toArabicDigits(s: string | number): string {
  return String(s).replace(/[0-9]/g, (d) => AR_DIGITS[+d])
}
export function toLatinDigits(s: string): string {
  return s.replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d))).replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
}

/** Strong-direction detection of the first strong character. */
const RTL_RE = /[֐-ࣿיִ-﷿ﹰ-ﻼ]/
const LTR_RE = /[A-Za-zÀ-ɏͰ-ϿЀ-ӿ]/
export function firstStrongDir(s: string): 'rtl' | 'ltr' | null {
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (RTL_RE.test(ch)) return 'rtl'
    if (LTR_RE.test(ch)) return 'ltr'
  }
  return null
}

/** Arabic-aware comparison for sorting titles. */
const collator = new Intl.Collator(['ar', 'en'], { sensitivity: 'base', numeric: true })
export function compareText(a: string, b: string): number {
  return collator.compare(normalize(a), normalize(b))
}
