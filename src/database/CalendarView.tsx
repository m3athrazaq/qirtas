import { DndContext, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { dateEnd, dateStart, isDone, optionById, viewRows } from '../data/dbops'
import { useCanEdit, useStore, ws } from '../data/store'
import type { PageMeta, PropDef, ViewDef } from '../data/types'
import {
  addDays,
  currentMonth,
  diffDays,
  GREG_MONTHS_AR,
  GREG_MONTHS_EN,
  HIJRI_MONTHS_AR,
  HIJRI_MONTHS_EN,
  monthGrid,
  monthTitle,
  num,
  shiftMonth,
  todayIso,
  WEEKDAYS_AR,
  WEEKDAYS_AR_SHORT,
  WEEKDAYS_EN,
  WEEKDAYS_EN_SHORT,
  formatDual,
  type CalendarSystem,
} from '../lib/hijri'
import { t } from '../lib/i18n'
import { Popover } from '../ui/Popover'
import { AddPropertyMenu } from './PropertyMenu'
import { createRow } from './TableView'

export function CalendarView({ db, view, rows }: { db: PageMeta; view: ViewDef; rows: PageMeta[] }) {
  const schema = db.schema ?? []
  const settings = useStore((s) => s.settings)
  const isMobile = useStore((s) => s.isMobile)
  const system: CalendarSystem = view.calendar && view.calendar !== 'default' ? view.calendar : settings.calendar
  const dateProp = schema.find((p) => p.id === view.datePropId && p.type === 'date') ?? schema.find((p) => p.type === 'date')
  // Open on this month, or on the month of the next item when this month is empty
  const pickAnchor = (sys: CalendarSystem) => {
    const now = currentMonth(sys)
    if (!dateProp) return now
    const today = todayIso()
    const dates = rows.map((r) => dateStart(r.props?.[dateProp.id] ?? null)).filter((d): d is string => !!d).sort()
    if (!dates.length) return now
    const inMonth = dates.some((d) => {
      const m = currentMonth(sys, d)
      return m.year === now.year && m.month === now.month
    })
    if (inMonth) return now
    const next = dates.find((d) => d >= today) ?? dates[dates.length - 1]
    return currentMonth(sys, next)
  }
  const [anchor, setAnchor] = useState(() => pickAnchor(system))
  const [anchorSystem, setAnchorSystem] = useState(system)
  const [daySheet, setDaySheet] = useState<{ iso: string; el: Element } | null>(null)
  const [addPropAnchor, setAddPropAnchor] = useState<Element | null>(null)
  if (anchorSystem !== system) {
    setAnchorSystem(system)
    setAnchor(pickAnchor(system))
  }
  const statusProp = schema.find((p) => p.type === 'status' || p.type === 'select')
  const fmt = { lang: settings.lang, numerals: settings.numerals } as const
  const grid = useMemo(() => monthGrid(system, anchor.year, anchor.month, settings.weekStart), [system, anchor, settings.weekStart])
  const title = monthTitle(system, anchor.year, anchor.month, fmt)
  const today = todayIso()
  const rtl = settings.lang === 'ar'
  const Prev = rtl ? ChevronRight : ChevronLeft
  const Next = rtl ? ChevronLeft : ChevronRight
  const wd = isMobile ? (rtl ? WEEKDAYS_AR_SHORT : WEEKDAYS_EN_SHORT) : rtl ? WEEKDAYS_AR : WEEKDAYS_EN
  const secMonths = system === 'hijri' ? (rtl ? GREG_MONTHS_AR : GREG_MONTHS_EN) : rtl ? HIJRI_MONTHS_AR : HIJRI_MONTHS_EN

  const visible = useMemo(() => viewRows(rows, schema, view), [rows, schema, view])
  const byDay = useMemo(() => {
    const map = new Map<string, PageMeta[]>()
    if (!dateProp) return map
    for (const r of visible) {
      const v = r.props?.[dateProp.id] ?? null
      const s = dateStart(v)
      if (!s) continue
      const e = dateEnd(v) ?? s
      const span = Math.min(62, Math.max(0, diffDays(e, s)))
      for (let i = 0; i <= span; i++) {
        const iso = addDays(s, i)
        const list = map.get(iso) ?? []
        list.push(r)
        map.set(iso, list)
      }
    }
    return map
  }, [visible, dateProp])

  const canEdit = useCanEdit()
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: canEdit ? 6 : 100000 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: canEdit ? 250 : 100000, tolerance: 6 } }),
  )

  if (!dateProp) {
    return (
      <div className="db-empty">
        <p>{t('noDateProp')}</p>
        <button type="button" className="btn" onClick={(e) => setAddPropAnchor(e.currentTarget)}>
          <Plus size={15} /> {t('addProperty')}
        </button>
        {addPropAnchor && (
          <AddPropertyMenu dbId={db.id} anchor={addPropAnchor} onClose={() => setAddPropAnchor(null)} onAdded={(id) => ws().updateView(db.id, view.id, { datePropId: id })} />
        )}
      </div>
    )
  }

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over) return
    const rowId = String(e.active.id).split('@')[0]
    const fromIso = String(e.active.id).split('@')[1]
    const toIso = String(e.over.id).replace('day:', '')
    const row = rows.find((r) => r.id === rowId)
    if (!row || fromIso === toIso) return
    const v = row.props?.[dateProp.id] ?? null
    const s = dateStart(v)
    if (!s) return
    const delta = diffDays(toIso, fromIso)
    const end = dateEnd(v)
    ws().setProp(rowId, dateProp.id, end ? { start: addDays(s, delta), end: addDays(end, delta) } : addDays(s, delta))
  }

  const addOn = (iso: string) => {
    const id = createRow(db.id, undefined, { [dateProp.id]: iso })
    useStore.setState({ peek: id })
  }

  const maxItems = isMobile ? 2 : 4

  return (
    <div className="cal">
      <div className="cal-head">
        <div className="cal-title">
          <div className="cal-main">{title.main}</div>
          <div className="cal-sub">{title.sub}</div>
        </div>
        <div className="cal-nav">
          <div className="seg seg-small">
            <button type="button" className={system === 'hijri' ? 'is-on' : ''} onClick={() => ws().updateView(db.id, view.id, { calendar: 'hijri' })}>
              {t('hijri')}
            </button>
            <button type="button" className={system === 'gregorian' ? 'is-on' : ''} onClick={() => ws().updateView(db.id, view.id, { calendar: 'gregorian' })}>
              {t('gregorian')}
            </button>
          </div>
          <button type="button" className="icon-btn" onClick={() => setAnchor(shiftMonth(system, anchor.year, anchor.month, -1))} aria-label="prev">
            <Prev size={17} />
          </button>
          <button type="button" className="btn-text" onClick={() => setAnchor(currentMonth(system))}>
            {t('today')}
          </button>
          <button type="button" className="icon-btn" onClick={() => setAnchor(shiftMonth(system, anchor.year, anchor.month, 1))} aria-label="next">
            <Next size={17} />
          </button>
        </div>
      </div>
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="cal-grid">
          {Array.from({ length: 7 }, (_, i) => (
            <div key={'wd' + i} className="cal-wd">
              {wd[(i + settings.weekStart) % 7]}
            </div>
          ))}
          {grid.cells.map((c) => {
            const items = byDay.get(c.iso) ?? []
            return (
              <Day
                key={c.iso}
                iso={c.iso}
                className={'cal-day' + (c.inMonth ? '' : ' is-out') + (c.iso === today ? ' is-today' : '')}
                onTap={(el) => isMobile && setDaySheet({ iso: c.iso, el })}
              >
                <div className="cal-daynum">
                  <span className="cal-n">{num(c.primaryDay, settings.numerals)}</span>
                  <span className="cal-s">
                    {c.secondaryDay === 1 ? `${num(1, settings.numerals)} ${secMonths[c.secondaryMonth - 1]}` : num(c.secondaryDay, settings.numerals)}
                  </span>
                  {!isMobile && canEdit && (
                    <button type="button" className="cal-add icon-btn" aria-label={t('newRow')} onClick={() => addOn(c.iso)}>
                      <Plus size={14} />
                    </button>
                  )}
                </div>
                <div className="cal-items">
                  {items.slice(0, maxItems).map((r) => (
                    <Item key={r.id} row={r} iso={c.iso} statusProp={statusProp} done={isDone(r, schema)} />
                  ))}
                  {items.length > maxItems && <div className="cal-more">+{num(items.length - maxItems, settings.numerals)}</div>}
                </div>
              </Day>
            )
          })}
        </div>
      </DndContext>
      {daySheet && (
        <Popover anchor={daySheet.el} open onClose={() => setDaySheet(null)} sheet>
          <div className="day-sheet">
            <div className="day-sheet-title">{formatDual(daySheet.iso, system, { ...fmt, weekday: true })}</div>
            {(byDay.get(daySheet.iso) ?? []).map((r) => (
              <button
                type="button"
                key={r.id}
                className="day-item"
                onClick={() => {
                  setDaySheet(null)
                  useStore.setState({ peek: r.id })
                }}
              >
                {r.icon && <span>{r.icon}</span>}
                {r.title || t('untitled')}
              </button>
            ))}
            <button
              type="button"
              className="btn"
              hidden={!canEdit}
              onClick={() => {
                const iso = daySheet.iso
                setDaySheet(null)
                addOn(iso)
              }}
            >
              <Plus size={15} /> {t('newRow')}
            </button>
          </div>
        </Popover>
      )}
    </div>
  )
}

function Day({ iso, className, children, onTap }: { iso: string; className: string; children: React.ReactNode; onTap: (el: Element) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${iso}` })
  return (
    <div ref={setNodeRef} className={className + (isOver ? ' is-over' : '')} onClick={(e) => e.target === e.currentTarget || (e.target as Element).closest('.cal-daynum') ? onTap(e.currentTarget) : undefined}>
      {children}
    </div>
  )
}

function Item({ row, iso, statusProp, done }: { row: PageMeta; iso: string; statusProp?: PropDef; done: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: `${row.id}@${iso}` })
  const opt = statusProp ? optionById(statusProp, row.props?.[statusProp.id]) : undefined
  const style = transform ? { transform: `translate(${transform.x}px, ${transform.y}px)`, zIndex: 5 } : undefined
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={style}
      className={'cal-item' + (isDragging ? ' is-dragging' : '') + (done ? ' is-done' : '') + (opt ? ` tag-${opt.color}` : '')}
      onClick={(e) => {
        e.stopPropagation()
        useStore.setState({ peek: row.id })
      }}
    >
      {row.icon && <span className="row-icon">{row.icon}</span>}
      <span className="cal-item-t">{row.title || t('untitled')}</span>
    </div>
  )
}
