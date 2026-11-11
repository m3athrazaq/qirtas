// The reminder chip in the text, and the small panel that sets its time.
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { Bell, BellOff, Check, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../../data/store'
import { dateToIso, isoToDate } from '../../lib/hijri'
import { t } from '../../lib/i18n'
import { formatWhen } from '../../lib/when'
import { DatePicker } from '../../ui/DatePicker'
import { Popover } from '../../ui/Popover'
import { consumeOpenNext } from './dateChipBus'

const pad = (n: number) => String(n).padStart(2, '0')

/** Ready-made times: in an hour, this evening, tomorrow morning, in a week. */
export function reminderPresets(now = new Date()): { key: 'remIn1h' | 'remTonight' | 'remTomorrow' | 'remNextWeek'; at: number }[] {
  const at = (days: number, h: number, m = 0) => {
    const d = new Date(now)
    d.setDate(d.getDate() + days)
    d.setHours(h, m, 0, 0)
    return d.getTime()
  }
  const hour = new Date(now.getTime() + 3600_000)
  hour.setMinutes(Math.ceil(hour.getMinutes() / 5) * 5, 0, 0)
  const out: ReturnType<typeof reminderPresets> = [{ key: 'remIn1h', at: hour.getTime() }]
  if (now.getHours() < 19) out.push({ key: 'remTonight', at: at(0, 20) })
  out.push({ key: 'remTomorrow', at: at(1, 9) }, { key: 'remNextWeek', at: at(7, 9) })
  return out
}

export function ReminderView({ node, updateAttributes, deleteNode, selected, editor }: NodeViewProps) {
  const settings = useStore((s) => s.settings)
  const [open, setOpen] = useState(false)
  const [, tick] = useState(0)
  const ref = useRef<HTMLSpanElement>(null)
  const at = node.attrs.at as number | null
  const done = !!node.attrs.done

  useEffect(() => {
    if (consumeOpenNext()) setTimeout(() => setOpen(true), 30)
  }, [])
  // Turn red when its time comes, without waiting for another change
  useEffect(() => {
    if (!at || done || at <= Date.now()) return
    const id = setTimeout(() => tick((n) => n + 1), Math.min(at - Date.now() + 500, 2 ** 31 - 1))
    return () => clearTimeout(id)
  }, [at, done])

  const due = !!at && !done && at <= Date.now()
  const set = (ms: number) => {
    updateAttributes({ at: ms, done: false })
    void import('../../data/reminders').then((m) => m.askReminderPermission())
  }

  return (
    <NodeViewWrapper as="span" className={'reminder-chip' + (selected ? ' is-selected' : '') + (done ? ' is-done' : due ? ' is-due' : '')}>
      <span ref={ref} contentEditable={false} role="button" tabIndex={0} title={t('reminder')} onClick={() => editor.isEditable && setOpen(true)}>
        {done ? <BellOff size={13} /> : <Bell size={13} />}
        <span>{at ? formatWhen(at, settings) : t('reminderSet')}</span>
      </span>
      <Popover anchor={ref.current} open={open} onClose={() => setOpen(false)} sheet>
        <ReminderPanel
          at={at}
          done={done}
          onSet={set}
          onDone={() => {
            updateAttributes({ done: !done })
            setOpen(false)
          }}
          onRemove={() => {
            setOpen(false)
            deleteNode()
          }}
          onClose={() => setOpen(false)}
        />
      </Popover>
    </NodeViewWrapper>
  )
}

export function ReminderPanel({
  at,
  done,
  onSet,
  onDone,
  onRemove,
  onClose,
}: {
  at: number | null
  done: boolean
  onSet: (ms: number) => void
  onDone?: () => void
  onRemove?: () => void
  onClose: () => void
}) {
  const base = at ? new Date(at) : new Date(reminderPresets()[0].at)
  const iso = dateToIso(base)
  const time = `${pad(base.getHours())}:${pad(base.getMinutes())}`
  const combine = (dayIso: string, hhmm: string) => {
    const d = isoToDate(dayIso)
    const [h, m] = hhmm.split(':').map(Number)
    d.setHours(h || 0, m || 0, 0, 0)
    return d.getTime()
  }
  return (
    <div className="reminder-panel">
      <div className="reminder-presets">
        {reminderPresets().map((p) => (
          <button
            type="button"
            key={p.key}
            className="chip-btn"
            onClick={() => {
              onSet(p.at)
              onClose()
            }}
          >
            {t(p.key)}
          </button>
        ))}
      </div>
      <DatePicker
        value={iso}
        allowClear={false}
        onChange={(v) => v && onSet(combine(v, time))}
        footer={
          <label className="reminder-time">
            <span>{t('reminderTime')}</span>
            <input type="time" className="input" value={time} onChange={(e) => e.target.value && onSet(combine(iso, e.target.value))} />
          </label>
        }
      />
      <div className="reminder-actions">
        {onDone && at && (
          <button type="button" className="btn btn-small" onClick={onDone}>
            <Check size={14} /> {done ? t('reminderUndone') : t('reminderDone')}
          </button>
        )}
        {onRemove && (
          <button type="button" className="btn btn-small" onClick={onRemove}>
            <Trash2 size={14} /> {t('reminderRemove')}
          </button>
        )}
        <span className="spacer" />
        <button type="button" className="btn btn-primary btn-small" onClick={onClose}>
          {t('done')}
        </button>
      </div>
    </div>
  )
}
