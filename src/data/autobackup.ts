// Automatic backups outside the app: one file a day, in a folder you choose (computer: Chrome or Edge)
// or in Documents/Qirtas (Android). The files survive clearing the browser or removing the app, and a
// folder inside OneDrive or Google Drive puts them in the cloud as well.
import { create } from 'zustand'
import { backupFileName, buildBackupBlob, buildBackupParts, collectDocs, IncompleteBackupError, type BackupInfo } from './backup'
import { useStore } from './store'
import { fingerprint, vaultGet, vaultSet } from './vault'
import { isNative, saveFile } from '../lib/platform'

const KEY = 'qirtas.autobackup'
const DEVICE_KEY = 'qirtas.device'
const HANDLE_KEY = 'backupDir'
const HOUR = 3600_000
const DAY = 24 * HOUR
const KEEP = 7
const ANDROID_DIR = 'Qirtas'
/** Pictures larger than this in total stay out of the automatic file (a download by hand has them):
 *  the file is put together in memory, and a phone has less of it. */
const AUTO_ASSET_MAX = { folder: 400 * 1024 * 1024, device: 60 * 1024 * 1024 }
/** Set while a backup runs, refreshed every few seconds: a fresh one means another window is writing
 *  now; an old one means a backup never finished (the app was closed or ran out of memory). */
const RUNNING_KEY = 'qirtas.autobackup.running'
const BEAT = 5000
const OWNER = Math.random().toString(36).slice(2)
interface RunMark {
  owner: string
  beat: number
  /** Backups in a row that never finished. */
  fails: number
}
function readMark(): RunMark | null {
  try {
    const m = JSON.parse(localStorage.getItem(RUNNING_KEY) || 'null') as RunMark | null
    return m && typeof m.beat === 'number' ? m : null
  } catch {
    return null
  }
}
function writeMark(m: RunMark | null) {
  try {
    if (m) localStorage.setItem(RUNNING_KEY, JSON.stringify(m))
    else localStorage.removeItem(RUNNING_KEY)
  } catch {
    /* ignore */
  }
}

/** folder: a chosen folder on the computer; device: Documents/Qirtas on the phone; manual: neither is possible here. */
export type BackupKind = 'folder' | 'device' | 'manual'

interface Saved {
  enabled: boolean
  lastAt: number
  lastHash: string
  lastName: string
  lastError: string
  /** Last backup of any kind, a downloaded file included (for the reminder). */
  lastAnyAt: number
  lastNagAt: number
  /** When this device first ran a version with backups: the reminder waits a few days from then. */
  since: number
  /** The last automatic file left the pictures out (too large). */
  noImages: boolean
}

export interface BackupState extends Saved {
  kind: BackupKind
  folderName: string
  /** The folder was chosen but the browser wants the permission confirmed again. */
  needsPermission: boolean
  busy: boolean
}

function load(): Saved {
  const base: Saved = { enabled: false, lastAt: 0, lastHash: '', lastName: '', lastError: '', lastAnyAt: 0, lastNagAt: 0, since: 0, noImages: false }
  try {
    return { ...base, ...(JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<Saved>) }
  } catch {
    return base
  }
}

function save(patch: Partial<Saved>) {
  // On top of what is stored, not of this window's copy: another window may have written since
  const next: Saved = { ...load(), ...patch }
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* ignore */
  }
  useBackup.setState(next)
}

type PermissionMode = { mode: 'readwrite' }
interface DirHandle {
  name: string
  queryPermission(o: PermissionMode): Promise<PermissionState>
  requestPermission(o: PermissionMode): Promise<PermissionState>
  getFileHandle(name: string, o?: { create?: boolean }): Promise<FileHandle>
  removeEntry(name: string): Promise<void>
  keys(): AsyncIterable<string>
}
interface FileHandle {
  createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void>; abort?(): Promise<void> }>
  getFile(): Promise<File>
}

export function backupKind(): BackupKind {
  if (isNative()) return 'device'
  return typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function' ? 'folder' : 'manual'
}

export const useBackup = create<BackupState>(() => ({ ...load(), kind: 'manual', folderName: '', needsPermission: false, busy: false }))

/** A short tag for this installation, so two devices writing to one folder never overwrite each other. */
function deviceTag(): string {
  try {
    let tag = localStorage.getItem(DEVICE_KEY)
    if (!tag || !/^[a-z0-9]{4}$/.test(tag)) {
      tag = Math.random().toString(36).slice(2, 6).padEnd(4, '0')
      localStorage.setItem(DEVICE_KEY, tag)
    }
    return tag
  } catch {
    return 'temp'
  }
}

const pad = (n: number) => String(n).padStart(2, '0')
/** `keep`: a file the rotation never removes (the copy made before signing out). */
export function autoBackupName(date = new Date(), keep = false): string {
  return `qirtas-backup-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${deviceTag()}${keep ? '-keep' : ''}.json`
}

/** After signing out or clearing the device: the next files get a new device tag, so the rotation
 *  never removes the files written before (another account's, the copy made before signing out),
 *  and a folder whose access was cleared is no longer counted as backing up. */
export function forgetBackupDevice() {
  try {
    localStorage.removeItem(DEVICE_KEY)
    localStorage.removeItem(RUNNING_KEY)
  } catch {
    /* ignore */
  }
  const kind = backupKind()
  save({ lastHash: '', lastName: '', lastError: '', lastAt: 0, ...(kind === 'folder' ? { enabled: false } : {}) })
}

/** This installation's backup files that are older than the newest `keep`. */
export function filesToPrune(names: string[], tag: string, keep = KEEP): string[] {
  const mine = names.filter((n) => new RegExp(`^qirtas-backup-\\d{4}-\\d{2}-\\d{2}-${tag}\\.json$`).test(n)).sort()
  return mine.slice(0, Math.max(0, mine.length - keep))
}

async function folderHandle(): Promise<DirHandle | null> {
  try {
    return ((await vaultGet<DirHandle>(HANDLE_KEY)) as DirHandle | undefined) ?? null
  } catch {
    return null
  }
}

/** Phones: on from the start when no permission question is needed (Android 13 and later). */
async function applyDefaults(kind: BackupKind) {
  let first = false
  try {
    first = localStorage.getItem(KEY) === null
  } catch {
    return
  }
  if (!first) {
    if (!useBackup.getState().since) save({ since: Date.now() })
    return
  }
  let enabled = false
  if (kind === 'device') {
    try {
      const { Filesystem } = await import('@capacitor/filesystem')
      enabled = (await Filesystem.checkPermissions()).publicStorage === 'granted'
    } catch {
      enabled = false
    }
  }
  save({ enabled, since: Date.now() })
}

/** Read the saved choices and whether the folder can be written to right now. */
export async function refreshBackupState(): Promise<void> {
  const kind = backupKind()
  await applyDefaults(kind)
  const patch: Partial<BackupState> = { kind }
  if (kind === 'folder') {
    const h = await folderHandle()
    patch.folderName = h?.name ?? ''
    if (!h) patch.needsPermission = false
    else {
      try {
        patch.needsPermission = (await h.queryPermission({ mode: 'readwrite' })) !== 'granted'
      } catch {
        patch.needsPermission = true
      }
    }
  }
  useBackup.setState(patch)
}

/** Computer: choose the folder (call from a click). Turns automatic backups on and makes the first one. */
export async function chooseBackupFolder(): Promise<boolean> {
  const pick = (window as unknown as { showDirectoryPicker?: (o: object) => Promise<DirHandle> }).showDirectoryPicker
  if (!pick) return false
  let handle: DirHandle
  try {
    handle = await pick({ id: 'qirtas-backup', mode: 'readwrite', startIn: 'documents' })
  } catch {
    return false // closed without choosing
  }
  await vaultSet(HANDLE_KEY, handle)
  save({ enabled: true, lastError: '' })
  await refreshBackupState()
  await runBackup({ force: true })
  return true
}

/** Computer: confirm the folder permission again (call from a click), then back up. */
export async function grantFolderAccess(): Promise<boolean> {
  const h = await folderHandle()
  if (!h) return false
  try {
    if ((await h.requestPermission({ mode: 'readwrite' })) !== 'granted') return false
  } catch {
    return false
  }
  await refreshBackupState()
  await runBackup({})
  return true
}

/** Turn automatic backups on or off (on the phone, turning on makes the first one). */
export async function setAutoBackup(enabled: boolean): Promise<void> {
  save({ enabled, lastError: '' })
  if (enabled) await runBackup({ force: true })
}

async function writeToFolder(h: DirHandle, name: string, parts: string[], bytes: number) {
  const file = await h.getFileHandle(name, { create: true })
  const w = await file.createWritable() // written to a temporary file that replaces the old one on close
  try {
    await w.write(new Blob(parts, { type: 'application/json' }))
    await w.close()
  } catch (err) {
    await w.abort?.().catch(() => {})
    throw err
  }
  const size = (await file.getFile()).size
  if (size !== bytes) throw new Error(`size ${size} != ${bytes}`)
  const names: string[] = []
  for await (const n of h.keys()) names.push(n)
  for (const old of filesToPrune(names, deviceTag())) await h.removeEntry(old).catch(() => {})
}

async function writeToDevice(name: string, parts: string[], bytes: number) {
  const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')
  const directory = Directory.Documents
  const perm = await Filesystem.checkPermissions().catch(() => null)
  if (perm && perm.publicStorage !== 'granted') {
    const asked = await Filesystem.requestPermissions()
    if (asked.publicStorage !== 'granted') throw new Error('storage permission denied')
  }
  await Filesystem.mkdir({ path: ANDROID_DIR, directory, recursive: true }).catch(() => {})
  // Written under a temporary name and renamed at the end: a backup is never left half-written
  const tmp = `${ANDROID_DIR}/${name}.part`
  const final = `${ANDROID_DIR}/${name}`
  await Filesystem.deleteFile({ path: tmp, directory }).catch(() => {})
  await Filesystem.writeFile({ path: tmp, directory, data: '', encoding: Encoding.UTF8 })
  const CHUNK = 400_000
  let buf = ''
  const flush = async () => {
    if (!buf) return
    await Filesystem.appendFile({ path: tmp, directory, data: buf, encoding: Encoding.UTF8 })
    buf = ''
  }
  for (const part of parts) {
    for (let i = 0; i < part.length; i += CHUNK) {
      buf += part.slice(i, i + CHUNK)
      if (buf.length >= CHUNK) await flush()
    }
  }
  await flush()
  const size = (await Filesystem.stat({ path: tmp, directory })).size
  if (size !== bytes) {
    await Filesystem.deleteFile({ path: tmp, directory }).catch(() => {})
    throw new Error(`size ${size} != ${bytes}`)
  }
  await Filesystem.deleteFile({ path: final, directory }).catch(() => {})
  await Filesystem.rename({ from: tmp, to: final, directory, toDirectory: directory })
  const listing = await Filesystem.readdir({ path: ANDROID_DIR, directory }).catch(() => ({ files: [] as { name: string }[] }))
  for (const old of filesToPrune(listing.files.map((f) => f.name), deviceTag())) {
    await Filesystem.deleteFile({ path: `${ANDROID_DIR}/${old}`, directory }).catch(() => {})
  }
}

export type BackupOutcome = 'done' | 'unchanged' | 'off' | 'permission' | 'failed' | 'busy'

let running: Promise<BackupOutcome> | null = null

/** Write today's backup file. `force` writes even when nothing changed since the last one. */
export function runBackup(opts: { force?: boolean }): Promise<BackupOutcome> {
  if (running) return Promise.resolve('busy')
  running = doBackup(opts).finally(() => {
    running = null
    useBackup.setState({ busy: false })
  })
  return running
}

async function doBackup(opts: { force?: boolean }): Promise<BackupOutcome> {
  const st = useBackup.getState()
  const kind = backupKind()
  if (kind === 'manual' || !st.enabled) return 'off'
  let handle: DirHandle | null = null
  if (kind === 'folder') {
    handle = await folderHandle()
    if (!handle) {
      // The folder's access was cleared (signing out, clearing the device): say so instead of going quiet
      save({ enabled: false })
      return 'off'
    }
    let state: PermissionState = 'prompt'
    try {
      state = await handle.queryPermission({ mode: 'readwrite' })
    } catch {
      /* treated as not granted */
    }
    if (state !== 'granted') {
      useBackup.setState({ needsPermission: true })
      return 'permission'
    }
  }
  const mark = readMark()
  const live = !!mark && Date.now() - mark.beat < 6 * BEAT
  if (live && mark.owner !== OWNER) return 'busy' // another window is writing it right now
  // Backups that never finished, twice in a row (the app closed during them, or ran out of memory):
  // not again automatically today, and the settings say so. "Back up now" still tries.
  const fails = mark && !live ? mark.fails + 1 : 0
  if (!opts.force && fails >= 2 && Date.now() - mark!.beat < DAY) {
    save({ lastError: 'interrupted' })
    return 'failed'
  }
  writeMark({ owner: OWNER, beat: Date.now(), fails })
  const beat = setInterval(() => writeMark({ owner: OWNER, beat: Date.now(), fails }), BEAT)
  useBackup.setState({ busy: true, needsPermission: false })
  try {
    const docs = await collectDocs()
    const hash = fingerprint([...docs.keys()].sort().map((id) => docs.get(id)!))
    if (!opts.force && hash === st.lastHash) {
      // Nothing changed: the last file is still a full backup
      save({ lastAt: Date.now(), lastAnyAt: Date.now(), lastError: '' })
      return 'unchanged'
    }
    const { parts, info } = await buildBackupParts({ docs, maxAssetBytes: AUTO_ASSET_MAX[kind] })
    const name = autoBackupName()
    if (kind === 'folder') await writeToFolder(handle!, name, parts, info.bytes)
    else await writeToDevice(name, parts, info.bytes)
    save({ lastAt: Date.now(), lastAnyAt: Date.now(), lastHash: hash, lastName: name, lastError: '', noImages: info.assetsSkipped })
    return 'done'
  } catch (err) {
    console.warn('[qirtas] automatic backup failed', err)
    save({ lastError: String((err as Error)?.message ?? err).slice(0, 200) })
    return 'failed'
  } finally {
    clearInterval(beat)
    writeMark(null)
  }
}

/** Download a full backup file (the settings, the crash screen and signing out use it). When the
 *  device store can't be read, what is open in memory is still saved, and info.partial says so.
 *  Throws when there is nothing at all to save. */
export async function downloadBackup(): Promise<BackupInfo> {
  const { blob, info } = await buildBackupBlob()
  if (!info.docs) throw new IncompleteBackupError('nothing could be read')
  await saveFile(backupFileName(), blob, 'application/json')
  // A file saved by hand counts for the reminder (a partial one doesn't)
  if (!info.partial) save({ lastAnyAt: Date.now() })
  return info
}

/** A full backup right now, somewhere that outlives signing out: Documents/Qirtas on the phone (the
 *  place is returned), a downloaded file elsewhere (returns ''). Throws when it could not be written. */
export async function emergencyBackup(): Promise<string> {
  if (backupKind() !== 'device') {
    // Signing out goes ahead only with a complete copy
    if ((await downloadBackup()).partial) throw new IncompleteBackupError('partial')
    return ''
  }
  const { parts, info } = await buildBackupParts()
  if (info.partial || !info.docs) throw new IncompleteBackupError('partial')
  const name = autoBackupName(new Date(), true)
  await writeToDevice(name, parts, info.bytes)
  save({ lastAt: Date.now(), lastAnyAt: Date.now(), lastName: name, lastError: '' })
  return `Documents/${ANDROID_DIR}/${name}`
}

export type BackupNudge = null | 'permission' | 'stale' | 'failed'

/** What, if anything, the user should be told about backups right now. */
export function backupNudge(now = Date.now()): BackupNudge {
  const st = useBackup.getState()
  const ws = useStore.getState().ws
  if (!ws || ws.isPristine()) return null
  if (st.enabled && st.kind === 'folder' && st.needsPermission) return 'permission'
  if (st.enabled && st.lastError && now - st.lastAt > 2 * DAY) return 'failed'
  // No backup at all: say so after a few days of use, then weekly; with an old one, after two weeks
  const last = Math.max(st.lastAnyAt, st.since)
  if (!st.enabled && last && now - last > (st.lastAnyAt ? 14 : 3) * DAY && now - st.lastNagAt > 7 * DAY) return 'stale'
  return null
}

export function noteNudgeShown() {
  save({ lastNagAt: Date.now() })
}

let started = false
/** Back up once a day while the app is open (first check shortly after start, then every few hours). */
export function startBackupSchedule(onNudge: (n: Exclude<BackupNudge, null>) => void) {
  if (started) return
  started = true
  const check = async () => {
    await refreshBackupState()
    const st = useBackup.getState()
    const ws = useStore.getState().ws
    if (st.enabled && ws && !ws.isPristine() && Date.now() - st.lastAt > 20 * HOUR) await runBackup({})
    const nudge = backupNudge()
    if (nudge) onNudge(nudge)
  }
  setTimeout(() => void check(), 20_000)
  setInterval(() => void check(), 3 * HOUR)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - useBackup.getState().lastAt > 20 * HOUR) void check()
  })
}
