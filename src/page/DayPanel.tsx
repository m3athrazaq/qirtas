// On a journal page: the way to the days around it and, on today's page, what is due today
// elsewhere in the workspace. Below any page: the pages that link to it.
import { ChevronLeft, ChevronRight, FileText, ListChecks } from 'lucide-react'
import { useMemo } from 'react'
import { navigate } from '../data/nav'
import { backlinksOf, usePageIndex } from '../data/pageIndex'
import { useStore } from '../data/store'
import { dayOfPage, ensureDayPage } from '../data/today'
import { addDays, formatGregorian, formatHijri, num } from '../lib/hijri'
import { t } from '../lib/i18n'
import { Group, useAgenda, useToday } from '../shell/TasksDialog'

export function DayPanel({ pageId }: { pageId: string }) {
  const day = dayOfPage(pageId)
  const today = useToday()
  const lang = useStore((s) => s.settings.lang)
  const numerals = useStore((s) => s.settings.numerals)
  const calendar = useStore((s) => s.settings.calendar)
  const agenda = useAgenda()
  if (!day) return null
  const rtl = lang === 'ar'
  const Prev = rtl ? ChevronRight : ChevronLeft
  const Next = rtl ? ChevronLeft : ChevronRight
  const go = (iso: string) => void ensureDayPage(iso).then((id) => id && navigate(id))
  // Tasks written in this very page are already in front of the reader
  const elsewhere = (items: typeof agenda.today) => items.filter((i) => i.pageId !== pageId)
  const overdue = day === today ? elsewhere(agenda.overdue) : []
  const due = day === today ? elsewhere(agenda.today) : []
  // The title carries the date in the chosen calendar; the other one is shown here
  const alt = calendar === 'hijri' ? formatGregorian(day, { lang, numerals }) : formatHijri(day, { lang, numerals })
  return (
    <div className="day-panel" contentEditable={false}>
      <div className="day-alt">{alt}</div>
      <div className="day-nav">
        <button type="button" className="chip-btn" onClick={() => go(addDays(day, -1))}>
          <Prev size={14} /> {t('dayPrev')}
        </button>
        {day !== today && (
          <button type="button" className="chip-btn" onClick={() => go(today)}>
            {t('today')}
          </button>
        )}
        <button type="button" className="chip-btn" onClick={() => go(addDays(day, 1))}>
          {t('dayNext')} <Next size={14} />
        </button>
        <span className="spacer" />
        <button type="button" className="chip-btn" onClick={() => useStore.getState().openModal('tasks')}>
          <ListChecks size={14} /> {t('tasks')}
          {agenda.count > 0 && <span className="count">{num(agenda.count, numerals)}</span>}
        </button>
      </div>
      {(overdue.length > 0 || due.length > 0) && (
        <div className="day-due">
          {overdue.length > 0 && <Group title={t('tasksOverdue')} items={overdue} onOpen={(i) => (i.kind === 'row' ? useStore.setState({ peek: i.pageId }) : navigate(i.pageId))} late />}
          {due.length > 0 && <Group title={t('dueToday')} items={due} onOpen={(i) => (i.kind === 'row' ? useStore.setState({ peek: i.pageId }) : navigate(i.pageId))} />}
        </div>
      )}
    </div>
  )
}

export function Backlinks({ pageId }: { pageId: string }) {
  const entries = usePageIndex((s) => s.entries)
  const pages = useStore((s) => s.pages)
  const ids = useMemo(() => backlinksOf(pageId, entries, pages), [pageId, entries, pages])
  if (!ids.length) return null
  return (
    <aside className="backlinks" aria-label={t('backlinks')}>
      <h3 className="backlinks-head">{t('backlinks')}</h3>
      <div className="backlinks-list">
        {ids.map((id) => (
          <button type="button" key={id} className="backlink" onClick={() => navigate(id)}>
            <span className="tree-icon">{pages[id]?.icon || <FileText size={15} strokeWidth={1.6} />}</span>
            <span className="tree-title">{pages[id]?.title || t('untitled')}</span>
          </button>
        ))}
      </div>
    </aside>
  )
}
