// Keeps the local Yjs documents and the server's update log in step.
// Local changes go to an IndexedDB outbox and are pushed in small batches;
// remote changes arrive through realtime inserts and are merged by Yjs.
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'
import * as Y from 'yjs'
import { getDoc, ORIGIN_REMOTE, pageDocId, setSyncHook } from '../data/docs'
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
  private perDocCount = new Map<string, { n: number; maxId: number }>()
  private live = false
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private lastPull = 0
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
    if (this.channel) void this.sb.removeChannel(this.channel)
    this.channel = null
  }

  // Without a live connection (blocked websockets, flaky network) keep checking every so often.
  private startPolling() {
    if (this.pollTimer || this.stopped) return
    this.pollTimer = setInterval(() => {
      if (document.visibilityState === 'visible') void this.pull().catch(() => this.status('offline'))
    }, 20000)
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
    this.pending = this.pending.then(() => outboxAdd(docId, update)).catch(() => {})
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = setTimeout(() => void this.flush(), 350)
  }

  async flush(): Promise<void> {
    if (this.flushing || this.stopped) return
    if (!navigator.onLine) return this.status('offline')
    this.flushing = true
    let again = false
    try {
      await this.pending
      const items = await outboxAll()
      if (!items.length) return
      const byDoc = new Map<string, Uint8Array[]>()
      items.forEach((i) => {
        const l = byDoc.get(i.docId) ?? []
        l.push(i.update)
        byDoc.set(i.docId, l)
      })
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
      this.status('synced')
      again = (await outboxAll()).length > 0
    } catch {
      this.status('offline')
      if (!this.stopped) this.flushTimer = setTimeout(() => void this.flush(), 6000)
    } finally {
      this.flushing = false
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
      await outboxAdd(docId, Y.encodeStateAsUpdate(doc))
    }
  }

  // ---------------- incoming

  async pull() {
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
    this.saveLast()
    this.status('synced')
    void this.compact()
  }

  private async apply(r: Row) {
    if (r.id > this.lastId) this.lastId = r.id
    const c = this.perDocCount.get(r.doc_id) ?? { n: 0, maxId: 0 }
    c.n++
    c.maxId = Math.max(c.maxId, r.id)
    this.perDocCount.set(r.doc_id, c)
    if (r.client_id === this.clientId) return
    const docId = r.doc_id.startsWith('ws:') ? `ws:${this.wsId}` : r.doc_id
    const doc = await getDoc(docId)
    try {
      Y.applyUpdate(doc, fromB64(r.data), ORIGIN_REMOTE)
    } catch {
      /* malformed update: skip */
    }
    this.saveLast()
  }

  private saveLast() {
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      void kvSet(`sync:last:${this.wsId}`, this.lastId)
    }, 800)
  }

  /** Squash long histories into one update so new devices download less. */
  private async compact() {
    if (this.role === 'viewer') return
    for (const [docId, c] of this.perDocCount) {
      if (c.n < 150) continue
      const doc = await getDoc(docId.startsWith('ws:') ? `ws:${this.wsId}` : docId)
      await this.sb.rpc('compact_doc', { ws: this.wsId, doc: docId, upto: c.maxId, merged: toB64(Y.encodeStateAsUpdate(doc)) })
      this.perDocCount.delete(docId)
    }
  }

  private subscribe() {
    const ch = this.sb.channel(`ws-${this.wsId}`, { config: { presence: { key: this.clientId } } })
    ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'doc_updates', filter: `workspace_id=eq.${this.wsId}` }, (payload) => {
      void this.apply(payload.new as Row)
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
        this.stopPolling()
        void ch.track(this.me)
        // catch anything that landed while we were connecting
        void this.pull().catch(() => this.status('offline'))
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        // the live channel retries by itself; meanwhile fall back to checking periodically
        this.live = false
        this.startPolling()
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
