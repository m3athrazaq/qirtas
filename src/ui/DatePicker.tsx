import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'
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
}

export function DatePicker({ value, onChange, allowClear = true, footer }: Props) {
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
    </div>
  )
}
