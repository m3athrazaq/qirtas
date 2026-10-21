import { Plus } from 'lucide-react'
import { useState } from 'react'
import { useCanEdit, useStore } from '../data/store'
import type { PageMeta } from '../data/types'
import { t } from '../lib/i18n'
import { CellEditor, CellView, TYPE_ICONS } from '../database/cells'
import { AddPropertyMenu } from '../database/PropertyMenu'

/** Property list shown at the top of a database row opened as a page. */
export function RowProps({ row }: { row: PageMeta }) {
  const db = useStore((s) => (row.parentId ? s.pages[row.parentId] : undefined))
  const [editing, setEditing] = useState<{ propId: string; anchor: Element } | null>(null)
  const [addAnchor, setAddAnchor] = useState<Element | null>(null)
  const canEdit = useCanEdit()
  if (!db || db.type !== 'database') return null
  const props = (db.schema ?? []).filter((p) => p.type !== 'title')
  const editingProp = editing ? props.find((p) => p.id === editing.propId) : null
  return (
    <div className="row-props">
      {props.map((p) => {
        const Icon = TYPE_ICONS[p.type]
        const readOnly = !canEdit || p.type === 'created_time' || p.type === 'updated_time' || p.type === 'checkbox'
        return (
          <div key={p.id} className="rp-row">
            <div className="rp-name">
              <Icon size={15} strokeWidth={1.6} />
              <span>{p.name}</span>
            </div>
            <div
              className={'rp-value' + (readOnly ? '' : ' is-editable')}
              onClick={(e) => !readOnly && setEditing({ propId: p.id, anchor: e.currentTarget })}
              role={readOnly ? undefined : 'button'}
              tabIndex={readOnly ? undefined : 0}
            >
              <CellView row={row} prop={p} />
              {!readOnly && isEmpty(row, p.id) && <span className="muted">{t('empty')}</span>}
            </div>
          </div>
        )
      })}
      <button type="button" hidden={!canEdit} className="btn-text rp-add" onClick={(e) => setAddAnchor(e.currentTarget)}>
        <Plus size={14} /> {t('addProperty')}
      </button>
      {editing && editingProp && <CellEditor row={row} prop={editingProp} anchor={editing.anchor} onClose={() => setEditing(null)} />}
      {addAnchor && <AddPropertyMenu dbId={db.id} anchor={addAnchor} onClose={() => setAddAnchor(null)} />}
    </div>
  )
}

function isEmpty(row: PageMeta, propId: string) {
  const v = row.props?.[propId]
  return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)
}
