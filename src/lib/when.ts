// "Today 10:32", "Yesterday 21:05", "8 Nov, 10:32": moments shown in lists (history, backups).
import type { Settings } from '../data/store'
import { t } from './i18n'

const DAY = 24 * 3600_000

export function formatWhen(ts: number, s: Pick<Settings, 'lang' | 'numerals'>, now = Date.now()): string {
  const loc = s.lang === 'ar' ? `ar-u-nu-${s.numerals}` : 'en'
  const d = new Date(ts)
  const time = d.toLocaleTimeString(loc, { hour: 'numeric', minute: '2-digit' })
  const startOfDay = (x: number) => {
    const y = new Date(x)
    y.setHours(0, 0, 0, 0)
    return y.getTime()
  }
  const days = Math.round((startOfDay(now) - startOfDay(ts)) / DAY)
  if (days === 0) return `${t('today')} ${time}`
  if (days === 1) return `${t('yesterday')} ${time}`
  const sameYear = d.getFullYear() === new Date(now).getFullYear()
  const date = d.toLocaleDateString(loc, sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' })
  return `${date}${s.lang === 'ar' ? '،' : ','} ${time}`
}

export function formatBytes(n: number, s: Pick<Settings, 'lang' | 'numerals'>): string {
  const loc = s.lang === 'ar' ? `ar-u-nu-${s.numerals}` : 'en'
  const units = s.lang === 'ar' ? ['بايت', 'ك.ب', 'م.ب', 'ج.ب'] : ['B', 'KB', 'MB', 'GB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toLocaleString(loc, { maximumFractionDigits: v < 10 && i > 0 ? 1 : 0 })} ${units[i]}`
}
