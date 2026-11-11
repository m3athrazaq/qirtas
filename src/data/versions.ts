// Version history of each page's content: copies taken while you write (and while changes arrive
// from other devices), kept in the vault, so a page can go back to how it was earlier.
import type { JSONContent } from '@tiptap/core'
import { yXmlFragmentToProsemirrorJSON } from '@tiptap/y-tiptap'
import * as Y from 'yjs'
import { getDoc, onDocDestroy, onDocLoaded, onDocUpdate, pageDocId, peekDoc } from './docs'
import { useStore } from './store'
import { deleteVersions, fingerprint, listVersions, loadVersion, saveVersion, versionsToDrop, type VersionMeta, type VersionReason } from './vault'

/** At least this long between two automatic versions of a page. */
export const VERSION_GAP = 10 * 60_000
/** A pause this long ends a stretch of writing: the version is taken then. */
export const VERSION_IDLE = 90_000

interface Track {
  dirty: boolean
  dirtySince: number
  lastSaved: number
  lastHash: string
  timer: ReturnType<typeof setTimeout> | null
  /** Resolves once the stored history's latest version is known. */
  ready: Promise<void>
  /** Saves run one after the other. */
  queue: Promise<unknown>
}

const tracks = new Map<string, Track>()

function textLength(node: Y.XmlFragment | Y.XmlElement): number {
  let n = 0
  node.forEach((child) => {
    if (child instanceof Y.XmlText) n += child.length
    else if (child instanceof Y.XmlElement) n += textLength(child)
  })
  return n
}

function isEmpty(doc: Y.Doc): boolean {
  const frag = doc.getXmlFragment('default')
  if (frag.length === 0) return true
  // A lone empty paragraph is what a new page holds
  if (frag.length > 1) return false
  const only = frag.get(0)
  return only instanceof Y.XmlElement && only.nodeName === 'paragraph' && only.length === 0
}

function track(pageId: string): Track {
  let t = tracks.get(pageId)
  if (!t) {
    const fresh: Track = { dirty: false, dirtySince: 0, lastSaved: 0, lastHash: '', timer: null, ready: Promise.resolve(), queue: Promise.resolve() }
    // Pick up where the stored history ends, so reopening the app doesn't repeat a version
    fresh.ready = listVersions(pageId)
      .then((list) => {
        if (list[0]) {
          fresh.lastSaved = list[0].ts
          fresh.lastHash = list[0].hash
        }
      })
      .catch(() => {})
    tracks.set(pageId, (t = fresh))
  }
  return t
}

interface Shot {
  update: Uint8Array
  hash: string
  chars: number
  empty: boolean
  title: string
}

function shoot(pageId: string, doc: Y.Doc): Shot {
  const update = Y.encodeStateAsUpdate(doc)
  return { update, hash: fingerprint([update]), chars: textLength(doc.getXmlFragment('default')), empty: isEmpty(doc), title: useStore.getState().pages[pageId]?.title ?? '' }
}

function store(pageId: string, reason: VersionReason, shot: Shot, ts = Date.now()): Promise<VersionMeta | null> {
  const t = track(pageId)
  const run = async (): Promise<VersionMeta | null> => {
    await t.ready
    if (shot.hash === t.lastHash) return null
    // An empty page is not worth a version, unless it records that a page with a history was emptied
    if (shot.empty && !t.lastHash) return null
    // The very first version only: a page that already has a history doesn't need another "first"
    if (reason === 'first' && t.lastHash) return null
    const meta = { pageId, ts, reason, title: shot.title, chars: shot.chars, bytes: shot.update.length, hash: shot.hash }
    const id = await saveVersion(meta, shot.update)
    t.lastSaved = Date.now()
    t.lastHash = shot.hash
    void listVersions(pageId)
      .then((list) => deleteVersions(versionsToDrop(list, Date.now())))
      .catch(() => {})
    return { id, ...meta }
  }
  const p = t.queue.then(run, run).catch((err) => {
    console.warn('[qirtas] version not saved', err)
    return null
  })
  t.queue = p
  return p
}

/** Store the page's current content as a version. Returns it, or null when there was nothing new. */
export async function captureVersion(pageId: string, reason: VersionReason): Promise<VersionMeta | null> {
  const background = reason === 'auto' || reason === 'first'
  let doc = peekDoc(pageDocId(pageId))
  if (!doc && !background) doc = await getDoc(pageDocId(pageId)).catch(() => null)
  if (!doc) return null
  const t = track(pageId)
  if (t.timer) clearTimeout(t.timer)
  t.timer = null
  t.dirty = false
  // Counted from now, so the next automatic version keeps its distance even while this one is being written
  if (background) t.lastSaved = Date.now()
  return store(pageId, reason, shoot(pageId, doc))
}

function onChange(pageId: string) {
  const t = track(pageId)
  const now = Date.now()
  if (!t.dirty) {
    t.dirty = true
    t.dirtySince = now
  }
  if (t.timer) clearTimeout(t.timer)
  t.timer = null
  // Writing without a pause for a long time still gets its versions
  if (now - t.dirtySince > VERSION_GAP && now - t.lastSaved > VERSION_GAP) {
    void captureVersion(pageId, 'auto')
    return
  }
  // After a pause in the writing, but not more often than every VERSION_GAP
  const wait = Math.min(VERSION_GAP, Math.max(VERSION_IDLE, VERSION_GAP - (now - t.lastSaved)))
  t.timer = setTimeout(() => void captureVersion(pageId, 'auto'), wait)
}

function captureDirty() {
  tracks.forEach((t, pageId) => {
    if (t.dirty) void captureVersion(pageId, 'auto')
  })
}

let started = false
export function startVersionCapture() {
  if (started) return
  started = true
  // The first time a page with content is loaded, that content becomes its first version. The copy
  // is taken at once: a change arriving from another device right after must not be part of it.
  onDocLoaded((docId) => {
    if (!docId.startsWith('pg:')) return
    const doc = peekDoc(docId)
    if (!doc || isEmpty(doc)) return
    const pageId = docId.slice(3)
    void store(pageId, 'first', shoot(pageId, doc))
  })
  onDocUpdate((docId) => {
    if (docId.startsWith('pg:')) onChange(docId.slice(3))
  })
  onDocDestroy((docId) => {
    const drop = (id: string) => {
      const t = tracks.get(id)
      if (t?.timer) clearTimeout(t.timer)
      tracks.delete(id)
    }
    if (docId === null) [...tracks.keys()].forEach(drop)
    else if (docId.startsWith('pg:')) drop(docId.slice(3))
  })
  // Leaving the app: don't lose the last stretch of writing
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') captureDirty()
  })
  window.addEventListener('pagehide', captureDirty)
}

/** A stored version (or any page state) as editor content. */
export function updateToJson(update: Uint8Array): JSONContent {
  const doc = new Y.Doc()
  try {
    Y.applyUpdate(doc, update)
    return yXmlFragmentToProsemirrorJSON(doc.getXmlFragment('default')) as JSONContent
  } finally {
    doc.destroy()
  }
}

export async function versionJson(versionId: number): Promise<JSONContent | null> {
  const update = await loadVersion(versionId)
  return update ? updateToJson(update) : null
}

/** Put a version's content back into the page. What it replaces is kept as a version first and
 *  returned, so the step can be taken back. */
export async function restoreVersion(pageId: string, versionId: number): Promise<{ ok: boolean; previous: VersionMeta | null }> {
  const json = await versionJson(versionId)
  if (!json) return { ok: false, previous: null }
  // Either a new version of what the page holds now, or the one that already holds exactly that
  let previous = await captureVersion(pageId, 'before-restore')
  if (!previous) {
    const doc = peekDoc(pageDocId(pageId))
    const hash = doc ? fingerprint([Y.encodeStateAsUpdate(doc)]) : ''
    previous = (await listVersions(pageId).catch(() => [])).find((v) => v.hash === hash) ?? null
  }
  await writePageContent(pageId, json)
  // The page now holds a version that is already in the history: nothing new to record until it changes again
  const t = tracks.get(pageId)
  if (t) {
    if (t.timer) clearTimeout(t.timer)
    t.timer = null
    t.dirty = false
  }
  return { ok: true, previous }
}

/** Replace a page's content: through its open editor when there is one (so Ctrl+Z takes it back). */
export async function writePageContent(pageId: string, json: JSONContent) {
  const { getActiveEditor } = await import('../editor/PageEditor')
  const editor = getActiveEditor(pageId)
  if (editor && editor.isEditable) {
    editor.commands.setContent(json)
    return
  }
  const { setPageContent } = await import('../templates/build')
  await setPageContent(pageId, json)
}
