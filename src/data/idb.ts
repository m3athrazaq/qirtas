// One IndexedDB database holds every Yjs document's update log, images and small settings.

const DB_NAME = 'qirtas'
const DB_VERSION = 1

let dbPromise: Promise<IDBDatabase> | null = null

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('updates')) {
        const s = db.createObjectStore('updates', { keyPath: 'id', autoIncrement: true })
        s.createIndex('docId', 'docId')
      }
      if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'key' })
      if (!db.objectStoreNames.contains('outbox')) {
        const o = db.createObjectStore('outbox', { keyPath: 'id', autoIncrement: true })
        o.createIndex('docId', 'docId')
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

function reqP<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}

export interface StoredUpdate {
  id?: number
  docId: string
  update: Uint8Array
}

export async function loadUpdates(docId: string): Promise<StoredUpdate[]> {
  const db = await openDb()
  const tx = db.transaction('updates', 'readonly')
  const idx = tx.objectStore('updates').index('docId')
  return reqP(idx.getAll(IDBKeyRange.only(docId))) as Promise<StoredUpdate[]>
}

export async function appendUpdate(docId: string, update: Uint8Array): Promise<void> {
  const db = await openDb()
  const tx = db.transaction('updates', 'readwrite')
  tx.objectStore('updates').add({ docId, update })
  await done(tx)
}

/** Replace all stored updates of a doc by a single merged update (compaction). */
export async function replaceUpdates(docId: string, merged: Uint8Array, upToId: number): Promise<void> {
  const db = await openDb()
  const tx = db.transaction('updates', 'readwrite')
  const store = tx.objectStore('updates')
  const idx = store.index('docId')
  const cursorReq = idx.openCursor(IDBKeyRange.only(docId))
  cursorReq.onsuccess = () => {
    const c = cursorReq.result
    if (!c) return
    if ((c.value as StoredUpdate).id! <= upToId) c.delete()
    c.continue()
  }
  store.add({ docId, update: merged })
  await done(tx)
}

export async function deleteDocUpdates(docId: string): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(['updates', 'outbox'], 'readwrite')
  for (const name of ['updates', 'outbox']) {
    const idx = tx.objectStore(name).index('docId')
    const cursorReq = idx.openCursor(IDBKeyRange.only(docId))
    cursorReq.onsuccess = () => {
      const c = cursorReq.result
      if (!c) return
      c.delete()
      c.continue()
    }
  }
  await done(tx)
}

export async function allDocIds(): Promise<string[]> {
  const db = await openDb()
  const tx = db.transaction('updates', 'readonly')
  const keys = await reqP(tx.objectStore('updates').index('docId').getAllKeys())
  const ids = new Set<string>()
  // getAllKeys on an index returns primary keys; fetch values lazily instead
  if (keys.length) {
    const all = (await reqP(tx.objectStore('updates').getAll())) as StoredUpdate[]
    all.forEach((u) => ids.add(u.docId))
  }
  return [...ids]
}

export async function dumpAll(): Promise<StoredUpdate[]> {
  const db = await openDb()
  const tx = db.transaction('updates', 'readonly')
  return (await reqP(tx.objectStore('updates').getAll())) as StoredUpdate[]
}

// ---- assets (images) ----
export interface StoredAsset {
  id: string
  blob: Blob
  type: string
  name?: string
  createdAt: number
  remoteUrl?: string
}

export async function putAsset(a: StoredAsset): Promise<void> {
  const db = await openDb()
  const tx = db.transaction('assets', 'readwrite')
  tx.objectStore('assets').put(a)
  await done(tx)
}

export async function getAsset(id: string): Promise<StoredAsset | undefined> {
  const db = await openDb()
  const tx = db.transaction('assets', 'readonly')
  return reqP(tx.objectStore('assets').get(id)) as Promise<StoredAsset | undefined>
}

export async function allAssets(): Promise<StoredAsset[]> {
  const db = await openDb()
  const tx = db.transaction('assets', 'readonly')
  return reqP(tx.objectStore('assets').getAll()) as Promise<StoredAsset[]>
}

// ---- key/value ----
export async function kvGet<T = unknown>(key: string): Promise<T | undefined> {
  const db = await openDb()
  const tx = db.transaction('kv', 'readonly')
  const row = (await reqP(tx.objectStore('kv').get(key))) as { key: string; value: T } | undefined
  return row?.value
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  const db = await openDb()
  const tx = db.transaction('kv', 'readwrite')
  tx.objectStore('kv').put({ key, value })
  await done(tx)
}

// ---- outbox (pending changes to push to the server) ----
export interface OutboxItem {
  id?: number
  docId: string
  update: Uint8Array
}

export async function outboxAdd(docId: string, update: Uint8Array): Promise<void> {
  const db = await openDb()
  const tx = db.transaction('outbox', 'readwrite')
  tx.objectStore('outbox').add({ docId, update })
  await done(tx)
}

export async function outboxAll(): Promise<OutboxItem[]> {
  const db = await openDb()
  const tx = db.transaction('outbox', 'readonly')
  return reqP(tx.objectStore('outbox').getAll()) as Promise<OutboxItem[]>
}

export async function outboxClear(): Promise<void> {
  const db = await openDb()
  const tx = db.transaction('outbox', 'readwrite')
  tx.objectStore('outbox').clear()
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function outboxDelete(ids: number[]): Promise<void> {
  if (!ids.length) return
  const db = await openDb()
  const tx = db.transaction('outbox', 'readwrite')
  const s = tx.objectStore('outbox')
  ids.forEach((id) => s.delete(id))
  await done(tx)
}

export async function wipeAll(): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(['updates', 'assets', 'kv', 'outbox'], 'readwrite')
  ;['updates', 'assets', 'kv', 'outbox'].forEach((s) => tx.objectStore(s).clear())
  await done(tx)
}
