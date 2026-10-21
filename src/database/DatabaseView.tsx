import {
  ArrowUpDown,
  ArrowUpLeft,
  ArrowUpRight,
  CalendarDays,
  ChevronDown,
  Eye,
  EyeOff,
  Filter,
  Plus,
  Settings2,
  SquareKanban,
  Table2,
  Trash2,
  X,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { newView } from '../data/dbops'
import { navigate } from '../data/nav'
import { useCanEdit, useStore, ws } from '../data/store'
import type { FilterOp, FilterRule, PageMeta, PropDef, ViewDef, ViewType } from '../data/types'
import { num } from '../lib/hijri'
import { t } from '../lib/i18n'
import { uid } from '../lib/ids'
import { DatePicker } from '../ui/DatePicker'
import { MenuItem, MenuLabel, MenuSep, Popover } from '../ui/Popover'
import { BoardView } from './BoardView'
import { CalendarView } from './CalendarView'
import { Tag, TYPE_ICONS } from './cells'
import { getActiveViewId, setActiveViewId, useDb, useRows } from './hooks'
import { AddPropertyMenu } from './PropertyMenu'
import { createRow, TableView } from './TableView'

const VIEW_ICONS: Record<ViewType, typeof Table2> = { table: Table2, board: SquareKanban, calendar: CalendarDays }

export default function DatabaseView({ dbId, inline }: { dbId: string; inline?: boolean }) {
  const db = useDb(dbId)
  const rows = useRows(dbId)
  const settings = useStore((s) => s.settings)
  const canEdit = useCanEdit()
  const [activeId, setActive] = useState<string | undefined>(() => (db?.views ? getActiveViewId(dbId, db.views) : undefined))
  const [menu, setMenu] = useState<null | { kind: 'filter' | 'sort' | 'props' | 'addView' | 'view'; anchor: Element; viewId?: string }>(null)

  if (!db || db.deletedAt) return <div className="db-missing">{t('pageLinkMissing')}</div>
  const views = db.views ?? []
  const view = views.find((v) => v.id === activeId) ?? views[0]
  const schema = db.schema ?? []
  const rtl = settings.lang === 'ar'
  const OpenIcon = rtl ? ArrowUpLeft : ArrowUpRight
  const pick = (id: string) => {
    setActive(id)
    setActiveViewId(dbId, id)
  }

  const addView = (type: ViewType) => {
    const v = newView(type, schema)
    if (type === 'board' && !v.groupBy) {
      // Boards need a status/select property
      const statusId = uid(6)
      ws().updateSchema(dbId, (s) => [...s, { id: statusId, name: t('p_status'), type: 'status', options: [] }])
      v.groupBy = statusId
    }
    if (type === 'calendar' && !v.datePropId) {
      const dateId = uid(6)
      ws().updateSchema(dbId, (s) => [...s, { id: dateId, name: t('p_date'), type: 'date' }])
      v.datePropId = dateId
    }
    ws().updateViews(dbId, (vs) => [...vs, v])
    pick(v.id)
    setMenu(null)
  }

  return (
    <div className={'db' + (inline ? ' db-inline' : ' db-full')}>
      {inline && (
        <div className="db-title-row">
          <DbTitle db={db} />
          <button type="button" className="btn-text" onClick={() => navigate(dbId)} title={t('openFull')}>
            <OpenIcon size={14} />
          </button>
        </div>
      )}
      <div className="db-bar">
        <div className="view-tabs" role="tablist">
          {views.map((v) => {
            const Icon = VIEW_ICONS[v.type]
            const on = v.id === view?.id
            return (
              <button
                type="button"
                role="tab"
                aria-selected={on}
                key={v.id}
                className={'view-tab' + (on ? ' is-on' : '')}
                onClick={(e) => (on ? canEdit && setMenu({ kind: 'view', anchor: e.currentTarget, viewId: v.id }) : pick(v.id))}
              >
                <Icon size={15} strokeWidth={1.6} />
                <span>{v.name}</span>
                {on && <ChevronDown size={12} className="muted" />}
              </button>
            )
          })}
          <button type="button" hidden={!canEdit} className="view-tab view-add" title={t('addView')} onClick={(e) => setMenu({ kind: 'addView', anchor: e.currentTarget })}>
            <Plus size={15} />
          </button>
        </div>
        {view && canEdit && (
          <div className="db-tools">
            <button
              type="button"
              className={'tool-btn' + (view.filters.length ? ' is-on' : '')}
              onClick={(e) => setMenu({ kind: 'filter', anchor: e.currentTarget })}
              title={t('filter')}
            >
              <Filter size={15} />
              <span className="tool-label">{t('filter')}</span>
              {view.filters.length > 0 && <span className="badge">{num(view.filters.length, settings.numerals)}</span>}
            </button>
            <button type="button" className={'tool-btn' + (view.sorts.length ? ' is-on' : '')} onClick={(e) => setMenu({ kind: 'sort', anchor: e.currentTarget })} title={t('sort')}>
              <ArrowUpDown size={15} />
              <span className="tool-label">{t('sort')}</span>
            </button>
            <button type="button" className="tool-btn" onClick={(e) => setMenu({ kind: 'props', anchor: e.currentTarget })} title={t('properties')}>
              <Settings2 size={15} />
              <span className="tool-label">{t('properties')}</span>
            </button>
            <button
              type="button"
              className="btn btn-primary btn-small"
              onClick={() => {
                const id = createRow(dbId)
                useStore.setState({ peek: id })
              }}
            >
              <Plus size={15} /> {t('newRow')}
            </button>
          </div>
        )}
      </div>

      {view?.type === 'table' && <TableView db={db} view={view} rows={rows} />}
      {view?.type === 'board' && <BoardView db={db} view={view} rows={rows} />}
      {view?.type === 'calendar' && <CalendarView db={db} view={view} rows={rows} />}

      {menu?.kind === 'addView' && (
        <Popover anchor={menu.anchor} open onClose={() => setMenu(null)} sheet>
          <div className="menu-list">
            <MenuLabel>{t('addView')}</MenuLabel>
            {(['table', 'board', 'calendar'] as ViewType[]).map((ty) => {
              const Icon = VIEW_ICONS[ty]
              return <MenuItem key={ty} icon={<Icon size={15} />} label={t(ty === 'table' ? 'viewTable' : ty === 'board' ? 'viewBoard' : 'viewCalendar')} onClick={() => addView(ty)} />
            })}
          </div>
        </Popover>
      )}
      {menu?.kind === 'view' && view && <ViewMenu db={db} view={view} anchor={menu.anchor} onClose={() => setMenu(null)} onDeleted={() => pick(views.find((v) => v.id !== view.id)?.id ?? '')} />}
      {menu?.kind === 'filter' && view && <FilterMenu db={db} view={view} anchor={menu.anchor} onClose={() => setMenu(null)} />}
      {menu?.kind === 'sort' && view && <SortMenu db={db} view={view} anchor={menu.anchor} onClose={() => setMenu(null)} />}
      {menu?.kind === 'props' && view && <PropsMenu db={db} view={view} anchor={menu.anchor} onClose={() => setMenu(null)} />}
    </div>
  )
}

function DbTitle({ db }: { db: PageMeta }) {
  const [val, setVal] = useState(db.title)
  const [focused, setFocused] = useState(false)
  const shown = focused ? val : db.title
  return (
    <input
      className="db-title"
      dir="auto"
      readOnly={useStore.getState().wsRole === 'viewer'}
      value={shown}
      placeholder={t('dbUntitled')}
      onFocus={() => {
        setVal(db.title)
        setFocused(true)
      }}
      onChange={(e) => setVal(e.target.value)}
      onBlur={() => {
        setFocused(false)
        if (val !== db.title) ws().updatePage(db.id, { title: val })
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  )
}

function ViewMenu({ db, view, anchor, onClose, onDeleted }: { db: PageMeta; view: ViewDef; anchor: Element; onClose: () => void; onDeleted: () => void }) {
  const [name, setName] = useState(view.name)
  const schema = db.schema ?? []
  const groupables = schema.filter((p) => p.type === 'status' || p.type === 'select')
  const dates = schema.filter((p) => p.type === 'date')
  const save = () => name.trim() && name !== view.name && ws().updateView(db.id, view.id, { name: name.trim() })
  return (
    <Popover anchor={anchor} open onClose={onClose} sheet width={250}>
      <div className="menu-list">
        <div className="menu-input">
          <input dir="auto" value={name} onChange={(e) => setName(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === 'Enter' && (save(), onClose())} />
        </div>
        {view.type === 'board' && groupables.length > 0 && (
          <>
            <MenuLabel>{t('groupBy')}</MenuLabel>
            {groupables.map((p) => (
              <MenuItem key={p.id} label={p.name} active={view.groupBy === p.id} onClick={() => ws().updateView(db.id, view.id, { groupBy: p.id })} />
            ))}
          </>
        )}
        {view.type === 'calendar' && dates.length > 1 && (
          <>
            <MenuLabel>{t('dateProperty')}</MenuLabel>
            {dates.map((p) => (
              <MenuItem key={p.id} label={p.name} active={view.datePropId === p.id} onClick={() => ws().updateView(db.id, view.id, { datePropId: p.id })} />
            ))}
          </>
        )}
        {(db.views?.length ?? 0) > 1 && (
          <>
            <MenuSep />
            <MenuItem
              icon={<Trash2 size={15} />}
              label={t('deleteView')}
              danger
              onClick={() => {
                ws().updateViews(db.id, (vs) => vs.filter((v) => v.id !== view.id))
                onDeleted()
                onClose()
              }}
            />
          </>
        )}
      </div>
    </Popover>
  )
}

function opsFor(p: PropDef): FilterOp[] {
  switch (p.type) {
    case 'checkbox':
      return ['checked', 'unchecked']
    case 'select':
    case 'status':
      return ['is', 'is_not', 'empty', 'not_empty']
    case 'multi_select':
    case 'person':
      return ['is', 'is_not', 'empty', 'not_empty']
    case 'date':
      return ['on', 'before', 'after', 'empty', 'not_empty']
    case 'number':
      return ['is', 'gt', 'lt', 'empty', 'not_empty']
    default:
      return ['contains', 'not_contains', 'is', 'empty', 'not_empty']
  }
}

function FilterMenu({ db, view, anchor, onClose }: { db: PageMeta; view: ViewDef; anchor: Element; onClose: () => void }) {
  const schema = (db.schema ?? []).filter((p) => p.type !== 'created_time' && p.type !== 'updated_time')
  const set = (filters: FilterRule[]) => ws().updateView(db.id, view.id, { filters })
  const update = (id: string, patch: Partial<FilterRule>) => set(view.filters.map((f) => (f.id === id ? { ...f, ...patch } : f)))
  return (
    <Popover anchor={anchor} open onClose={onClose} sheet width={360}>
      <div className="filter-menu">
        {view.filters.length === 0 && <div className="menu-empty">{t('noFilters')}</div>}
        {view.filters.map((f) => {
          const prop = schema.find((p) => p.id === f.propId) ?? schema[0]
          const ops = opsFor(prop)
          const needsValue = !['empty', 'not_empty', 'checked', 'unchecked'].includes(f.op)
          return (
            <div key={f.id} className="filter-row">
              <select className="select" value={prop.id} onChange={(e) => update(f.id, { propId: e.target.value, op: opsFor(schema.find((p) => p.id === e.target.value)!)[0], value: '' })}>
                {schema.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <select className="select" value={f.op} onChange={(e) => update(f.id, { op: e.target.value as FilterOp })}>
                {ops.map((o) => (
                  <option key={o} value={o}>
                    {t(`f_${o}`)}
                  </option>
                ))}
              </select>
              {needsValue && <FilterValue prop={prop} value={f.value ?? ''} onChange={(value) => update(f.id, { value })} />}
              <button type="button" className="icon-btn" aria-label={t('delete')} onClick={() => set(view.filters.filter((x) => x.id !== f.id))}>
                <X size={15} />
              </button>
            </div>
          )
        })}
        <div className="filter-actions">
          <button
            type="button"
            className="btn-text"
            onClick={() => {
              const p = schema[0]
              set([...view.filters, { id: uid(6), propId: p.id, op: opsFor(p)[0], value: '' }])
            }}
          >
            <Plus size={14} /> {t('addFilter')}
          </button>
          {view.filters.length > 0 && (
            <button type="button" className="btn-text" onClick={() => set([])}>
              {t('clear')}
            </button>
          )}
        </div>
      </div>
    </Popover>
  )
}

function FilterValue({ prop, value, onChange }: { prop: PropDef; value: string; onChange: (v: string) => void }) {
  const [dateAnchor, setDateAnchor] = useState<Element | null>(null)
  if (prop.type === 'select' || prop.type === 'status' || prop.type === 'multi_select' || prop.type === 'person') {
    return (
      <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {(prop.options ?? []).map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    )
  }
  if (prop.type === 'date') {
    return (
      <>
        <button type="button" className="select" onClick={(e) => setDateAnchor(e.currentTarget)}>
          {value || t('value')}
        </button>
        {dateAnchor && (
          <Popover anchor={dateAnchor} open onClose={() => setDateAnchor(null)} sheet>
            <DatePicker
              value={value || null}
              onChange={(v) => {
                onChange(v ?? '')
                setDateAnchor(null)
              }}
            />
          </Popover>
        )}
      </>
    )
  }
  return <input className="input" dir="auto" value={value} placeholder={t('value')} inputMode={prop.type === 'number' ? 'decimal' : 'text'} onChange={(e) => onChange(e.target.value)} />
}

function SortMenu({ db, view, anchor, onClose }: { db: PageMeta; view: ViewDef; anchor: Element; onClose: () => void }) {
  const schema = db.schema ?? []
  const set = (sorts: ViewDef['sorts']) => ws().updateView(db.id, view.id, { sorts })
  return (
    <Popover anchor={anchor} open onClose={onClose} sheet width={320}>
      <div className="filter-menu">
        {view.sorts.length === 0 && <div className="menu-empty">{t('noSorts')}</div>}
        {view.sorts.map((s, i) => (
          <div key={i} className="filter-row">
            <select className="select" value={s.propId} onChange={(e) => set(view.sorts.map((x, j) => (j === i ? { ...x, propId: e.target.value } : x)))}>
              {schema.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <select className="select" value={s.dir} onChange={(e) => set(view.sorts.map((x, j) => (j === i ? { ...x, dir: e.target.value as 'asc' | 'desc' } : x)))}>
              <option value="asc">{t('sortAsc')}</option>
              <option value="desc">{t('sortDesc')}</option>
            </select>
            <button type="button" className="icon-btn" aria-label={t('delete')} onClick={() => set(view.sorts.filter((_, j) => j !== i))}>
              <X size={15} />
            </button>
          </div>
        ))}
        <div className="filter-actions">
          <button type="button" className="btn-text" onClick={() => set([...view.sorts, { propId: schema[0]?.id ?? 'title', dir: 'asc' }])}>
            <Plus size={14} /> {t('addSort')}
          </button>
          {view.sorts.length > 0 && (
            <button type="button" className="btn-text" onClick={() => set([])}>
              {t('clear')}
            </button>
          )}
        </div>
      </div>
    </Popover>
  )
}

function PropsMenu({ db, view, anchor, onClose }: { db: PageMeta; view: ViewDef; anchor: Element; onClose: () => void }) {
  const schema = db.schema ?? []
  const [addAnchor, setAddAnchor] = useState<Element | null>(null)
  const toggle = (id: string) =>
    ws().updateView(db.id, view.id, { hidden: view.hidden.includes(id) ? view.hidden.filter((h) => h !== id) : [...view.hidden, id] })
  const props = useMemo(() => schema.filter((p) => p.type !== 'title'), [schema])
  return (
    <Popover anchor={anchor} open onClose={onClose} sheet width={260}>
      <div className="menu-list">
        <MenuLabel>{t('properties')}</MenuLabel>
        {props.map((p) => {
          const Icon = TYPE_ICONS[p.type]
          const hidden = view.hidden.includes(p.id)
          return (
            <MenuItem
              key={p.id}
              icon={<Icon size={15} />}
              label={p.name}
              trailing={hidden ? <EyeOff size={15} className="muted" /> : <Eye size={15} />}
              onClick={() => toggle(p.id)}
            />
          )
        })}
        <MenuSep />
        <MenuItem icon={<Plus size={15} />} label={t('addProperty')} onClick={() => setAddAnchor(anchor)} />
      </div>
      {addAnchor && <AddPropertyMenu dbId={db.id} anchor={addAnchor} onClose={() => setAddAnchor(null)} />}
    </Popover>
  )
}

export { Tag }
