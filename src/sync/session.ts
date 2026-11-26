// Accounts, workspaces, invitations and the sync engine's lifecycle.
//
// An account has no e-mail or password: the first device starts it, and every other device joins
// it with a one-time link code made on a device that already belongs (or with the account's
// recovery key). A linked device stays linked until it is unlinked; nothing expires.
import * as Y from 'yjs'
import { create } from 'zustand'
import { setAssetUploadHook, setRemoteAssetResolver } from '../data/assets'
import { allDocIds, getAsset, kvGet, kvSet, loadUpdates, outboxAll, outboxClearWorkspace, putAsset, wipeAll } from '../data/idb'
import { flushWrites, getDoc, hasUnsaved, resetDocs } from '../data/docs'
import { anyRevived, forgetPurged, purgedDocs } from '../data/purged'
import { takeSnapshot } from '../data/snapshots'
import { forgetBackupDevice } from '../data/autobackup'
import { cancelReminders } from '../data/reminders'
import { wipeVault } from '../data/vault'
import { useStore } from '../data/store'
import { getActor, setActor } from '../data/workspace'
import { setServerAi } from '../ai/client'
import { isNative } from '../lib/platform'
import { bookmarkKey, SyncEngine, workspaceDocIds, type PresenceUser, type Role } from './engine'
import { api, ApiError, loadCredentials, saveCredentials, toB64, type Credentials } from './api'
import { apiBase, syncAvailable } from './config'
import { t } from '../lib/i18n'

export interface SyncUser {
  id: string
  name: string
}

export interface WorkspaceInfo {
  id: string
  name: string
  role: Role
}

export interface Member {
  user_id: string
  role: Role
  display_name: string | null
  email: string | null
}

interface SessionState {
  user: SyncUser | null
  role: Role | null
  workspaces: WorkspaceInfo[]
  presence: PresenceUser[]
  busy: boolean
}

export const useSession = create<SessionState>(() => ({ user: null, role: null, workspaces: [], presence: [], busy: false }))

let engine: SyncEngine | null = null
export const getEngine = () => engine

// Flags kept on the device for each workspace ("cf": this server; "sync:" ones are the old server's)
const LINKED = (ws: string) => `cf:linked:${ws}`
const ROLE = (ws: string) => `cf:role:${ws}`
const OWNER = (ws: string) => `cf:owner:${ws}`

function displayName(user: SyncUser): string {
  return useStore.getState().settings.userName || user.name || ''
}

/** What this device is called in the account's list of devices. */
export function deviceLabel(): string {
  const ua = navigator.userAgent
  const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iOS' : /Windows/i.test(ua) ? 'Windows' : /Mac OS/i.test(ua) ? 'Mac' : /Linux/i.test(ua) ? 'Linux' : ''
  if (isNative()) return `${os || 'Android'} · ${t('appName')}`
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : ''
  return [os, browser].filter(Boolean).join(' · ') || t('thisDevice')
}

/** Called once after the local workspace is open. */
export async function initSync() {
  if (!syncAvailable()) return
  const c = loadCredentials()
  if (c) await connectOnce(c.account)
}

let connecting: { userId: string; done: Promise<void> } | null = null
function connectOnce(user: SyncUser): Promise<void> {
  if (connecting?.userId === user.id) return connecting.done
  const done = connect(user)
  connecting = { userId: user.id, done }
  return done
}

async function loadWorkspaces(): Promise<WorkspaceInfo[]> {
  return (await api<{ workspaces: WorkspaceInfo[] }>('/workspaces')).workspaces
}

function setRole(role: Role | null) {
  useSession.setState({ role })
  useStore.setState({ wsRole: role })
}

async function connect(user: SyncUser) {
  const w = useStore.getState().ws
  if (!w) return
  const name = displayName(user)
  // Favorites saved before linking (or under the old server's account) move to this account
  const before = await kvGet<SyncUser>('sync:user')
  for (const from of ['local', before && before.id !== user.id ? before.id : '']) {
    if (!from) continue
    const favs = w.favorites(from)
    favs.forEach((f) => {
      if (!w.favorites(user.id).includes(f)) w.toggleFavorite(user.id, f)
    })
    if (favs.length) w.prefs.delete(from)
  }
  setActor({ id: user.id, name })
  void kvSet('sync:user', { id: user.id, name })
  useStore.setState({ favorites: w.favorites(user.id) })
  useSession.setState({ user })

  // A workspace this device already syncs starts right away (offline too); the role is re-checked after
  const linked = await kvGet<boolean>(LINKED(w.id))
  const knownRole = await kvGet<Role>(ROLE(w.id))
  if (linked && knownRole) {
    setRole(knownRole)
    await startEngine(user, knownRole, false)
    void refreshMembership(user)
    void carryOverOthers()
    return
  }

  let workspaces: WorkspaceInfo[]
  try {
    workspaces = await loadWorkspaces()
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return unlinkedElsewhere()
    return retryLater(user)
  }
  // The first link changes where this device's pages live: keep a restore point of them as they are
  if (!w.isPristine()) await takeSnapshot('before-signin')
  let role = workspaces.find((x) => x.id === w.id)?.role ?? null
  let upload = false

  if (!role) {
    const carried = await carriedOver(w.id)
    if (carried === 'shared') {
      // Shared with this person on the old server by someone else: that person shares it again
      setRole(null)
      useStore.setState({ syncStatus: 'local' })
      useStore.getState().toast(t('sharedNeedsNewInvite'), undefined, 15000)
      void carryOverOthers()
      return
    }
    if (workspaces.length && !carried && !(await kvGet(OWNER(w.id)))) {
      // The account already has pages: bring this device's own pages into the main workspace
      const target = workspaces.find((x) => x.role === 'owner') ?? workspaces[0]
      try {
        if (!w.isPristine()) await mergeLocalInto(target.id)
      } catch {
        useStore.setState({ syncStatus: 'offline' })
        useStore.getState().toast(t('mergeFailed'))
        return
      }
      await switchWorkspace(target.id)
      return
    }
    // A new workspace, or one this device synced with the old server: it goes up as it is
    try {
      role = (await api<{ role: Role }>('/workspaces', { body: { id: w.id, name: (w.meta.get('name') as string) || '', my_name: name } })).role
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        // The same workspace belongs to another account (both devices started their own account)
        useStore.setState({ syncStatus: 'local' })
        useStore.getState().toast(t('wsOtherAccount'), { label: t('relinkShort'), run: () => window.dispatchEvent(new CustomEvent('qirtas:settings', { detail: 'account' })) }, 30000)
        return
      }
      return retryLater(user)
    }
    upload = role !== 'viewer'
    await kvSet(OWNER(w.id), user.id)
    workspaces = await loadWorkspaces().catch(() => workspaces)
  } else {
    upload = role !== 'viewer' && !w.isPristine()
  }

  useSession.setState({ workspaces })
  setRole(role)
  await startEngine(user, role, upload)
  void carryOverOthers()
}

/** No connection for the first link: try again when it's back, and every minute meanwhile. */
function retryLater(user: SyncUser) {
  useStore.setState({ syncStatus: 'offline' })
  let done = false
  const retry = () => {
    if (done) return
    done = true
    clearTimeout(timer)
    window.removeEventListener('online', retry)
    if (useSession.getState().user?.id !== user.id) return // unlinked meanwhile
    connecting = null
    void connectOnce(user)
  }
  const timer = setTimeout(retry, 60_000)
  window.addEventListener('online', retry)
}

/** Was this workspace synced with the old server (before the move to this one)? As whose? */
async function carriedOver(wsId: string): Promise<'own' | 'shared' | null> {
  if (!(await kvGet(`sync:linked:${wsId}`))) return null
  // Someone else's only when the old server said so: the first versions kept no role at all, and a
  // device whose old sign-in had run out never saved one; such a workspace is the person's own
  const role = await kvGet<string>(`sync:role:${wsId}`)
  return role === 'editor' || role === 'viewer' ? 'shared' : 'own'
}

let carrying = false
/** Other workspaces on this device that the old server synced (this account's own): they go up
 *  too, read straight from storage, so the account has every one of them. */
async function carryOverOthers() {
  if (carrying) return
  carrying = true
  try {
    const current = useStore.getState().ws?.id
    const stored = await allDocIds()
    const name = getActor().name
    for (const docId of stored) {
      if (!docId.startsWith('ws:')) continue
      const wsId = docId.slice(3)
      if (wsId === current || (await kvGet(LINKED(wsId))) || (await carriedOver(wsId)) !== 'own') continue
      const merged = await storedState(docId)
      if (!merged) continue
      const doc = new Y.Doc()
      Y.applyUpdate(doc, merged)
      const pages = [...doc.getMap('pages').keys()].map((id) => `pg:${id}`).filter((d) => stored.includes(d))
      const role = (await api<{ role: Role }>('/workspaces', { body: { id: wsId, name: (doc.getMap('meta').get('name') as string) || '', my_name: name } })).role
      if (role === 'viewer') continue
      let rows: { doc: string; data: string }[] = [{ doc: docId, data: toB64(merged) }]
      for (const d of pages) {
        const state = await storedState(d)
        if (state) rows.push({ doc: d, data: toB64(state) })
        if (rows.length >= 10) {
          await api(`/workspaces/${wsId}/updates`, { body: { rows }, timeout: 120_000 })
          rows = []
        }
      }
      if (rows.length) await api(`/workspaces/${wsId}/updates`, { body: { rows }, timeout: 120_000 })
      await kvSet(LINKED(wsId), true)
      await kvSet(ROLE(wsId), role)
      await kvSet(OWNER(wsId), getActor().id)
    }
    useSession.setState({ workspaces: await loadWorkspaces() })
  } catch {
    /* tried again at the next start */
  } finally {
    carrying = false
  }
}

async function storedState(docId: string): Promise<Uint8Array | null> {
  const list = await loadUpdates(docId)
  if (!list.length) return null
  return list.length === 1 ? list[0].update : Y.mergeUpdates(list.map((u) => u.update))
}

let hooksReady = false

let refetchTimer: ReturnType<typeof setTimeout> | null = null
function refetchSoon(ms = 1000) {
  if (refetchTimer) return
  refetchTimer = setTimeout(() => {
    refetchTimer = null
    void refetchRevived()
  }, ms)
}

/** Pages deleted for good on this device that are in the workspace again: fetch their whole history. */
async function refetchRevived() {
  const w = useStore.getState().ws
  if (!engine || !w) return
  let failed = false
  for (const docId of purgedDocs(w.id)) {
    if (!w.pages.has(docId.slice(3))) continue
    try {
      await engine.refetchDoc(docId)
      forgetPurged(w.id, docId)
    } catch {
      failed = true
    }
  }
  if (failed) refetchSoon(60_000) // offline or the server failed: again in a minute
}

async function startEngine(user: SyncUser, role: Role, upload: boolean) {
  const w = useStore.getState().ws!
  const name = displayName(user)
  engine?.stop()
  if (role === 'viewer') await outboxClearWorkspace(w.id) // a viewer's edits can't be sent (other workspaces' stay queued)
  engine = new SyncEngine(w.id, role, { id: user.id, name })
  engine.onPresence = (users) => useSession.setState({ presence: users.filter((u) => u.userId !== user.id) })
  engine.onMembersChanged = () => void refreshMembership(user)
  engine.onDenied = (err) => {
    if (err.status === 401) void unlinkedElsewhere()
    else void refreshMembership(user)
  }
  await kvSet(LINKED(w.id), true)
  await kvSet(ROLE(w.id), role)
  await engine.start({ upload })
  const route = useStore.getState().route
  engine.setPage(route.name === 'page' ? route.id : null)
  void refetchRevived()
  if (hooksReady) return
  hooksReady = true
  // A page deleted for good here that comes back (a restore): its whole history first
  useStore.subscribe((s, prev) => {
    if (s.pages !== prev.pages && s.ws && anyRevived(s.ws.id, s.pages)) refetchSoon()
  })
  useStore.subscribe((s, prev) => {
    if (s.route !== prev.route) engine?.setPage(s.route.name === 'page' ? s.route.id : null)
  })

  // Images: upload new ones, fetch missing ones on demand
  setAssetUploadHook((id, blob) => void uploadAsset(w.id, id, blob))
  setRemoteAssetResolver(async (id) => {
    try {
      const blob = await api<Blob>(`/workspaces/${w.id}/assets/${encodeURIComponent(id)}`, { blob: true, timeout: 60_000 })
      await putAsset({ id, blob, type: blob.type, createdAt: Date.now() })
      return URL.createObjectURL(blob)
    } catch {
      return null
    }
  })
  // The writing assistant through the server, for linked devices without a personal key
  setServerAi(async (body, signal) => {
    const base = apiBase() ?? ''
    return fetch(`${base}/ai`, {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${loadCredentials()?.token ?? ''}` },
      body: JSON.stringify(body),
    })
  })
  void uploadPendingAssets(w.id)
  window.addEventListener('online', () => void uploadPendingAssets(w.id))
}

/** Re-read this account's workspaces; follow role changes and removals. */
async function refreshMembership(user: SyncUser) {
  const w = useStore.getState().ws
  if (!w) return
  let list: WorkspaceInfo[]
  try {
    list = await loadWorkspaces()
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) void unlinkedElsewhere()
    return
  }
  useSession.setState({ workspaces: list })
  // Reminders of a workspace this account is no longer in stop ringing (this one's own are kept
  // while it is open; local workspaces aren't in the list)
  void cancelReminders([...list.map((x) => x.id), w.id])
  const role = list.find((x) => x.id === w.id)?.role ?? null
  if (role === useSession.getState().role) return
  if (!role) {
    // Removed from this workspace (or it was deleted)
    engine?.stop()
    engine = null
    await kvSet(LINKED(w.id), false)
    await kvSet(ROLE(w.id), null)
    useStore.getState().toast(t('removedFromWorkspace'))
    const next = list.find((x) => x.role === 'owner') ?? list[0]
    await switchWorkspace(next ? next.id : crypto.randomUUID(), !!next)
    return
  }
  setRole(role)
  await startEngine(user, role, false)
}

/** This device was removed from the account (on another device): it stops syncing and says so.
 *  Its pages stay here; linking it again brings them back together. */
async function unlinkedElsewhere() {
  if (!loadCredentials()) return
  engine?.stop()
  engine = null
  saveCredentials(null)
  connecting = null
  const w = useStore.getState().ws
  if (w) {
    await kvSet(LINKED(w.id), false)
    await kvSet(ROLE(w.id), null)
  }
  setRole(null)
  useSession.setState({ user: null, workspaces: [], presence: [] })
  useStore.setState({ syncStatus: 'local' })
  useStore.getState().toast(t('deviceUnlinked'), { label: t('linkAgain'), run: () => window.dispatchEvent(new CustomEvent('qirtas:settings', { detail: 'account' })) }, 20000)
}

async function uploadAsset(wsId: string, id: string, blob: Blob) {
  try {
    await api(`/workspaces/${wsId}/assets/${encodeURIComponent(id)}`, { method: 'PUT', raw: blob, timeout: 120_000 })
  } catch {
    const list = (await kvGet<string[]>('sync:pendingAssets')) ?? []
    if (!list.includes(id)) await kvSet('sync:pendingAssets', [...list, id])
  }
}

async function uploadPendingAssets(wsId: string) {
  const list = (await kvGet<string[]>('sync:pendingAssets')) ?? []
  if (!list.length) return
  await kvSet('sync:pendingAssets', [])
  for (const id of list) {
    const a = await getAsset(id)
    if (a) await uploadAsset(wsId, id, a.blob)
  }
}

/** Copy this device's workspace into another workspace (used when an account already has pages). */
async function mergeLocalInto(targetId: string) {
  const w = useStore.getState().ws!
  // Untouched starter pages stay behind, so the account doesn't get a second copy of them
  const starters = [...w.pages.keys()].filter(
    (id) => w.pages.get(id)?.get('seed') && !w.descendants(id).some((d) => !w.pages.get(d)?.get('seed')),
  )
  for (const id of starters) if (w.pages.has(id)) await w.purgePage(id)
  await flushWrites()
  const ids = await workspaceDocIds(w)
  const rows = []
  for (const docId of ids) {
    const doc = await getDoc(docId)
    rows.push({ doc: docId.startsWith('ws:') ? `ws:${targetId}` : docId, data: toB64(Y.encodeStateAsUpdate(doc)) })
  }
  for (let i = 0; i < rows.length; i += 10) await api(`/workspaces/${targetId}/updates`, { body: { rows: rows.slice(i, i + 10) }, timeout: 120_000 })
}

export async function switchWorkspace(id: string, remote = true) {
  await flushWrites()
  // Changes that could not be written to the device would be lost by the reload
  if (hasUnsaved()) {
    useStore.getState().toast(t('saveFailing'))
    return
  }
  if (remote) await kvSet(`sync:remote:${id}`, true)
  await kvSet('currentWs', id)
  location.hash = '#/'
  location.reload()
}

// ---------------- the account and its devices

function linked(c: Credentials) {
  saveCredentials(c)
  connecting = null
  void connectOnce(c.account)
}

/** Start syncing: a new account with this device in it. Returns the recovery key (shown once). */
export async function startAccount(name: string): Promise<string> {
  const r = await api<Credentials & { recovery: string }>('/account', { body: { name, label: deviceLabel() } })
  linked({ token: r.token, account: { id: r.account.id, name: r.account.name } })
  return r.recovery
}

/** Join the account of another device with the code it shows. */
export async function linkWithCode(code: string) {
  const r = await api<Credentials>('/link/claim', { body: { code, label: deviceLabel() } })
  linked({ token: r.token, account: { id: r.account.id, name: r.account.name } })
}

/** Move this linked device to another account (it was linked to the wrong one): its pages stay and
 *  go up to the other account, which gets them merged with its own. */
export async function relinkWithCode(code: string) {
  const r = await api<Credentials>('/link/claim', { body: { code, label: deviceLabel() } })
  // The old account forgets this device (the new link is already made; if this fails it only lingers)
  await api('/signout', { method: 'POST', timeout: 8000 }).catch(() => {})
  engine?.stop()
  engine = null
  const w = useStore.getState().ws
  if (w) {
    await kvSet(LINKED(w.id), false)
    await kvSet(ROLE(w.id), null)
    await kvSet(OWNER(w.id), null)
    await kvSet(bookmarkKey(w.id), 0)
  }
  setRole(null)
  useSession.setState({ user: null, workspaces: [], presence: [] })
  linked({ token: r.token, account: { id: r.account.id, name: r.account.name } })
}

/** Join an account with its recovery key (when none of its devices is at hand). */
export async function linkWithRecoveryKey(key: string) {
  const r = await api<Credentials>('/recover', { body: { key, label: deviceLabel() } })
  linked({ token: r.token, account: { id: r.account.id, name: r.account.name } })
}

/** A one-time code for linking another device (valid a few minutes). */
export async function makeLinkCode(): Promise<{ code: string; expires_at: number }> {
  return api('/link', { method: 'POST' })
}

export interface DeviceInfo {
  id: string
  label: string
  created_at: number
  seen_at: number
  current: boolean
}

export async function accountDevices(): Promise<DeviceInfo[]> {
  return (await api<{ devices: DeviceInfo[] }>('/account')).devices
}

export async function removeDevice(id: string) {
  await api(`/devices/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/** A new recovery key; the old one stops working. */
export async function newRecoveryKey(): Promise<string> {
  return (await api<{ recovery: string }>('/account/recovery', { method: 'POST' })).recovery
}

export async function renameAccount(name: string) {
  await api('/account', { method: 'PATCH', body: { name } })
  const c = loadCredentials()
  if (c) saveCredentials({ ...c, account: { ...c.account, name } })
}

/** Is there work on this device that the account doesn't have yet? Unlinking would delete it. */
export async function hasUnsyncedWork(): Promise<boolean> {
  await flushWrites()
  if (hasUnsaved()) return true
  // One more try before deciding
  await engine?.flush().catch(() => {})
  try {
    if ((await outboxAll()).length) return true
    if (((await kvGet<string[]>('sync:pendingAssets')) ?? []).length) return true
    const w = useStore.getState().ws
    // Linked, but this device's pages never reached the account (no connection at the first link)
    if (w && !w.isPristine() && !(await kvGet(LINKED(w.id)))) return true
  } catch {
    return true // can't tell: treat it as unsynced
  }
  return false
}

/** Unlink this device and clear it, so the next person starts fresh. */
export async function signOut() {
  engine?.stop()
  engine = null
  // The server forgets this device (if it can be reached; without a connection it is forgotten here)
  await api('/signout', { method: 'POST', timeout: 8000 }).catch(() => {})
  saveCredentials(null)
  resetDocs()
  await wipeAll()
  await wipeVault().catch(() => {})
  forgetBackupDevice() // the files written so far stay out of the next account's rotation
  await cancelReminders() // the account's reminders must not ring on this device any more
  localStorage.removeItem('qirtas.recent')
  location.hash = '#/'
  location.reload()
}

export async function deleteAccount() {
  await api('/account', { method: 'DELETE' })
  await signOut()
}

// ---------------- workspaces & sharing

export async function createWorkspace(name: string) {
  const id = crypto.randomUUID()
  await api('/workspaces', { body: { id, name, my_name: getActor().name } })
  await kvSet(OWNER(id), getActor().id)
  // name the new workspace locally too
  const doc = await getDoc(`ws:${id}`)
  doc.getMap('meta').set('name', name)
  await switchWorkspace(id)
}

export async function renameRemoteWorkspace(id: string, name: string) {
  await api(`/workspaces/${id}`, { method: 'PATCH', body: { name } }).catch(() => {})
}

export async function listMembers(wsId: string): Promise<Member[]> {
  return (await api<{ members: Member[] }>(`/workspaces/${wsId}/members`)).members
}

export async function setMemberRole(wsId: string, userId: string, role: Role) {
  await api(`/workspaces/${wsId}/members/${encodeURIComponent(userId)}`, { method: 'PATCH', body: { role } })
}

/** The owner removes someone (their old invitation links stop working too). */
export async function removeMember(wsId: string, userId: string) {
  await api(`/workspaces/${wsId}/members/${encodeURIComponent(userId)}`, { method: 'DELETE' })
}

export async function createInvite(wsId: string, role: 'editor' | 'viewer'): Promise<string> {
  return (await api<{ token: string }>(`/workspaces/${wsId}/invites`, { body: { role } })).token
}

export interface Invite {
  token: string
  role: 'editor' | 'viewer'
  created_at: string
  expires_at?: string | null
}

export async function listInvites(wsId: string): Promise<Invite[]> {
  return (await api<{ invites: Invite[] }>(`/workspaces/${wsId}/invites`)).invites
}

export async function revokeInvite(token: string) {
  await api(`/invites/${encodeURIComponent(token)}`, { method: 'DELETE' }).catch(() => {})
}

export async function inviteInfo(token: string) {
  return (await api<{ invite: { workspace_id: string; name: string; role: Role } | null }>(`/invites/${encodeURIComponent(token)}`)).invite
}

export async function acceptInvite(token: string) {
  const { workspace_id } = await api<{ workspace_id: string }>(`/invites/${encodeURIComponent(token)}/accept`, { body: { name: getActor().name } })
  await switchWorkspace(workspace_id)
}

export async function leaveWorkspace(wsId: string) {
  const user = useSession.getState().user
  if (!user) return
  await api(`/workspaces/${wsId}/members/${encodeURIComponent(user.id)}`, { method: 'DELETE' })
  const rest = useSession.getState().workspaces.filter((x) => x.id !== wsId)
  if (rest[0]) await switchWorkspace(rest[0].id)
}

/** The public address of the web app, used in invitation links. */
export function appBaseUrl(): string {
  const configured = import.meta.env.VITE_PUBLIC_URL as string | undefined
  if (configured) return configured.replace(/\/$/, '')
  if (location.protocol.startsWith('http') && !location.hostname.includes('localhost')) return location.origin + location.pathname.replace(/\/$/, '')
  return ''
}

export function inviteLink(token: string): string {
  const base = appBaseUrl()
  return base ? `${base}/#/join/${token}` : token
}

export { wipeAll }
