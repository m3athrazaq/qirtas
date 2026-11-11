// Backup files: collecting everything on the device into one file, and reading such a file back.
// Putting a backup back into the workspace is in restore.ts.
import * as Y from 'yjs'
import { allAssets, dumpAll } from './idb'
import { flushWrites, loadedDocIds, onDocDestroy, onDocUpdate, peekDoc, unsavedUpdates } from './docs'
import { useStore } from './store'

export function toB64(u: Uint8Array): string {
  let s = ''
  const chunk = 0x8000
  for (let i = 0; i < u.length; i += chunk) s += String.fromCharCode(...u.subarray(i, i + chunk))
  return btoa(s)
}

export function fromB64(b: string): Uint8Array {
  const s = atob(b)
  const u = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i)
  return u
}

/** A backup, in memory: the state of every document at one moment, and the pictures. */
export interface BackupData {
  takenAt: number
  /** The workspace that was open when the backup was made. */
  wsId?: string
  wsName?: string
  docs: Map<string, Uint8Array>
  assets: { id: string; type: string; blob: Blob }[]
  /** Documents in the file that could not be read. */
  unreadable: number
}

/** Several updates of one document as a single one; a damaged update is left out, the rest is kept. */
export function mergeDocUpdates(list: Uint8Array[]): Uint8Array {
  if (list.length === 1) return list[0]
  try {
    return Y.mergeUpdates(list)
  } catch {
    const doc = new Y.Doc()
    for (const u of list) {
      try {
        Y.applyUpdate(doc, u)
      } catch {
        /* damaged update */
      }
    }
    const merged = Y.encodeStateAsUpdate(doc)
    doc.destroy()
    return merged
  }
}

/** The device store could not be read, so a backup would hold only what is open in memory. */
export class IncompleteBackupError extends Error {}

const partialSets = new WeakSet<Map<string, Uint8Array>>()
/** Was this collection made from memory only (the device store unreadable)? */
export const isPartial = (docs: Map<string, Uint8Array>) => partialSets.has(docs)

/** The current state of every document on this device (all workspaces), one update per document.
 *  When the device store can't be read it throws IncompleteBackupError, unless allowPartial: then
 *  what is open in memory is returned, marked (isPartial). Automatic backups and restore points
 *  never take a partial collection: it would replace (and later rotate out) a complete one. */
export async function collectDocs(opts: { allowPartial?: boolean } = {}): Promise<Map<string, Uint8Array>> {
  await flushWrites()
  // The restore point and the daily file are made seconds apart at start: one read serves both
  if (recent && recent.gen === changes && Date.now() - recent.at < 60_000) return recent.docs
  const gen = changes
  const byDoc = new Map<string, Uint8Array[]>()
  const push = (id: string, u: Uint8Array) => {
    const l = byDoc.get(id)
    if (l) l.push(u)
    else byDoc.set(id, [u])
  }
  let incomplete = false
  try {
    for (const u of await dumpAll()) push(u.docId, u.update)
  } catch (err) {
    if (!opts.allowPartial) throw new IncompleteBackupError(String((err as Error)?.message ?? err))
    // The device store can't be read: save at least what is open in memory
    incomplete = true
    for (const id of loadedDocIds()) {
      const doc = peekDoc(id)
      if (doc) push(id, Y.encodeStateAsUpdate(doc))
    }
  }
  // Changes that could not be written to the device are still in memory
  unsavedUpdates().forEach((list, id) => list.forEach((u) => push(id, u)))
  const out = new Map<string, Uint8Array>()
  byDoc.forEach((list, id) => out.set(id, mergeDocUpdates(list)))
  if (incomplete) partialSets.add(out)
  else if (gen === changes) recent = { at: Date.now(), gen, docs: out }
  return out
}

/** Any change to a document makes the shared collection stale. */
let changes = 0
let recent: { at: number; gen: number; docs: Map<string, Uint8Array> } | null = null
onDocUpdate(() => void changes++)
onDocDestroy(() => void changes++)

/** How many pages of a workspace document are not in the trash, and the workspace's name. */
export function describeWorkspace(update: Uint8Array): { pages: number; name: string } {
  const doc = new Y.Doc()
  try {
    Y.applyUpdate(doc, update)
    let pages = 0
    ;(doc.getMap('pages') as Y.Map<Y.Map<unknown>>).forEach((m) => {
      if (m instanceof Y.Map && !m.get('deletedAt')) pages++
    })
    return { pages, name: (doc.getMap('meta').get('name') as string) || '' }
  } catch {
    return { pages: 0, name: '' }
  } finally {
    doc.destroy()
  }
}

export interface BackupInfo {
  bytes: number
  docs: number
  assets: number
  pages: number
  /** Only what was open in memory: the device store could not be read. */
  partial: boolean
  /** The pictures were left out (too large for an automatic backup). */
  assetsSkipped: boolean
}

/** The backup file as a list of text pieces (plain ASCII apart from the first), so a large backup
 *  never has to exist as one string and can be written piece by piece. */
export async function buildBackupParts(opts: { assets?: boolean; docs?: Map<string, Uint8Array>; maxAssetBytes?: number } = {}): Promise<{ parts: string[]; info: BackupInfo }> {
  const docs = opts.docs ?? (await collectDocs({ allowPartial: true }))
  const st = useStore.getState()
  const wsId = st.ws?.id
  const wsUpdate = wsId ? docs.get(`ws:${wsId}`) : undefined
  const pages = wsUpdate ? describeWorkspace(wsUpdate).pages : 0
  const head = {
    app: 'qirtas',
    version: 2,
    exportedAt: new Date().toISOString(),
    appVersion: __APP_VERSION__,
    workspaceId: wsId,
    workspaceName: st.wsName || '',
    pages,
  }
  const parts: string[] = [JSON.stringify(head).slice(0, -1), ',"docs":{']
  let first = true
  docs.forEach((u, id) => {
    parts.push(`${first ? '' : ','}${JSON.stringify(id)}:"${toB64(u)}"`)
    first = false
  })
  parts.push('},"assets":[')
  let assets = 0
  let assetsSkipped = false
  if (opts.assets !== false) {
    let list: Awaited<ReturnType<typeof allAssets>> = []
    try {
      list = await allAssets()
    } catch {
      /* pictures unreadable: the text is still worth saving */
    }
    // Pictures go into the file as text, in memory: past a size, a phone could run out of it
    if (opts.maxAssetBytes !== undefined && list.reduce((n, a) => n + (a.blob?.size ?? 0), 0) > opts.maxAssetBytes) {
      assetsSkipped = true
      list = []
    }
    for (const a of list) {
      try {
        const data = toB64(new Uint8Array(await a.blob.arrayBuffer()))
        parts.push(`${assets ? ',' : ''}{"id":${JSON.stringify(a.id)},"type":${JSON.stringify(a.type || a.blob.type || '')},"data":"${data}"}`)
        assets++
      } catch {
        /* one unreadable picture doesn't stop the backup */
      }
    }
  }
  parts.push(']}')
  let bytes = 0
  // Everything after the first piece is ASCII: its length is its size
  parts.forEach((p, i) => (bytes += i === 0 ? new Blob([p]).size : p.length))
  return { parts, info: { bytes, docs: docs.size, assets, pages, partial: isPartial(docs), assetsSkipped } }
}

export async function buildBackupBlob(opts: { assets?: boolean; docs?: Map<string, Uint8Array>; maxAssetBytes?: number } = {}): Promise<{ blob: Blob; info: BackupInfo }> {
  const { parts, info } = await buildBackupParts(opts)
  return { blob: new Blob(parts, { type: 'application/json' }), info }
}

/** The backup as text (small workspaces; the file route uses buildBackupBlob). */
export async function buildBackup(): Promise<string> {
  return (await buildBackupBlob()).blob.text()
}

export function backupFileName(date = new Date()): string {
  const d = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  return `qirtas-backup-${d}.json`
}

export class BackupFormatError extends Error {}

/** Read a backup file. Throws BackupFormatError when it is not one. */
export async function parseBackup(input: string | Blob): Promise<BackupData> {
  let raw: unknown
  try {
    raw = JSON.parse(typeof input === 'string' ? input : await input.text())
  } catch {
    throw new BackupFormatError('not json')
  }
  const data = raw as { app?: unknown; exportedAt?: unknown; workspaceId?: unknown; workspaceName?: unknown; docs?: unknown; assets?: unknown }
  if (!data || typeof data !== 'object' || data.app !== 'qirtas' || !data.docs || typeof data.docs !== 'object') throw new BackupFormatError('not a qirtas backup')
  const docs = new Map<string, Uint8Array>()
  let unreadable = 0
  for (const [id, b64] of Object.entries(data.docs as Record<string, unknown>)) {
    try {
      if (typeof b64 !== 'string') throw new Error('bad doc')
      const u = fromB64(b64)
      // Must be a Yjs update: anything else would be refused later, half-way through a restore
      Y.decodeUpdate(u)
      docs.set(id, u)
    } catch {
      unreadable++
    }
  }
  const assets: BackupData['assets'] = []
  if (Array.isArray(data.assets)) {
    for (const a of data.assets as { id?: unknown; type?: unknown; data?: unknown }[]) {
      try {
        if (typeof a?.id !== 'string' || typeof a.data !== 'string') continue
        const type = typeof a.type === 'string' ? a.type : ''
        assets.push({ id: a.id, type, blob: new Blob([fromB64(a.data) as BlobPart], { type }) })
      } catch {
        /* damaged picture */
      }
    }
  }
  const taken = typeof data.exportedAt === 'string' ? Date.parse(data.exportedAt) : NaN
  return {
    takenAt: Number.isFinite(taken) ? taken : Date.now(),
    wsId: typeof data.workspaceId === 'string' ? data.workspaceId : undefined,
    wsName: typeof data.workspaceName === 'string' ? data.workspaceName : undefined,
    docs,
    assets,
    unreadable,
  }
}
