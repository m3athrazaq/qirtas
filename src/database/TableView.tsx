import { ArrowUpLeft, ArrowUpRight, BetweenHorizontalEnd, BetweenHorizontalStart, Copy, MoreHorizontal, Plus, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { defaultRowProps, formatNumber, viewRows } from '../data/dbops'
import { useCanEdit, useStore, ws } from '../data/store'
import type { PageMeta, PropDef, ViewDef } from '../data/types'
import { num } from '../lib/hijri'
import { isTypingTarget } from '../lib/keys'
import { t } from '../lib/i18n'
import { MenuItem, MenuSep, Popover } from '../ui/Popover'
import { trashPage } from '../shell/pageOps'
import { CellEditor, CellView, TYPE_ICONS } from './cells'
import { AddPropertyMenu, PropertyMenu } from './PropertyMenu'

/** Every property in this view's order (title first), hidden ones included. */
function sortProps(schema: PropDef[], view: ViewDef): PropDef[] {
  const order = view.propOrder ?? []
  return [...schema].sort((a, b) => {
    if (a.type === 'title') return -1
    if (b.type === 'title') return 1
    const ia = order.indexOf(a.id)
    const ib = order.indexOf(b.id)
    if (ia === -1 && ib === -1) return 0
    if (ia === -1) return 1
    if (ib === -1) return -1
    return ia - ib
  })
}

export function orderedProps(schema: PropDef[], view: ViewDef): PropDef[] {
  return sortProps(schema, view).filter((p) => p.type === 'title' || !view.hidden.includes(p.id))
}

/** The view's property order with `newId` placed next to `refId`. */
export function propOrderWith(schema: PropDef[], view: ViewDef, newId: string, refId: string, side: 'before' | 'after'): string[] {
  const ids = sortProps(schema, view)
    .filter((p) => p.type !== 'title' && p.id !== newId)
    .map((p) => p.id)
  const at = ids.indexOf(refId)
  ids.splice(at === -1 ? (side === 'after' && refId !== 'title' ? ids.length : 0) : at + (side === 'after' ? 1 : 0), 0, newId)
  return ids
}

/** A new row; `place` is the row to follow (or `{ before }` / `{ after }`). */
export function createRow(dbId: string, place?: string | { before?: string; after?: string }, props?: Record<string, unknown>): string {
  const schema = useStore.getState().pages[dbId]?.schema ?? []
  const initial = { ...defaultRowProps(schema), ...(props as PageMeta['props']) }
  const where = typeof place === 'string' ? { after: place } : (place ?? {})
  return ws().createPage({ type: 'row', parentId: dbId, props: initial }, where)
}

export function TableView({ db, view, rows }: { db: PageMeta; view: ViewDef; rows: PageMeta[] }) {
  const schema = db.schema ?? []
  const settings = useStore((s) => s.settings)
  const canEdit = useCanEdit()
  const rtl = settings.lang === 'ar'
  const props = useMemo(() => orderedProps(schema, view), [schema, view])
  const visibleRows = useMemo(() => viewRows(rows, schema, view), [rows, schema, view])
  const [editing, setEditing] = useState<{ rowId: string; propId: string; anchor: Element | null } | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const [headerMenu, setHeaderMenu] = useState<{ prop: PropDef; anchor: Element } | null>(null)
  const [addProp, setAddProp] = useState<{ anchor: Element; at?: { ref: string; side: 'before' | 'after' } } | null>(null)
  const [rowMenu, setRowMenu] = useState<{ row: PageMeta; anchor: Element } | null>(null)
  const [picked, setPicked] = useState<Set<string>>(() => new Set())
  // Only rows still on screen count as selected
  const selected = useMemo(() => new Set(visibleRows.filter((r) => picked.has(r.id)).map((r) => r.id)), [picked, visibleRows])
  const togglePick = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const allPicked = visibleRows.length > 0 && selected.size === visibleRows.length
  const deleteSelected = () => {
    const ids = [...selected]
    if (!ids.length) return
    const w = ws()
    w.doc.transact(() => ids.forEach((id) => w.trashPage(id)))
    setPicked(new Set())
    useStore.getState().toast(t('rowsDeleted', { n: num(ids.length, settings.numerals) }), {
      label: t('undo'),
      run: () => w.doc.transact(() => ids.forEach((id) => w.restorePage(id))),
    })
  }

  const tableRef = useRef<HTMLDivElement>(null)
  // Delete removes the selected rows, Escape clears the selection
  const deleteRef = useRef(deleteSelected)
  deleteRef.current = deleteSelected
  const hasSelection = selected.size > 0
  useEffect(() => {
    if (!hasSelection) return
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      // Only when the keyboard isn't busy elsewhere: not typing, no dialog or menu on top, no row
      // preview over this table, and the focus in this table or nowhere in particular
      if (isTypingTarget(el)) return
      const st = useStore.getState()
      const table = tableRef.current
      if (!table || st.modal || document.querySelector('.popover')) return
      if (st.peek && !table.closest('.in-peek')) return
      if (el && el !== document.body && !table.contains(el)) return
      if (e.key === 'Escape') setPicked(new Set())
      else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        deleteRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hasSelection])
  const OpenIcon = rtl ? ArrowUpLeft : ArrowUpRight

  useEffect(() => {
    if (!pending) return
    const el = tableRef.current?.querySelector(`[data-cell="${pending}:title"]`)
    if (el) {
      setEditing({ rowId: pending, propId: 'title', anchor: el })
      setPending(null)
    }
  })

  const width = (p: PropDef) => view.widths?.[p.id] ?? (p.type === 'title' ? 260 : p.type === 'checkbox' ? 90 : 170)

  const startResize = (e: React.PointerEvent, p: PropDef) => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startW = width(p)
    const th = (e.currentTarget as HTMLElement).parentElement as HTMLElement
    let w = startW
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) * (rtl ? -1 : 1)
      w = Math.max(70, Math.min(640, startW + dx))
      th.style.width = `${w}px`
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      ws().updateView(db.id, view.id, { widths: { ...(view.widths ?? {}), [p.id]: Math.round(w) } })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const editingRow = editing ? rows.find((r) => r.id === editing.rowId) : null
  const editingProp = editing ? schema.find((p) => p.id === editing.propId) : null
  const totalWidth = props.reduce((s, p) => s + width(p), 0) + 44

  return (
    <div className="table-scroll" ref={tableRef}>
      {selected.size > 0 && (
        <div className="sel-bar" role="toolbar">
          <span className="sel-count">{t('selectedCount', { n: num(selected.size, settings.numerals) })}</span>
          <button type="button" className="btn-text is-danger" onClick={deleteSelected}>
            <Trash2 size={14} /> {t('deleteSelected')}
          </button>
          <button type="button" className="icon-btn" title={t('clearSelection')} aria-label={t('clearSelection')} onClick={() => setPicked(new Set())}>
            <X size={15} />
          </button>
        </div>
      )}
      <table className={'db-table' + (selected.size ? ' has-selection' : '')} style={{ width: totalWidth }}>
        <colgroup>
          {props.map((p) => (
            <col key={p.id} style={{ width: width(p) }} />
          ))}
          <col style={{ width: 44 }} />
        </colgroup>
        <thead>
          <tr>
            {props.map((p, i) => {
              const Icon = TYPE_ICONS[p.type]
              return (
                <th key={p.id} style={{ width: width(p) }}>
                  {i === 0 && canEdit && visibleRows.length > 0 && (
                    <label className="row-gutter th-gutter" title={t('selectAllRows')}>
                      <input
                        type="checkbox"
                        className="row-check"
                        checked={allPicked}
                        aria-label={t('selectAllRows')}
                        onChange={() => setPicked(allPicked ? new Set() : new Set(visibleRows.map((r) => r.id)))}
                      />
                    </label>
                  )}
                  <button type="button" className="th-btn" onClick={(e) => canEdit && setHeaderMenu({ prop: p, anchor: e.currentTarget })}>
                    <Icon size={14} strokeWidth={1.6} />
                    <span className="th-name">{p.name}</span>
                  </button>
                  <span className="col-resize" onPointerDown={(e) => startResize(e, p)} />
                </th>
              )
            })}
            <th className="th-add">
              {canEdit && (
                <button type="button" className="icon-btn" title={t('addProperty')} onClick={(e) => setAddProp({ anchor: e.currentTarget })}>
                  <Plus size={16} />
                </button>
              )}
            </th>
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((row) => (
            <tr key={row.id} className={'db-row' + (selected.has(row.id) ? ' is-selected' : '')}>
              {props.map((p, i) => (
                <td
                  key={p.id}
                  data-cell={`${row.id}:${p.id}`}
                  className={'td td-' + p.type}
                  onClick={(e) => {
                    if (!canEdit) {
                      if (p.type === 'title') useStore.setState({ peek: row.id })
                      return
                    }
                    if (p.type === 'checkbox' || p.type === 'created_time' || p.type === 'updated_time') return
                    setEditing({ rowId: row.id, propId: p.id, anchor: e.currentTarget })
                  }}
                >
                  {i === 0 && canEdit && (
                    <span className="row-gutter" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" className="row-check" checked={selected.has(row.id)} aria-label={t('selectRow')} title={t('selectRow')} onChange={() => togglePick(row.id)} />
                      <button type="button" className="row-more" aria-label={t('more')} title={t('more')} onClick={(e) => setRowMenu({ row, anchor: e.currentTarget })}>
                        <MoreHorizontal size={15} />
                      </button>
                    </span>
                  )}
                  <div className="td-inner">
                    {p.type === 'title' && row.icon && <span className="row-icon">{row.icon}</span>}
                    <CellView row={row} prop={p} />
                    {p.type === 'title' && (
                      <button
                        type="button"
                        className="open-row"
                        onClick={(e) => {
                          e.stopPropagation()
                          useStore.setState({ peek: row.id })
                        }}
                      >
                        <OpenIcon size={13} /> {t('openAsPage')}
                      </button>
                    )}
                  </div>
                </td>
              ))}
              <td className="td-pad" />
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr hidden={!canEdit}>
            <td colSpan={props.length + 1}>
              <button type="button" className="new-row" onClick={() => setPending(createRow(db.id, visibleRows[visibleRows.length - 1]?.id))}>
                <Plus size={15} /> {t('newRow')}
              </button>
            </td>
          </tr>
          <tr className="calc-row">
            {props.map((p, i) => {
              if (i === 0)
                return (
                  <td key={p.id} className="calc">
                    {t('count')} {num(visibleRows.length, settings.numerals)}
                  </td>
                )
              if (p.type === 'number') {
                const sum = visibleRows.reduce((s, r) => s + (typeof r.props?.[p.id] === 'number' ? (r.props![p.id] as number) : 0), 0)
                return (
                  <td key={p.id} className="calc">
                    {t('sum')} {formatNumber(Math.round(sum * 1000) / 1000, p, settings.numerals, settings.lang)}
                  </td>
                )
              }
              return <td key={p.id} />
            })}
            <td />
          </tr>
        </tfoot>
      </table>

      {editing && editingRow && editingProp && (
        <CellEditor row={editingRow} prop={editingProp} anchor={editing.anchor} onClose={() => setEditing(null)} />
      )}
      {headerMenu && (
        <PropertyMenu
          dbId={db.id}
          prop={headerMenu.prop}
          view={view}
          anchor={headerMenu.anchor}
          onClose={() => setHeaderMenu(null)}
          onInsert={(side) => setAddProp({ anchor: headerMenu.anchor, at: { ref: headerMenu.prop.id, side } })}
        />
      )}
      {addProp && (
        <AddPropertyMenu
          dbId={db.id}
          anchor={addProp.anchor}
          onClose={() => setAddProp(null)}
          onAdded={(id) => {
            const at = addProp.at
            if (at) ws().updateView(db.id, view.id, { propOrder: propOrderWith(schema, view, id, at.ref, at.side) })
          }}
        />
      )}
      {rowMenu && (
        <Popover anchor={rowMenu.anchor} open onClose={() => setRowMenu(null)} sheet>
          <RowMenu row={rowMenu.row} onClose={() => setRowMenu(null)} onCreated={setPending} />
        </Popover>
      )}
    </div>
  )
}

export function RowMenu({ row, onClose, onCreated }: { row: PageMeta; onClose: () => void; onCreated?: (id: string) => void }) {
  const rtl = useStore((s) => s.settings.lang === 'ar')
  const OpenIcon = rtl ? ArrowUpLeft : ArrowUpRight
  const insert = (side: 'before' | 'after') => {
    if (!row.parentId) return
    const id = createRow(row.parentId, { [side]: row.id })
    onClose()
    onCreated?.(id)
  }
  return (
    <div className="menu-list">
      <MenuItem
        icon={<OpenIcon size={15} />}
        label={t('openAsPage')}
        onClick={() => {
          useStore.setState({ peek: row.id })
          onClose()
        }}
      />
      <MenuItem icon={<BetweenHorizontalStart size={15} />} label={t('insertRowAbove')} onClick={() => insert('before')} />
      <MenuItem icon={<BetweenHorizontalEnd size={15} />} label={t('insertRowBelow')} onClick={() => insert('after')} />
      <MenuItem
        icon={<Copy size={15} />}
        label={t('duplicateRow')}
        onClick={() => {
          void ws().duplicatePage(row.id)
          onClose()
        }}
      />
      <MenuSep />
      <MenuItem
        icon={<Trash2 size={15} />}
        label={t('deleteRow')}
        danger
        onClick={() => {
          onClose()
          trashPage(row)
        }}
      />
    </div>
  )
}
