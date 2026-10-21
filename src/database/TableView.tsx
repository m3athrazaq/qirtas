import { ArrowUpLeft, ArrowUpRight, Copy, MoreHorizontal, Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { defaultRowProps, formatNumber, viewRows } from '../data/dbops'
import { useCanEdit, useStore, ws } from '../data/store'
import type { PageMeta, PropDef, ViewDef } from '../data/types'
import { num } from '../lib/hijri'
import { t } from '../lib/i18n'
import { MenuItem, MenuSep, Popover } from '../ui/Popover'
import { CellEditor, CellView, TYPE_ICONS } from './cells'
import { AddPropertyMenu, PropertyMenu } from './PropertyMenu'

export function orderedProps(schema: PropDef[], view: ViewDef): PropDef[] {
  const order = view.propOrder ?? []
  const byOrder = [...schema].sort((a, b) => {
    if (a.type === 'title') return -1
    if (b.type === 'title') return 1
    const ia = order.indexOf(a.id)
    const ib = order.indexOf(b.id)
    if (ia === -1 && ib === -1) return 0
    if (ia === -1) return 1
    if (ib === -1) return -1
    return ia - ib
  })
  return byOrder.filter((p) => p.type === 'title' || !view.hidden.includes(p.id))
}

export function createRow(dbId: string, after?: string, props?: Record<string, unknown>): string {
  const schema = useStore.getState().pages[dbId]?.schema ?? []
  const initial = { ...defaultRowProps(schema), ...(props as PageMeta['props']) }
  return ws().createPage({ type: 'row', parentId: dbId, props: initial }, after ? { after } : {})
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
  const [addProp, setAddProp] = useState<Element | null>(null)
  const [rowMenu, setRowMenu] = useState<{ row: PageMeta; anchor: Element } | null>(null)
  const tableRef = useRef<HTMLDivElement>(null)
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
      <table className="db-table" style={{ width: totalWidth }}>
        <colgroup>
          {props.map((p) => (
            <col key={p.id} style={{ width: width(p) }} />
          ))}
          <col style={{ width: 44 }} />
        </colgroup>
        <thead>
          <tr>
            {props.map((p) => {
              const Icon = TYPE_ICONS[p.type]
              return (
                <th key={p.id} style={{ width: width(p) }}>
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
                <button type="button" className="icon-btn" title={t('addProperty')} onClick={(e) => setAddProp(e.currentTarget)}>
                  <Plus size={16} />
                </button>
              )}
            </th>
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((row) => (
            <tr key={row.id} className="db-row">
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
                    <button
                      type="button"
                      className="row-more"
                      aria-label={t('more')}
                      onClick={(e) => {
                        e.stopPropagation()
                        setRowMenu({ row, anchor: e.currentTarget })
                      }}
                    >
                      <MoreHorizontal size={15} />
                    </button>
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
      {headerMenu && <PropertyMenu dbId={db.id} prop={headerMenu.prop} view={view} anchor={headerMenu.anchor} onClose={() => setHeaderMenu(null)} />}
      {addProp && <AddPropertyMenu dbId={db.id} anchor={addProp} onClose={() => setAddProp(null)} />}
      {rowMenu && (
        <Popover anchor={rowMenu.anchor} open onClose={() => setRowMenu(null)} sheet>
          <RowMenu row={rowMenu.row} onClose={() => setRowMenu(null)} />
        </Popover>
      )}
    </div>
  )
}

export function RowMenu({ row, onClose }: { row: PageMeta; onClose: () => void }) {
  const rtl = useStore((s) => s.settings.lang === 'ar')
  const OpenIcon = rtl ? ArrowUpLeft : ArrowUpRight
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
          ws().trashPage(row.id)
          onClose()
        }}
      />
    </div>
  )
}
