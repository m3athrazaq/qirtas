// Restore points: the state of every document, kept in the vault once a day and before risky steps
// (restoring a backup, signing in, a new app version).
import { collectDocs, describeWorkspace, type BackupData } from './backup'
import { useStore } from './store'
import { deleteSnapshots, fingerprint, listSnapshots, loadSnapshot, saveSnapshot, snapshotsToDrop, type SnapshotMeta, type SnapshotReason } from './vault'

const HOUR = 3600_000
const VERSION_KEY = 'qirtas.appVersion'

/** Keep a restore point of the current state. Returns the point that now holds it (an existing one
 *  when nothing changed since), or null when it could not be made. Never throws. */
export async function takeSnapshot(reason: SnapshotReason): Promise<SnapshotMeta | null> {
  try {
    const docs = await collectDocs()
    if (!docs.size) return null
    const ids = [...docs.keys()].sort()
    const hash = fingerprint(ids.map((id) => docs.get(id)!))
    const list = await listSnapshots()
    if (list[0]?.hash === hash) return list[0]
    const st = useStore.getState()
    const wsId = st.ws?.id ?? ''
    const wsUpdate = docs.get(`ws:${wsId}`)
    const info = wsUpdate ? describeWorkspace(wsUpdate) : { pages: 0, name: '' }
    let bytes = 0
    docs.forEach((u) => (bytes += u.length))
    const meta = { ts: Date.now(), reason, wsId, wsName: info.name || st.wsName || '', pages: info.pages, bytes, hash }
    const id = await saveSnapshot(meta, docs)
    await deleteSnapshots(snapshotsToDrop(await listSnapshots(), Date.now())).catch(() => {})
    return { id, ...meta }
  } catch (err) {
    console.warn('[qirtas] restore point failed', err)
    return null
  }
}

/** A restore point as backup data, ready for restore.ts. */
export async function snapshotData(meta: SnapshotMeta): Promise<BackupData | null> {
  const docs = await loadSnapshot(meta.id)
  if (!docs) return null
  return { takenAt: meta.ts, wsId: meta.wsId, wsName: meta.wsName, docs, assets: [], unreadable: 0 }
}

async function dailyCheck() {
  try {
    const st = useStore.getState()
    // Nothing of the user's yet: no point keeping copies of the welcome pages
    if (!st.ws || st.ws.isPristine()) return
    let previous: string | null = null
    const build = `${__APP_VERSION__}+${__BUILD_ID__}`
    try {
      previous = localStorage.getItem(VERSION_KEY)
      localStorage.setItem(VERSION_KEY, build)
    } catch {
      /* storage unavailable */
    }
    if (previous && previous !== build) {
      await takeSnapshot('before-update')
      return
    }
    const last = (await listSnapshots()).find((s) => s.reason === 'auto' || s.reason === 'before-update')
    if (!last || Date.now() - last.ts > 20 * HOUR) await takeSnapshot('auto')
  } catch {
    /* vault unavailable */
  }
}

let started = false
/** One restore point a day, made while the app is open (the first check runs shortly after start). */
export function startSnapshotSchedule() {
  if (started) return
  started = true
  setTimeout(() => void dailyCheck(), 12_000)
  setInterval(() => void dailyCheck(), HOUR)
}
