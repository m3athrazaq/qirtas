export type PageType = 'page' | 'database' | 'row'
export type PageFont = 'sans' | 'naskh' | 'mono'

export type Cover =
  | { kind: 'color'; value: string }
  | { kind: 'pattern'; value: string }
  | { kind: 'image'; assetId: string }

export type PropType =
  | 'title'
  | 'text'
  | 'number'
  | 'select'
  | 'multi_select'
  | 'status'
  | 'date'
  | 'person'
  | 'checkbox'
  | 'url'
  | 'created_time'
  | 'updated_time'

export type TagColor = 'gray' | 'brown' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'pink' | 'red'
export const TAG_COLORS: TagColor[] = ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red']

export type StatusGroup = 'todo' | 'doing' | 'done'

export interface SelectOption {
  id: string
  name: string
  color: TagColor
  group?: StatusGroup // status properties only
}

export type NumberFormat = 'plain' | 'comma' | 'percent' | 'kwd' | 'sar' | 'aed' | 'usd'

export interface PropDef {
  id: string
  name: string
  type: PropType
  options?: SelectOption[]
  numberFormat?: NumberFormat
}

export type ViewType = 'table' | 'board' | 'calendar'

export type FilterOp =
  | 'contains'
  | 'not_contains'
  | 'is'
  | 'is_not'
  | 'empty'
  | 'not_empty'
  | 'checked'
  | 'unchecked'
  | 'before'
  | 'after'
  | 'on'
  | 'gt'
  | 'lt'

export interface FilterRule {
  id: string
  propId: string
  op: FilterOp
  value?: string
}

export interface SortRule {
  propId: string
  dir: 'asc' | 'desc'
}

export interface ViewDef {
  id: string
  name: string
  type: ViewType
  groupBy?: string // board
  datePropId?: string // calendar
  calendar?: 'hijri' | 'gregorian' | 'default'
  filters: FilterRule[]
  sorts: SortRule[]
  hidden: string[] // property ids hidden in this view
  widths?: Record<string, number>
  propOrder?: string[]
  cardProps?: string[] // board/calendar: properties shown on cards
}

export type PropValue = string | number | boolean | string[] | null | { start: string; end?: string }

export interface PageMeta {
  id: string
  type: PageType
  title: string
  icon: string
  cover: Cover | null
  coverY: number
  parentId: string | null
  order: string
  createdAt: number
  updatedAt: number
  createdBy: string
  updatedBy: string
  deletedAt: number | null
  fullWidth: boolean
  font: PageFont
  smallText: boolean
  inline: boolean
  schema?: PropDef[]
  views?: ViewDef[]
  props?: Record<string, PropValue>
}
