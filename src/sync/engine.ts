// Keeps the local Yjs documents and the server's update log in step.
// Local changes go to an IndexedDB outbox and are pushed in small batches; changes from other
// devices are pulled after a bookmark and merged by Yjs. While the app is on screen a request waits
// on the server for the next change (long polling), so they arrive within a second or two.
import * as Y from 'yjs'
import { applyOutside, getDoc, ORIGIN_REMOTE, pageDocId, setSyncHook } from '../data/docs'
import { allDocIds, kvGet, kvSet, outboxAdd, outboxAll, outboxDelete } from '../data/idb'
import { useStore } from '../data/store'
import type { Workspace } from '../data/workspace'
import { uid } from '../lib/ids'
import { api, ApiError, fromB64, toB64 } from './api'

export type Role = 'owner' | 'editor' | 'viewer'

interface Row {
  id: number
  doc_id: string
  data: string
  client_id: string | null
}

interface WaitResult {
  latest: number
  version: number
  presence: { client_id: string; user_id: string; name: string | null; page_id: string | null; color: string | null }[]
}

/** A document's history is squashed only when no row for it arrived for this long. */
const COMPACT_QUIET = 60_000
/** Rows per push, and bytes (the server takes at most 20 rows and ~24 MB per request). */
const PUSH_ROWS = 20
const PUSH_BYTES = 8_000_000

export interface PresenceUser {
  userId: string
  name: string
  pageId: string | null
  color: string
}

/** The stored documents that belong to a workspace: its own document and its pages'. */
export async function workspaceDocIds(w: Workspace): Promise<string[]> {
  const stored = new Set(await allDocIds())
  return [`ws:${w.id}`, ...[...w.pages.keys()].map(pageDocId)].filter((d) => stored.has(d))
}

const COLORS = ['#2a47a8', '#1f6f6b', '#b5443a', '#7650ad', '#c2621b', '#2b7a4b', '#ad437c']

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Where this device is in a workspace's log (kept per workspace; "cf" = this server's numbering). */
export const bookmarkKey = (wsId: string) => `cf:last:${wsId}`

export class SyncEngine {
  readonly clientId = uid(10)
  private lastId = 0
  private version = -1
  private flushing = false
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private pending: Promise<unknown> = Promise.resolve()
  private stopped = false
  private perDocCount = new Map<string, { n: number; maxId: number; at: number }>()
  /** Documents whose change could not be queued: their whole state is sent on the next flush. */
  private resync = new Set<string>()
  private live = false
  private looping = false
  private waiting: AbortController | null = null
  private wake: (() => void) | null = null
  private lastPull = 0
  private pulling: Promise<void> | null = null
  onPresence: (users: PresenceUser[]) => void = () => {}
  onMembersChanged: () => void = () => {}
  /** The server no longer lets this device in (unlinked, or no longer a member). */
  onDenied: (err: ApiError) => void = () => {}
  private me: PresenceUser

  readonly wsId: string
  readonly role: Role

  constructor(wsId: string, role: Role, user: { id: string; name: string }) {
    this.wsId = wsId
    this.role = role
    const color = COLORS[[...user.id].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length]
    this.me = { userId: user.id, name: user.name, pageId: null, color }
  }

  private status(s: 'syncing' | 'synced' | 'offline') {
    if (!this.stopped) useStore.setState({ syncStatus: s })
  }

  async start(opts: { upload?: boolean } = {}) {
    this.lastId = (await kvGet<number>(bookmarkKey(this.wsId))) ?? 0
    useStore.setState({ lastSyncedAt: (await kvGet<number>(`sync:ok:${this.wsId}`)) ?? null })
    void this.countPending()
    if (this.role !== 'viewer') setSyncHook((docId, update) => this.enqueue(docId, update))
    window.addEventListener('online', this.onOnline)
    window.addEventListener('offline', this.onOffline)
    document.addEventListener('visibilitychange', this.onVisible)
    if (opts.upload) await this.uploadAll()
    try {
      await this.pull()
    } catch (err) {
      if (this.denied(err)) return
      this.status('offline')
    }
    void this.flush()
    void this.loop()
  }

  stop() {
    this.stopped = true
    setSyncHook(null)
    window.removeEventListener('online', this.onOnline)
    window.removeEventListener('offline', this.onOffline)
    document.removeEventListener('visibilitychange', this.onVisible)
    this.waiting?.abort()
    this.wake?.()
  }

  /** Answers that mean this device can't use the workspace any more. */
  private denied(err: unknown): boolean {
    if (!(err instanceof ApiError) || ![401, 403, 404].includes(err.status) || err.code === 'no_server') return false
    this.onDenied(err)
    return true
  }

  // Coming back to the app (phones pause apps in the background): catch up straight away.
  private onVisible = () => {
    if (this.stopped) return
    if (document.visibilityState !== 'visible') {
      this.waiting?.abort() // no waiting on the server while nobody is looking
      return
    }
    if (Date.now() - this.lastPull > 5000) void this.pull().catch((err) => this.denied(err) || this.status('offline'))
    void this.flush()
    this.wake?.()
  }

  private onOnline = () => {
    void this.pull().catch(() => {})
    void this.flush()
    this.wake?.()
  }

  private onOffline = () => this.status('offline')

  // ---------------- outgoing

  private enqueue(docId: string, update: Uint8Array) {
    // A change that can't be queued (storage full) must not be skipped: later changes build on it,
    // and other devices could not apply them. The whole document is sent instead.
    this.pending = this.pending.then(() => outboxAdd(docId, update, this.wsId)).catch(() => void this.resync.add(docId))
    if (!useStore.getState().pendingSync) useStore.setState({ pendingSync: 1 })
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = setTimeout(() => void this.flush(), 350)
  }

  private mine = (i: { wsId?: string }) => !i.wsId || i.wsId === this.wsId

  /** How many documents have changes that the server doesn't have yet (shown in the settings). */
  private async countPending() {
    try {
      const docs = new Set((await outboxAll()).filter(this.mine).map((i) => i.docId))
      this.resync.forEach((d) => docs.add(d))
      if (!this.stopped) useStore.setState({ pendingSync: docs.size })
    } catch {
      /* leave the last count */
    }
  }

  private synced() {
    if (this.stopped) return
    const now = Date.now()
    useStore.setState({ lastSyncedAt: now })
    void kvSet(`sync:ok:${this.wsId}`, now).catch(() => {})
  }

  async flush(): Promise<void> {
    if (this.flushing || this.stopped) return
    if (!navigator.onLine) {
      void this.countPending()
      return this.status('offline')
    }
    this.flushing = true
    let again = false
    // Taken out of the set before their state is read: a change that fails to queue while they are
    // being sent puts its document back in, for the next round
    const whole = [...this.resync]
    whole.forEach((d) => this.resync.delete(d))
    try {
      await this.pending
      // Only this workspace's changes: ones queued in another workspace (offline, then switched)
      // wait until that workspace is open again, instead of landing here
      const items = (await outboxAll()).filter(this.mine)
      if (!items.length && !whole.length) {
        // A document may have come back into the set while the queue was settling
        again = this.resync.size > 0
        if (!again) useStore.setState({ pendingSync: 0 })
        return
      }
      const byDoc = new Map<string, Uint8Array[]>()
      items.forEach((i) => {
        const l = byDoc.get(i.docId) ?? []
        l.push(i.update)
        byDoc.set(i.docId, l)
      })
      for (const docId of whole) byDoc.set(docId, [Y.encodeStateAsUpdate(await getDoc(docId))])
      const rows = [...byDoc].map(([docId, list]) => ({ doc: docId, data: toB64(list.length === 1 ? list[0] : Y.mergeUpdates(list)), client: this.clientId }))
      // In batches the server takes at once
      let batch: typeof rows = []
      let bytes = 0
      const send = async () => {
        if (batch.length) await api(`/workspaces/${this.wsId}/updates`, { body: { rows: batch }, timeout: 120_000 })
        batch = []
        bytes = 0
      }
      for (const r of rows) {
        if (batch.length >= PUSH_ROWS || (batch.length && bytes + r.data.length > PUSH_BYTES)) await send()
        batch.push(r)
        bytes += r.data.length
      }
      await send()
      await outboxDelete(items.map((i) => i.id!).filter((x) => x !== undefined))
      whole.length = 0
      this.status('synced')
      this.synced()
      again = (await outboxAll()).some(this.mine) || this.resync.size > 0
    } catch (err) {
      if (!this.denied(err)) {
        this.status('offline')
        if (!this.stopped) this.flushTimer = setTimeout(() => void this.flush(), 6000)
      }
    } finally {
      // Not sent: they go back in the set
      whole.forEach((d) => this.resync.add(d))
      this.flushing = false
      void this.countPending()
      if (again) void this.flush()
    }
  }

  /** First link of a device's workspace: queue the full state of every document.
   *  It goes through the outbox, so it survives going offline or closing the app. */
  private async uploadAll() {
    const w = useStore.getState().ws
    if (!w || w.id !== this.wsId) return
    for (const docId of await workspaceDocIds(w)) {
      const doc = await getDoc(docId)
      await outboxAdd(docId, Y.encodeStateAsUpdate(doc), this.wsId)
    }
  }

  // ---------------- incoming

  /** Fetch everything after the bookmark. Concurrent calls share one run. */
  pull(): Promise<void> {
    if (!this.pulling) this.pulling = this.doPull().finally(() => (this.pulling = null))
    return this.pulling
  }

  private async doPull() {
    this.lastPull = Date.now()
    if (!this.live) this.status('syncing')
    for (;;) {
      const { rows, more } = await api<{ rows: Row[]; more: boolean }>(`/workspaces/${this.wsId}/updates?after=${this.lastId}`, { timeout: 120_000 })
      for (const r of rows) await this.apply(r)
      if (!more || !rows.length) break
    }
    this.saveLast()
    this.status('synced')
    this.synced()
    void this.compact().catch(() => {})
  }

  private async apply(r: Row) {
    if (r.id > this.lastId) this.lastId = r.id
    const c = this.perDocCount.get(r.doc_id) ?? { n: 0, maxId: 0, at: 0 }
    c.n++
    c.maxId = Math.max(c.maxId, r.id)
    c.at = Date.now()
    this.perDocCount.set(r.doc_id, c)
    if (r.client_id !== this.clientId) {
      const docId = r.doc_id.startsWith('ws:') ? `ws:${this.wsId}` : r.doc_id
      const doc = await getDoc(docId)
      try {
        applyOutside(docId, doc, fromB64(r.data), ORIGIN_REMOTE)
      } catch {
        /* malformed update: skip */
      }
    }
    this.saveLast()
  }

  private saveLast() {
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      void kvSet(bookmarkKey(this.wsId), this.lastId).catch(() => {})
    }, 800)
  }

  /** Squash long histories into one update so new devices download less. Only for a document that
   *  has been quiet for a while: the squash deletes every row up to the newest one seen, and a row
   *  that another device is writing at that very moment must not be among them. */
  private async compact() {
    if (this.role === 'viewer') return
    for (const [docId, c] of this.perDocCount) {
      if (c.n < 150 || Date.now() - c.at < COMPACT_QUIET) continue
      const doc = await getDoc(docId.startsWith('ws:') ? `ws:${this.wsId}` : docId)
      await api(`/workspaces/${this.wsId}/compact`, { body: { doc: docId, upto: c.maxId, merged: toB64(Y.encodeStateAsUpdate(doc)) }, timeout: 120_000 })
      this.perDocCount.delete(docId)
    }
  }

  /** While the app is on screen: wait on the server for the next change, then fetch it. */
  private async loop() {
    if (this.looping) return
    this.looping = true
    let failures = 0
    try {
      while (!this.stopped) {
        if (document.visibilityState !== 'visible' || !navigator.onLine) {
          this.live = false
          if (!navigator.onLine) this.status('offline')
          await new Promise<void>((r) => (this.wake = r))
          this.wake = null
          continue
        }
        this.waiting = new AbortController()
        try {
          const q = new URLSearchParams({ after: String(this.lastId), v: String(this.version), client: this.clientId, name: this.me.name, page: this.me.pageId ?? '', color: this.me.color })
          const r = await api<WaitResult>(`/workspaces/${this.wsId}/wait?${q}`, { signal: this.waiting.signal, timeout: 45_000 })
          failures = 0
          this.live = true
          if (this.version !== -1 && r.version !== this.version) this.onMembersChanged()
          this.version = r.version
          this.onPresence(
            r.presence
              .filter((p) => p.client_id !== this.clientId)
              .map((p) => ({ userId: p.user_id, name: p.name ?? '', pageId: p.page_id, color: p.color || COLORS[0] })),
          )
          if (r.latest > this.lastId) await this.pull()
          else this.status('synced')
        } catch (err) {
          if (this.stopped) break
          if (err instanceof ApiError && err.code === 'aborted') continue // hidden, or the page changed
          if (this.denied(err)) break
          this.live = false
          failures++
          this.status('offline')
          // Back off, but keep trying (and come back at once when the network does)
          await Promise.race([sleep(Math.min(30_000, 1500 * 2 ** Math.min(failures, 5))), new Promise<void>((r) => (this.wake = r))])
          this.wake = null
        } finally {
          this.waiting = null
        }
      }
    } finally {
      this.looping = false
    }
  }

  setPage(pageId: string | null) {
    if (this.me.pageId === pageId) return
    this.me = { ...this.me, pageId }
    this.waiting?.abort() // tell the others now, not at the next round
  }

  /** Every row of one document, whatever the bookmark says: for a page deleted for good on this
   *  device that is in use again (see data/purged.ts). Applying rows twice changes nothing. */
  async refetchDoc(docId: string) {
    const doc = await getDoc(docId)
    let after = 0
    for (;;) {
      const { rows, more } = await api<{ rows: Row[]; more: boolean }>(`/workspaces/${this.wsId}/updates?doc=${encodeURIComponent(docId)}&after=${after}`, { timeout: 120_000 })
      for (const r of rows) {
        try {
          applyOutside(docId, doc, fromB64(r.data), ORIGIN_REMOTE)
        } catch {
          /* malformed update: skip */
        }
        after = r.id
      }
      if (!more || !rows.length) break
    }
  }

  /** Make sure a page that only exists remotely is available locally. */
  async ensureDoc(pageId: string) {
    return getDoc(pageDocId(pageId))
  }
}
