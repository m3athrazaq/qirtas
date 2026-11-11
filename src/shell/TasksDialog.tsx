// "Tasks": every open task, reminder and dated row from all pages in one list, by day.
import { Bell, CalendarDays, Table2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { buildAgenda, type Agenda, type AgendaItem } from '../data/agenda'
import { navigate } from '../data/nav'
import { setTaskChecked, updateReminder, usePageIndex } from '../data/pageIndex'
import { useStore } from '../data/store'
import { formatGregorian, formatHijri, num, todayIso, WEEKDAYS_AR, WEEKDAYS_EN, weekday } from '../lib/hijri'
import { t } from '../lib/i18n'
import { Modal } from '../ui/Modal'

/** Today's date, kept current across midnight. */
export function useToday(): string {
  const [day, setDay] = useState(todayIso)
  useEffect(() => {
    const id = setInterval(() => setDay(todayIso()), 60_000)
    return () => clearInterval(id)
  }, [])
  return day
}

export function useAgenda(): Agenda {
  const entries = usePageIndex((s) => s.entries)
  const pages = useStore((s) => s.pages)
  const today = useToday()
  return useMemo(() => buildAgenda(entries, pages, today), [entries, pages, today])
}

type Tab = 'today' | 'upcoming' | 'all'

export function TasksDialog() {
  const open = useStore((s) => s.modal === 'tasks')
  const close = useStore((s) => s.closeModal)
  if (!open) return null
  return <TasksInner onClose={close} />
}

function TasksInner({ onClose }: { onClose: () => void }) {
  const agenda = useAgenda()
  const ready = usePageIndex((s) => s.ready)
  const settings = useStore((s) => s.settings)
  const [tab, setTab] = useState<Tab>('today')
  const n = (x: number) => num(x, settings.numerals)
  const dayLabel = (iso: string) => {
    const fmt = { lang: settings.lang, numerals: settings.numerals } as const
    const wd = (settings.lang === 'ar' ? WEEKDAYS_AR : WEEKDAYS_EN)[weekday(iso)]
    return `${wd}${settings.lang === 'ar' ? '،' : ','} ${settings.calendar === 'hijri' ? formatHijri(iso, fmt) : formatGregorian(iso, fmt)}`
  }
  const open = (i: AgendaItem) => {
    onClose()
    if (i.kind === 'row') useStore.setState({ peek: i.pageId })
    else navigate(i.pageId)
  }
  const undatedCount = agenda.undated.reduce((s, g) => s + g.items.length, 0)
  const upcomingCount = agenda.upcoming.reduce((s, g) => s + g.items.length, 0)
  const nothing = tab === 'today' ? !agenda.count : tab === 'upcoming' ? !upcomingCount : !agenda.count && !upcomingCount && !undatedCount

  return (
    <Modal open onClose={onClose} title={t('tasks')} width={620} className="tasks-modal">
      <div className="seg tasks-tabs" role="tablist">
        {(['today', 'upcoming', 'all'] as Tab[]).map((k) => (
          <button type="button" key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'is-on' : ''} onClick={() => setTab(k)}>
            {t(k === 'today' ? 'tasksToday' : k === 'upcoming' ? 'tasksUpcoming' : 'tasksAll')}
            {k === 'today' && agenda.count > 0 && <span className="count">{n(agenda.count)}</span>}
          </button>
        ))}
      </div>
      <div className="tasks-body">
        {nothing && <div className="menu-empty">{ready ? t(tab === 'today' ? 'tasksNoneToday' : 'tasksNone') : t('loading')}</div>}
        {tab !== 'upcoming' && agenda.overdue.length > 0 && <Group title={t('tasksOverdue')} items={agenda.overdue} onOpen={open} late />}
        {tab !== 'upcoming' && agenda.today.length > 0 && <Group title={t('today')} items={agenda.today} onOpen={open} />}
        {tab !== 'today' && agenda.upcoming.map((g) => <Group key={g.day} title={dayLabel(g.day)} items={g.items} onOpen={open} />)}
        {tab === 'all' && agenda.undated.map((g) => <Group key={g.pageId} title={g.pageTitle} items={g.items} onOpen={open} hidePage />)}
      </div>
      <p className="tasks-hint muted small">{t('tasksHint')}</p>
    </Modal>
  )
}

export function Group({ title, items, onOpen, late, hidePage }: { title: string; items: AgendaItem[]; onOpen: (i: AgendaItem) => void; late?: boolean; hidePage?: boolean }) {
  return (
    <section className={'tasks-group' + (late ? ' is-late' : '')}>
      <h3 className="tasks-head">{title}</h3>
      {items.map((i) => (
        <AgendaRow key={i.key} item={i} onOpen={onOpen} hidePage={hidePage} />
      ))}
    </section>
  )
}

function AgendaRow({ item, onOpen, hidePage }: { item: AgendaItem; onOpen: (i: AgendaItem) => void; hidePage?: boolean }) {
  const settings = useStore((s) => s.settings)
  const canEdit = useStore((s) => s.wsRole !== 'viewer')
  const toast = useStore((s) => s.toast)
  const [busy, setBusy] = useState(false)
  const loc = settings.lang === 'ar' ? `ar-u-nu-${settings.numerals}` : 'en'
  const at = item.kind === 'reminder' ? item.at : item.kind === 'task' ? item.remindAt : null
  const time = at ? new Date(at).toLocaleTimeString(loc, { hour: 'numeric', minute: '2-digit' }) : ''

  const finish = async () => {
    if (busy || !canEdit) return
    setBusy(true)
    try {
      if (item.kind === 'task') {
        const ok = await setTaskChecked(item.pageId, item.n, item.text, true)
        if (ok) toast(t('taskDone'), { label: t('undo'), run: () => void setTaskChecked(item.pageId, item.n, item.text, false) })
      } else if (item.kind === 'reminder' && item.id) {
        const id = item.id
        const ok = await updateReminder(item.pageId, id, { done: true })
        if (ok) toast(t('taskDone'), { label: t('undo'), run: () => void updateReminder(item.pageId, id, { done: false }) })
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="task-row">
      {item.kind === 'row' ? (
        <span className="task-kind">
          <Table2 size={15} />
        </span>
      ) : item.kind === 'reminder' && !item.id ? (
        <span className="task-kind">
          <Bell size={15} />
        </span>
      ) : (
        <input type="checkbox" className="task-check" checked={false} disabled={!canEdit || busy} aria-label={t('taskFinish')} onChange={() => void finish()} />
      )}
      <button type="button" className="task-main" onClick={() => onOpen(item)}>
        <span className="task-text" dir="auto">
          {item.text || t('untitled')}
        </span>
        <span className="task-meta muted small">
          {time && (
            <span className="task-time">
              <Bell size={12} /> {time}
            </span>
          )}
          {item.kind === 'row' && <CalendarDays size={12} />}
          {!hidePage && <span className="task-page">{item.pageTitle}</span>}
        </span>
      </button>
    </div>
  )
}
