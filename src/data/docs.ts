// Loads Yjs documents from IndexedDB, persists their changes, and keeps tabs in sync.
import * as Y from 'yjs'
import { appendUpdate, deleteDocUpdates, loadUpdates, replaceUpdates } from './idb'

export const ORIGIN_IDB = 'idb'
export const ORIGIN_TAB = 'tab'
export const ORIGIN_REMOTE = 'remote'
export const ORIGIN_TEMPLATE = 'template'

interface Entry {
  doc: Y.Doc
  ready: Promise<Y.Doc>
  loaded: boolean
}

const docs = new Map<string, Entry>()
const pending = new Map<string, Uint8Array[]>()
/** Docs deleted for good in this session: a write that failed for one of them is not retried. */
const destroyed = new Set<string>()
let flushTimer: ReturnType<typeof setTimeout> | null = null

const bc: BroadcastChannel | null = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('qirtas-docs') : null
bc?.addEventListener('message', (e: MessageEvent) => {
  const { docId, update } = e.data as { docId: string; update: Uint8Array }
  const entry = docs.get(docId)
  if (entry?.loaded) Y.applyUpdate(entry.doc, update, ORIGIN_TAB)
})

type SyncHook = (docId: string, update: Uint8Array) => void
let syncHook: SyncHook | null = null
/** The sync engine registers here to receive every local change (for the outbox). */
export function setSyncHook(fn: SyncHook | null) {
  syncHook = fn
}

const destroyListeners = new Set<(docId: string | null) => void>()
/** Notified when a doc is destroyed (`null`: every doc, when the workspace is reset). */
export function onDocDestroy(fn: (docId: string | null) => void) {
  destroyListeners.add(fn)
  return () => destroyListeners.delete(fn)
}

const updateListeners = new Set<(docId: string, doc: Y.Doc, origin: unknown) => void>()
/** Notified after every change to a loaded doc, whoever made it (not while it loads from the device). */
export function onDocUpdate(fn: (docId: string, doc: Y.Doc, origin: unknown) => void) {
  updateListeners.add(fn)
  return () => updateListeners.delete(fn)
}

/** Apply a change that came from outside this tab (the server, a backup).
 *  Parts of it that build on an earlier change which hasn't arrived yet are held back by Yjs in
 *  memory, without any event. They must reach the device too, or a reload would lose them for good:
 *  the update itself is stored and waits there with the rest. */
export function applyOutside(docId: string, doc: Y.Doc, update: Uint8Array, origin: unknown) {
  Y.applyUpdate(doc, update, origin)
  const store = doc.store as unknown as { pendingStructs: unknown; pendingDs: unknown }
  if (store.pendingStructs || store.pendingDs) queueWrite(docId, update)
}

const docListeners = new Set<(docId: string) => void>()
/** Notified when a doc finishes loading (used by the sync engine). */
export function onDocLoaded(fn: (docId: string) => void) {
  docListeners.add(fn)
  return () => docListeners.delete(fn)
}

function queueWrite(docId: string, update: Uint8Array) {
  const list = pending.get(docId) ?? []
  list.push(update)
  pending.set(docId, list)
  if (!flushTimer) flushTimer = setTimeout(() => void flushWrites(), 250)
}

// ---- saving must not fail silently
let saveFailures = 0
let flushing: Promise<void> | null = null
const healthListeners = new Set<(ok: boolean, error?: unknown) => void>()
/** Told when writing to the device starts failing (storage full, blocked…) and when it works again. */
export function onSaveHealth(fn: (ok: boolean, error?: unknown) => void) {
  healthListeners.add(fn)
  return () => healthListeners.delete(fn)
}

/** Changes made in memory that are not on the device yet (they still belong in a backup). */
export function unsavedUpdates(): Map<string, Uint8Array[]> {
  return new Map([...pending].map(([id, list]) => [id, [...list]]))
}

/** True while some change could not be written to the device (see onSaveHealth). */
export function hasUnsaved(): boolean {
  return pending.size > 0
}

/** Write queued changes to the device. Never rejects: what fails stays queued and is retried. */
export function flushWrites(): Promise<void> {
  // One writer at a time: a second call waits for the first, then writes what came in meanwhile
  const mine: Promise<void> = (flushing ?? Promise.resolve()).then(doFlush, doFlush).finally(() => {
    if (flushing === mine) flushing = null
  })
  flushing = mine
  return mine
}

async function writeOne(docId: string, updates: Uint8Array[]) {
  let merged: Uint8Array | null = null
  if (updates.length === 1) merged = updates[0]
  else {
    try {
      merged = Y.mergeUpdates(updates)
    } catch {
      merged = null // can't be merged: store them one by one
    }
  }
  if (merged) await appendUpdate(docId, merged)
  else for (const u of updates) await appendUpdate(docId, u)
}

async function doFlush() {
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = null
  const batch = [...pending.entries()]
  pending.clear()
  if (!batch.length) return
  const results = await Promise.allSettled(batch.map(([docId, updates]) => writeOne(docId, updates)))
  let failed = false
  let error: unknown
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') return
    failed = true
    error = r.reason
    // Not written: keep it (ahead of anything newer) and try again
    const [docId, updates] = batch[i]
    if (!destroyed.has(docId)) pending.set(docId, [...updates, ...(pending.get(docId) ?? [])])
  })
  if (failed) {
    saveFailures++
    healthListeners.forEach((fn) => fn(false, error))
    if (!flushTimer && pending.size) flushTimer = setTimeout(() => void flushWrites(), Math.min(30000, 500 * 2 ** Math.min(saveFailures, 10)))
  } else if (saveFailures) {
    saveFailures = 0
    healthListeners.forEach((fn) => fn(true))
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => void flushWrites())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushWrites()
  })
}

export function getDoc(docId: string): Promise<Y.Doc> {
  const existing = docs.get(docId)
  if (existing) return existing.ready
  destroyed.delete(docId)
  const doc = new Y.Doc({ guid: docId })
  const entry: Entry = { doc, ready: Promise.resolve(doc), loaded: false }
  entry.ready = (async () => {
    const stored = await loadUpdates(docId)
    if (stored.length) {
      const merged = stored.length === 1 ? stored[0].update : Y.mergeUpdates(stored.map((s) => s.update))
      Y.applyUpdate(doc, merged, ORIGIN_IDB)
      if (stored.length > 40) {
        const maxId = Math.max(...stored.map((s) => s.id ?? 0))
        void replaceUpdates(docId, Y.encodeStateAsUpdate(doc), maxId)
      }
    }
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === ORIGIN_IDB) return
      if (origin !== ORIGIN_TAB) {
        queueWrite(docId, update)
        bc?.postMessage({ docId, update })
      }
      if (origin !== ORIGIN_REMOTE && origin !== ORIGIN_TAB) syncHook?.(docId, update)
      updateListeners.forEach((fn) => fn(docId, doc, origin))
    })
    entry.loaded = true
    docListeners.forEach((fn) => fn(docId))
    return doc
  })()
  docs.set(docId, entry)
  return entry.ready
}

/** Returns the doc only if it is already loaded. */
export function peekDoc(docId: string): Y.Doc | null {
  const e = docs.get(docId)
  return e?.loaded ? e.doc : null
}

export function loadedDocIds(): string[] {
  return [...docs.entries()].filter(([, e]) => e.loaded).map(([id]) => id)
}

export async function destroyDoc(docId: string) {
  destroyListeners.forEach((fn) => fn(docId))
  const e = docs.get(docId)
  if (e) {
    e.doc.destroy()
    docs.delete(docId)
  }
  pending.delete(docId)
  destroyed.add(docId)
  await deleteDocUpdates(docId)
}

export function resetDocs() {
  destroyListeners.forEach((fn) => fn(null))
  docs.forEach((e) => e.doc.destroy())
  docs.clear()
  pending.clear()
  destroyed.clear()
}

export const pageDocId = (pageId: string) => `pg:${pageId}`
export const workspaceDocId = (wsId: string) => `ws:${wsId}`
