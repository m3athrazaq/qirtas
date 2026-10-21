// Database helpers: default schemas, values, filtering, sorting and grouping.
import { t } from '../lib/i18n'
import { uid } from '../lib/ids'
import { compareText, matchesAll } from '../lib/arabic'
import { isValidIso } from '../lib/hijri'
import type { FilterRule, PageMeta, PropDef, PropValue, SelectOption, SortRule, StatusGroup, TagColor, ViewDef, ViewType } from './types'
import type { Workspace } from './workspace'

export function defaultStatusOptions(withReview = false): SelectOption[] {
  const opts: SelectOption[] = [
    { id: uid(6), name: t('s_todo'), color: 'gray', group: 'todo' },
    { id: uid(6), name: t('s_doing'), color: 'blue', group: 'doing' },
  ]
  if (withReview) opts.push({ id: uid(6), name: t('s_review'), color: 'purple', group: 'doing' })
  opts.push({ id: uid(6), name: t('s_done'), color: 'green', group: 'done' })
  return opts
}

export function newView(type: ViewType, schema: PropDef[], name?: string): ViewDef {
  const v: ViewDef = {
    id: uid(8),
    name: name ?? (type === 'table' ? t('viewTable') : type === 'board' ? t('viewBoard') : t('viewCalendar')),
    type,
    filters: [],
    sorts: [],
    hidden: [],
  }
  if (type === 'board') v.groupBy = schema.find((p) => p.type === 'status' || p.type === 'select')?.id
  if (type === 'calendar') {
    v.datePropId = schema.find((p) => p.type === 'date')?.id
    v.calendar = 'default'
  }
  return v
}

export function defaultSchema(): PropDef[] {
  return [
    { id: 'title', name: t('p_name'), type: 'title' },
    { id: uid(6), name: t('p_status'), type: 'status', options: defaultStatusOptions() },
    { id: uid(6), name: t('p_date'), type: 'date' },
  ]
}

export function createDatabase(
  w: Workspace,
  opts: { parentId: string | null; inline: boolean; viewType?: ViewType; title?: string; schema?: PropDef[]; views?: ViewDef[]; icon?: string },
): string {
  const schema = opts.schema ?? defaultSchema()
  const views = opts.views ?? [newView(opts.viewType ?? 'table', schema)]
  // make sure board/calendar views have something to work with
  return w.createPage({
    type: 'database',
    parentId: opts.parentId,
    inline: opts.inline,
    title: opts.title ?? '',
    icon: opts.icon ?? '',
    schema,
    views,
  })
}

/** Values a brand-new row starts with (status columns begin at their first "to do" option). */
export function defaultRowProps(schema: PropDef[]): Record<string, PropValue> {
  const out: Record<string, PropValue> = {}
  for (const p of schema) {
    if (p.type === 'status' && p.options?.length) out[p.id] = (p.options.find((o) => (o.group ?? 'todo') === 'todo') ?? p.options[0]).id
  }
  return out
}

// ---------- values ----------
export function getValue(row: PageMeta, prop: PropDef): PropValue {
  if (prop.type === 'title') return row.title
  if (prop.type === 'created_time') return row.createdAt
  if (prop.type === 'updated_time') return row.updatedAt
  return row.props?.[prop.id] ?? null
}

export function dateStart(v: PropValue): string | null {
  if (!v) return null
  if (typeof v === 'string') return isValidIso(v) ? v : null
  if (typeof v === 'object' && !Array.isArray(v) && 'start' in v) return v.start
  return null
}

export function dateEnd(v: PropValue): string | null {
  if (v && typeof v === 'object' && !Array.isArray(v) && 'start' in v) return v.end ?? null
  return null
}

export function optionById(prop: PropDef, id: unknown): SelectOption | undefined {
  return prop.options?.find((o) => o.id === id)
}

export function valueText(row: PageMeta, prop: PropDef): string {
  const v = getValue(row, prop)
  if (v === null || v === undefined) return ''
  switch (prop.type) {
    case 'select':
    case 'status':
      return optionById(prop, v)?.name ?? ''
    case 'multi_select':
    case 'person':
      return (Array.isArray(v) ? v : [])
        .map((id) => (prop.type === 'person' ? (optionById(prop, id)?.name ?? String(id)) : (optionById(prop, id)?.name ?? '')))
        .filter(Boolean)
        .join('، ')
    case 'checkbox':
      return v ? '✓' : ''
    case 'date': {
      const s = dateStart(v)
      const e = dateEnd(v)
      return s ? (e ? `${s} → ${e}` : s) : ''
    }
    case 'created_time':
    case 'updated_time':
      return typeof v === 'number' ? new Date(v).toISOString().slice(0, 10) : ''
    default:
      return String(v)
  }
}

export function isDone(row: PageMeta, schema: PropDef[]): boolean {
  const status = schema.find((p) => p.type === 'status')
  if (status) {
    const opt = optionById(status, row.props?.[status.id])
    if (opt) return opt.group === 'done'
  }
  const cb = schema.find((p) => p.type === 'checkbox')
  if (cb) return !!row.props?.[cb.id]
  return false
}

// ---------- filtering ----------
export function applyFilters(rows: PageMeta[], schema: PropDef[], filters: FilterRule[]): PageMeta[] {
  if (!filters.length) return rows
  return rows.filter((row) =>
    filters.every((f) => {
      const prop = schema.find((p) => p.id === f.propId)
      if (!prop) return true
      const v = getValue(row, prop)
      const text = valueText(row, prop)
      const val = f.value ?? ''
      switch (f.op) {
        case 'contains':
          return matchesAll(text, val)
        case 'not_contains':
          return !val || !matchesAll(text, val)
        case 'is':
          if (prop.type === 'select' || prop.type === 'status') return v === val
          if (prop.type === 'multi_select' || prop.type === 'person') return Array.isArray(v) && v.includes(val)
          if (prop.type === 'date') return dateStart(v) === val
          return text === val
        case 'is_not':
          if (prop.type === 'select' || prop.type === 'status') return v !== val
          if (prop.type === 'multi_select' || prop.type === 'person') return !(Array.isArray(v) && v.includes(val))
          return text !== val
        case 'empty':
          return text === ''
        case 'not_empty':
          return text !== ''
        case 'checked':
          return !!v
        case 'unchecked':
          return !v
        case 'before': {
          const s = dateStart(v)
          return !!s && !!val && s < val
        }
        case 'after': {
          const s = dateStart(v)
          return !!s && !!val && s > val
        }
        case 'on':
          return dateStart(v) === val
        case 'gt':
          return typeof v === 'number' && v > Number(val)
        case 'lt':
          return typeof v === 'number' && v < Number(val)
        default:
          return true
      }
    }),
  )
}

export function applySorts(rows: PageMeta[], schema: PropDef[], sorts: SortRule[]): PageMeta[] {
  if (!sorts.length) return rows
  const out = [...rows]
  out.sort((a, b) => {
    for (const s of sorts) {
      const prop = schema.find((p) => p.id === s.propId)
      if (!prop) continue
      const c = compareValues(a, b, prop)
      if (c !== 0) return s.dir === 'asc' ? c : -c
    }
    return 0
  })
  return out
}

function compareValues(a: PageMeta, b: PageMeta, prop: PropDef): number {
  const va = getValue(a, prop)
  const vb = getValue(b, prop)
  const emptyA = va === null || va === undefined || va === ''
  const emptyB = vb === null || vb === undefined || vb === ''
  if (emptyA && emptyB) return 0
  if (emptyA) return 1
  if (emptyB) return -1
  switch (prop.type) {
    case 'number':
    case 'created_time':
    case 'updated_time':
      return Number(va) - Number(vb)
    case 'checkbox':
      return Number(!!va) - Number(!!vb)
    case 'date':
      return (dateStart(va) ?? '').localeCompare(dateStart(vb) ?? '')
    case 'select':
    case 'status': {
      const ia = prop.options?.findIndex((o) => o.id === va) ?? 0
      const ib = prop.options?.findIndex((o) => o.id === vb) ?? 0
      return ia - ib
    }
    default:
      return compareText(valueText(a, prop), valueText(b, prop))
  }
}

export function viewRows(all: PageMeta[], schema: PropDef[], view: ViewDef): PageMeta[] {
  return applySorts(applyFilters(all, schema, view.filters), schema, view.sorts)
}

// ---------- formatting numbers ----------
export function formatNumber(n: number, prop: PropDef, numerals: 'arab' | 'latn', lang: 'ar' | 'en'): string {
  const loc = `${lang === 'ar' ? 'ar' : 'en'}-u-nu-${numerals}`
  const f = prop.numberFormat ?? 'plain'
  try {
    switch (f) {
      case 'comma':
        return new Intl.NumberFormat(loc).format(n)
      case 'percent':
        return new Intl.NumberFormat(loc, { style: 'percent', maximumFractionDigits: 2 }).format(n / 100)
      case 'kwd':
      case 'sar':
      case 'aed':
      case 'usd':
        return new Intl.NumberFormat(loc, { style: 'currency', currency: f.toUpperCase() }).format(n)
      default:
        return new Intl.NumberFormat(loc, { useGrouping: false, maximumFractionDigits: 6 }).format(n)
    }
  } catch {
    return String(n)
  }
}

export function nextColor(options: SelectOption[] | undefined): TagColor {
  const used = new Set(options?.map((o) => o.color))
  const palette: TagColor[] = ['blue', 'green', 'orange', 'purple', 'pink', 'yellow', 'brown', 'red', 'gray']
  return palette.find((c) => !used.has(c)) ?? palette[(options?.length ?? 0) % palette.length]
}

export function groupOfStatus(o: SelectOption): StatusGroup {
  return o.group ?? 'todo'
}
