// "What is due": open tasks, reminders and database rows gathered from every page and sorted by day.
import { dateToIso } from '../lib/hijri'
import { t } from '../lib/i18n'
import { isReachable } from '../shell/pageOps'
import { inTemplates } from './today'
import type { PageIndexEntry } from './pageIndex'
import type { PageMeta } from './types'

export type AgendaItem =
  | { kind: 'task'; key: string; pageId: string; pageTitle: string; n: number; text: string; day: string | null; remindAt: number | null; reminderId: string | null }
  | { kind: 'reminder'; key: string; pageId: string; pageTitle: string; id: string | null; text: string; day: string; at: number }
  | { kind: 'row'; key: string; pageId: string; pageTitle: string; text: string; day: string }

export interface Agenda {
  overdue: AgendaItem[]
  today: AgendaItem[]
  /** The coming days that have something, in order. */
  upcoming: { day: string; items: AgendaItem[] }[]
  /** Open tasks with no date, grouped by page. */
  undated: { pageId: string; pageTitle: string; items: AgendaItem[] }[]
  /** Overdue + today: the number shown beside "Tasks". */
  count: number
}

const dayOf = (ms: number) => dateToIso(new Date(ms))

export function buildAgenda(entries: Record<string, PageIndexEntry>, pages: Record<string, PageMeta>, today: string): Agenda {
  const dated: AgendaItem[] = []
  const undated = new Map<string, AgendaItem[]>()
  const title = (id: string) => pages[id]?.title || t('untitled')

  for (const [pageId, e] of Object.entries(entries)) {
    if (!(e.tasks.length || e.reminders.length) || !isReachable(pageId, pages) || inTemplates(pageId, pages)) continue
    for (const task of e.tasks) {
      if (task.checked) continue
      const day = task.due ?? (task.remindAt ? dayOf(task.remindAt) : null)
      const item: AgendaItem = { kind: 'task', key: `t:${pageId}:${task.n}`, pageId, pageTitle: title(pageId), n: task.n, text: task.text, day, remindAt: task.remindAt, reminderId: task.reminderId }
      if (day) dated.push(item)
      else {
        const l = undated.get(pageId) ?? []
        l.push(item)
        undated.set(pageId, l)
      }
    }
    // Reminders written outside tasks stand on their own
    for (const r of e.reminders) {
      if (r.done || r.task !== null) continue
      dated.push({ kind: 'reminder', key: `r:${pageId}:${r.key}`, pageId, pageTitle: title(pageId), id: r.id, text: r.text, day: dayOf(r.at), at: r.at })
    }
  }

  // Database rows whose date (or date range) includes today
  for (const row of Object.values(pages)) {
    if (row.type !== 'row' || row.deletedAt || !row.parentId) continue
    const db = pages[row.parentId]
    if (!db?.schema || !isReachable(row.id, pages) || inTemplates(row.id, pages)) continue
    for (const prop of db.schema) {
      if (prop.type !== 'date') continue
      const v = row.props?.[prop.id]
      if (!v || typeof v !== 'object' || Array.isArray(v) || !('start' in v)) continue
      const end = v.end ?? v.start
      if (v.start <= today && today <= end) {
        dated.push({ kind: 'row', key: `d:${row.id}:${prop.id}`, pageId: row.id, pageTitle: db.title || t('untitled'), text: row.title || t('untitled'), day: today })
        break
      }
    }
  }

  const time = (i: AgendaItem) => (i.kind === 'reminder' ? i.at : i.kind === 'task' && i.remindAt ? i.remindAt : Number.MAX_SAFE_INTEGER)
  dated.sort((a, b) => (a.day! < b.day! ? -1 : a.day! > b.day! ? 1 : time(a) - time(b)))
  const overdue = dated.filter((i) => i.day! < today)
  const now = dated.filter((i) => i.day === today)
  const upcoming: Agenda['upcoming'] = []
  for (const i of dated) {
    if (i.day! <= today) continue
    const last = upcoming[upcoming.length - 1]
    if (last?.day === i.day) last.items.push(i)
    else upcoming.push({ day: i.day!, items: [i] })
  }
  return {
    overdue,
    today: now,
    upcoming,
    undated: [...undated].map(([pageId, items]) => ({ pageId, pageTitle: title(pageId), items })).sort((a, b) => (pages[b.pageId]?.updatedAt ?? 0) - (pages[a.pageId]?.updatedAt ?? 0)),
    count: overdue.length + now.length,
  }
}
