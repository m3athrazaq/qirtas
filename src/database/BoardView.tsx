import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { isDone, nextColor, optionById, viewRows } from '../data/dbops'
import { useCanEdit, useStore, ws } from '../data/store'
import type { PageMeta, PropDef, SelectOption, ViewDef } from '../data/types'
import { num } from '../lib/hijri'
import { t } from '../lib/i18n'
import { orderBetween, uid } from '../lib/ids'
import { CellView, OptionEdit, Tag } from './cells'
import { createRow } from './TableView'

const NONE = '__none__'

export function BoardView({ db, view, rows }: { db: PageMeta; view: ViewDef; rows: PageMeta[] }) {
  const schema = db.schema ?? []
  const numerals = useStore((s) => s.settings.numerals)
  const groupProp = schema.find((p) => p.id === view.groupBy && (p.type === 'status' || p.type === 'select'))
  const visible = useMemo(() => viewRows(rows, schema, view), [rows, schema, view])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [editingNew, setEditingNew] = useState<string | null>(null)
  const [optEdit, setOptEdit] = useState<{ opt: SelectOption; anchor: Element } | null>(null)
  const [adding, setAdding] = useState(false)
  const [newGroup, setNewGroup] = useState('')

  const canEdit = useCanEdit()
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: canEdit ? 6 : 100000 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: canEdit ? 220 : 100000, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const columns = useMemo(() => {
    if (!groupProp) return []
    const opts = groupProp.options ?? []
    const byCol = new Map<string, PageMeta[]>()
    byCol.set(NONE, [])
    opts.forEach((o) => byCol.set(o.id, []))
    visible.forEach((r) => {
      const v = r.props?.[groupProp.id] as string | undefined
      const key = v && byCol.has(v) ? v : NONE
      byCol.get(key)!.push(r)
    })
    const cols: { id: string; option: SelectOption | null; rows: PageMeta[] }[] = []
    if (byCol.get(NONE)!.length) cols.push({ id: NONE, option: null, rows: byCol.get(NONE)! })
    opts.forEach((o) => cols.push({ id: o.id, option: o, rows: byCol.get(o.id)! }))
    return cols
  }, [groupProp, visible])

  if (!groupProp) {
    return <div className="db-empty">{t('groupBy')}: {t('t_status')} / {t('t_select')}</div>
  }

  const colOf = (rowId: string) => columns.find((c) => c.rows.some((r) => r.id === rowId))

  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id))
  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null)
    const { active, over } = e
    if (!over) return
    const rowId = String(active.id)
    const from = colOf(rowId)
    const overId = String(over.id)
    const target = overId.startsWith('col:') ? columns.find((c) => `col:${c.id}` === overId) : colOf(overId)
    if (!from || !target) return
    const w = ws()
    const others = target.rows.filter((r) => r.id !== rowId)
    let index = others.length
    if (!overId.startsWith('col:')) {
      const overIdx = others.findIndex((r) => r.id === overId)
      const activeIdx = target.rows.findIndex((r) => r.id === rowId)
      const overIdxInTarget = target.rows.findIndex((r) => r.id === overId)
      index = from.id === target.id && activeIdx < overIdxInTarget ? overIdx + 1 : overIdx
      if (index < 0) index = others.length
    }
    if (from.id !== target.id) w.setProp(rowId, groupProp.id, target.id === NONE ? null : target.id)
    // Only reorder when the view isn't sorted by something else
    if (!view.sorts.length) {
      const before = others[index - 1]?.order ?? null
      const after = others[index]?.order ?? null
      if (from.id !== target.id || before !== null || after !== null) w.setOrder(rowId, orderBetween(before, after))
    }
  }

  const addGroup = () => {
    const name = newGroup.trim()
    if (!name) return setAdding(false)
    const opt: SelectOption = { id: uid(6), name, color: nextColor(groupProp.options) }
    if (groupProp.type === 'status') opt.group = 'doing'
    ws().updateSchema(db.id, (s) => s.map((p) => (p.id === groupProp.id ? { ...p, options: [...(p.options ?? []), opt] } : p)))
    setNewGroup('')
    setAdding(false)
  }

  const activeRow = activeId ? rows.find((r) => r.id === activeId) : null
  const cardProps = schema.filter((p) => p.type !== 'title' && p.id !== groupProp.id && !view.hidden.includes(p.id))

  return (
    <div className="board-scroll">
      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
        <div className="board">
          {columns.map((col) => (
            <Column key={col.id} id={col.id}>
              <div className="col-head">
                {col.option ? (
                  <button type="button" className="col-tag" onClick={(e) => setOptEdit({ opt: col.option!, anchor: e.currentTarget })}>
                    <Tag color={col.option.color} dot={groupProp.type === 'status'}>
                      {col.option.name}
                    </Tag>
                  </button>
                ) : (
                  <span className="col-none">{t('noValue')}</span>
                )}
                <span className="col-count">{num(col.rows.length, numerals)}</span>
                <button
                  hidden={!canEdit}
                  type="button"
                  className="icon-btn col-add"
                  title={t('newRow')}
                  onClick={() => setEditingNew(createRow(db.id, undefined, col.id === NONE ? {} : { [groupProp.id]: col.id }))}
                >
                  <Plus size={15} />
                </button>
              </div>
              <SortableContext items={col.rows.map((r) => r.id)} strategy={verticalListSortingStrategy}>
                <div className="col-cards">
                  {col.rows.map((r) => (
                    <Card key={r.id} row={r} props={cardProps} schema={schema} editing={editingNew === r.id} onDoneEditing={() => setEditingNew(null)} />
                  ))}
                </div>
              </SortableContext>
              <button
                hidden={!canEdit}
                type="button"
                className="new-card"
                onClick={() => setEditingNew(createRow(db.id, col.rows[col.rows.length - 1]?.id, col.id === NONE ? {} : { [groupProp.id]: col.id }))}
              >
                <Plus size={15} /> {t('newRow')}
              </button>
            </Column>
          ))}
          <div className="board-add" hidden={!canEdit}>
            {adding ? (
              <input
                autoFocus
                dir="auto"
                className="input"
                value={newGroup}
                placeholder={t('addGroup')}
                onChange={(e) => setNewGroup(e.target.value)}
                onBlur={addGroup}
                onKeyDown={(e) => e.key === 'Enter' && addGroup()}
              />
            ) : (
              <button type="button" className="btn-ghost" onClick={() => setAdding(true)}>
                <Plus size={15} /> {t('addGroup')}
              </button>
            )}
          </div>
        </div>
        <DragOverlay dropAnimation={null}>
          {activeRow ? <CardBody row={activeRow} props={cardProps} schema={schema} overlay /> : null}
        </DragOverlay>
      </DndContext>
      {optEdit && <OptionEdit dbId={db.id} prop={groupProp} opt={optEdit.opt} anchor={optEdit.anchor} onClose={() => setOptEdit(null)} />}
    </div>
  )
}

function Column({ id, children }: { id: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${id}` })
  return (
    <div ref={setNodeRef} className={'board-col' + (isOver ? ' is-over' : '')}>
      {children}
    </div>
  )
}

function Card({ row, props, schema, editing, onDoneEditing }: { row: PageMeta; props: PropDef[]; schema: PropDef[]; editing: boolean; onDoneEditing: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: row.id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.35 : 1 }
  if (editing) {
    return (
      <div className="card is-editing" ref={setNodeRef} style={style}>
        <TitleInput row={row} onDone={onDoneEditing} />
      </div>
    )
  }
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} className="card-wrap" onClick={() => useStore.setState({ peek: row.id })}>
      <CardBody row={row} props={props} schema={schema} />
    </div>
  )
}

export function CardBody({ row, props, schema, overlay }: { row: PageMeta; props: PropDef[]; schema: PropDef[]; overlay?: boolean }) {
  const done = isDone(row, schema)
  return (
    <div className={'card' + (overlay ? ' is-overlay' : '') + (done ? ' is-done' : '')}>
      <div className="card-title">
        {row.icon && <span className="row-icon">{row.icon}</span>}
        {row.title || <span className="muted">{t('untitled')}</span>}
      </div>
      {props.map((p) => {
        const v = row.props?.[p.id]
        if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) return null
        if ((p.type === 'select' || p.type === 'status') && !optionById(p, v)) return null
        return (
          <div key={p.id} className="card-prop" title={p.name}>
            <CellView row={row} prop={p} />
          </div>
        )
      })}
    </div>
  )
}

function TitleInput({ row, onDone }: { row: PageMeta; onDone: () => void }) {
  const [val, setVal] = useState(row.title)
  const commit = () => {
    ws().setProp(row.id, 'title', val.trim())
    onDone()
  }
  return (
    <textarea
      autoFocus
      dir="auto"
      className="card-input"
      value={val}
      rows={2}
      placeholder={t('untitled')}
      onChange={(e) => setVal(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          commit()
        }
        if (e.key === 'Escape') onDone()
      }}
    />
  )
}
