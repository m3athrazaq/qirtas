// The Quran in the app: its verses (loaded the first time they're needed), finding verses by a
// reference ("البقرة ٢٥٥", "2:255-257"), by a surah's name or by words from the verse, and how a
// quotation reads when it is shown, copied or exported.
import { normalize } from '../lib/arabic'
import { num, type Numerals } from '../lib/hijri'
import { SURAH_ALIASES, SURAHS } from './surahs'

export interface VerseRef {
  surah: number
  from: number
  to: number
}

let verses: string[][] | null = null
let loading: Promise<string[][]> | null = null

/** The verses of every surah, [surah - 1][verse - 1] (1.3 MB, kept apart from the app's code). */
export function loadQuran(): Promise<string[][]> {
  if (verses) return Promise.resolve(verses)
  loading ??= import('./quran.json').then(
    (m) => (verses = m.default),
    (err) => {
      loading = null
      throw err
    },
  )
  return loading
}

export const quranIfLoaded = () => verses

/** A reference that exists: a surah from 1 to 114, verses within it, in order. */
export function cleanRef(surah: unknown, from: unknown, to: unknown): VerseRef | null {
  const s = Math.trunc(Number(surah))
  if (!(s >= 1 && s <= 114)) return null
  const count = SURAHS[s - 1][2]
  const clamp = (v: number) => Math.min(count, Math.max(1, Math.trunc(v) || 1))
  const a = clamp(Number(from))
  const b = clamp(Number(to) || a)
  return { surah: s, from: Math.min(a, b), to: Math.max(a, b) }
}

export const versesOf = (all: string[][], r: VerseRef) => all[r.surah - 1].slice(r.from - 1, r.to)

const AR = '٠١٢٣٤٥٦٧٨٩'
export const arabicDigits = (n: number) => String(n).replace(/\d/g, (d) => AR[Number(d)])

/** The end-of-verse sign with the verse's number: the Quran font draws the two as one ornament. */
export const ayahMark = (n: number) => '۝' + arabicDigits(n)

/** Verses as one quotation, ﴿… ۝١ … ۝٢﴾ (a verse's last word and its number stay on one line). */
export function quotation(list: string[], from: number): string {
  return '﴿' + list.map((v, i) => `${v} ${ayahMark(from + i)}`).join(' ') + '﴾'
}

export function surahName(n: number, lang: 'ar' | 'en'): string {
  const s = SURAHS[n - 1]
  return s ? (lang === 'ar' ? s[0] : s[1]) : ''
}

/** "[البقرة: ٢٥٥–٢٥٧]" in Arabic, "Al-Baqarah 2:255–257" in English. */
export function refLabel(r: VerseRef, lang: 'ar' | 'en', numerals: Numerals): string {
  const n = (x: number) => num(x, numerals)
  const span = r.to > r.from ? `${n(r.from)}–${n(r.to)}` : n(r.from)
  return lang === 'ar' ? `[${surahName(r.surah, 'ar')}: ${span}]` : `${surahName(r.surah, 'en')} ${n(r.surah)}:${span}`
}

/** What to type to find these verses again ("البقرة ٢٥٥-٢٥٧"). */
export function refQuery(r: VerseRef, lang: 'ar' | 'en', numerals: Numerals): string {
  const n = (x: number) => num(x, numerals)
  return `${surahName(r.surah, lang)} ${n(r.from)}${r.to > r.from ? '-' + n(r.to) : ''}`
}

// ---------- finding verses ----------

const MARKS = /[ؐ-ًؚ-ٰٟۖ-ࣰۭ-ࣲـ]/g

/** How a word is spelled once vowel marks, alefs and hamzas are set aside: the Uthmani script of
 *  the Mushaf and everyday spelling differ mostly in those (ٱلۡكِتَٰبُ / الكتاب, ٱلصَّلَوٰةَ / الصلاة,
 *  يَـُٔودُهُۥ / يؤوده), so both come out the same. */
export function skeleton(s: string): string {
  return (
    s
      // ٱلصَّلَوٰةَ: a waw that carries the alef before a final ta marbuta is not written today
      .replace(/و(?=ٰ[ً-ٟۖ-ࣰۭ-ࣲ]*ة)/g, '')
      .replace(MARKS, '')
      .replace(/ؤ/g, 'و')
      .replace(/ئ/g, 'ي')
      .replace(/[اأإآٱٲٳء]/g, '')
      .replace(/ى/g, 'ي')
      .replace(/ة/g, 'ه')
      .replace(/([وي])\1+/g, '$1')
      .replace(/[^ء-يa-z0-9\s]/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
  )
}

const DIGITS: Record<string, string> = {}
'٠١٢٣٤٥٦٧٨٩'.split('').forEach((d, i) => (DIGITS[d] = String(i)))
'۰۱۲۳۴۵۶۷۸۹'.split('').forEach((d, i) => (DIGITS[d] = String(i)))
const asciiDigits = (s: string) => s.replace(/[٠-٩۰-۹]/g, (d) => DIGITS[d])

// Names are compared with their alefs (النساء and الناس differ only there), without the article
const nameKey = (s: string) =>
  /[a-z]/i.test(s)
    ? s
        .toLowerCase()
        .replace(/^(al|an|ar|as|ash|at|ad|adh|az|ath|aal)[-\s]+/, '')
        .replace(/[^a-z]/g, '')
    : normalize(s)
        .replace(/[^\u0621-\u064A]/g, '')
        .replace(/^ال(?=..)/, '')

let names: { key: string; surah: number }[] | null = null
function nameKeys() {
  if (!names) {
    names = []
    SURAHS.forEach(([ar, en], i) => {
      names!.push({ key: nameKey(ar), surah: i + 1 }, { key: nameKey(en), surah: i + 1 })
      for (const a of SURAH_ALIASES[i + 1] ?? []) names!.push({ key: nameKey(a), surah: i + 1 })
    })
  }
  return names
}

/** Surahs whose name is what was typed (first), or starts with it. */
export function findSurahs(text: string): number[] {
  const key = nameKey(text.trim())
  if (!key) return []
  const exact = new Set<number>()
  const starts = new Set<number>()
  for (const n of nameKeys()) {
    if (n.key === key) exact.add(n.surah)
    else if (key.length >= 2 && n.key.startsWith(key)) starts.add(n.surah)
  }
  return [...exact, ...[...starts].filter((s) => !exact.has(s)).sort((a, b) => a - b)]
}

export interface QuranQuery {
  /** A reference was typed: these verses. */
  ref: VerseRef | null
  /** Surahs named by what was typed (no verse number given). */
  surahs: number[]
  /** Words to look for in the verses (as skeletons). */
  words: string[]
}

const RANGE = String.raw`(\d{1,3})(?:\s*[-–—~]\s*(\d{1,3}))?`

export function parseQuery(input: string): QuranQuery {
  const q = asciiDigits(input)
    .replace(/[﴿﴾[\](){}«»"]/g, ' ')
    .replace(/(^|\s)(سورة|سوره|surah|surat|sura)(?=\s|$)/gi, ' ')
    .replace(/(^|\s)(الآيات|الايات|آيات|ايات|الآية|الاية|آية|اية|ayahs?|ayat|aya|verses?)(?=\s|$)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const none: QuranQuery = { ref: null, surahs: [], words: [] }
  if (!q) return none
  // 2:255, 2 255, 2.255-257
  let m = q.match(new RegExp(String.raw`^(\d{1,3})\s*[:：.,،/\s]\s*${RANGE}$`))
  if (m) return { ...none, ref: cleanRef(m[1], m[2], m[3] ?? m[2]) }
  // 2
  if (/^\d{1,3}$/.test(q)) return { ...none, surahs: cleanRef(q, 1, 1) ? [Number(q)] : [] }
  // البقرة 255, Al-Baqarah 255-257, الكهف:10
  m = q.match(new RegExp(String.raw`^(.*?[^\d\s:،,.])\s*[:،,.]?\s*${RANGE}$`))
  if (m) {
    const s = findSurahs(m[1])
    if (s.length) return { ...none, ref: cleanRef(s[0], m[2], m[3] ?? m[2]) }
  }
  const words = skeleton(q)
    .split(' ')
    .filter((w) => w.length >= 2 && !/^\d+$/.test(w))
  return { ref: null, surahs: findSurahs(q), words }
}

let skeletons: string[][] | null = null

export interface VerseHit {
  surah: number
  ayah: number
}

/** Verses that have every word (verses with the words side by side first), in the Mushaf's order. */
export function searchVerses(all: string[][], words: string[], limit = 80): { hits: VerseHit[]; total: number } {
  if (!words.length) return { hits: [], total: 0 }
  skeletons ??= all.map((s) => s.map(skeleton))
  const phrase = words.join(' ')
  const first: VerseHit[] = []
  const rest: VerseHit[] = []
  skeletons.forEach((s, si) =>
    s.forEach((v, vi) => {
      if (!words.every((w) => v.includes(w))) return
      ;(words.length > 1 && v.includes(phrase) ? first : rest).push({ surah: si + 1, ayah: vi + 1 })
    }),
  )
  const all2 = [...first, ...rest]
  return { hits: all2.slice(0, limit), total: all2.length }
}
