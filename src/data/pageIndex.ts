// What the pages contain, gathered in one place: tasks (with their dates and reminders), reminders,
// and links to other pages. It is worked out on this device from the pages themselves (never synced),
// kept up to date as pages change here or arrive from other devices, and cached between starts.
import type { JSONContent } from '@tiptap/core'
import { yXmlFragmentToProsemirrorJSON } from '@tiptap/y-tiptap'
import * as Y from 'yjs'
import { create } from 'zustand'
import { getDoc, onDocDestroy, onDocLoaded, onDocUpdate, pageDocId, peekDoc } from './docs'
import { kvGet, kvSet, loadUpdates } from './idb'
import { useStore } from './store'
import type { PageMeta } from './types'

export interface IndexedTask {
  /** Position among the page's tasks, in reading order (how a task is found again to tick it). */
  n: number
  text: string
  checked: boolean
  /** The date written in the task (a date chip), if any. */
  due: string | null
  reminderId: string | null
  remindAt: number | null
}

export interface IndexedReminder {
  /** The reminder's own id; `key` also tells two reminders apart that were saved before ids existed. */
  id: string | null
  key: string
  at: number
  /** Marked done, or inside a ticked task. */
  done: boolean
  text: string
  /** The task it sits in, if any. */
  task: number | null
}

export interface PageIndexEntry {
  /** The page's "last changed" when this was worked out. */
  stamp: number
  tasks: IndexedTask[]
  reminders: IndexedReminder[]
  links: string[]
}

interface IndexState {
  entries: Record<string, PageIndexEntry>
  /** The first pass over every page has finished. */
  ready: boolean
}

export const usePageIndex = create<IndexState>(() => ({ entries: {}, ready: false }))

const INLINE_ATOMS = new Set(['dateChip', 'reminder', 'pageMention', 'hardBreak'])

function inlineInfo(block: JSONContent) {
  let text = ''
  const dates: string[] = []
  const reminders: { id: string | null; at: number; done: boolean }[] = []
  const links: string[] = []
  for (const c of block.content ?? []) {
    if (c.type === 'text') text += c.text ?? ''
    else if (c.type === 'dateChip' && c.attrs?.date) dates.push(c.attrs.date as string)
    else if (c.type === 'reminder' && c.attrs?.at) reminders.push({ id: (c.attrs.id as string) ?? null, at: Number(c.attrs.at), done: !!c.attrs.done })
    else if (c.type === 'pageMention' && c.attrs?.pageId) links.push(c.attrs.pageId as string)
    else if (c.type === 'hardBreak') text += ' '
  }
  return { text: text.replace(/\s+/g, ' ').trim(), dates, reminders, links }
}

const isTextBlock = (n: JSONContent) => !!n.content?.length && n.content.every((c) => c.type === 'text' || INLINE_ATOMS.has(c.type ?? ''))

/** Tasks, reminders and links of one page's content. */
export function indexContent(root: JSONContent): Omit<PageIndexEntry, 'stamp'> {
  const tasks: IndexedTask[] = []
  const reminders: IndexedReminder[] = []
  const links = new Set<string>()
  let n = 0
  let r = 0
  const visit = (node: JSONContent) => {
    if (node.type === 'pageLink' && node.attrs?.pageId) links.add(node.attrs.pageId as string)
    if (node.type === 'taskItem') {
      const [first, ...rest] = node.content ?? []
      const info = first ? inlineInfo(first) : { text: '', dates: [], reminders: [], links: [] }
      const checked = !!node.attrs?.checked
      const rem = info.reminders.find((x) => !x.done) ?? info.reminders[0]
      const task: IndexedTask = { n: n++, text: info.text, checked, due: info.dates[0] ?? null, reminderId: rem?.id ?? null, remindAt: rem?.at ?? null }
      tasks.push(task)
      info.reminders.forEach((x) => reminders.push({ id: x.id, key: x.id ?? `#${r}`, at: x.at, done: x.done || checked, text: info.text, task: task.n }) && r++)
      info.links.forEach((l) => links.add(l))
      rest.forEach(visit)
      return
    }
    if (isTextBlock(node)) {
      const info = inlineInfo(node)
      info.reminders.forEach((x) => reminders.push({ id: x.id, key: x.id ?? `#${r}`, at: x.at, done: x.done, text: info.text, task: null }) && r++)
      info.links.forEach((l) => links.add(l))
      return
    }
    node.content?.forEach(visit)
  }
  visit(root)
  return { tasks, reminders, links: [...links] }
}

function indexDoc(doc: Y.Doc): Omit<PageIndexEntry, 'stamp'> {
  return indexContent(yXmlFragmentToProsemirrorJSON(doc.getXmlFragment('default')) as JSONContent)
}

const same = (a: Omit<PageIndexEntry, 'stamp'>, b: Omit<PageIndexEntry, 'stamp'>) =>
  JSON.stringify([a.tasks, a.reminders, a.links]) === JSON.stringify([b.tasks, b.reminders, b.links])

/** During the first pass, entries are collected here and published a few dozen at a time (one
 *  store update per page would redraw the lists for every page of a large workspace). */
let batch: Record<string, PageIndexEntry> | null = null

function flushBatch() {
  if (!batch || !Object.keys(batch).length) return
  const add = batch
  batch = {}
  usePageIndex.setState((s) => ({ entries: { ...s.entries, ...add } }))
  scheduleSave()
}

function put(pageId: string, doc: Y.Doc) {
  const page = useStore.getState().pages[pageId]
  if (!page) return
  let next: Omit<PageIndexEntry, 'stamp'>
  try {
    next = indexDoc(doc)
  } catch {
    return
  }
  const cur = batch?.[pageId] ?? usePageIndex.getState().entries[pageId]
  const stamp = page.updatedAt
  if (cur && cur.stamp === stamp && same(cur, next)) return
  if (batch) {
    batch[pageId] = { stamp, ...next }
    return
  }
  usePageIndex.setState((s) => ({ entries: { ...s.entries, [pageId]: { stamp, ...next } } }))
  scheduleSave()
}

// ---------------------------------------------------------------- keeping it current

// Pages changed since the index was last saved, noted at once (the save itself waits a moment): a
// page changed by sync just before the app was closed is looked at again at the next start, even
// though its "last changed" (which only follows typed text) didn't move.
const DIRTY_KEY = 'qirtas.pageIndex.dirty'
function readDirty(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(DIRTY_KEY) || '[]') as string[])
  } catch {
    return new Set()
  }
}
function writeDirty(ids: Set<string>) {
  try {
    if (ids.size) localStorage.setItem(DIRTY_KEY, JSON.stringify([...ids]))
    else localStorage.removeItem(DIRTY_KEY)
  } catch {
    /* ignore */
  }
}
function markDirty(pageId: string) {
  const d = readDirty()
  if (d.has(pageId)) return
  d.add(pageId)
  writeDirty(d)
}

const timers = new Map<string, ReturnType<typeof setTimeout>>()
function later(pageId: string) {
  markDirty(pageId)
  const old = timers.get(pageId)
  if (old) clearTimeout(old)
  timers.set(
    pageId,
    setTimeout(() => {
      timers.delete(pageId)
      const doc = peekDoc(pageDocId(pageId))
      if (doc) put(pageId, doc)
    }, 350),
  )
}

/** Index a page right now (after ticking a task from a list, so the list answers at once). */
export function reindexNow(pageId: string) {
  const doc = peekDoc(pageDocId(pageId))
  if (doc) put(pageId, doc)
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
const cacheKey = () => `pageIndex:1:${useStore.getState().ws?.id ?? ''}`
function scheduleSave() {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    void saveNow()
  }, 1500)
}
async function saveNow() {
  if (!useStore.getState().ws) return
  const dirty = readDirty()
  try {
    await kvSet(cacheKey(), usePageIndex.getState().entries)
  } catch {
    return
  }
  // Saved: those pages are up to date in the cache, except the ones still waiting to be read
  const now = readDirty()
  dirty.forEach((id) => !timers.has(id) && now.delete(id))
  writeDirty(now)
}

const breathe = () => new Promise<void>((r) => setTimeout(r, 0))

let started = false
/** Start following the pages. The first pass reads every page whose index is missing or out of date. */
export async function startPageIndex() {
  if (started) return
  started = true
  try {
    const cached = await kvGet<Record<string, PageIndexEntry>>(cacheKey())
    if (cached && typeof cached === 'object') usePageIndex.setState({ entries: cached })
  } catch {
    /* no cache */
  }
  onDocLoaded((docId) => {
    if (docId.startsWith('pg:')) later(docId.slice(3))
  })
  onDocUpdate((docId) => {
    if (docId.startsWith('pg:')) later(docId.slice(3))
  })
  onDocDestroy((docId) => {
    if (docId === null) usePageIndex.setState({ entries: {}, ready: false })
    else if (docId.startsWith('pg:')) drop([docId.slice(3)])
  })
  // Pages that are gone leave the index
  useStore.subscribe((s, prev) => {
    if (s.pages === prev.pages) return
    const gone = Object.keys(usePageIndex.getState().entries).filter((id) => !s.pages[id])
    if (gone.length) drop(gone)
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void saveNow()
  })

  // First pass, a page at a time so the app stays responsive
  const pages = Object.values(useStore.getState().pages).filter((p) => !p.deletedAt && p.type !== 'database')
  const dirty = readDirty()
  let i = 0
  batch = {}
  try {
    for (const p of pages) {
      const cur = usePageIndex.getState().entries[p.id]
      if (cur && cur.stamp === p.updatedAt && !dirty.has(p.id)) continue
      try {
        await indexStored(p.id)
      } catch {
        /* unreadable page: skipped */
      }
      if (++i % 8 === 0) await breathe()
      if (i % 40 === 0) flushBatch()
    }
  } finally {
    flushBatch()
    batch = null
  }
  usePageIndex.setState({ ready: true })
  void saveNow()
}

/** Index a page from what is saved on the device, without keeping it open (a first pass over a large
 *  workspace would otherwise hold every page in memory). */
async function indexStored(pageId: string) {
  const open = peekDoc(pageDocId(pageId))
  if (open) return put(pageId, open)
  const stored = await loadUpdates(pageDocId(pageId))
  const doc = new Y.Doc()
  try {
    if (stored.length) Y.applyUpdate(doc, stored.length === 1 ? stored[0].update : Y.mergeUpdates(stored.map((s) => s.update)))
    put(pageId, doc)
  } finally {
    doc.destroy()
  }
}

function drop(ids: string[]) {
  usePageIndex.setState((s) => {
    const entries = { ...s.entries }
    ids.forEach((id) => delete entries[id])
    return { entries }
  })
  scheduleSave()
}

// ---------------------------------------------------------------- changing a page from a list

function walk(node: Y.XmlFragment | Y.XmlElement, fn: (el: Y.XmlElement) => boolean | void): boolean {
  for (const child of node.toArray()) {
    if (!(child instanceof Y.XmlElement)) continue
    if (fn(child) === true) return true
    if (walk(child, fn)) return true
  }
  return false
}

/** Tick or untick the page's n-th task. `text` guards against the page having changed meanwhile. */
export async function setTaskChecked(pageId: string, n: number, text: string, checked: boolean): Promise<boolean> {
  const doc = await getDoc(pageDocId(pageId))
  const now = indexDoc(doc).tasks[n]
  if (!now || now.text !== text) {
    put(pageId, doc)
    return false
  }
  let i = 0
  let done = false
  doc.transact(() => {
    walk(doc.getXmlFragment('default'), (el) => {
      if (el.nodeName !== 'taskItem') return
      if (i++ !== n) return
      el.setAttribute('checked', checked as unknown as string)
      done = true
      return true
    })
  })
  put(pageId, doc)
  return done
}

/** Mark a reminder done (or not), or move it to another time. */
export async function updateReminder(pageId: string, id: string, patch: { done?: boolean; at?: number }): Promise<boolean> {
  const doc = await getDoc(pageDocId(pageId))
  let done = false
  doc.transact(() => {
    walk(doc.getXmlFragment('default'), (el) => {
      if (el.nodeName !== 'reminder' || el.getAttribute('id') !== id) return
      if (patch.done !== undefined) el.setAttribute('done', patch.done as unknown as string)
      if (patch.at !== undefined) el.setAttribute('at', patch.at as unknown as string)
      done = true
      return true
    })
  })
  put(pageId, doc)
  return done
}

/** Pages that link to this one (a sub-page link or a mention), newest first. */
export function backlinksOf(pageId: string, entries: Record<string, PageIndexEntry>, pages: Record<string, PageMeta>): string[] {
  return Object.keys(entries)
    .filter((id) => id !== pageId && entries[id].links.includes(pageId) && pages[id] && !pages[id].deletedAt)
    .sort((a, b) => (pages[b]?.updatedAt ?? 0) - (pages[a]?.updatedAt ?? 0))
}
