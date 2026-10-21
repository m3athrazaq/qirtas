import {
  AlignRight,
  Calendar,
  CheckSquare,
  CircleDot,
  Clock,
  Hash,
  Link as LinkIcon,
  List,
  Pencil,
  Plus,
  Tag as TagIcon,
  Trash2,
  Type,
  User,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { dateEnd, dateStart, formatNumber, nextColor, optionById } from '../data/dbops'
import { useStore, ws } from '../data/store'
import type { PageMeta, PropDef, PropType, PropValue, SelectOption, TagColor } from '../data/types'
import { matchScore } from '../lib/arabic'
import { COLOR_NAMES } from '../lib/colors'
import { formatGregorian, formatHijri, formatShort, num } from '../lib/hijri'
import { t } from '../lib/i18n'
import { uid } from '../lib/ids'
import { DatePicker } from '../ui/DatePicker'
import { MenuItem, MenuLabel, MenuSep, Popover } from '../ui/Popover'

export const TYPE_ICONS: Record<PropType, LucideIcon> = {
  title: Type,
  text: AlignRight,
  number: Hash,
  select: CircleDot,
  multi_select: List,
  status: TagIcon,
  date: Calendar,
  person: User,
  checkbox: CheckSquare,
  url: LinkIcon,
  created_time: Clock,
  updated_time: Clock,
}

export function Tag({ color, children, dot }: { color: TagColor; children: React.ReactNode; dot?: boolean }) {
  return (
    <span className={`tag tag-${color}`}>
      {dot && <span className="tag-dot" />}
      {children}
    </span>
  )
}

function useFmt() {
  const s = useStore((st) => st.settings)
  return { lang: s.lang, numerals: s.numerals, calendar: s.calendar } as const
}

export function DateText({ v, calendar }: { v: PropValue; calendar?: 'hijri' | 'gregorian' }) {
  const f = useFmt()
  const s = dateStart(v)
  if (!s) return null
  const e = dateEnd(v)
  const sys = calendar ?? f.calendar
  const o = { lang: f.lang, numerals: f.numerals }
  const full = (iso: string) => (sys === 'hijri' ? formatHijri(iso, o) : formatGregorian(iso, o))
  const other = (iso: string) => (sys === 'hijri' ? formatGregorian(iso, o) : formatHijri(iso, o))
  return (
    <span className="date-text" title={other(s) + (e ? ` → ${other(e)}` : '')}>
      {e ? `${formatShort(s, sys, o)} → ${full(e)}` : full(s)}
    </span>
  )
}

/** Read-only rendering of a cell value. */
export function CellView({ row, prop }: { row: PageMeta; prop: PropDef }) {
  const f = useFmt()
  const v = prop.type === 'title' ? row.title : row.props?.[prop.id]
  switch (prop.type) {
    case 'title':
      return <span className="cell-title">{row.title || <span className="muted">{t('untitled')}</span>}</span>
    case 'text':
      return <span className="cell-text">{String(v ?? '')}</span>
    case 'number':
      return typeof v === 'number' ? <span className="cell-num">{formatNumber(v, prop, f.numerals, f.lang)}</span> : null
    case 'select':
    case 'status': {
      const o = optionById(prop, v)
      return o ? (
        <Tag color={o.color} dot={prop.type === 'status'}>
          {o.name}
        </Tag>
      ) : null
    }
    case 'multi_select':
    case 'person': {
      const ids = Array.isArray(v) ? v : []
      return (
        <span className="tags">
          {ids.map((id) => {
            const o = optionById(prop, id)
            if (!o) return null
            return prop.type === 'person' ? (
              <span key={id} className="person">
                <span className={`avatar tag-${o.color}`}>{[...o.name][0]}</span>
                {o.name}
              </span>
            ) : (
              <Tag key={id} color={o.color}>
                {o.name}
              </Tag>
            )
          })}
        </span>
      )
    }
    case 'date':
      return <DateText v={v ?? null} />
    case 'checkbox':
      return (
        <input
          type="checkbox"
          className="checkbox"
          disabled={useStore.getState().wsRole === 'viewer'}
          checked={!!v}
          onChange={(e) => ws().setProp(row.id, prop.id, e.target.checked)}
          onClick={(e) => e.stopPropagation()}
        />
      )
    case 'url':
      return v ? (
        <a className="cell-url" href={String(v)} target="_blank" rel="noopener noreferrer" dir="ltr" onClick={(e) => e.stopPropagation()}>
          {String(v).replace(/^https?:\/\//, '')}
        </a>
      ) : null
    case 'created_time':
    case 'updated_time': {
      const ts = prop.type === 'created_time' ? row.createdAt : row.updatedAt
      const iso = new Date(ts).toISOString().slice(0, 10)
      const time = new Date(ts).toLocaleTimeString(f.lang === 'ar' ? `ar-u-nu-${f.numerals}` : 'en', { hour: 'numeric', minute: '2-digit' })
      return (
        <span className="muted">
          <DateText v={iso} /> {time}
        </span>
      )
    }
  }
}

// ---------------- editors ----------------

export function CellEditor({ row, prop, anchor, onClose }: { row: PageMeta; prop: PropDef; anchor: Element | null; onClose: () => void }) {
  const dbId = row.parentId!
  switch (prop.type) {
    case 'select':
    case 'status':
    case 'multi_select':
    case 'person':
      return (
        <Popover anchor={anchor} open onClose={onClose} sheet width={280}>
          <OptionsEditor dbId={dbId} row={row} prop={prop} onClose={onClose} />
        </Popover>
      )
    case 'date':
      return (
        <Popover anchor={anchor} open onClose={onClose} sheet>
          <DateEditor row={row} prop={prop} onClose={onClose} />
        </Popover>
      )
    case 'title':
    case 'text':
    case 'url':
    case 'number':
      return (
        <Popover anchor={anchor} open onClose={onClose} placement="bottom-start" offsetPx={-36} width={Math.max(240, (anchor as HTMLElement | null)?.offsetWidth ?? 240)}>
          <TextEditor row={row} prop={prop} onClose={onClose} />
        </Popover>
      )
    default:
      return null
  }
}

function TextEditor({ row, prop, onClose }: { row: PageMeta; prop: PropDef; onClose: () => void }) {
  const initial = prop.type === 'title' ? row.title : row.props?.[prop.id]
  const [val, setVal] = useState(initial === null || initial === undefined ? '' : String(initial))
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  const commit = () => {
    if (prop.type === 'number') {
      const n = parseFloat(val.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[,،]/g, ''))
      ws().setProp(row.id, prop.id, Number.isFinite(n) ? n : null)
    } else if (prop.type === 'url') {
      const v = val.trim()
      ws().setProp(row.id, prop.id, v ? (/^[a-z]+:\/\//i.test(v) ? v : `https://${v}`) : null)
    } else ws().setProp(row.id, prop.id, prop.type === 'title' ? val.replace(/\n/g, ' ') : val)
    onClose()
  }
  return (
    <div className="text-editor">
      <textarea
        ref={ref}
        dir="auto"
        value={val}
        rows={prop.type === 'text' ? 3 : 1}
        inputMode={prop.type === 'number' ? 'decimal' : prop.type === 'url' ? 'url' : 'text'}
        onChange={(e) => setVal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !(prop.type === 'text' && e.shiftKey)) {
            e.preventDefault()
            commit()
          }
          if (e.key === 'Escape') onClose()
        }}
      />
    </div>
  )
}

function DateEditor({ row, prop, onClose }: { row: PageMeta; prop: PropDef; onClose: () => void }) {
  const v = row.props?.[prop.id] ?? null
  const start = dateStart(v)
  const end = dateEnd(v)
  const [editing, setEditing] = useState<'start' | 'end'>('start')
  const [hasEnd, setHasEnd] = useState(!!end)
  const set = (s: string | null, e: string | null) => {
    if (!s) return ws().setProp(row.id, prop.id, null)
    ws().setProp(row.id, prop.id, e && e >= s ? { start: s, end: e } : s)
  }
  return (
    <div className="date-editor">
      {hasEnd && (
        <div className="seg seg-small">
          <button type="button" className={editing === 'start' ? 'is-on' : ''} onClick={() => setEditing('start')}>
            {start ? <DateText v={start} /> : t('p_date')}
          </button>
          <button type="button" className={editing === 'end' ? 'is-on' : ''} onClick={() => setEditing('end')}>
            {end ? <DateText v={end} /> : t('endDate')}
          </button>
        </div>
      )}
      <DatePicker
        value={editing === 'start' ? start : end}
        onChange={(iso) => {
          if (editing === 'start') {
            set(iso, hasEnd ? end : null)
            if (!hasEnd) onClose()
            else if (iso) setEditing('end')
          } else set(start ?? iso, iso)
        }}
        footer={
          <label className="check-row">
            <input
              type="checkbox"
              checked={hasEnd}
              onChange={(e) => {
                setHasEnd(e.target.checked)
                if (!e.target.checked) set(start, null)
                else setEditing('end')
              }}
            />
            {t('endDate')}
          </label>
        }
      />
    </div>
  )
}

function OptionsEditor({ dbId, row, prop, onClose }: { dbId: string; row: PageMeta; prop: PropDef; onClose: () => void }) {
  const multi = prop.type === 'multi_select' || prop.type === 'person'
  const raw = row.props?.[prop.id]
  const selected: string[] = multi ? (Array.isArray(raw) ? raw : []) : raw ? [String(raw)] : []
  const [q, setQ] = useState('')
  const [editOpt, setEditOpt] = useState<SelectOption | null>(null)
  const [editAnchor, setEditAnchor] = useState<Element | null>(null)
  const options = prop.options ?? []
  const filtered = useMemo(() => (q.trim() ? options.filter((o) => matchScore(o.name, q) > 0) : options), [options, q])
  const exact = options.some((o) => o.name.trim() === q.trim())

  const toggle = (id: string) => {
    if (multi) {
      const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]
      ws().setProp(row.id, prop.id, next)
    } else {
      ws().setProp(row.id, prop.id, selected[0] === id ? null : id)
      onClose()
    }
  }

  const create = () => {
    const name = q.trim()
    if (!name) return
    const opt: SelectOption = { id: uid(6), name, color: nextColor(options) }
    if (prop.type === 'status') opt.group = 'todo'
    ws().updateSchema(dbId, (s) => s.map((p) => (p.id === prop.id ? { ...p, options: [...(p.options ?? []), opt] } : p)))
    setQ('')
    if (multi) ws().setProp(row.id, prop.id, [...selected, opt.id])
    else {
      ws().setProp(row.id, prop.id, opt.id)
      onClose()
    }
  }

  return (
    <div className="options-editor">
      <div className="oe-selected">
        {selected.map((id) => {
          const o = optionById(prop, id)
          return o ? (
            <Tag key={id} color={o.color}>
              {o.name}
              <button type="button" className="tag-x" onClick={() => toggle(id)} aria-label={t('delete')}>
                ×
              </button>
            </Tag>
          ) : null
        })}
        <input
          autoFocus
          dir="auto"
          value={q}
          placeholder={t('searchOrCreate')}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              if (filtered.length && (exact || !q.trim())) toggle(filtered[0].id)
              else create()
            }
          }}
        />
      </div>
      <div className="oe-list">
        {filtered.map((o) => (
          <div key={o.id} className={'oe-row' + (selected.includes(o.id) ? ' is-on' : '')}>
            <button type="button" className="oe-pick" onClick={() => toggle(o.id)}>
              {prop.type === 'person' ? (
                <span className="person">
                  <span className={`avatar tag-${o.color}`}>{[...o.name][0]}</span>
                  {o.name}
                </span>
              ) : (
                <Tag color={o.color} dot={prop.type === 'status'}>
                  {o.name}
                </Tag>
              )}
            </button>
            <button
              type="button"
              className="icon-btn oe-edit"
              aria-label={t('editOption')}
              onClick={(e) => {
                setEditOpt(o)
                setEditAnchor(e.currentTarget)
              }}
            >
              <Pencil size={14} />
            </button>
          </div>
        ))}
        {q.trim() && !exact && (
          <button type="button" className="oe-create" onClick={create}>
            <Plus size={14} /> {t('newOption')} <Tag color={nextColor(options)}>{q.trim()}</Tag>
          </button>
        )}
      </div>
      {editOpt && <OptionEdit dbId={dbId} prop={prop} opt={editOpt} anchor={editAnchor} onClose={() => setEditOpt(null)} />}
    </div>
  )
}

export function OptionEdit({ dbId, prop, opt, anchor, onClose }: { dbId: string; prop: PropDef; opt: SelectOption; anchor: Element | null; onClose: () => void }) {
  const [name, setName] = useState(opt.name)
  const update = (patch: Partial<SelectOption>) =>
    ws().updateSchema(dbId, (s) => s.map((p) => (p.id === prop.id ? { ...p, options: (p.options ?? []).map((o) => (o.id === opt.id ? { ...o, ...patch } : o)) } : p)))
  const remove = () => {
    ws().updateSchema(dbId, (s) => s.map((p) => (p.id === prop.id ? { ...p, options: (p.options ?? []).filter((o) => o.id !== opt.id) } : p)))
    onClose()
  }
  return (
    <Popover anchor={anchor} open onClose={onClose} placement="right-start" sheet width={220}>
      <div className="menu-list">
        <div className="menu-input">
          <input
            dir="auto"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name.trim() && update({ name: name.trim() })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                if (name.trim()) update({ name: name.trim() })
                onClose()
              }
            }}
          />
        </div>
        {prop.type === 'status' && (
          <>
            <MenuLabel>{t('t_status')}</MenuLabel>
            {(['todo', 'doing', 'done'] as const).map((g) => (
              <MenuItem key={g} label={t(`g_${g}`)} active={(opt.group ?? 'todo') === g} onClick={() => update({ group: g })} />
            ))}
          </>
        )}
        <MenuLabel>{t('color')}</MenuLabel>
        <div className="swatches pad">
          {COLOR_NAMES.map((c) => (
            <button key={c} type="button" title={t(`c_${c}`)} className={'swatch' + (opt.color === c ? ' is-on' : '')} onClick={() => update({ color: c })}>
              <span className={`swatch-dot tag-${c}`} />
            </button>
          ))}
        </div>
        <MenuSep />
        <MenuItem icon={<Trash2 size={15} />} label={t('deleteOption')} danger onClick={remove} />
      </div>
    </Popover>
  )
}

export function formatCellForTitle(v: PropValue): string {
  if (v === null || v === undefined) return ''
  return typeof v === 'object' ? JSON.stringify(v) : String(v)
}

export { num }
