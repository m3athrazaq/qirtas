// Repeating tasks. A task whose date repeats (daily, on working days, weekly, monthly or yearly, by the
// Hijri or the Gregorian calendar) comes back when it is ticked: a moment later its box is empty again
// and its date has moved to the next time, and a reminder in it moves along with it.
// Only the device (and tab) where the task was ticked moves it, so it never moves twice.
import * as Y from 'yjs'
import {
  addDays,
  diffDays,
  formatGregorian,
  formatHijri,
  GREG_MONTHS_AR,
  GREG_MONTHS_EN,
  HIJRI_MONTHS_AR,
  HIJRI_MONTHS_EN,
  hijriMonthLength,
  hijriToIso,
  isValidIso,
  num,
  shiftHijriMonth,
  todayIso,
  toHijri,
  weekday,
  WEEKDAYS_AR,
  WEEKDAYS_AR_SHORT,
  WEEKDAYS_EN,
  type CalendarSystem,
  type Numerals,
} from '../lib/hijri'
import { t } from '../lib/i18n'
import { ORIGIN_SYSTEM } from './history'
import { getDoc, onDocUpdate, ORIGIN_IDB, ORIGIN_REMOTE, ORIGIN_TAB, ORIGIN_TEMPLATE, pageDocId, peekDoc } from './docs'
import { usePageIndex } from './pageIndex'
import { useStore } from './store'
import { inTemplates } from './today'

export type Repeat = 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly' | 'hmonthly' | 'hyearly'
export const REPEATS: readonly Repeat[] = ['daily', 'weekdays', 'weekly', 'monthly', 'yearly', 'hmonthly', 'hyearly']
export const isRepeat = (v: unknown): v is Repeat => REPEATS.includes(v as Repeat)

/** What the repeat chips offer; "monthly" and "yearly" follow the calendar shown in the date picker. */
export type RepeatKind = 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly'
export const REPEAT_KINDS: readonly RepeatKind[] = ['daily', 'weekdays', 'weekly', 'monthly', 'yearly']
export const kindOf = (r: Repeat): RepeatKind => (r === 'hmonthly' ? 'monthly' : r === 'hyearly' ? 'yearly' : r)
export const repeatFor = (kind: RepeatKind, system: CalendarSystem): Repeat =>
  system === 'hijri' && (kind === 'monthly' || kind === 'yearly') ? (kind === 'monthly' ? 'hmonthly' : 'hyearly') : kind

/** The weekend of a week that starts on `weekStart` (0 = Sunday): the two days before it. */
export function weekendOf(weekStart: number): [number, number] {
  return [(weekStart + 5) % 7, (weekStart + 6) % 7]
}

const p2 = (n: number) => String(n).padStart(2, '0')

/** The same day `n` months later, or that month's last day when it is shorter. */
export function addMonths(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const idx = y * 12 + (m - 1) + n
  const year = Math.floor(idx / 12)
  const month = (idx % 12) + 1
  const last = new Date(Date.UTC(year, month, 0, 12)).getUTCDate()
  return `${String(year).padStart(4, '0')}-${p2(month)}-${p2(Math.min(d, last))}`
}

/** The same Hijri day `n` Hijri months later, or that month's last day when it is shorter. */
export function addHijriMonths(iso: string, n: number): string {
  const h = toHijri(iso)
  const { year, month } = shiftHijriMonth(h.year, h.month, n)
  return hijriToIso(year, month, Math.min(h.day, hijriMonthLength(year, month)))
}

/** The date one repetition after `iso`. */
export function step(iso: string, r: Repeat, weekStart: number): string {
  switch (r) {
    case 'daily':
      return addDays(iso, 1)
    case 'weekdays': {
      const off = weekendOf(weekStart)
      let d = addDays(iso, 1)
      while (off.includes(weekday(d))) d = addDays(d, 1)
      return d
    }
    case 'weekly':
      return addDays(iso, 7)
    case 'monthly':
      return addMonths(iso, 1)
    case 'yearly':
      return addMonths(iso, 12)
    case 'hmonthly':
      return addHijriMonths(iso, 1)
    case 'hyearly':
      return addHijriMonths(iso, 12)
  }
}

/** Where a ticked repeating task goes: one repetition after its date, and on past today when it was
 *  overdue (a task done late doesn't come back for days that are already over). */
export function nextOccurrence(from: string, r: Repeat, today: string, weekStart: number): string {
  if (r === 'monthly' || r === 'yearly' || r === 'hmonthly' || r === 'hyearly') {
    // Counted from the task's own date each time, so a short month doesn't shift the day for good
    const per = r === 'monthly' || r === 'hmonthly' ? 1 : 12
    const add = r === 'monthly' || r === 'yearly' ? addMonths : addHijriMonths
    for (let k = 1; k < 5000; k++) {
      const d = add(from, k * per)
      if (d > today) return d
    }
  }
  let d = step(from, r, weekStart)
  for (let guard = 0; d <= today && guard < 40000; guard++) d = step(d, r, weekStart)
  return d
}

/** "Every Sunday", "On the 13th of every Hijri month"…, for the picker, the chip and exports. */
export function describeRepeat(r: Repeat, iso: string, o: { lang: 'ar' | 'en'; numerals: Numerals; weekStart: number }): string {
  const ar = o.lang === 'ar'
  const n = (x: number) => num(x, o.numerals)
  switch (r) {
    case 'daily':
      return t('repeatDescDaily')
    case 'weekdays': {
      const names = weekendOf(o.weekStart).map((d) => (ar ? WEEKDAYS_AR : WEEKDAYS_EN)[d])
      return t('repeatDescWeekdays', { days: names.join(ar ? ' و' : ' and ') })
    }
    case 'weekly':
      return t('repeatDescWeekly', { day: (ar ? WEEKDAYS_AR_SHORT : WEEKDAYS_EN)[weekday(iso)] })
    case 'monthly':
      return t('repeatDescMonthly', { d: n(Number(iso.slice(8, 10))) })
    case 'hmonthly':
      return t('repeatDescHMonthly', { d: n(toHijri(iso).day) })
    case 'yearly': {
      const m = Number(iso.slice(5, 7))
      return t('repeatDescYearly', { date: `${n(Number(iso.slice(8, 10)))} ${(ar ? GREG_MONTHS_AR : GREG_MONTHS_EN)[m - 1]}` })
    }
    case 'hyearly': {
      const h = toHijri(iso)
      return t('repeatDescHYearly', { date: `${n(h.day)} ${(ar ? HIJRI_MONTHS_AR : HIJRI_MONTHS_EN)[h.month - 1]}` })
    }
  }
}

// ---------------------------------------------------------------- moving ticked tasks on

/** Changes made here carry this origin: they are synced like typing, and not looked at again. */
export const ORIGIN_RECUR = 'recur'

const isOn = (v: unknown) => v === true || v === 'true'

function elements(node: Y.XmlFragment | Y.XmlElement): Y.XmlElement[] {
  return node.toArray().filter((c): c is Y.XmlElement => c instanceof Y.XmlElement)
}

function taskItems(node: Y.XmlFragment | Y.XmlElement, out: Y.XmlElement[] = []): Y.XmlElement[] {
  for (const el of elements(node)) {
    if (el.nodeName === 'taskItem') out.push(el)
    taskItems(el, out)
  }
  return out
}

function plainText(line: Y.XmlElement): string {
  let s = ''
  for (const c of line.toArray()) {
    if (c instanceof Y.XmlText) for (const op of c.toDelta() as { insert?: unknown }[]) if (typeof op.insert === 'string') s += op.insert
  }
  return s.replace(/\s+/g, ' ').trim()
}

/** A reminder moved by whole days keeps its time of day (also across a change of summer time). */
function shiftMoment(at: number, days: number): number {
  const d = new Date(at)
  d.setDate(d.getDate() + days)
  return d.getTime()
}

interface Moved {
  doc: Y.Doc
  item: Y.XmlElement
  chip: Y.XmlElement
  text: string
  from: string
  to: string
  doneOn: string | null
  reminders: { el: Y.XmlElement; at: number; done: unknown }[]
}

/** Move every ticked repeating task of the page on to its next date (returns what moved). */
export function advanceRepeating(doc: Y.Doc, today = todayIso(), weekStart = useStore.getState().settings.weekStart): Moved[] {
  const moved: Moved[] = []
  const due: { item: Y.XmlElement; chip: Y.XmlElement; line: Y.XmlElement; repeat: Repeat; date: string }[] = []
  for (const item of taskItems(doc.getXmlFragment('default'))) {
    if (!isOn(item.getAttribute('checked'))) continue
    const line = elements(item)[0]
    if (!line) continue
    // The task's date is the first date in its line (as in "Tasks")
    const chip = elements(line).find((el) => el.nodeName === 'dateChip')
    const repeat = chip?.getAttribute('repeat')
    const date = chip?.getAttribute('date')
    if (!chip || !isRepeat(repeat) || !isValidIso(date)) continue
    due.push({ item, chip, line, repeat, date })
  }
  if (!due.length) return moved
  doc.transact(() => {
    for (const { item, chip, line, repeat, date } of due) {
      const to = nextOccurrence(date, repeat, today, weekStart)
      const days = diffDays(to, date)
      const reminders = elements(line)
        .filter((el) => el.nodeName === 'reminder' && Number(el.getAttribute('at')) > 0)
        .map((el) => ({ el, at: Number(el.getAttribute('at')), done: el.getAttribute('done') }))
      moved.push({ doc, item, chip, text: plainText(line), from: date, to, doneOn: (chip.getAttribute('doneOn') as string | undefined) ?? null, reminders })
      chip.setAttribute('date', to)
      chip.setAttribute('doneOn', today)
      for (const r of reminders) {
        r.el.setAttribute('at', shiftMoment(r.at, days) as unknown as string)
        r.el.setAttribute('done', false as unknown as string)
      }
      item.setAttribute('checked', false as unknown as string)
    }
  }, ORIGIN_RECUR)
  return moved
}

const gone = (el: Y.XmlElement) => !el.doc || !!(el as unknown as { _item: { deleted: boolean } | null })._item?.deleted

/** Put moved tasks back where they were (the "Undo" of the notice): the old date and reminders, box empty. */
function putBack(moved: Moved[]) {
  for (const doc of new Set(moved.map((m) => m.doc))) {
    doc.transact(() => {
      for (const m of moved) {
        if (m.doc !== doc || gone(m.item) || gone(m.chip)) continue
        if (m.chip.getAttribute('date') !== m.to) continue // changed since: left alone
        m.chip.setAttribute('date', m.from)
        if (m.doneOn) m.chip.setAttribute('doneOn', m.doneOn)
        else m.chip.removeAttribute('doneOn')
        for (const r of m.reminders) {
          if (gone(r.el)) continue
          r.el.setAttribute('at', r.at as unknown as string)
          r.el.setAttribute('done', (r.done ?? false) as string)
        }
      }
    }, ORIGIN_RECUR)
  }
}

/** "Tomorrow", or the weekday and date. */
function whenLabel(iso: string): string {
  const s = useStore.getState().settings
  if (iso === addDays(todayIso(), 1)) return t('tomorrow')
  const fmt = { lang: s.lang, numerals: s.numerals } as const
  const wd = (s.lang === 'ar' ? WEEKDAYS_AR : WEEKDAYS_EN)[weekday(iso)]
  const date = s.calendar === 'hijri' ? formatHijri(iso, { ...fmt, year: false }) : formatGregorian(iso, { ...fmt, year: false })
  return `${wd} ${date}`
}

const WAIT = 700
const timers = new Map<string, ReturnType<typeof setTimeout>>()
let started = false

function tell(moved: Moved[]) {
  if (!moved.length) return
  const st = useStore.getState()
  const undo = { label: t('undo'), run: () => putBack(moved) }
  if (moved.length === 1) {
    const m = moved[0]
    const task = m.text.length > 40 ? m.text.slice(0, 39) + '…' : m.text
    st.toast(task ? t('repeatMoved', { task, when: whenLabel(m.to) }) : t('repeatMovedBare', { when: whenLabel(m.to) }), undo)
  } else st.toast(t('repeatMovedMany', { n: num(moved.length, st.settings.numerals) }), undo)
}

/** Follow the pages: a repeating task ticked on this device moves on a moment later. */
export function startRecurring() {
  if (started) return
  started = true
  onDocUpdate((docId, doc, origin) => {
    if (!docId.startsWith('pg:')) return
    // Changes from the server, another tab, the device's own storage, a template, a restore or this
    // module: not ticks made here
    if (origin === ORIGIN_REMOTE || origin === ORIGIN_TAB || origin === ORIGIN_IDB || origin === ORIGIN_TEMPLATE || origin === ORIGIN_SYSTEM || origin === ORIGIN_RECUR) return
    const old = timers.get(docId)
    if (old) clearTimeout(old)
    timers.set(
      docId,
      setTimeout(() => {
        timers.delete(docId)
        if (peekDoc(docId) !== doc || useStore.getState().wsRole === 'viewer') return
        try {
          tell(advanceRepeating(doc))
        } catch {
          /* the page changed shape meanwhile: the next change looks again */
        }
      }, WAIT),
    )
  })
  // Once the pages have been read: repeating tasks left ticked (the app was closed right after, or an
  // older version of Qirtas ticked them on another device) move on too
  const sweep = () => setTimeout(() => void sweepTicked(), 4000)
  if (usePageIndex.getState().ready) sweep()
  else {
    const stop = usePageIndex.subscribe((s) => {
      if (!s.ready) return
      stop()
      sweep()
    })
  }
}

async function sweepTicked() {
  const { entries } = usePageIndex.getState()
  const { pages, wsRole } = useStore.getState()
  if (wsRole === 'viewer') return
  const ids = Object.keys(entries).filter((id) => entries[id].tasks.some((x) => x.checked && x.repeat) && pages[id] && !pages[id].deletedAt && !inTemplates(id, pages))
  const moved: Moved[] = []
  for (const id of ids) {
    try {
      moved.push(...advanceRepeating(await getDoc(pageDocId(id))))
    } catch {
      /* unreadable page: skipped */
    }
  }
  tell(moved)
}
