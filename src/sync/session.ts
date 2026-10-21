// Accounts, workspaces, invitations and the sync engine's lifecycle.
import type { User } from '@supabase/supabase-js'
import * as Y from 'yjs'
import { create } from 'zustand'
import { setAssetUploadHook, setRemoteAssetResolver } from '../data/assets'
import { getAsset, kvGet, kvSet, putAsset, wipeAll } from '../data/idb'
import { flushWrites, getDoc, resetDocs } from '../data/docs'
import { useStore } from '../data/store'
import { getActor, setActor } from '../data/workspace'
import { setServerAi } from '../ai/client'
import { SyncEngine, workspaceDocIds, type PresenceUser, type Role } from './engine'
import { SUPABASE_KEY, SUPABASE_URL } from './config'
import { supa, toB64 } from './supabase'
import { t } from '../lib/i18n'

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
  user: User | null
  role: Role | null
  workspaces: WorkspaceInfo[]
  presence: PresenceUser[]
  busy: boolean
}

export const useSession = create<SessionState>(() => ({ user: null, role: null, workspaces: [], presence: [], busy: false }))

let engine: SyncEngine | null = null
export const getEngine = () => engine

function displayName(user: User): string {
  const s = useStore.getState().settings
  return s.userName || (user.user_metadata?.name as string) || user.email?.split('@')[0] || ''
}

/** Called once after the local workspace is open. */
export async function initSync() {
  const sb = supa()
  if (!sb) return
  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') {
      useSession.setState({ user: null, role: null, workspaces: [] })
      return
    }
    if (event === 'PASSWORD_RECOVERY') {
      // Arrived from a "reset password" email: go straight to choosing a new one
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('qirtas:settings', { detail: 'account' }))
        useStore.getState().toast(t('setNewPassword'))
      }, 400)
    }
    if (session?.user && useSession.getState().user?.id !== session.user.id) void connect(session.user)
  })
  const { data } = await sb.auth.getSession()
  if (data.session?.user) await connect(data.session.user)
}

async function loadWorkspaces(userId: string): Promise<WorkspaceInfo[]> {
  const sb = supa()!
  const { data } = await sb.from('members').select('workspace_id, role, workspaces(name)').eq('user_id', userId)
  return ((data ?? []) as unknown as { workspace_id: string; role: Role; workspaces: { name: string } | null }[]).map((r) => ({
    id: r.workspace_id,
    name: r.workspaces?.name ?? '',
    role: r.role,
  }))
}

async function connect(user: User) {
  const sb = supa()!
  const st = useStore.getState()
  const w = st.ws
  if (!w) return
  const name = displayName(user)
  // Favorites saved before signing in move to the account
  const localFavs = w.favorites('local')
  setActor({ id: user.id, name })
  if (localFavs.length) {
    localFavs.forEach((f) => {
      if (!w.favorites(user.id).includes(f)) w.toggleFavorite(user.id, f)
    })
    w.prefs.delete('local')
  }
  useStore.setState({ favorites: w.favorites(user.id) })
  useSession.setState({ user })

  let workspaces = await loadWorkspaces(user.id)
  let role = workspaces.find((x) => x.id === w.id)?.role ?? null
  let upload = false

  if (!role) {
    const linkedTo = await kvGet<string>(`sync:owner:${w.id}`)
    if (workspaces.length && !linkedTo) {
      // The account already has pages: bring this device's own pages into the main workspace
      const target = workspaces.find((x) => x.role === 'owner') ?? workspaces[0]
      if (!w.isPristine()) await mergeLocalInto(target.id)
      await switchWorkspace(target.id)
      return
    }
    const { error } = await sb.rpc('create_workspace', { ws: w.id, ws_name: (w.meta.get('name') as string) || '', my_name: name })
    if (error) {
      useStore.setState({ syncStatus: 'local' })
      return
    }
    role = 'owner'
    upload = true
    await kvSet(`sync:owner:${w.id}`, user.id)
    workspaces = await loadWorkspaces(user.id)
  } else if (!(await kvGet(`sync:linked:${w.id}`))) {
    upload = role !== 'viewer' && !w.isPristine()
  }

  useSession.setState({ role, workspaces })
  useStore.setState({ wsRole: role })
  engine?.stop()
  engine = new SyncEngine(sb, w.id, role, { id: user.id, name })
  engine.onPresence = (users) => useSession.setState({ presence: users.filter((u) => u.userId !== user.id) })
  await engine.start({ upload })
  await kvSet(`sync:linked:${w.id}`, true)
  const route = useStore.getState().route
  engine.setPage(route.name === 'page' ? route.id : null)
  useStore.subscribe((s, prev) => {
    if (s.route !== prev.route) engine?.setPage(s.route.name === 'page' ? s.route.id : null)
  })

  // Images: upload new ones, fetch missing ones on demand
  setAssetUploadHook((id, blob) => void uploadAsset(w.id, id, blob))
  setRemoteAssetResolver(async (id) => {
    const { data } = await sb.storage.from('assets').download(`${w.id}/${id}`)
    if (!data) return null
    await putAsset({ id, blob: data, type: data.type, createdAt: Date.now() })
    return URL.createObjectURL(data)
  })
  // Assistant through the server for signed-in users without a personal key
  setServerAi(async (body, signal) => {
    const { data } = await sb.auth.getSession()
    return fetch(`${SUPABASE_URL}/functions/v1/ai`, {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${data.session?.access_token ?? ''}`, apikey: SUPABASE_KEY },
      body: JSON.stringify(body),
    })
  })
  void uploadPendingAssets(w.id)
}

async function uploadAsset(wsId: string, id: string, blob: Blob) {
  const sb = supa()
  if (!sb) return
  const { error } = await sb.storage.from('assets').upload(`${wsId}/${id}`, blob, { upsert: true, contentType: blob.type })
  if (error) {
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
  const sb = supa()!
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
    rows.push({ workspace_id: targetId, doc_id: docId.startsWith('ws:') ? `ws:${targetId}` : docId, data: toB64(Y.encodeStateAsUpdate(doc)) })
  }
  for (let i = 0; i < rows.length; i += 25) await sb.from('doc_updates').insert(rows.slice(i, i + 25))
}

export async function switchWorkspace(id: string) {
  await flushWrites()
  await kvSet(`sync:remote:${id}`, true)
  await kvSet('currentWs', id)
  location.hash = '#/'
  location.reload()
}

// ---------------- auth

export async function signIn(email: string, password: string) {
  const { error } = await supa()!.auth.signInWithPassword({ email, password })
  if (error) throw error
}

export async function signUp(email: string, password: string, name: string) {
  const { data, error } = await supa()!.auth.signUp({ email, password, options: { data: { name } } })
  if (error) throw error
  return { needsConfirm: !data.session }
}

export async function resetPassword(email: string) {
  // The link in the email opens the web app (inside the Android app there's no address to return to,
  // so Supabase falls back to the Site URL).
  const base = appBaseUrl()
  const { error } = await supa()!.auth.resetPasswordForEmail(email, base ? { redirectTo: `${base}/` } : undefined)
  if (error) throw error
}

export async function updatePassword(password: string) {
  const { error } = await supa()!.auth.updateUser({ password })
  if (error) throw error
}

/** Sign out and clear this device, so the next person starts fresh. */
export async function signOut() {
  engine?.stop()
  engine = null
  await supa()?.auth.signOut()
  resetDocs()
  await wipeAll()
  localStorage.removeItem('qirtas.recent')
  location.hash = '#/'
  location.reload()
}

export async function deleteAccount() {
  const sb = supa()!
  const { error } = await sb.rpc('delete_my_account')
  if (error) throw error
  await signOut()
}

// ---------------- workspaces & sharing

export async function createWorkspace(name: string) {
  const sb = supa()!
  const id = crypto.randomUUID()
  const { error } = await sb.rpc('create_workspace', { ws: id, ws_name: name, my_name: getActor().name })
  if (error) throw error
  await kvSet(`sync:owner:${id}`, getActor().id)
  // name the new workspace locally too
  const doc = await getDoc(`ws:${id}`)
  doc.getMap('meta').set('name', name)
  await switchWorkspace(id)
}

export async function renameRemoteWorkspace(id: string, name: string) {
  await supa()?.from('workspaces').update({ name }).eq('id', id)
}

export async function listMembers(wsId: string): Promise<Member[]> {
  const { data } = await supa()!.from('members').select('user_id, role, display_name, email').eq('workspace_id', wsId)
  return (data ?? []) as Member[]
}

export async function setMemberRole(wsId: string, userId: string, role: Role) {
  const { error } = await supa()!.from('members').update({ role }).eq('workspace_id', wsId).eq('user_id', userId)
  if (error) throw error
}

export async function removeMember(wsId: string, userId: string) {
  const { error } = await supa()!.from('members').delete().eq('workspace_id', wsId).eq('user_id', userId)
  if (error) throw error
}

export async function createInvite(wsId: string, role: 'editor' | 'viewer'): Promise<string> {
  const { data, error } = await supa()!.from('invites').insert({ workspace_id: wsId, role, created_by: getActor().id }).select('token').single()
  if (error) throw error
  return (data as { token: string }).token
}

export async function listInvites(wsId: string) {
  const { data } = await supa()!.from('invites').select('token, role, created_at').eq('workspace_id', wsId).eq('revoked', false).order('created_at', { ascending: false })
  return (data ?? []) as { token: string; role: 'editor' | 'viewer'; created_at: string }[]
}

export async function revokeInvite(token: string) {
  await supa()!.from('invites').update({ revoked: true }).eq('token', token)
}

export async function inviteInfo(token: string) {
  const { data } = await supa()!.rpc('invite_info', { invite_token: token })
  const row = (data as { workspace_id: string; name: string; role: Role }[] | null)?.[0]
  return row ?? null
}

export async function acceptInvite(token: string) {
  const { data, error } = await supa()!.rpc('accept_invite', { invite_token: token, my_name: getActor().name })
  if (error) throw error
  await switchWorkspace(data as string)
}

export async function leaveWorkspace(wsId: string) {
  const user = useSession.getState().user
  if (!user) return
  await removeMember(wsId, user.id)
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
