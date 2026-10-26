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
  if (!flushTimer) flushTimer = setTimeout(flushWrites, 250)
}

export async function flushWrites() {
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = null
  const batch = [...pending.entries()]
  pending.clear()
  await Promise.all(
    batch.map(([docId, updates]) => appendUpdate(docId, updates.length === 1 ? updates[0] : Y.mergeUpdates(updates))),
  )
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
  await deleteDocUpdates(docId)
}

export function resetDocs() {
  destroyListeners.forEach((fn) => fn(null))
  docs.forEach((e) => e.doc.destroy())
  docs.clear()
  pending.clear()
}

export const pageDocId = (pageId: string) => `pg:${pageId}`
export const workspaceDocId = (wsId: string) => `ws:${wsId}`
