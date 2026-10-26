// Undo and redo for the whole app.
//
// - Every page keeps its own text history for the whole session: it survives leaving the page and
//   coming back, and edits made in the row preview and the full page land in the same history.
// - The workspace keeps a history of structural changes: creating, moving, renaming and deleting
//   pages, and database rows, columns, cells and views.
// - One timeline decides which of the two the next undo reverts, so undo always takes back the
//   most recent thing you did, whatever it was. Changes from other people are never undone.
import type { EditorState } from '@tiptap/pm/state'
import { defaultDeleteFilter, defaultProtectedNodes, redo as yRedo, undo as yUndo, ySyncPluginKey } from '@tiptap/y-tiptap'
import * as Y from 'yjs'
import { onDocDestroy } from './docs'
import { navigate } from './nav'
import { useStore } from './store'

/** Origin for bookkeeping writes (search text, flags, permanent deletes) that undo must skip. */
export const ORIGIN_SYSTEM = 'system'

const SEQ = 'qirtas:seq'
let seq = 0
/** Sequence number of the latest change made by hand; redo items older than it are stale. */
let lastFresh = 0

type Listener = (...args: never[]) => void

/** A page's text history. Editor views attach to it and detach from it; it outlives them. */
export class PageUndoManager extends Y.UndoManager {
  private known = new Set<Listener>()

  constructor(type: Y.XmlFragment) {
    super(type, {
      trackedOrigins: new Set([ySyncPluginKey]),
      deleteFilter: (item) => defaultDeleteFilter(item, defaultProtectedNodes),
      captureTransaction: (tr) => tr.meta.get('addToHistory') !== false,
    })
    // TipTap's Collaboration extension "restores" a manager it thinks a view destroyed when the next
    // view mounts. This manager is never detached, so that restore must not run (it would attach the
    // manager to the document twice and record every change twice).
    Object.defineProperty(this, 'restore', { configurable: true, get: () => undefined, set: () => {} })
  }

  /** Called by editor views as they unmount: the history stays (see dispose). */
  override destroy() {}

  dispose() {
    super.destroy()
  }

  /** Remember the listeners registered so far as the manager's own. */
  markKnown() {
    this._observers.forEach((set) => set.forEach((f: Listener) => this.known.add(f)))
  }

  /** Listeners added since the last call belong to the editor view that just mounted. */
  claimViewListeners(): [string, Listener][] {
    const out: [string, Listener][] = []
    this._observers.forEach((set, name) =>
      set.forEach((f: Listener) => {
        if (this.known.has(f)) return
        this.known.add(f)
        out.push([name, f])
      }),
    )
    return out
  }

  releaseViewListeners(list: [string, Listener][]) {
    for (const [name, f] of list) {
      this.off(name as 'stack-item-added', f as never)
      this.known.delete(f)
    }
  }
}

const pageManagers = new Map<string, PageUndoManager>()
const liveStates = new Map<string, Set<() => EditorState>>()
let wsManager: Y.UndoManager | null = null

function watch(um: Y.UndoManager) {
  um.on('stack-item-added', ({ stackItem, type }) => {
    stackItem.meta.set(SEQ, ++seq)
    if (type === 'undo' && !um.redoing) lastFresh = seq
    scheduleRefresh()
  })
  um.on('stack-item-updated', ({ stackItem }) => {
    // Typing that joins the previous step still counts as the latest change
    stackItem.meta.set(SEQ, ++seq)
    lastFresh = seq
    scheduleRefresh()
  })
  um.on('stack-item-popped', scheduleRefresh)
  um.on('stack-cleared', scheduleRefresh)
}

/** The persistent text history of a page (created on first use). */
export function pageUndoManager(pageId: string, doc: Y.Doc): PageUndoManager {
  let um = pageManagers.get(pageId)
  if (um && um.doc !== doc) {
    um.dispose()
    pageManagers.delete(pageId)
    um = undefined
  }
  if (!um) {
    um = new PageUndoManager(doc.getXmlFragment('default'))
    watch(um)
    um.markKnown()
    pageManagers.set(pageId, um)
  }
  return um
}

/** Editors register how to read their state, so undo from a toolbar can go through the editor. */
export function registerEditorState(pageId: string, get: () => EditorState): () => void {
  let set = liveStates.get(pageId)
  if (!set) liveStates.set(pageId, (set = new Set()))
  set.add(get)
  return () => {
    set!.delete(get)
    if (!set!.size) liveStates.delete(pageId)
  }
}

/** Start recording structural changes (call once the workspace is loaded and seeded). */
export function attachWorkspaceHistory(pages: ConstructorParameters<typeof Y.UndoManager>[0]) {
  wsManager?.destroy()
  // Local changes carry no origin; sync, other tabs, loading and bookkeeping use their own origins.
  wsManager = new Y.UndoManager(pages, { trackedOrigins: new Set([null]), captureTimeout: 600 })
  watch(wsManager)
  scheduleRefresh()
}

function disposePage(pageId: string) {
  pageManagers.get(pageId)?.dispose()
  pageManagers.delete(pageId)
  scheduleRefresh()
}

onDocDestroy((docId) => {
  if (docId === null) {
    pageManagers.forEach((um) => um.dispose())
    pageManagers.clear()
    wsManager?.destroy()
    wsManager = null
    scheduleRefresh()
  } else if (docId.startsWith('pg:')) disposePage(docId.slice(3))
})

// ---------------- the timeline

type StackItem = { meta: Map<unknown, unknown> }
const topSeq = (stack: StackItem[]) => (stack.length ? ((stack[stack.length - 1].meta.get(SEQ) as number | undefined) ?? 0) : 0)

type Candidate = { kind: 'page'; um: PageUndoManager; pageId: string } | { kind: 'ws'; um: Y.UndoManager }

function candidates(pageId: string | null): Candidate[] {
  const out: Candidate[] = []
  const page = pageId ? pageManagers.get(pageId) : undefined
  if (page && pageId) out.push({ kind: 'page', um: page, pageId })
  if (wsManager) out.push({ kind: 'ws', um: wsManager })
  return out
}

function pick(dir: 'undo' | 'redo', pageId: string | null, clearStale: boolean): Candidate | null {
  let best: Candidate | null = null
  let bestSeq = 0
  for (const c of candidates(pageId)) {
    const stack = (dir === 'undo' ? c.um.undoStack : c.um.redoStack) as unknown as StackItem[]
    const s = topSeq(stack)
    if (dir === 'redo' && s <= lastFresh) {
      // Something new was done after these were undone: redoing them now would surprise
      if (clearStale && stack.length) c.um.clear(false, true)
      continue
    }
    if (s > bestSeq) {
      best = c
      bestSeq = s
    }
  }
  return best
}

/** The page whose text history undo can reach: the open preview, else the open page. */
export function historyPageId(): string | null {
  const s = useStore.getState()
  return s.peek ?? (s.route.name === 'page' ? s.route.id : null)
}

function run(dir: 'undo' | 'redo', pageId: string | null, state?: EditorState): boolean {
  const c = pick(dir, pageId, true)
  if (!c) return false
  if (c.kind === 'page') {
    // Through the editor when one is open: it keeps the cursor where the change was
    const st = state ?? [...(liveStates.get(c.pageId) ?? [])][0]?.()
    if (st) (dir === 'undo' ? yUndo : yRedo)(st)
    else c.um[dir]()
  } else {
    c.um[dir]()
    leaveVanishedPage()
  }
  scheduleRefresh()
  return true
}

export const historyUndo = (pageId: string | null = historyPageId(), state?: EditorState) => run('undo', pageId, state)
export const historyRedo = (pageId: string | null = historyPageId(), state?: EditorState) => run('redo', pageId, state)
export const canUndo = (pageId: string | null = historyPageId()) => !!pick('undo', pageId, false)
export const canRedo = (pageId: string | null = historyPageId()) => !!pick('redo', pageId, false)

/** After undoing a structural change, don't leave the screen on a page that no longer exists. */
function leaveVanishedPage() {
  const s = useStore.getState()
  if (s.peek) {
    const row = s.pages[s.peek]
    if (!row || row.deletedAt) useStore.setState({ peek: null })
  }
  if (s.route.name !== 'page') return
  const id = s.route.id
  const page = s.pages[id]
  if (page && !page.deletedAt) return
  // Walk up to the nearest page that still exists
  let parent = page?.parentId ?? null
  while (parent && (!s.pages[parent] || s.pages[parent].deletedAt)) parent = s.pages[parent]?.parentId ?? null
  navigate(parent, { replace: true })
}

let refreshQueued = false
function scheduleRefresh() {
  if (refreshQueued) return
  refreshQueued = true
  queueMicrotask(() => {
    refreshQueued = false
    const pid = historyPageId()
    const next = { canUndo: canUndo(pid), canRedo: canRedo(pid) }
    const cur = useStore.getState()
    if (cur.canUndo !== next.canUndo || cur.canRedo !== next.canRedo) useStore.setState(next)
  })
}

useStore.subscribe((s, prev) => {
  if (s.route !== prev.route || s.peek !== prev.peek) scheduleRefresh()
})
