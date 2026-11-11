// Putting a backup (a file, or a restore point from the vault) back into the open workspace.
//
// Merging old data into a live document changes nothing that was edited or deleted since: the newer
// state wins. So a restore does three things on top of the merge:
// - pages that were deleted for good since the backup are created again;
// - "merge" keeps every page as it is now, and files the backup's content in that page's version
//   history when it differs;
// - "rollback" puts every page of the backup back to its content and place in the backup (what is
//   replaced goes to the version history first; pages made after the backup stay).
// A restore point of the current state is taken first, so the restore itself can be taken back.
import type { JSONContent } from '@tiptap/core'
import { yXmlFragmentToProsemirrorJSON } from '@tiptap/y-tiptap'
import * as Y from 'yjs'
import { restoreAsset } from './assets'
import { BackupFormatError, describeWorkspace, type BackupData } from './backup'
import { applyOutside, flushWrites, getDoc, pageDocId } from './docs'
import { ORIGIN_SYSTEM } from './history'
import { takeSnapshot } from './snapshots'
import { useStore } from './store'
import type { PropValue } from './types'
import { fingerprint, listVersions, saveVersion } from './vault'
import { captureVersion, updateToJson, writePageContent } from './versions'
import type { Workspace } from './workspace'

export type RestoreMode = 'merge' | 'rollback'

export interface RestorePlan {
  /** The workspace document in the backup that goes into the open workspace. */
  wsDocId: string
  takenAt: number
  wsName: string
  /** Pages in the backup that were not in its trash. */
  pages: number
  /** Of those, how many the open workspace no longer has at all. */
  missing: number
  /** …and how many are in the trash now. */
  inTrash: number
  /** The backup was made in the workspace that is open now. */
  sameWorkspace: boolean
  /** Other workspaces in the file (they are left alone). */
  otherWorkspaces: number
}

export interface RestoreResult {
  pages: number
  /** Pages that were not in the workspace before and are now (out of its trash). */
  revived: number
  /** Pages whose content differed: filed in their history (merge) or put back (rollback). */
  changed: number
  assets: number
  failed: number
}

interface BackupPage {
  fields: Map<string, unknown>
  props: Record<string, PropValue> | null
}

/** Fields of a page that a rollback puts back. Not its kind: a page turned into a database since
 *  keeps its rows visible. */
const ROLLBACK_FIELDS = ['title', 'icon', 'cover', 'coverY', 'parentId', 'order', 'fullWidth', 'font', 'smallText', 'inline', 'schema', 'views']

const clone = <T>(v: T): T => (v !== null && typeof v === 'object' ? (JSON.parse(JSON.stringify(v)) as T) : v)

/** JSON with keys in a fixed order, to compare two documents whatever order their attributes were set in. */
function canon(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canon(o[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(v ?? null)
}

function readPages(update: Uint8Array): Map<string, BackupPage> {
  const doc = new Y.Doc()
  const out = new Map<string, BackupPage>()
  try {
    Y.applyUpdate(doc, update)
    ;(doc.getMap('pages') as Y.Map<unknown>).forEach((m, id) => {
      if (!(m instanceof Y.Map)) return
      const fields = new Map<string, unknown>()
      let props: Record<string, PropValue> | null = null
      m.forEach((v: unknown, k: string) => {
        if (k === 'props') props = v instanceof Y.Map ? (clone(v.toJSON()) as Record<string, PropValue>) : null
        else fields.set(k, v instanceof Y.AbstractType ? clone(v.toJSON()) : clone(v))
      })
      out.set(id, { fields, props })
    })
  } finally {
    doc.destroy()
  }
  return out
}

/** Which workspace of the backup belongs in the open one: the same workspace when the file has it,
 *  else the one that was open when the backup was made, else the largest. */
function pickWorkspaceDoc(b: BackupData, currentWsId: string): string | null {
  const all = [...b.docs.keys()].filter((k) => k.startsWith('ws:'))
  if (b.docs.has(`ws:${currentWsId}`)) return `ws:${currentWsId}`
  if (b.wsId && b.docs.has(`ws:${b.wsId}`)) return `ws:${b.wsId}`
  let best: string | null = null
  let most = -1
  for (const id of all) {
    const n = describeWorkspace(b.docs.get(id)!).pages
    if (n > most) {
      most = n
      best = id
    }
  }
  return best
}

function openWorkspace(): Workspace {
  const st = useStore.getState()
  if (!st.ws) throw new Error('workspace not ready')
  return st.ws
}

/** What restoring this backup would do, for the confirmation. Throws BackupFormatError when the file has no workspace. */
export function planRestore(b: BackupData): RestorePlan {
  const w = openWorkspace()
  const wsDocId = pickWorkspaceDoc(b, w.id)
  if (!wsDocId) throw new BackupFormatError('no workspace in backup')
  const pages = readPages(b.docs.get(wsDocId)!)
  const plan: RestorePlan = {
    wsDocId,
    takenAt: b.takenAt,
    wsName: (wsDocId === `ws:${b.wsId}` && b.wsName) || describeWorkspace(b.docs.get(wsDocId)!).name,
    pages: 0,
    missing: 0,
    inTrash: 0,
    sameWorkspace: wsDocId === `ws:${w.id}`,
    otherWorkspaces: [...b.docs.keys()].filter((k) => k.startsWith('ws:')).length - 1,
  }
  pages.forEach((p, id) => {
    if (p.fields.get('deletedAt')) return
    plan.pages++
    const cur = w.pages.get(id)
    if (!cur) plan.missing++
    else if (cur.get('deletedAt')) plan.inTrash++
  })
  return plan
}

const breathe = () => new Promise<void>((r) => setTimeout(r, 0))

export async function restoreData(b: BackupData, mode: RestoreMode, onProgress?: (done: number, total: number) => void): Promise<RestoreResult> {
  const w = openWorkspace()
  if (useStore.getState().wsRole === 'viewer') throw new Error('read only')
  const wsDocId = pickWorkspaceDoc(b, w.id)
  if (!wsDocId) throw new BackupFormatError('no workspace in backup')
  const bPages = readPages(b.docs.get(wsDocId)!)
  const result: RestoreResult = { pages: 0, revived: 0, changed: 0, assets: 0, failed: 0 }
  const wasPristine = w.isPristine()
  const had = new Set(w.pages.keys())

  await takeSnapshot('before-restore')

  // 1. Merge: brings in whatever this device doesn't have (everything, on a new device)
  applyOutside(`ws:${w.id}`, w.doc, b.docs.get(wsDocId)!, ORIGIN_SYSTEM)
  const total = bPages.size
  let step = 0
  for (const id of bPages.keys()) {
    const u = b.docs.get(pageDocId(id))
    if (u) {
      try {
        applyOutside(pageDocId(id), await getDoc(pageDocId(id)), u, ORIGIN_SYSTEM)
      } catch {
        result.failed++
      }
    }
    if (++step % 25 === 0) {
      onProgress?.(step / 2, total)
      await breathe()
    }
  }

  // 2. Pages deleted for good since the backup come back (those that were in the backup's own
  //    trash only when rolling back, and into the trash)
  const revived: string[] = []
  w.doc.transact(() => {
    bPages.forEach((p, id) => {
      if (w.pages.has(id)) return
      if (p.fields.get('deletedAt') && mode !== 'rollback') return
      const m = new Y.Map<unknown>()
      w.pages.set(id, m)
      p.fields.forEach((v, k) => m.set(k, clone(v)))
      if (p.props) {
        const props = new Y.Map<PropValue>()
        m.set('props', props)
        Object.entries(p.props).forEach(([k, v]) => props.set(k, v))
      }
      revived.push(id)
    })
    // A page whose parent didn't come back goes to the top level (a row becomes a page)
    for (const id of revived) {
      const m = w.pages.get(id)!
      const parent = m.get('parentId') as string | null
      if (parent && !w.pages.has(parent)) {
        m.set('parentId', null)
        if (m.get('type') === 'row') m.set('type', 'page')
      }
    }
  }, ORIGIN_SYSTEM)
  // Counted together: pages this workspace didn't have (a new device) and pages it had deleted for good
  bPages.forEach((_p, id) => {
    const m = w.pages.get(id)
    if (m && !had.has(id) && !m.get('deletedAt')) result.revived++
  })

  // 3. Pages that exist on both sides with different content
  const changed = new Set<string>()
  step = 0
  for (const [id, p] of bPages) {
    if (++step % 25 === 0) {
      onProgress?.(total / 2 + step / 2, total)
      await breathe()
    }
    if (!p.fields.get('deletedAt')) result.pages++
    const u = b.docs.get(pageDocId(id))
    if (!u || !w.pages.has(id)) continue
    try {
      const doc = await getDoc(pageDocId(id))
      const old = updateToJson(u)
      const now = yXmlFragmentToProsemirrorJSON(doc.getXmlFragment('default')) as JSONContent
      if (canon(old) === canon(now)) continue
      if (mode === 'merge') {
        const hash = fingerprint([u])
        if ((await listVersions(id)).some((v) => v.hash === hash)) continue
        await saveVersion({ pageId: id, ts: b.takenAt, reason: 'backup', title: String(p.fields.get('title') ?? ''), chars: plainLength(old), bytes: u.length, hash }, u)
      } else {
        await captureVersion(id, 'before-restore')
        await writePageContent(id, old)
      }
      changed.add(id)
    } catch {
      result.failed++
    }
  }

  // 4. Rolling back: titles, icons, places in the tree, database columns and cell values as well
  if (mode === 'rollback') {
    w.doc.transact(() => {
      bPages.forEach((p, id) => {
        const m = w.pages.get(id)
        if (!m || revived.includes(id)) return
        let touched = false
        for (const k of ROLLBACK_FIELDS) {
          if (!p.fields.has(k)) continue
          let v = p.fields.get(k)
          if (k === 'parentId' && v && !w.pages.has(v as string)) v = null
          if (canon(m.get(k)) === canon(v)) continue
          m.set(k, clone(v))
          touched = true
        }
        // Out of the trash when it was a live page then; a page that is live now never goes into it
        if (m.get('deletedAt') && !p.fields.get('deletedAt')) {
          m.set('deletedAt', null)
          touched = true
        }
        if (p.props) {
          let props = m.get('props') as Y.Map<PropValue> | undefined
          if (!(props instanceof Y.Map)) {
            props = new Y.Map<PropValue>()
            m.set('props', props)
          }
          const target = props
          for (const k of [...target.keys()]) {
            if (!(k in p.props)) {
              target.delete(k)
              touched = true
            }
          }
          for (const [k, v] of Object.entries(p.props)) {
            if (canon(target.get(k)) === canon(v)) continue
            target.set(k, v)
            touched = true
          }
        }
        if (touched) {
          m.set('updatedAt', Date.now())
          changed.add(id)
        }
      })
    }, ORIGIN_SYSTEM)
  }
  result.changed = changed.size

  // 5. Pictures
  for (const a of b.assets) {
    try {
      if (await restoreAsset(a.id, a.type, a.blob)) result.assets++
    } catch {
      result.failed++
    }
  }

  // 6. Restored into a brand-new workspace: the untouched welcome pages make way
  if (wasPristine) {
    const starters = [...w.pages.keys()].filter((id) => !bPages.has(id) && w.pages.get(id)?.get('seed'))
    for (const id of starters) if (w.pages.has(id)) await w.purgePage(id)
  }

  await flushWrites()
  onProgress?.(total, total)
  return result
}

function plainLength(node: JSONContent): number {
  if (node.type === 'text') return node.text?.length ?? 0
  return (node.content ?? []).reduce((n, c) => n + plainLength(c), 0)
}
