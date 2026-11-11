// The safety vault: a second IndexedDB database that keeps restore points of every document and the
// version history of each page. Day-to-day use never deletes from it, so a mistake (or a bug in the
// main store) can be taken back from here. A failure in the vault never gets in the way of the app.

const DB_NAME = 'qirtas-vault'
const DB_VERSION = 1

export type SnapshotReason = 'auto' | 'manual' | 'before-restore' | 'before-signin' | 'before-update'

export interface SnapshotMeta {
  id: number
  ts: number
  reason: SnapshotReason
  wsId: string
  wsName: string
  /** Pages that were not in the trash. */
  pages: number
  bytes: number
  hash: string
}

export type VersionReason = 'auto' | 'first' | 'manual' | 'before-restore' | 'backup'

export interface VersionMeta {
  id: number
  pageId: string
  ts: number
  reason: VersionReason
  title: string
  chars: number
  bytes: number
  hash: string
}

let dbPromise: Promise<IDBDatabase> | null = null

function openVault(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('snapshots')) db.createObjectStore('snapshots', { keyPath: 'id', autoIncrement: true })
      if (!db.objectStoreNames.contains('snapshotData')) db.createObjectStore('snapshotData', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('versions')) {
        const s = db.createObjectStore('versions', { keyPath: 'id', autoIncrement: true })
        s.createIndex('pageId', 'pageId')
      }
      if (!db.objectStoreNames.contains('versionData')) db.createObjectStore('versionData', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'key' })
    }
    req.onsuccess = () => {
      const db = req.result
      // Another tab upgrading or deleting the database: let go, reopen on the next call
      db.onversionchange = () => {
        db.close()
        dbPromise = null
      }
      resolve(db)
    }
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new Error('vault blocked'))
  })
  // A failed open must not stick: the next call tries again
  dbPromise.catch(() => (dbPromise = null))
  return dbPromise
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error('aborted'))
  })
}

function reqP<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}

/** FNV-1a over the bytes, with the length: cheap "did anything change" check (not a security hash). */
export function fingerprint(parts: Iterable<Uint8Array>): string {
  let h = 0x811c9dc5
  let len = 0
  for (const u of parts) {
    len += u.length
    for (let i = 0; i < u.length; i++) {
      h ^= u[i]
      h = Math.imul(h, 0x01000193)
    }
  }
  return `${len}:${(h >>> 0).toString(16)}`
}

// ---------------------------------------------------------------- restore points

export async function saveSnapshot(meta: Omit<SnapshotMeta, 'id'>, docs: Map<string, Uint8Array>): Promise<number> {
  const db = await openVault()
  const tx = db.transaction(['snapshots', 'snapshotData'], 'readwrite')
  const finished = done(tx)
  const id = (await reqP(tx.objectStore('snapshots').add(meta))) as number
  tx.objectStore('snapshotData').put({ id, docs: Object.fromEntries(docs) })
  await finished
  return id
}

export async function listSnapshots(): Promise<SnapshotMeta[]> {
  const db = await openVault()
  const all = (await reqP(db.transaction('snapshots', 'readonly').objectStore('snapshots').getAll())) as SnapshotMeta[]
  return all.sort((a, b) => b.ts - a.ts || b.id - a.id)
}

export async function loadSnapshot(id: number): Promise<Map<string, Uint8Array> | null> {
  const db = await openVault()
  const row = (await reqP(db.transaction('snapshotData', 'readonly').objectStore('snapshotData').get(id))) as { docs: Record<string, Uint8Array> } | undefined
  return row ? new Map(Object.entries(row.docs)) : null
}

export async function deleteSnapshots(ids: number[]): Promise<void> {
  if (!ids.length) return
  const db = await openVault()
  const tx = db.transaction(['snapshots', 'snapshotData'], 'readwrite')
  ids.forEach((id) => {
    tx.objectStore('snapshots').delete(id)
    tx.objectStore('snapshotData').delete(id)
  })
  await done(tx)
}

// ---------------------------------------------------------------- page versions

export async function saveVersion(meta: Omit<VersionMeta, 'id'>, update: Uint8Array): Promise<number> {
  const db = await openVault()
  const tx = db.transaction(['versions', 'versionData'], 'readwrite')
  const finished = done(tx)
  const id = (await reqP(tx.objectStore('versions').add(meta))) as number
  tx.objectStore('versionData').put({ id, update })
  await finished
  return id
}

export async function listVersions(pageId: string): Promise<VersionMeta[]> {
  const db = await openVault()
  const idx = db.transaction('versions', 'readonly').objectStore('versions').index('pageId')
  const all = (await reqP(idx.getAll(IDBKeyRange.only(pageId)))) as VersionMeta[]
  return all.sort((a, b) => b.ts - a.ts || b.id - a.id)
}

export async function loadVersion(id: number): Promise<Uint8Array | null> {
  const db = await openVault()
  const row = (await reqP(db.transaction('versionData', 'readonly').objectStore('versionData').get(id))) as { update: Uint8Array } | undefined
  return row?.update ?? null
}

export async function deleteVersions(ids: number[]): Promise<void> {
  if (!ids.length) return
  const db = await openVault()
  const tx = db.transaction(['versions', 'versionData'], 'readwrite')
  ids.forEach((id) => {
    tx.objectStore('versions').delete(id)
    tx.objectStore('versionData').delete(id)
  })
  await done(tx)
}

/** Every page that has versions, with how many (for clean-up of pages that no longer exist). */
export async function versionPages(): Promise<Map<string, VersionMeta[]>> {
  const db = await openVault()
  const all = (await reqP(db.transaction('versions', 'readonly').objectStore('versions').getAll())) as VersionMeta[]
  const out = new Map<string, VersionMeta[]>()
  all.forEach((v) => {
    const l = out.get(v.pageId) ?? []
    l.push(v)
    out.set(v.pageId, l)
  })
  return out
}

// ---------------------------------------------------------------- small values (folder handle, bookkeeping)

export async function vaultGet<T = unknown>(key: string): Promise<T | undefined> {
  const db = await openVault()
  const row = (await reqP(db.transaction('kv', 'readonly').objectStore('kv').get(key))) as { value: T } | undefined
  return row?.value
}

export async function vaultSet(key: string, value: unknown): Promise<void> {
  const db = await openVault()
  const tx = db.transaction('kv', 'readwrite')
  tx.objectStore('kv').put({ key, value })
  await done(tx)
}

/** Everything in the vault goes (used by "erase all data" and when signing out of a synced account). */
export async function wipeVault(): Promise<void> {
  const db = await openVault()
  const names = ['snapshots', 'snapshotData', 'versions', 'versionData', 'kv']
  const tx = db.transaction(names, 'readwrite')
  names.forEach((n) => tx.objectStore(n).clear())
  await done(tx)
}

// ---------------------------------------------------------------- what to keep

export interface Tier {
  /** Applies to items no older than this (ms). */
  maxAge: number
  /** Keep the newest item of every period this long (ms); 0 keeps all of them. */
  every: number
}

const HOUR = 3600_000
const DAY = 24 * HOUR

/** Ids to drop so that each tier keeps one item per period (the newest). Items older than the last
 *  tier go; `pinned` ones always stay. */
export function thin<T extends { id: number; ts: number }>(items: T[], now: number, tiers: Tier[], pinned: (x: T) => boolean = () => false): number[] {
  const drop: number[] = []
  const seen = new Set<string>()
  for (const it of [...items].sort((a, b) => b.ts - a.ts || b.id - a.id)) {
    if (pinned(it)) continue
    const age = now - it.ts
    const ti = tiers.findIndex((t) => age <= t.maxAge)
    if (ti < 0) {
      drop.push(it.id)
      continue
    }
    const every = tiers[ti].every
    if (!every) continue
    const key = `${ti}:${Math.floor(it.ts / every)}`
    if (seen.has(key)) drop.push(it.id)
    else seen.add(key)
  }
  return drop
}

/** Daily restore points: every one for two days, then one a day for two weeks, then one a week for two months. */
export const SNAPSHOT_TIERS: Tier[] = [
  { maxAge: 2 * DAY, every: 0 },
  { maxAge: 14 * DAY, every: DAY },
  { maxAge: 60 * DAY, every: 7 * DAY },
]

/** Page versions: all of the last day, one a day for a month, one a week for a year. */
export const VERSION_TIERS: Tier[] = [
  { maxAge: DAY, every: 0 },
  { maxAge: 30 * DAY, every: DAY },
  { maxAge: 365 * DAY, every: 7 * DAY },
]

const MAX_PINNED = 12

export function snapshotsToDrop(list: SnapshotMeta[], now: number): number[] {
  // Points made by hand or before a risky step stay a month whatever the rhythm; the newest two always stay
  const newest = new Set([...list].sort((a, b) => b.ts - a.ts).slice(0, 2).map((s) => s.id))
  const special = list.filter((s) => s.reason !== 'auto').sort((a, b) => b.ts - a.ts)
  const keepSpecial = new Set(special.filter((s, i) => i < MAX_PINNED && now - s.ts <= 30 * DAY).map((s) => s.id))
  const drop = new Set(thin(list.filter((s) => s.reason === 'auto'), now, SNAPSHOT_TIERS))
  special.forEach((s) => !keepSpecial.has(s.id) && drop.add(s.id))
  // A very large workspace: never hold more than ~250 MB of restore points
  let total = list.filter((s) => !drop.has(s.id)).reduce((n, s) => n + s.bytes, 0)
  for (const s of [...list].sort((a, b) => a.ts - b.ts)) {
    if (total <= 250 * 1024 * 1024) break
    if (drop.has(s.id) || newest.has(s.id)) continue
    drop.add(s.id)
    total -= s.bytes
  }
  newest.forEach((id) => drop.delete(id))
  return [...drop]
}

/** All page versions together stay under this size. */
export const VERSIONS_MAX_BYTES = 200 * 1024 * 1024

/** Past the size limit, the oldest versions go first; versions saved by hand and each page's
 *  newest version stay. */
export function versionsOverCap(all: VersionMeta[], max = VERSIONS_MAX_BYTES): number[] {
  let total = all.reduce((n, v) => n + v.bytes, 0)
  if (total <= max) return []
  const newest = new Map<string, VersionMeta>()
  for (const v of all) {
    const cur = newest.get(v.pageId)
    if (!cur || v.ts > cur.ts) newest.set(v.pageId, v)
  }
  const drop: number[] = []
  for (const v of all.filter((x) => x.reason !== 'manual' && newest.get(x.pageId)?.id !== x.id).sort((a, b) => a.ts - b.ts)) {
    if (total <= max) break
    drop.push(v.id)
    total -= v.bytes
  }
  return drop
}

export function versionsToDrop(list: VersionMeta[], now: number): number[] {
  const manual = list.filter((v) => v.reason === 'manual').sort((a, b) => b.ts - a.ts)
  const keepManual = new Set(manual.slice(0, 20).map((v) => v.id))
  const newest = [...list].sort((a, b) => b.ts - a.ts)[0]?.id
  const drop = new Set(thin(list.filter((v) => v.reason !== 'manual'), now, VERSION_TIERS))
  manual.forEach((v) => !keepManual.has(v.id) && drop.add(v.id))
  if (newest !== undefined) drop.delete(newest)
  return [...drop]
}
