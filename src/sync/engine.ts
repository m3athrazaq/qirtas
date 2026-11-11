// Keeps the local Yjs documents and the server's update log in step.
// Local changes go to an IndexedDB outbox and are pushed in small batches;
// remote changes arrive through realtime inserts and are merged by Yjs.
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'
import * as Y from 'yjs'
import { applyOutside, getDoc, ORIGIN_REMOTE, pageDocId, setSyncHook } from '../data/docs'
import { allDocIds, kvGet, kvSet, outboxAdd, outboxAll, outboxDelete } from '../data/idb'
import { useStore } from '../data/store'
import type { Workspace } from '../data/workspace'
import { uid } from '../lib/ids'
import { fromB64, toB64 } from './supabase'

export type Role = 'owner' | 'editor' | 'viewer'

interface Row {
  id: number
  doc_id: string
  data: string
  client_id: string | null
}

/** How far behind the bookmark a pull looks for rows it has not seen (see recheck). */
const RECHECK_WINDOW = 300
const RECHECK_EVERY = 2 * 60_000
/** A document's history is squashed only when no row for it arrived for this long. */
const COMPACT_QUIET = 60_000

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

export class SyncEngine {
  readonly clientId = uid(10)
  private channel: RealtimeChannel | null = null
  private lastId = 0
  private flushing = false
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private pending: Promise<unknown> = Promise.resolve()
  private stopped = false
  private perDocCount = new Map<string, { n: number; maxId: number; at: number }>()
  /** Ids of recent rows this device has taken in (applied, or its own): what recheck compares against. */
  private recent = new Set<number>()
  private lastRecheck = 0
  /** Documents whose change could not be queued: their whole state is sent on the next flush. */
  private resync = new Set<string>()
  private live = false
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private catchUpTimer: ReturnType<typeof setTimeout> | null = null
  private lastPull = 0
  /** Rows already applied from the live channel but not yet covered by the pull bookmark. */
  private seen = new Set<number>()
  private pulling: Promise<void> | null = null
  onPresence: (users: PresenceUser[]) => void = () => {}
  onMembersChanged: () => void = () => {}
  private me: PresenceUser

  private sb: SupabaseClient
  readonly wsId: string
  readonly role: Role

  constructor(sb: SupabaseClient, wsId: string, role: Role, user: { id: string; name: string }) {
    this.sb = sb
    this.wsId = wsId
    this.role = role
    const color = COLORS[[...user.id].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length]
    this.me = { userId: user.id, name: user.name, pageId: null, color }
  }

  private status(s: 'syncing' | 'synced' | 'offline') {
    if (!this.stopped) useStore.setState({ syncStatus: s })
  }

  async start(opts: { upload?: boolean } = {}) {
    this.lastId = (await kvGet<number>(`sync:last:${this.wsId}`)) ?? 0
    ;((await kvGet<number[]>(`sync:recent:${this.wsId}`)) ?? []).forEach((id) => this.recent.add(id))
    useStore.setState({ lastSyncedAt: (await kvGet<number>(`sync:ok:${this.wsId}`)) ?? null })
    void this.countPending()
    if (this.role !== 'viewer') setSyncHook((docId, update) => this.enqueue(docId, update))
    window.addEventListener('online', this.onOnline)
    window.addEventListener('offline', this.onOffline)
    document.addEventListener('visibilitychange', this.onVisible)
    if (opts.upload) await this.uploadAll()
    try {
      await this.pull()
    } catch {
      this.status('offline')
    }
    this.subscribe()
    void this.flush()
  }

  stop() {
    this.stopped = true
    setSyncHook(null)
    window.removeEventListener('online', this.onOnline)
    window.removeEventListener('offline', this.onOffline)
    document.removeEventListener('visibilitychange', this.onVisible)
    this.stopPolling()
    if (this.catchUpTimer) clearTimeout(this.catchUpTimer)
    if (this.channel) void this.sb.removeChannel(this.channel)
    this.channel = null
  }

  // Without a live connection (blocked websockets, flaky network) keep checking every so often.
  private startPolling(every = 20000) {
    this.stopPolling()
    if (this.stopped) return
    this.pollTimer = setInterval(() => {
      if (document.visibilityState === 'visible') void this.pull().catch(() => this.status('offline'))
    }, every)
  }

  private stopPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.pollTimer = null
  }

  // Coming back to the app (phones pause background tabs): catch up straight away.
  private onVisible = () => {
    if (document.visibilityState !== 'visible' || this.stopped) return
    if (Date.now() - this.lastPull > 15000) void this.pull().catch(() => this.status('offline'))
    void this.flush()
  }

  private onOnline = () => {
    void this.pull().catch(() => {})
    void this.flush()
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
    try {
      await this.pending
      // Only this workspace's changes: ones queued in another workspace (offline, then switched)
      // wait until that workspace is open again, instead of landing here
      const items = (await outboxAll()).filter(this.mine)
      const whole = [...this.resync]
      if (!items.length && !whole.length) {
        useStore.setState({ pendingSync: 0 })
        return
      }
      const byDoc = new Map<string, Uint8Array[]>()
      items.forEach((i) => {
        const l = byDoc.get(i.docId) ?? []
        l.push(i.update)
        byDoc.set(i.docId, l)
      })
      for (const docId of whole) byDoc.set(docId, [Y.encodeStateAsUpdate(await getDoc(docId))])
      const rows = [...byDoc].map(([docId, list]) => ({
        workspace_id: this.wsId,
        doc_id: docId,
        data: toB64(list.length === 1 ? list[0] : Y.mergeUpdates(list)),
        client_id: this.clientId,
      }))
      for (let i = 0; i < rows.length; i += 40) {
        const { error } = await this.sb.from('doc_updates').insert(rows.slice(i, i + 40))
        if (error) throw error
      }
      await outboxDelete(items.map((i) => i.id!).filter((x) => x !== undefined))
      whole.forEach((d) => this.resync.delete(d))
      this.status('synced')
      this.synced()
      again = (await outboxAll()).some(this.mine) || this.resync.size > 0
    } catch {
      this.status('offline')
      if (!this.stopped) this.flushTimer = setTimeout(() => void this.flush(), 6000)
    } finally {
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
      const { data, error } = await this.sb
        .from('doc_updates')
        .select('id, doc_id, data, client_id')
        .eq('workspace_id', this.wsId)
        .gt('id', this.lastId)
        .order('id', { ascending: true })
        .limit(500)
      if (error) throw error
      const rows = (data ?? []) as Row[]
      for (const r of rows) await this.apply(r)
      if (rows.length < 500) break
    }
    for (const id of this.seen) if (id <= this.lastId) this.seen.delete(id)
    await this.recheck()
    this.saveLast()
    this.status('synced')
    this.synced()
    void this.compact().catch(() => {})
  }

  /** Rows get their number when they are written but become visible when their write completes, so
   *  a row can show up *behind* the bookmark (two devices writing in the same instant). A pull that
   *  only asks for "newer than the bookmark" would never fetch it. Every so often, compare the ids
   *  just behind the bookmark with the ones this device has taken in, and fetch any it lacks. */
  private async recheck() {
    if (this.lastId <= 0) return
    const now = Date.now()
    if (now - this.lastRecheck < RECHECK_EVERY) return
    const floor = this.lastId - RECHECK_WINDOW
    const { data, error } = await this.sb.from('doc_updates').select('id').eq('workspace_id', this.wsId).gt('id', floor).lte('id', this.lastId).limit(RECHECK_WINDOW)
    if (error) throw error
    this.lastRecheck = now
    const missing = ((data ?? []) as { id: number }[]).map((r) => r.id).filter((id) => !this.recent.has(id))
    for (let i = 0; i < missing.length; i += 50) {
      const { data: rows, error: e2 } = await this.sb.from('doc_updates').select('id, doc_id, data, client_id').eq('workspace_id', this.wsId).in('id', missing.slice(i, i + 50))
      if (e2) throw e2
      for (const r of (rows ?? []) as Row[]) await this.apply(r, true)
    }
    for (const id of this.recent) if (id <= floor - RECHECK_WINDOW) this.recent.delete(id)
    // Remembered at once, so the same rows are not fetched again after a restart
    if (missing.length) await this.writeBookmark().catch(() => {})
  }

  /** Pull a little later (after live changes settle) so the bookmark moves forward. */
  private schedulePull(ms: number) {
    if (this.catchUpTimer) clearTimeout(this.catchUpTimer)
    this.catchUpTimer = setTimeout(() => {
      this.catchUpTimer = null
      if (!this.stopped) void this.pull().catch(() => this.status('offline'))
    }, ms)
  }

  // Rows from a pull move the bookmark; rows from the live channel don't (one could have been
  // missed while reconnecting, and the next pull must still fetch it).
  private async apply(r: Row, live = false) {
    if (!live && r.id > this.lastId) this.lastId = r.id
    if (this.seen.has(r.id)) return
    if (live) this.seen.add(r.id)
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
    this.recent.add(r.id)
    if (!live) this.saveLast()
  }

  private saveLast() {
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      void this.writeBookmark().catch(() => {})
    }, 800)
  }

  private async writeBookmark() {
    await kvSet(`sync:last:${this.wsId}`, this.lastId)
    await kvSet(`sync:recent:${this.wsId}`, [...this.recent].filter((id) => id > this.lastId - 2 * RECHECK_WINDOW))
  }

  /** Squash long histories into one update so new devices download less. Only for a document that
   *  has been quiet for a while: the squash deletes every row up to the newest one seen, and a row
   *  that another device is writing at that very moment must not be among them. */
  private async compact() {
    if (this.role === 'viewer') return
    let checked = false
    for (const [docId, c] of this.perDocCount) {
      if (c.n < 150 || Date.now() - c.at < COMPACT_QUIET) continue
      if (!checked) {
        // Look behind the bookmark once more right now; a row found there resets the quiet time
        checked = true
        this.lastRecheck = 0
        await this.recheck()
        if (Date.now() - c.at < COMPACT_QUIET) continue
      }
      const doc = await getDoc(docId.startsWith('ws:') ? `ws:${this.wsId}` : docId)
      const { error } = await this.sb.rpc('compact_doc', { ws: this.wsId, doc: docId, upto: c.maxId, merged: toB64(Y.encodeStateAsUpdate(doc)) })
      if (!error) this.perDocCount.delete(docId)
    }
  }

  private subscribe() {
    const ch = this.sb.channel(`ws-${this.wsId}`, { config: { presence: { key: this.clientId } } })
    ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'doc_updates', filter: `workspace_id=eq.${this.wsId}` }, (payload) => {
      const row = payload.new as Partial<Row>
      // Very large rows arrive without their data: fetch them normally
      if (typeof row?.id !== 'number' || typeof row.data !== 'string') return this.schedulePull(200)
      void this.apply(row as Row, true)
      this.schedulePull(5000)
    })
    // Someone changed the members (a role, a removal): let the session re-check
    ch.on('postgres_changes', { event: '*', schema: 'public', table: 'members', filter: `workspace_id=eq.${this.wsId}` }, () => {
      this.onMembersChanged()
    })
    ch.on('presence', { event: 'sync' }, () => {
      const state = ch.presenceState<PresenceUser>()
      const users: PresenceUser[] = []
      Object.values(state).forEach((list) => list.forEach((u) => users.push(u)))
      this.onPresence(users)
    })
    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        this.live = true
        this.startPolling(60000) // light catch-up while live
        void ch.track(this.me)
        // catch anything that landed while we were connecting
        void this.pull().catch(() => this.status('offline'))
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        // the live channel retries by itself; meanwhile fall back to checking periodically
        this.live = false
        this.startPolling(20000)
      }
    })
    this.channel = ch
  }

  setPage(pageId: string | null) {
    this.me = { ...this.me, pageId }
    if (this.channel) void this.channel.track(this.me)
  }

  /** Make sure a page that only exists remotely is available locally. */
  async ensureDoc(pageId: string) {
    return getDoc(pageDocId(pageId))
  }
}
