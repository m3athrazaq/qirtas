import { ArrowDownWideNarrow, ArrowUpNarrowWide, BetweenVerticalEnd, BetweenVerticalStart, ChevronLeft, ChevronRight, Copy, EyeOff, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { defaultStatusOptions } from '../data/dbops'
import { useStore, ws } from '../data/store'
import type { NumberFormat, PropDef, PropType, ViewDef } from '../data/types'
import { t } from '../lib/i18n'
import { uid } from '../lib/ids'
import { MenuItem, MenuLabel, MenuSep, Popover } from '../ui/Popover'
import { TYPE_ICONS } from './cells'
import { propOrderWith } from './TableView'

export const ADDABLE_TYPES: PropType[] = ['text', 'number', 'select', 'multi_select', 'status', 'date', 'person', 'checkbox', 'url', 'created_time', 'updated_time']
const NUMBER_FORMATS: NumberFormat[] = ['plain', 'comma', 'percent', 'kwd', 'sar', 'aed', 'usd']

/** A copy of a property, with every row's value, right after the original. */
function duplicateProperty(dbId: string, prop: PropDef, view: ViewDef) {
  const w = ws()
  const id = uid(6)
  const schema = useStore.getState().pages[dbId]?.schema ?? []
  w.doc.transact(() => {
    w.updateSchema(dbId, (s) => {
      const at = s.findIndex((p) => p.id === prop.id)
      s.splice(at + 1, 0, { ...structuredClone(prop), id, name: prop.name + t('copySuffix') })
      return s
    })
    for (const r of w.rowsOrdered(dbId)) {
      const v = useStore.getState().pages[r.id]?.props?.[prop.id]
      if (v !== undefined && v !== null) w.setProp(r.id, id, structuredClone(v))
    }
    w.updateView(dbId, view.id, { propOrder: propOrderWith(schema, view, id, prop.id, 'after') })
  })
}

export function PropertyMenu({
  dbId,
  prop,
  view,
  anchor,
  onClose,
  onInsert,
}: {
  dbId: string
  prop: PropDef
  view: ViewDef
  anchor: Element | null
  onClose: () => void
  /** Add a new property next to this one ("before" = towards the start of the row). */
  onInsert?: (side: 'before' | 'after') => void
}) {
  const [name, setName] = useState(prop.name)
  const [sub, setSub] = useState<null | 'type' | 'format'>(null)
  const rtl = useStore((s) => s.settings.lang === 'ar')
  const Sub = rtl ? ChevronLeft : ChevronRight
  const w = ws()
  const rename = () => {
    const n = name.trim()
    if (n && n !== prop.name) w.updateSchema(dbId, (s) => s.map((p) => (p.id === prop.id ? { ...p, name: n } : p)))
  }
  const changeType = (type: PropType) => {
    w.updateSchema(dbId, (s) =>
      s.map((p) => {
        if (p.id !== prop.id) return p
        const next: PropDef = { ...p, type }
        if ((type === 'select' || type === 'multi_select' || type === 'person') && !p.options) next.options = []
        if (type === 'status') next.options = p.options?.length ? p.options.map((o) => ({ ...o, group: o.group ?? 'todo' })) : defaultStatusOptions()
        return next
      }),
    )
    setSub(null)
  }
  const sort = (dir: 'asc' | 'desc') => {
    w.updateView(dbId, view.id, { sorts: [{ propId: prop.id, dir }] })
    onClose()
  }

  return (
    <Popover anchor={anchor} open onClose={onClose} sheet width={240}>
      {sub === 'type' ? (
        <div className="menu-list">
          <MenuLabel>{t('propType')}</MenuLabel>
          {ADDABLE_TYPES.map((ty) => {
            const Icon = TYPE_ICONS[ty]
            return <MenuItem key={ty} icon={<Icon size={15} />} label={t(`t_${ty}`)} active={prop.type === ty} onClick={() => changeType(ty)} />
          })}
        </div>
      ) : sub === 'format' ? (
        <div className="menu-list">
          {NUMBER_FORMATS.map((f) => (
            <MenuItem
              key={f}
              label={t(`nf_${f}`)}
              active={(prop.numberFormat ?? 'plain') === f}
              onClick={() => {
                w.updateSchema(dbId, (s) => s.map((p) => (p.id === prop.id ? { ...p, numberFormat: f } : p)))
                setSub(null)
              }}
            />
          ))}
        </div>
      ) : (
        <div className="menu-list">
          <div className="menu-input">
            <input
              dir="auto"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={rename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  rename()
                  onClose()
                }
              }}
            />
          </div>
          {prop.type !== 'title' && (
            <MenuItem
              icon={(() => {
                const Icon = TYPE_ICONS[prop.type]
                return <Icon size={15} />
              })()}
              label={t('propType')}
              hint={t(`t_${prop.type}`)}
              trailing={<Sub size={14} />}
              onClick={() => setSub('type')}
            />
          )}
          {prop.type === 'number' && <MenuItem label={t('nf_plain')} hint={t(`nf_${prop.numberFormat ?? 'plain'}`)} trailing={<Sub size={14} />} onClick={() => setSub('format')} />}
          {onInsert && (
            <>
              <MenuSep />
              {/* The title column always comes first: new ones can only go after it */}
              {(prop.type !== 'title' || !rtl) && (
                <MenuItem
                  icon={<BetweenVerticalEnd size={15} />}
                  label={t('insertPropRight')}
                  onClick={() => {
                    onClose()
                    onInsert(rtl ? 'before' : 'after')
                  }}
                />
              )}
              {(prop.type !== 'title' || rtl) && (
                <MenuItem
                  icon={<BetweenVerticalStart size={15} />}
                  label={t('insertPropLeft')}
                  onClick={() => {
                    onClose()
                    onInsert(rtl ? 'after' : 'before')
                  }}
                />
              )}
              {prop.type !== 'title' && (
                <MenuItem
                  icon={<Copy size={15} />}
                  label={t('duplicateProperty')}
                  onClick={() => {
                    duplicateProperty(dbId, prop, view)
                    onClose()
                  }}
                />
              )}
            </>
          )}
          <MenuSep />
          <MenuItem icon={<ArrowUpNarrowWide size={15} />} label={t('sortAsc')} onClick={() => sort('asc')} />
          <MenuItem icon={<ArrowDownWideNarrow size={15} />} label={t('sortDesc')} onClick={() => sort('desc')} />
          {prop.type !== 'title' && (
            <>
              <MenuItem
                icon={<EyeOff size={15} />}
                label={t('hideProperty')}
                onClick={() => {
                  w.updateView(dbId, view.id, { hidden: [...view.hidden, prop.id] })
                  onClose()
                }}
              />
              <MenuSep />
              <MenuItem
                icon={<Trash2 size={15} />}
                label={t('deleteProperty')}
                danger
                onClick={() => {
                  w.deleteProperty(dbId, prop.id)
                  onClose()
                }}
              />
            </>
          )}
        </div>
      )}
    </Popover>
  )
}

export function AddPropertyMenu({ dbId, anchor, onClose, onAdded }: { dbId: string; anchor: Element | null; onClose: () => void; onAdded?: (id: string) => void }) {
  const [name, setName] = useState('')
  const add = (type: PropType) => {
    const id = uid(6)
    const def: PropDef = { id, name: name.trim() || t(`t_${type}`), type }
    if (type === 'select' || type === 'multi_select' || type === 'person') def.options = []
    if (type === 'status') def.options = defaultStatusOptions()
    ws().updateSchema(dbId, (s) => [...s, def])
    onAdded?.(id)
    onClose()
  }
  return (
    <Popover anchor={anchor} open onClose={onClose} sheet width={240}>
      <div className="menu-list">
        <div className="menu-input">
          <input dir="auto" autoFocus placeholder={t('propName')} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <MenuLabel>{t('propType')}</MenuLabel>
        {ADDABLE_TYPES.map((ty) => {
          const Icon = TYPE_ICONS[ty]
          return <MenuItem key={ty} icon={<Icon size={15} />} label={t(`t_${ty}`)} onClick={() => add(ty)} />
        })}
      </div>
    </Popover>
  )
}
