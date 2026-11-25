// Bringing notes in from other apps: Notion (its "Markdown & CSV" export), an Obsidian vault,
// Google Keep (Google Takeout), Evernote (.enex), and plain Markdown, text, HTML and CSV files.
// First the files are read and a plan is made (what pages, tables and pictures there are), shown to
// the user; then the pages are made, all inside one new page, so an import can be removed in one go.
import { getSchema, type JSONContent } from '@tiptap/core'
import { DOMParser as PMDOMParser } from '@tiptap/pm/model'
import { importImage } from '../data/assets'
import { createDatabase, newView } from '../data/dbops'
import { ORIGIN_SYSTEM } from '../data/history'
import { useStore, ws } from '../data/store'
import type { PropDef, PropType, PropValue, SelectOption, StatusGroup, TagColor } from '../data/types'
import { schemaExtensions } from '../editor/ext'
import { markdownToJson } from '../lib/exporter'
import { formatGregorian, formatHijri, localIso, todayIso } from '../lib/hijri'
import { t } from '../lib/i18n'
import { uid } from '../lib/ids'
import { setPageContent } from '../templates/build'
import { ASSET, PAGE, dropTitleHeading, finishDoc, linkify, prepareMarkdown, propsBlock, splitFrontMatter, textBlocks, type LinkContext } from './markdown'
import { baseName, blobOf, dirName, extOf, fromBase64, imageType, md5, normalize, parseCsv, readEntries, resolveLink, safeDecode, stem, text, type Entry, type Picked } from './util'

export type Source = 'notion' | 'obsidian' | 'keep' | 'evernote' | 'files'

export const SOURCE_NAME: Record<Source, string> = {
  notion: 'Notion',
  obsidian: 'Obsidian',
  keep: 'Google Keep',
  evernote: 'Evernote',
  files: '',
}
export const sourceName = (s: Source) => SOURCE_NAME[s] || t('impFiles')

interface PlanColumn {
  name: string
  type: PropType
  options?: { name: string; group?: StatusGroup }[]
}

interface PlanRow {
  key: string | null
  title: string
  values: string[]
  /** The row's own page, when it has more than its values. */
  body?: Body
}

interface PlanDatabase {
  columns: PlanColumn[]
  rows: PlanRow[]
}

/** Writes a page's content; links and pictures are found through the context. */
type Body = (ctx: LinkContext) => JSONContent

export interface PlanPage {
  key: string
  title: string
  icon?: string
  /** The file it comes from (links in it are relative to that). */
  from?: string
  body?: Body
  db?: PlanDatabase
  /** It stands for a folder (listed first, as in a file manager). */
  folder?: boolean
  children: PlanPage[]
}

export interface ImportPlan {
  source: Source
  pages: PlanPage[]
  counts: { pages: number; databases: number; rows: number; images: number }
  /** Files that were left out (types the importer doesn't read). */
  skipped: string[]
  assets: Map<string, { data: Uint8Array; type: string }>
  byPath: Map<string, string>
  byName: Map<string, string>
  imageByName: Map<string, string>
}

export interface ImportResult {
  rootId: string
  pages: number
  databases: number
  rows: number
  images: number
  missingImages: number
  failed: string[]
}

const PAGE_EXT = new Set(['md', 'markdown', 'txt', 'html', 'htm', 'csv'])
const NOTION_ID = /\s+[0-9a-f]{32}$/i
const isNotionName = (s: string) => NOTION_ID.test(s)
/** "Tasks 1a2b…" → "Tasks"; "Tasks 1a2b…_all" → "Tasks". */
const cleanName = (s: string) => s.replace(/_all$/, '').replace(NOTION_ID, '').trim() || s

const compareTitles = (a: PlanPage, b: PlanPage) => a.title.localeCompare(b.title, 'ar', { numeric: true })

// ---------------------------------------------------------------- reading, planning

export async function planImport(files: Picked[]): Promise<ImportPlan> {
  const entries = await readEntries(files)
  if (!entries.length) throw new Error('empty')
  const plan: ImportPlan = {
    source: 'files',
    pages: [],
    counts: { pages: 0, databases: 0, rows: 0, images: 0 },
    skipped: [],
    assets: new Map(),
    byPath: new Map(),
    byName: new Map(),
    imageByName: new Map(),
  }
  const docs: Entry[] = []
  const keep: Entry[] = []
  const enex: Entry[] = []
  for (const e of entries) {
    const ext = extOf(e.path)
    const img = imageType(e.path)
    if (img) {
      plan.assets.set(e.path, { data: e.data, type: img })
      const name = baseName(e.path).toLowerCase()
      if (!plan.imageByName.has(name)) plan.imageByName.set(name, e.path)
    } else if (ext === 'enex') enex.push(e)
    else if (ext === 'json' && isKeepNote(e)) keep.push(e)
    else if (PAGE_EXT.has(ext)) docs.push(e)
    else if (ext !== 'json') plan.skipped.push(e.path)
  }
  // Keep writes each note twice (JSON and HTML): the JSON is read. Takeout's own files (its index,
  // the list of labels) are not notes.
  const keepDirs = new Set(keep.map((e) => dirName(e.path)))
  const pageDocs = keep.length ? docs.filter((e) => !keepDirs.has(dirName(e.path)) && !/^archive_browser\.html$/i.test(baseName(e.path))) : docs

  plan.source = enex.length ? 'evernote' : keep.length ? 'keep' : pageDocs.some((e) => e.path.split('/').some((s) => isNotionName(stem(s)))) ? 'notion' : pageDocs.some((e) => extOf(e.path) === 'md' && /\[\[[^\]]+\]\]/.test(text(e.data).slice(0, 200_000))) ? 'obsidian' : 'files'

  plan.pages.push(...planTree(pageDocs, plan))
  if (keep.length) plan.pages.push(...planKeep(keep, plan))
  for (const e of enex) plan.pages.push(planEnex(e, plan))

  const count = (ps: PlanPage[]) =>
    ps.forEach((p) => {
      if (p.db) {
        plan.counts.databases++
        plan.counts.rows += p.db.rows.length
      } else plan.counts.pages++
      count(p.children)
    })
  count(plan.pages)
  plan.counts.images = plan.assets.size
  if (!plan.counts.pages && !plan.counts.databases) throw new Error('nothing')
  return plan
}

// ---------------------------------------------------------------- Notion, Obsidian, plain files

function planTree(docs: Entry[], plan: ImportPlan): PlanPage[] {
  // Notion writes a table twice, "X.csv" (one view) and "X_all.csv" (everything): the full one is read
  const paths = new Set(docs.map((d) => d.path))
  docs = docs.filter((d) => !(extOf(d.path) === 'csv' && paths.has(d.path.replace(/\.csv$/i, '_all.csv'))))
  const byPath = new Map(docs.map((d) => [d.path, d]))
  const top: PlanPage[] = []
  const pages = new Map<string, PlanPage>()
  const folders = new Map<string, PlanPage | null>()
  /** A table's row pages, with the folder where the table itself is (their own sub-pages go there). */
  const rowHome = new Map<PlanPage, string>()

  // The page that stands for a folder: "A.md" next to "A/" (Notion), "A/A.md" (Obsidian), or a
  // page made for it
  const pathOfFolderPage = (dir: string): string | null => {
    for (const ext of ['md', 'markdown', 'html', 'htm', 'txt', 'csv']) {
      if (byPath.has(`${dir}.${ext}`)) return `${dir}.${ext}`
      if (ext === 'csv' && byPath.has(`${dir}_all.csv`)) return `${dir}_all.csv`
    }
    const note = `${dir}/${baseName(dir)}.md`
    return byPath.has(note) ? note : null
  }
  const folderPage = (dir: string): PlanPage | null => {
    if (!dir) return null
    if (folders.has(dir)) return folders.get(dir)!
    const own = pathOfFolderPage(dir)
    let page: PlanPage
    if (own) page = pageOf(own)
    else {
      page = { key: 'dir:' + dir, title: cleanName(baseName(dir)), icon: '📁', children: [] }
      attach(page, dirName(dir))
    }
    page.folder = true
    folders.set(dir, page)
    return page
  }
  const attach = (page: PlanPage, dir: string): void => {
    const parent = folderPage(dir)
    if (parent && rowHome.has(parent)) return attach(page, rowHome.get(parent)!)
    if (parent?.db) {
      const tableDir = dirName(parent.from ?? '')
      // A page in a table's folder is one of its rows; one that isn't goes next to the table
      if (addRowPage(parent.db, page)) rowHome.set(page, tableDir)
      else attach(page, tableDir)
      return
    }
    ;(parent ? parent.children : top).push(page)
  }
  const pageOf = (path: string): PlanPage => {
    const hit = pages.get(path)
    if (hit) return hit
    const entry = byPath.get(path)!
    const page = makePage(entry, plan.source !== 'obsidian')
    pages.set(path, page)
    plan.byPath.set(path, page.key)
    const name = stem(path).toLowerCase()
    if (!plan.byName.has(name)) plan.byName.set(name, page.key)
    const clean = cleanName(stem(path)).toLowerCase()
    if (!plan.byName.has(clean)) plan.byName.set(clean, page.key)
    // An Obsidian folder note stands for its folder: it sits where the folder is
    const dir = dirName(path)
    const isFolderNote = extOf(path) === 'md' && dir && baseName(dir) === stem(path) && !byPath.has(`${dir}.md`)
    attach(page, isFolderNote ? dirName(dir) : dir)
    return page
  }
  for (const d of docs) pageOf(d.path)
  // A link to "X.csv" means the table read from "X_all.csv"
  for (const p of paths) {
    if (extOf(p) !== 'csv' || plan.byPath.has(p)) continue
    const key = plan.byPath.get(p.replace(/\.csv$/i, '_all.csv'))
    if (key) plan.byPath.set(p, key)
  }

  // Order: as the parent page lists them (Notion links its sub-pages in order), then by name
  const order = (list: PlanPage[], parent: PlanPage | null) => {
    const src = parent?.from && !parent.db ? text(byPath.get(parent.from)?.data ?? new Uint8Array()) : ''
    const at = new Map<string, number>()
    if (src) {
      for (const m of src.matchAll(/\]\(([^)\s]+)\)/g)) {
        const key = plan.byPath.get(resolveLink(parent!.from!, m[1]))
        if (key && !at.has(key)) at.set(key, m.index!)
      }
    }
    list.sort((a, b) => {
      const x = at.get(a.key)
      const y = at.get(b.key)
      if (x !== undefined || y !== undefined) return (x ?? Infinity) - (y ?? Infinity)
      // folders first, as in a file manager
      if (!!a.folder !== !!b.folder) return a.folder ? -1 : 1
      return compareTitles(a, b)
    })
    list.forEach((p) => order(p.children, p))
  }
  order(top, null)
  return top
}

function makePage(entry: Entry, headingTitle: boolean): PlanPage {
  const ext = extOf(entry.path)
  const key = entry.path
  const src = text(entry.data)
  const fileTitle = cleanName(stem(entry.path))
  if (ext === 'csv') {
    return { key, title: fileTitle, from: entry.path, db: planDatabase(src), children: [] }
  }
  if (ext === 'txt') return { key, title: fileTitle, from: entry.path, body: () => ({ type: 'doc', content: textBlocks(src) }), children: [] }
  if (ext === 'html' || ext === 'htm') {
    const dom = new DOMParser().parseFromString(src, 'text/html')
    const title = dom.querySelector('title')?.textContent?.trim() || fileTitle
    return { key, title, from: entry.path, body: (ctx) => dropTitleHeading(finishDoc(htmlToJson(dom.body), ctx), title), children: [] }
  }
  // Markdown: the title is the file's name (Obsidian), or the heading that starts it (Notion)
  const { meta, body } = splitFrontMatter(src)
  const h1 = /^\s*#\s+(.+?)\s*#*\s*$/m.exec(body.slice(0, 2000))
  const headingFirst = h1 && body.slice(0, h1.index).trim() === ''
  const metaTitle = meta.find(([k]) => k.toLowerCase() === 'title')?.[1]
  // The title: the note's own (front matter), or the heading it starts with (Notion, most Markdown
  // files), or the file's name (Obsidian, where the name is the title)
  const title = metaTitle || (headingTitle && headingFirst ? h1![1].replace(/\\(.)/g, '$1') : '') || fileTitle
  return {
    key,
    title,
    from: entry.path,
    body: (ctx) => {
      const doc = dropTitleHeading(markdownToJson(prepareMarkdown(body)) as JSONContent, title)
      const out = finishDoc(doc, ctx)
      const props = propsBlock(meta.filter(([k]) => k.toLowerCase() !== 'title'))
      if (props) out.content = [props, ...(out.content ?? [])]
      return out
    },
    children: [],
  }
}

/** A page found in a table's folder: the body of the row with that title (Notion writes each row
 *  as a page, with its values at the top). */
function addRowPage(db: PlanDatabase, page: PlanPage): boolean {
  const row = db.rows.find((r) => !r.key && r.title.trim() === page.title.trim())
  if (!row || !page.body) return false
  row.key = page.key
  const names = db.columns.map((c) => c.name)
  const body = page.body
  row.body = (ctx) => {
    const doc = body(ctx)
    // The values written at the top ("Status: Done") are the row's own columns
    let i = 0
    const blocks = doc.content ?? []
    while (i < blocks.length && blocks[i].type === 'paragraph') {
      const lines = (blocks[i].content ?? []).map((n) => (n.type === 'text' ? (n.text ?? '') : n.type === 'hardBreak' ? '\n' : ' ')).join('').split('\n')
      if (!lines.every((l) => names.some((n) => l.startsWith(n + ':')))) break
      i++
    }
    return { ...doc, content: blocks.slice(i).length ? blocks.slice(i) : [{ type: 'paragraph' }] }
  }
  return true
}

// ---------------------------------------------------------------- tables (CSV)

const YES = new Set(['yes', 'no', 'true', 'false', '✓', '✔', 'x', 'نعم', 'لا', 'checked', 'unchecked'])
const TRUE = new Set(['yes', 'true', '✓', '✔', 'x', 'نعم', 'checked'])
const MONTHS = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i

/** "November 25, 2026", "2026-11-25", "25/11/2026 9:00 AM", and ranges with "→". */
export function parseDateValue(s: string): { start: string; end?: string } | null {
  const parts = s.split(/\s*→\s*/)
  const one = (p: string): string | null => {
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(p)
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
    const dmy = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})\b/.exec(p)
    if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`
    const ymd = /^(\d{4})[/.](\d{1,2})[/.](\d{1,2})\b/.exec(p)
    if (ymd) return `${ymd[1]}-${ymd[2].padStart(2, '0')}-${ymd[3].padStart(2, '0')}`
    if (!MONTHS.test(p) || !/\b\d{4}\b/.test(p)) return null
    const ms = Date.parse(p.replace(/\(.*?\)/g, '').replace(/\s+(at\s+)?\d{1,2}:\d{2}.*$/i, ''))
    return Number.isNaN(ms) ? null : localIso(ms)
  }
  const start = one(parts[0].trim())
  if (!start) return null
  const end = parts[1] ? one(parts[1].trim()) : null
  return end && end !== start ? { start, end } : { start }
}

const NUMBER = /^-?[\d٠-٩]{1,3}([,،]?[\d٠-٩]{3})*([.٫][\d٠-٩]+)?%?$|^-?[\d٠-٩]*[.٫][\d٠-٩]+%?$/
const toNumber = (s: string) => {
  const n = Number(s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[,،%]/g, '').replace('٫', '.'))
  return s.trim().endsWith('%') ? n / 100 : n
}
const STATUS_NAME = /^(status|state|الحالة|حالة)$/i
const groupOf = (name: string): StatusGroup =>
  /^(done|complete(d)?|finished|closed|منجز|مكتمل|تم|انتهى)/i.test(name) ? 'done' : /(progress|doing|started|review|active|جار|قيد)/i.test(name) && !/not started/i.test(name) ? 'doing' : 'todo'

function inferColumn(name: string, values: string[]): PlanColumn {
  const filled = values.map((v) => v.trim()).filter(Boolean)
  if (!filled.length) return { name, type: 'text' }
  if (filled.every((v) => YES.has(v.toLowerCase()))) return { name, type: 'checkbox' }
  if (filled.every((v) => NUMBER.test(v))) return { name, type: 'number' }
  if (filled.every((v) => /^https?:\/\/\S+$/i.test(v))) return { name, type: 'url' }
  if (filled.every((v) => parseDateValue(v))) return { name, type: 'date' }
  const distinct = [...new Set(filled)]
  const short = filled.every((v) => v.length <= 40 && !v.includes('\n'))
  // A column called "Status" with a few short values is one, even before they repeat
  if (short && distinct.length <= 12 && STATUS_NAME.test(name.trim())) return { name, type: 'status', options: distinct.map((n) => ({ name: n, group: groupOf(n) })) }
  if (short && filled.some((v) => v.includes(', '))) {
    const items = filled.flatMap((v) => v.split(', ').map((x) => x.trim()).filter(Boolean))
    const set = [...new Set(items)]
    if (set.length <= 24 && set.length < items.length) return { name, type: 'multi_select', options: set.map((n) => ({ name: n })) }
  }
  if (short && distinct.length <= 12 && distinct.length < filled.length) return { name, type: 'select', options: distinct.map((n) => ({ name: n })) }
  return { name, type: 'text' }
}

function planDatabase(src: string): PlanDatabase {
  const rows = parseCsv(src)
  const head = rows[0] ?? []
  const data = rows.slice(1).filter((r) => r.some((c) => c.trim()))
  const columns: PlanColumn[] = head.map((name, i) => (i === 0 ? { name: name.trim() || t('p_name'), type: 'title' as PropType } : inferColumn(name.trim() || `${i + 1}`, data.map((r) => r[i] ?? ''))))
  if (!columns.length) columns.push({ name: t('p_name'), type: 'title' })
  return { columns, rows: data.map((r) => ({ key: null, title: (r[0] ?? '').trim(), values: r })) }
}

const PALETTE: TagColor[] = ['blue', 'green', 'orange', 'purple', 'pink', 'yellow', 'brown', 'red', 'gray']

function buildDatabase(db: PlanDatabase): { schema: PropDef[]; rows: { row: PlanRow; props: Record<string, PropValue> }[] } {
  const schema: PropDef[] = db.columns.map((c, i) => {
    const def: PropDef = { id: i === 0 ? 'title' : uid(6), name: c.name, type: c.type }
    if (c.options)
      def.options = c.options.map((o, k): SelectOption => {
        const color: TagColor = c.type === 'status' ? (o.group === 'done' ? 'green' : o.group === 'doing' ? 'blue' : 'gray') : PALETTE[k % PALETTE.length]
        return { id: uid(6), name: o.name, color, ...(o.group ? { group: o.group } : {}) }
      })
    return def
  })
  // A status column needs every group to be useful on a board: a missing one is added
  for (const p of schema) {
    if (p.type !== 'status' || !p.options) continue
    for (const g of ['todo', 'doing', 'done'] as StatusGroup[]) {
      if (!p.options.some((o) => o.group === g)) p.options.push({ id: uid(6), name: t(g === 'todo' ? 's_todo' : g === 'doing' ? 's_doing' : 's_done'), color: g === 'done' ? 'green' : g === 'doing' ? 'blue' : 'gray', group: g })
    }
  }
  const rows = db.rows.map((row) => {
    const props: Record<string, PropValue> = {}
    schema.forEach((p, i) => {
      if (i === 0) return
      const raw = (row.values[i] ?? '').trim()
      if (!raw) return
      switch (p.type) {
        case 'checkbox':
          props[p.id] = TRUE.has(raw.toLowerCase())
          break
        case 'number':
          props[p.id] = toNumber(raw)
          break
        case 'date': {
          const d = parseDateValue(raw)
          if (d) props[p.id] = d
          break
        }
        case 'select':
        case 'status': {
          const o = p.options?.find((x) => x.name === raw)
          if (o) props[p.id] = o.id
          break
        }
        case 'multi_select':
          props[p.id] = raw
            .split(', ')
            .map((x) => p.options?.find((o) => o.name === x.trim())?.id)
            .filter((x): x is string => !!x)
          break
        default:
          props[p.id] = raw
      }
    })
    return { row, props }
  })
  return { schema, rows }
}

// ---------------------------------------------------------------- Google Keep (Takeout)

interface KeepNote {
  title?: string
  textContent?: string
  listContent?: { text?: string; isChecked?: boolean }[]
  labels?: { name?: string }[]
  attachments?: { filePath?: string; mimetype?: string }[]
  annotations?: { url?: string; title?: string }[]
  isTrashed?: boolean
  isPinned?: boolean
  isArchived?: boolean
  userEditedTimestampUsec?: number
}

function isKeepNote(e: Entry): boolean {
  if (e.data.length > 5_000_000) return false
  const head = text(e.data.subarray(0, 4000))
  return /"(textContent|listContent)"\s*:/.test(head) || (/"isTrashed"\s*:/.test(head) && /"userEditedTimestampUsec"/.test(head))
}

function planKeep(entries: Entry[], plan: ImportPlan): PlanPage[] {
  const notes: { e: Entry; n: KeepNote }[] = []
  for (const e of entries) {
    try {
      const n = JSON.parse(text(e.data)) as KeepNote
      if (!n.isTrashed) notes.push({ e, n })
    } catch {
      plan.skipped.push(e.path)
    }
  }
  notes.sort((a, b) => Number(!!b.n.isPinned) - Number(!!a.n.isPinned) || (b.n.userEditedTimestampUsec ?? 0) - (a.n.userEditedTimestampUsec ?? 0))
  const page = ({ e, n }: { e: Entry; n: KeepNote }): PlanPage => {
    const firstLine = (n.textContent ?? n.listContent?.[0]?.text ?? '').split('\n')[0].trim()
    const title = n.title?.trim() || (firstLine.length > 60 ? firstLine.slice(0, 59) + '…' : firstLine) || t('untitled')
    return {
      key: e.path,
      title,
      icon: n.isPinned ? '📌' : undefined,
      from: e.path,
      children: [],
      body: (ctx) => {
        const blocks: JSONContent[] = []
        const labels = (n.labels ?? []).map((l) => l.name?.trim()).filter(Boolean)
        if (labels.length) blocks.push({ type: 'paragraph', content: [{ type: 'text', text: t('impLabels', { labels: labels.join('، ') }), marks: [{ type: 'italic' }] }] })
        for (const a of n.attachments ?? []) {
          const path = a.filePath ? ctx.image(a.filePath, true) : null
          if (path) blocks.push({ type: 'image', attrs: { src: ASSET + path } })
        }
        // A note whose first line is its title doesn't say it twice
        let body = n.textContent ?? ''
        if (!n.title?.trim() && body.split('\n')[0].trim() === title) body = body.split('\n').slice(1).join('\n')
        if (body.trim()) blocks.push(...textBlocks(body.replace(/^\n+|\n+$/g, '')))
        if (n.listContent?.length)
          blocks.push({
            type: 'taskList',
            content: n.listContent.map((it) => ({ type: 'taskItem', attrs: { checked: !!it.isChecked }, content: [{ type: 'paragraph', content: it.text?.trim() ? linkify(it.text.trim()) : undefined }] })),
          })
        for (const a of n.annotations ?? []) {
          if (a.url) blocks.push({ type: 'paragraph', content: [{ type: 'text', text: a.title?.trim() || a.url, marks: [{ type: 'link', attrs: { href: a.url } }] }] })
        }
        return finishDoc({ type: 'doc', content: blocks.length ? blocks : [{ type: 'paragraph' }] }, ctx)
      },
    }
  }
  const live = notes.filter((x) => !x.n.isArchived).map(page)
  const archived = notes.filter((x) => x.n.isArchived).map(page)
  if (archived.length) live.push({ key: 'keep:archive', title: t('impArchived'), icon: '🗄️', children: archived })
  return live
}

// ---------------------------------------------------------------- Evernote (.enex)

function planEnex(entry: Entry, plan: ImportPlan): PlanPage {
  const xml = new DOMParser().parseFromString(text(entry.data), 'application/xml')
  const notebook: PlanPage = { key: entry.path, title: cleanName(stem(entry.path)), icon: '📓', children: [] }
  if (xml.querySelector('parsererror')) {
    plan.skipped.push(entry.path)
    return notebook
  }
  ;[...xml.getElementsByTagName('note')].forEach((note, i) => {
    const title = note.getElementsByTagName('title')[0]?.textContent?.trim() || t('untitled')
    const tags = [...note.getElementsByTagName('tag')].map((x) => x.textContent?.trim()).filter(Boolean)
    // Its pictures, by the MD5 of their bytes (how the note refers to them)
    const media = new Map<string, string>()
    for (const r of note.getElementsByTagName('resource')) {
      const type = r.getElementsByTagName('mime')[0]?.textContent?.trim() ?? ''
      const b64 = r.getElementsByTagName('data')[0]?.textContent ?? ''
      if (!type.startsWith('image/') || !b64) continue
      try {
        const data = fromBase64(b64)
        const hash = md5(data)
        const path = `${entry.path}#${hash}`
        plan.assets.set(path, { data, type })
        media.set(hash, path)
      } catch {
        /* a picture that can't be read is left out */
      }
    }
    const enml = note.getElementsByTagName('content')[0]?.textContent ?? ''
    notebook.children.push({
      key: `${entry.path}#${i}`,
      title,
      children: [],
      body: (ctx) => {
        const dom = new DOMParser().parseFromString(enmlToHtml(enml, media), 'text/html')
        const doc = finishDoc(htmlToJson(dom.body), ctx)
        if (tags.length) doc.content = [{ type: 'paragraph', content: [{ type: 'text', text: t('impLabels', { labels: tags.join('، ') }), marks: [{ type: 'italic' }] }] }, ...(doc.content ?? [])]
        return doc
      },
    })
  })
  return notebook
}

/** Evernote's note markup as plain HTML: its pictures, and its check boxes as tasks. */
function enmlToHtml(enml: string, media: Map<string, string>): string {
  // <en-media …/> and <en-todo …/> close themselves, which an HTML reader doesn't know
  const html = enml
    .replace(/<\?xml[^>]*>/, '')
    .replace(/<!DOCTYPE[^>]*>/i, '')
    .replace(/<(en-media|en-todo|en-crypt)([^>]*)\/>/g, '<$1$2></$1>')
  const dom = new DOMParser().parseFromString(html, 'text/html')
  for (const m of [...dom.querySelectorAll('en-media')]) {
    const path = media.get((m.getAttribute('hash') ?? '').toLowerCase())
    if (path) {
      const img = dom.createElement('img')
      img.setAttribute('src', ASSET + path)
      m.replaceWith(img)
    } else m.remove()
  }
  // A line with a check box is a task
  for (const todo of [...dom.querySelectorAll('en-todo')]) {
    const line = todo.closest('div, p, li') ?? todo.parentElement
    const checked = todo.getAttribute('checked') === 'true'
    todo.remove()
    if (!line || line === dom.body) continue
    const li = dom.createElement('li')
    li.setAttribute('data-type', 'taskItem')
    li.setAttribute('data-checked', String(checked))
    const p = dom.createElement('p')
    p.append(...line.childNodes)
    li.append(p)
    const prev = line.previousElementSibling
    if (prev?.getAttribute('data-type') === 'taskList') {
      prev.append(li)
      line.remove()
    } else {
      const ul = dom.createElement('ul')
      ul.setAttribute('data-type', 'taskList')
      ul.append(li)
      line.replaceWith(ul)
    }
  }
  dom.querySelectorAll('en-crypt').forEach((e) => e.remove())
  const note = dom.querySelector('en-note')
  return note ? note.innerHTML : dom.body.innerHTML
}

// ---------------------------------------------------------------- HTML

let schema: ReturnType<typeof getSchema> | null = null
const pmSchema = () => (schema ??= getSchema(schemaExtensions()))

function htmlToJson(el: HTMLElement): JSONContent {
  return PMDOMParser.fromSchema(pmSchema()).parse(el).toJSON() as JSONContent
}

// ---------------------------------------------------------------- making the pages

const breathe = () => new Promise<void>((r) => setTimeout(r, 0))

/** What every page's links and pictures are looked up in. */
function contextFor(plan: ImportPlan, page: PlanPage): LinkContext {
  const from = page.from ?? ''
  const tryPath = (p: string) => plan.byPath.get(p) ?? plan.byPath.get(p + '.md') ?? null
  return {
    page: (href) => tryPath(resolveLink(from, href)) ?? tryPath(normalize(safeDecode(href.split('#')[0]))),
    wiki: (name) => {
      const n = name.trim()
      return tryPath(normalize(n)) ?? plan.byName.get(n.toLowerCase()) ?? plan.byName.get(baseName(n).toLowerCase()) ?? null
    },
    image: (src, embed) => {
      if (src.startsWith(ASSET)) return src.slice(ASSET.length)
      const name = baseName(safeDecode(src)).toLowerCase()
      if (embed) return plan.assets.has(normalize(src)) ? normalize(src) : (plan.imageByName.get(name) ?? null)
      const rel = resolveLink(from, src)
      if (plan.assets.has(rel)) return rel
      const fromRoot = normalize(safeDecode(src))
      if (plan.assets.has(fromRoot)) return fromRoot
      // Obsidian finds a picture by its name wherever it is in the vault
      return plan.imageByName.get(name) ?? null
    },
    children: new Set(page.children.map((c) => c.key)),
  }
}

/** Write the ids of the new pages and the stored pictures into a page's content. */
async function resolve(doc: JSONContent, ids: Map<string, string>, plan: ImportPlan, pictures: Map<string, string | null>, tally: { images: number; missing: number }): Promise<JSONContent> {
  const visit = async (n: JSONContent): Promise<JSONContent | null> => {
    if ((n.type === 'pageMention' || n.type === 'pageLink') && typeof n.attrs?.pageId === 'string' && n.attrs.pageId.startsWith(PAGE)) {
      const id = ids.get(n.attrs.pageId.slice(PAGE.length))
      return id ? { ...n, attrs: { ...n.attrs, pageId: id } } : null
    }
    if (n.type === 'image' && typeof n.attrs?.src === 'string' && n.attrs.src.startsWith(ASSET)) {
      const path = n.attrs.src.slice(ASSET.length)
      if (!pictures.has(path)) {
        const a = plan.assets.get(path)
        let src: string | null = null
        if (a) {
          try {
            src = await importImage(blobOf(a.data, a.type))
          } catch {
            src = null
          }
        }
        pictures.set(path, src)
        if (src) tally.images++
      }
      const src = pictures.get(path)
      if (!src) {
        tally.missing++
        return { type: 'paragraph', content: [{ type: 'text', text: `🖼️ ${baseName(path.split('#')[0])}`, marks: [{ type: 'italic' }] }] }
      }
      return { ...n, attrs: { ...n.attrs, src } }
    }
    if (n.type === 'image' && typeof n.attrs?.src === 'string' && n.attrs.src.startsWith('data:image/')) {
      try {
        const [head, b64] = n.attrs.src.split(',', 2)
        const src = await importImage(blobOf(fromBase64(b64), head.slice(5).split(';')[0]))
        tally.images++
        return { ...n, attrs: { ...n.attrs, src } }
      } catch {
        return null
      }
    }
    if (!n.content) return n
    const content: JSONContent[] = []
    for (const c of n.content) {
      const r = await visit(c)
      if (r) content.push(r)
    }
    // a block left empty (all it held is gone) keeps a line
    if (!content.length && n.type !== 'paragraph' && n.type !== 'heading' && n.type !== 'doc') return { ...n, content: [{ type: 'paragraph' }] }
    return { ...n, content }
  }
  return (await visit(doc)) ?? { type: 'doc', content: [{ type: 'paragraph' }] }
}

/** Content the editor can't take as it is (an odd export): its text, line by line. */
function safeContent(doc: JSONContent): JSONContent {
  try {
    pmSchema().nodeFromJSON(doc).check()
    return doc
  } catch {
    const lines: string[] = []
    const walk = (n: JSONContent, line: string[]): void => {
      if (n.type === 'text') line.push(n.text ?? '')
      else if (n.type === 'hardBreak') line.push('\n')
      else if (n.content) {
        const block = !['paragraph', 'heading'].includes(n.type ?? '') ? null : ([] as string[])
        n.content.forEach((c) => walk(c, block ?? line))
        if (block) lines.push(block.join(''))
      }
    }
    walk(doc, [])
    return { type: 'doc', content: lines.length ? lines.flatMap((l) => textBlocks(l)) : [{ type: 'paragraph' }] }
  }
}

export async function runImport(plan: ImportPlan, onProgress: (done: number, total: number) => void): Promise<ImportResult> {
  const w = ws()
  const ids = new Map<string, string>()
  const jobs: { id: string; page: PlanPage; body: Body }[] = []
  const result: ImportResult = { rootId: '', pages: 0, databases: 0, rows: 0, images: 0, missingImages: 0, failed: [] }
  const s = useStore.getState().settings
  const day = (s.calendar === 'hijri' ? formatHijri : formatGregorian)(todayIso(), { lang: s.lang, numerals: s.numerals })

  // 1. Every page, table and row, in one change (the page list is redrawn once)
  w.doc.transact(() => {
    const one = plan.pages.length === 1 && !plan.pages[0].db ? plan.pages[0] : null
    const root = one ? null : w.createPage({ title: t('impRootTitle', { source: sourceName(plan.source), date: day }), icon: '📥', parentId: null })
    const make = (p: PlanPage, parentId: string | null) => {
      if (p.db) {
        const { schema, rows } = buildDatabase(p.db)
        const dbId = createDatabase(w, { parentId, inline: false, title: p.title, icon: p.icon, schema, views: [newView('table', schema)] })
        ids.set(p.key, dbId)
        result.databases++
        for (const { row, props } of rows) {
          const id = w.createPage({ type: 'row', parentId: dbId, title: row.title, props })
          result.rows++
          if (row.key) ids.set(row.key, id)
          if (row.body) jobs.push({ id, page: { key: row.key ?? id, title: row.title, from: row.key ?? undefined, children: [] }, body: row.body })
        }
        // pages kept in the table's folder that are not rows sit next to it
        p.children.forEach((c) => make(c, parentId))
        return
      }
      const id = w.createPage({ title: p.title, icon: p.icon ?? '', parentId })
      ids.set(p.key, id)
      result.pages++
      if (p.body) jobs.push({ id, page: p, body: p.body })
      p.children.forEach((c) => make(c, id))
    }
    if (one) make(one, null)
    else plan.pages.forEach((p) => make(p, root))
    result.rootId = root ?? ids.get(one!.key)!
  }, ORIGIN_SYSTEM)

  // 2. What each page says, with its links and pictures
  const pictures = new Map<string, string | null>()
  const tally = { images: 0, missing: 0 }
  let done = 0
  onProgress(0, jobs.length)
  for (const job of jobs) {
    try {
      const raw = job.body(contextFor(plan, job.page))
      const doc = safeContent(await resolve(raw, ids, plan, pictures, tally))
      await setPageContent(job.id, doc)
    } catch {
      result.failed.push(job.page.title)
    }
    onProgress(++done, jobs.length)
    if (done % 4 === 0) await breathe()
  }
  result.images = tally.images
  result.missingImages = tally.missing
  return result
}

