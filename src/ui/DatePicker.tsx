import { ChevronLeft, ChevronRight, Repeat as RepeatIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { describeRepeat, kindOf, REPEAT_KINDS, repeatFor, type Repeat, type RepeatKind } from '../data/recurring'
import { useStore } from '../data/store'
import { t } from '../lib/i18n'
import {
  currentMonth,
  monthGrid,
  monthTitle,
  num,
  shiftMonth,
  todayIso,
  WEEKDAYS_AR_SHORT,
  WEEKDAYS_EN_SHORT,
  type CalendarSystem,
} from '../lib/hijri'

interface Props {
  value: string | null
  onChange: (iso: string | null) => void
  allowClear?: boolean
  footer?: React.ReactNode
  /** A date in a task can repeat: the choice is shown under the month. */
  repeat?: { value: Repeat | null; onChange: (r: Repeat | null) => void }
}

const KIND_LABEL: Record<RepeatKind, 'repeatDaily' | 'repeatWeekdays' | 'repeatWeekly' | 'repeatMonthly' | 'repeatYearly'> = {
  daily: 'repeatDaily',
  weekdays: 'repeatWeekdays',
  weekly: 'repeatWeekly',
  monthly: 'repeatMonthly',
  yearly: 'repeatYearly',
}

export function DatePicker({ value, onChange, allowClear = true, footer, repeat }: Props) {
  const settings = useStore((s) => s.settings)
  const [system, setSystem] = useState<CalendarSystem>(settings.calendar)
  const [anchor, setAnchor] = useState(() => currentMonth(system, value ?? todayIso()))
  const fmt = { lang: settings.lang, numerals: settings.numerals } as const
  const grid = useMemo(() => monthGrid(system, anchor.year, anchor.month, settings.weekStart), [system, anchor, settings.weekStart])
  const title = monthTitle(system, anchor.year, anchor.month, fmt)
  const today = todayIso()
  const wd = settings.lang === 'ar' ? WEEKDAYS_AR_SHORT : WEEKDAYS_EN_SHORT
  const rtl = settings.lang === 'ar'
  const Prev = rtl ? ChevronRight : ChevronLeft
  const Next = rtl ? ChevronLeft : ChevronRight

  const switchSystem = (s: CalendarSystem) => {
    setSystem(s)
    setAnchor(currentMonth(s, value ?? todayIso()))
    // A monthly or yearly repeat follows the calendar the date is chosen in
    const r = repeat?.value
    if (r && (kindOf(r) === 'monthly' || kindOf(r) === 'yearly') && repeatFor(kindOf(r), s) !== r) repeat.onChange(repeatFor(kindOf(r), s))
  }

  return (
    <div className="datepicker">
      <div className="seg" role="tablist">
        <button type="button" className={system === 'hijri' ? 'is-on' : ''} onClick={() => switchSystem('hijri')}>
          {t('hijri')}
        </button>
        <button type="button" className={system === 'gregorian' ? 'is-on' : ''} onClick={() => switchSystem('gregorian')}>
          {t('gregorian')}
        </button>
      </div>
      <div className="dp-head">
        <button type="button" className="icon-btn" onClick={() => setAnchor(shiftMonth(system, anchor.year, anchor.month, -1))} aria-label="prev">
          <Prev size={16} />
        </button>
        <div className="dp-title">
          <div className="dp-main">{title.main}</div>
          <div className="dp-sub">{title.sub}</div>
        </div>
        <button type="button" className="icon-btn" onClick={() => setAnchor(shiftMonth(system, anchor.year, anchor.month, 1))} aria-label="next">
          <Next size={16} />
        </button>
      </div>
      <div className="dp-grid">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={'w' + i} className="dp-wd">
            {wd[(i + settings.weekStart) % 7]}
          </div>
        ))}
        {grid.cells.map((c) => (
          <button
            type="button"
            key={c.iso}
            className={'dp-day' + (c.inMonth ? '' : ' is-out') + (c.iso === today ? ' is-today' : '') + (c.iso === value ? ' is-sel' : '')}
            onClick={() => onChange(c.iso)}
          >
            <span className="dp-n">{num(c.primaryDay, settings.numerals)}</span>
            <span className="dp-s">{num(c.secondaryDay, settings.numerals)}</span>
          </button>
        ))}
      </div>
      <div className="dp-foot">
        <button type="button" className="btn-text" onClick={() => onChange(today)}>
          {t('today')}
        </button>
        {footer}
        {allowClear && value && (
          <button type="button" className="btn-text" onClick={() => onChange(null)}>
            {t('clearDate')}
          </button>
        )}
      </div>
      {repeat && (
        <div className="dc-repeat-row">
          <div className="dc-repeat-head">
            <RepeatIcon size={14} />
            <span>{t('repeat')}</span>
          </div>
          <div className="dc-repeat-chips" role="radiogroup" aria-label={t('repeat')}>
            <button type="button" role="radio" aria-checked={!repeat.value} className={'chip-btn' + (!repeat.value ? ' is-on' : '')} onClick={() => repeat.onChange(null)}>
              {t('repeatNone')}
            </button>
            {REPEAT_KINDS.map((k) => {
              const on = !!repeat.value && kindOf(repeat.value) === k
              return (
                <button type="button" key={k} role="radio" aria-checked={on} className={'chip-btn' + (on ? ' is-on' : '')} onClick={() => repeat.onChange(repeatFor(k, system))}>
                  {t(KIND_LABEL[k])}
                </button>
              )
            })}
          </div>
          <p className="dc-repeat-desc muted small">{repeat.value && value ? describeRepeat(repeat.value, value, settings) : t('repeatHint')}</p>
        </div>
      )}
    </div>
  )
}
