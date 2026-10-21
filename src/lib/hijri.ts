// Umm al-Qura Hijri calendar helpers built on the platform's Intl (ICU) data.
// Dates are handled as local "calendar days" in ISO form: YYYY-MM-DD.

export type CalendarSystem = 'hijri' | 'gregorian'
export type Numerals = 'arab' | 'latn'

export interface HijriParts {
  year: number
  month: number // 1..12
  day: number
}

const partsFmt = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', {
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  timeZone: 'UTC',
})

const cache = new Map<string, HijriParts>()

/** ISO date (YYYY-MM-DD) → Date at UTC noon (avoids DST/timezone edge cases). */
export function isoToDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d, 12))
}

export function dateToIso(d: Date): string {
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth() + 1
  const day = d.getUTCDate()
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** Today's local calendar date as ISO. */
export function todayIso(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export function addDays(iso: string, n: number): string {
  const d = isoToDate(iso)
  d.setUTCDate(d.getUTCDate() + n)
  return dateToIso(d)
}

export function diffDays(a: string, b: string): number {
  return Math.round((isoToDate(a).getTime() - isoToDate(b).getTime()) / 86400000)
}

export function weekday(iso: string): number {
  return isoToDate(iso).getUTCDay() // 0 = Sunday
}

export function toHijri(iso: string): HijriParts {
  const hit = cache.get(iso)
  if (hit) return hit
  const parts = partsFmt.formatToParts(isoToDate(iso))
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0)
  // Some ICU builds report the year as "relatedYear" or with an era suffix
  let year = get('year')
  if (!year) year = get('relatedYear')
  const res = { year, month: get('month'), day: get('day') }
  cache.set(iso, res)
  return res
}

/** First Gregorian day (ISO) of the given Hijri month. */
export function hijriMonthStart(hy: number, hm: number): string {
  // Estimate from the mean lunar month, then walk to the exact day.
  const epoch = Date.UTC(622, 6, 16, 12) // 1 Muharram 1 AH (approx, proleptic Julian ≈ Gregorian 622-07-19)
  const monthsSinceEpoch = (hy - 1) * 12 + (hm - 1)
  const est = new Date(epoch + monthsSinceEpoch * 29.530588853 * 86400000)
  let iso = dateToIso(est)
  // Move into the target month
  for (let guard = 0; guard < 120; guard++) {
    const h = toHijri(iso)
    const cmp = h.year * 12 + h.month - (hy * 12 + hm)
    if (cmp === 0) break
    iso = addDays(iso, cmp < 0 ? 15 : -15)
  }
  // Walk back to day 1
  for (let guard = 0; guard < 40; guard++) {
    const h = toHijri(iso)
    if (h.day === 1 && h.month === hm) return iso
    if (h.year * 12 + h.month > hy * 12 + hm) iso = addDays(iso, -1)
    else if (h.year * 12 + h.month < hy * 12 + hm) iso = addDays(iso, 1)
    else iso = addDays(iso, -(h.day - 1))
  }
  return iso
}

export function hijriMonthLength(hy: number, hm: number): number {
  const start = hijriMonthStart(hy, hm)
  // A Hijri month is 29 or 30 days
  return toHijri(addDays(start, 29)).month === hm ? 30 : 29
}

export function hijriToIso(hy: number, hm: number, hd: number): string {
  return addDays(hijriMonthStart(hy, hm), hd - 1)
}

export function shiftHijriMonth(hy: number, hm: number, delta: number): { year: number; month: number } {
  let idx = hy * 12 + (hm - 1) + delta
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 }
}

export const HIJRI_MONTHS_AR = [
  'محرّم', 'صفر', 'ربيع الأول', 'ربيع الآخر', 'جمادى الأولى', 'جمادى الآخرة',
  'رجب', 'شعبان', 'رمضان', 'شوّال', 'ذو القعدة', 'ذو الحجة',
]
export const HIJRI_MONTHS_EN = [
  'Muharram', 'Safar', 'Rabiʿ I', 'Rabiʿ II', 'Jumada I', 'Jumada II',
  'Rajab', 'Shaʿban', 'Ramadan', 'Shawwal', 'Dhu al-Qaʿdah', 'Dhu al-Hijjah',
]
export const GREG_MONTHS_AR = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
]
export const GREG_MONTHS_EN = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
export const WEEKDAYS_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']
export const WEEKDAYS_AR_SHORT = ['أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت']
export const WEEKDAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export const WEEKDAYS_EN_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩'
export function num(n: number | string, numerals: Numerals): string {
  const s = String(n)
  return numerals === 'arab' ? s.replace(/[0-9]/g, (d) => AR_DIGITS[+d]) : s
}

export interface FormatOptions {
  lang: 'ar' | 'en'
  numerals: Numerals
  weekday?: boolean
  year?: boolean
}

export function formatHijri(iso: string, o: FormatOptions): string {
  const h = toHijri(iso)
  const months = o.lang === 'ar' ? HIJRI_MONTHS_AR : HIJRI_MONTHS_EN
  const wd = o.weekday ? (o.lang === 'ar' ? WEEKDAYS_AR : WEEKDAYS_EN)[weekday(iso)] + (o.lang === 'ar' ? ' ' : ', ') : ''
  const year = o.year === false ? '' : ` ${num(h.year, o.numerals)}${o.lang === 'ar' ? ' هـ' : ' AH'}`
  return `${wd}${num(h.day, o.numerals)} ${months[h.month - 1]}${year}`
}

export function formatGregorian(iso: string, o: FormatOptions): string {
  const d = isoToDate(iso)
  const months = o.lang === 'ar' ? GREG_MONTHS_AR : GREG_MONTHS_EN
  const wd = o.weekday ? (o.lang === 'ar' ? WEEKDAYS_AR : WEEKDAYS_EN)[d.getUTCDay()] + (o.lang === 'ar' ? ' ' : ', ') : ''
  const day = num(d.getUTCDate(), o.numerals)
  const month = months[d.getUTCMonth()]
  const year = o.year === false ? '' : ` ${num(d.getUTCFullYear(), o.numerals)}`
  return o.lang === 'ar' ? `${wd}${day} ${month}${year}` : `${wd}${month} ${day}${year ? ',' + year : ''}`
}

/** "١٥ جمادى الأولى ١٤٤٨ هـ (٢٦ نوفمبر ٢٠٢٦)" — primary calendar first. */
export function formatDual(iso: string, primary: CalendarSystem, o: FormatOptions): string {
  const a = primary === 'hijri' ? formatHijri(iso, o) : formatGregorian(iso, o)
  const b = primary === 'hijri' ? formatGregorian(iso, { ...o, weekday: false }) : formatHijri(iso, { ...o, weekday: false })
  return `${a} (${b})`
}

export function formatShort(iso: string, system: CalendarSystem, o: FormatOptions): string {
  return system === 'hijri' ? formatHijri(iso, { ...o, year: false }) : formatGregorian(iso, { ...o, year: false })
}

export interface MonthCell {
  iso: string
  inMonth: boolean
  primaryDay: number
  secondaryDay: number
  secondaryMonth: number
}

/**
 * Build a month grid (6 rows max) for a calendar view.
 * `anchor` identifies the month: for hijri {year, month} of Hijri; for gregorian {year, month}.
 */
export function monthGrid(system: CalendarSystem, year: number, month: number, weekStart: number): { cells: MonthCell[]; start: string; end: string } {
  let start: string
  let length: number
  if (system === 'hijri') {
    start = hijriMonthStart(year, month)
    length = hijriMonthLength(year, month)
  } else {
    start = `${year}-${String(month).padStart(2, '0')}-01`
    length = new Date(Date.UTC(year, month, 0)).getUTCDate()
  }
  const end = addDays(start, length - 1)
  const lead = (weekday(start) - weekStart + 7) % 7
  const total = Math.ceil((lead + length) / 7) * 7
  const cells: MonthCell[] = []
  for (let i = 0; i < total; i++) {
    const iso = addDays(start, i - lead)
    const g = isoToDate(iso)
    const h = toHijri(iso)
    const inMonth = i >= lead && i < lead + length
    if (system === 'hijri') {
      cells.push({ iso, inMonth, primaryDay: h.day, secondaryDay: g.getUTCDate(), secondaryMonth: g.getUTCMonth() + 1 })
    } else {
      cells.push({ iso, inMonth, primaryDay: g.getUTCDate(), secondaryDay: h.day, secondaryMonth: h.month })
    }
  }
  return { cells, start, end }
}

export function monthTitle(system: CalendarSystem, year: number, month: number, o: FormatOptions): { main: string; sub: string } {
  if (system === 'hijri') {
    const months = o.lang === 'ar' ? HIJRI_MONTHS_AR : HIJRI_MONTHS_EN
    const start = hijriMonthStart(year, month)
    const end = addDays(start, hijriMonthLength(year, month) - 1)
    const gm = o.lang === 'ar' ? GREG_MONTHS_AR : GREG_MONTHS_EN
    const s = isoToDate(start)
    const e = isoToDate(end)
    const sub =
      s.getUTCMonth() === e.getUTCMonth()
        ? `${gm[s.getUTCMonth()]} ${num(s.getUTCFullYear(), o.numerals)}`
        : s.getUTCFullYear() === e.getUTCFullYear()
          ? `${gm[s.getUTCMonth()]} – ${gm[e.getUTCMonth()]} ${num(e.getUTCFullYear(), o.numerals)}`
          : `${gm[s.getUTCMonth()]} ${num(s.getUTCFullYear(), o.numerals)} – ${gm[e.getUTCMonth()]} ${num(e.getUTCFullYear(), o.numerals)}`
    return { main: `${months[month - 1]} ${num(year, o.numerals)}${o.lang === 'ar' ? ' هـ' : ' AH'}`, sub }
  }
  const months = o.lang === 'ar' ? GREG_MONTHS_AR : GREG_MONTHS_EN
  const start = `${year}-${String(month).padStart(2, '0')}-01`
  const end = addDays(start, new Date(Date.UTC(year, month, 0)).getUTCDate() - 1)
  const hs = toHijri(start)
  const he = toHijri(end)
  const hm = o.lang === 'ar' ? HIJRI_MONTHS_AR : HIJRI_MONTHS_EN
  const suffix = o.lang === 'ar' ? ' هـ' : ' AH'
  const sub =
    hs.year === he.year
      ? `${hm[hs.month - 1]} – ${hm[he.month - 1]} ${num(he.year, o.numerals)}${suffix}`
      : `${hm[hs.month - 1]} ${num(hs.year, o.numerals)} – ${hm[he.month - 1]} ${num(he.year, o.numerals)}${suffix}`
  return { main: `${months[month - 1]} ${num(year, o.numerals)}`, sub }
}

/** Current month anchor for a calendar system. */
export function currentMonth(system: CalendarSystem, iso = todayIso()): { year: number; month: number } {
  if (system === 'hijri') {
    const h = toHijri(iso)
    return { year: h.year, month: h.month }
  }
  const d = isoToDate(iso)
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 }
}

export function shiftMonth(system: CalendarSystem, year: number, month: number, delta: number) {
  if (system === 'hijri') return shiftHijriMonth(year, month, delta)
  const idx = year * 12 + (month - 1) + delta
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 }
}

export function isValidIso(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
}
