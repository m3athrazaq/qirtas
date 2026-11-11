// Settings → Data: automatic backups, backup files, restore points, storage, and erasing the device.
import { Download, FolderOpen, History, RotateCcw, ShieldCheck, Upload } from 'lucide-react'
import { useEffect, useState } from 'react'
import { pickFile } from '../data/assets'
import { chooseBackupFolder, downloadBackup, grantFolderAccess, refreshBackupState, runBackup, setAutoBackup, useBackup } from '../data/autobackup'
import { BackupFormatError, parseBackup, type BackupData } from '../data/backup'
import { resetDocs } from '../data/docs'
import { wipeAll } from '../data/idb'
import { planRestore, restoreData, type RestoreMode, type RestorePlan } from '../data/restore'
import { snapshotData, takeSnapshot } from '../data/snapshots'
import { useStore } from '../data/store'
import { listSnapshots, wipeVault, type SnapshotMeta } from '../data/vault'
import { num } from '../lib/hijri'
import { t, type Key } from '../lib/i18n'
import { isNative } from '../lib/platform'
import { formatBytes, formatWhen } from '../lib/when'
import { Modal } from '../ui/Modal'
import { askText } from '../ui/dialogs'
import { Row } from './SettingsDialog'

const REASON: Record<SnapshotMeta['reason'], Key> = {
  auto: 'rp_auto',
  manual: 'rp_manual',
  'before-restore': 'rp_before_restore',
  'before-signin': 'rp_before_signin',
  'before-update': 'rp_before_update',
}

export function DataSection() {
  const settings = useStore((s) => s.settings)
  const toast = useStore((s) => s.toast)
  const canEdit = useStore((s) => s.wsRole !== 'viewer')
  const backup = useBackup()
  const [points, setPoints] = useState<SnapshotMeta[]>([])
  const [showAll, setShowAll] = useState(false)
  const [pending, setPending] = useState<{ data: BackupData; plan: RestorePlan } | null>(null)
  const [storage, setStorage] = useState<{ persisted: boolean | null; used: number | null }>({ persisted: null, used: null })
  const [busy, setBusy] = useState(false)

  const reloadPoints = () =>
    void listSnapshots()
      .then(setPoints)
      .catch(() => setPoints([]))

  useEffect(() => {
    void refreshBackupState()
    reloadPoints()
    void (async () => {
      try {
        const persisted = (await navigator.storage?.persisted?.()) ?? null
        const est = await navigator.storage?.estimate?.()
        setStorage({ persisted, used: est?.usage ?? null })
      } catch {
        /* not available */
      }
    })()
  }, [])

  const when = (ts: number) => formatWhen(ts, settings)

  const backupNow = async () => {
    const r = await runBackup({ force: true })
    if (r === 'done') toast(t('bkDone', { where: backup.kind === 'device' ? t('bkDocuments') : useBackup.getState().folderName }))
    else if (r === 'permission') toast(t('bkNeedsPermission'))
    else if (r === 'failed') toast(t('bkFailed'))
  }

  const openRestore = (data: BackupData) => {
    try {
      setPending({ data, plan: planRestore(data) })
    } catch {
      toast(t('rsBadFile'))
    }
  }

  const restoreFromFile = async () => {
    const f = await pickFile('application/json,.json')
    if (!f) return
    try {
      openRestore(await parseBackup(f))
    } catch (err) {
      toast(err instanceof BackupFormatError ? t('rsBadFile') : t('rsFailed', { msg: String((err as Error).message) }))
    }
  }

  const restoreFromPoint = async (p: SnapshotMeta) => {
    const data = await snapshotData(p).catch(() => null)
    if (data) openRestore(data)
    else toast(t('rsBadFile'))
  }

  const shown = showAll ? points : points.slice(0, 5)

  return (
    <>
      <h3 className="set-head">{t('bkAuto')}</h3>
      {backup.kind === 'folder' && (
        <Row label={backup.folderName ? t('bkFolderLabel', { name: backup.folderName }) : t('bkAuto')} desc={t('bkAutoFolderDesc')}>
          {backup.folderName ? (
            <div className="set-stack">
              <input type="checkbox" className="switch" aria-label={t('bkAuto')} checked={backup.enabled} onChange={(e) => void setAutoBackup(e.target.checked)} />
              <button type="button" className="btn-text" onClick={() => void chooseBackupFolder()}>
                {t('bkChangeFolder')}
              </button>
            </div>
          ) : (
            <button type="button" className="btn btn-primary" onClick={() => void chooseBackupFolder().then((ok) => ok && toast(t('bkDone', { where: useBackup.getState().folderName })))}>
              <FolderOpen size={15} /> {t('bkChooseFolder')}
            </button>
          )}
        </Row>
      )}
      {backup.kind === 'device' && (
        <Row label={t('bkDocuments')} desc={t('bkAutoDeviceDesc')}>
          <input type="checkbox" className="switch" aria-label={t('bkAuto')} checked={backup.enabled} onChange={(e) => void setAutoBackup(e.target.checked)} />
        </Row>
      )}
      {backup.kind === 'manual' && <p className="muted small set-note">{t('bkAutoManualDesc')}</p>}
      {backup.kind !== 'manual' && backup.enabled && (
        <div className="set-status">
          <span className={backup.lastError ? 'is-bad' : ''}>
            {backup.lastError ? t('bkFailed') : backup.lastAt ? t('bkLast', { when: when(backup.lastAt) }) : t('bkNone')}
          </span>
          {backup.kind === 'folder' && backup.needsPermission ? (
            <button type="button" className="btn btn-small" onClick={() => void grantFolderAccess().then((ok) => ok && toast(t('bkDone', { where: useBackup.getState().folderName })))}>
              {t('bkAllow')}
            </button>
          ) : (
            <button type="button" className="btn btn-small" disabled={backup.busy} onClick={() => void backupNow()}>
              {t('bkNow')}
            </button>
          )}
        </div>
      )}

      <h3 className="set-head">{t('bkManual')}</h3>
      <p className="muted small set-note">{t('bkManualDesc')}</p>
      <div className="settings-actions">
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            try {
              await downloadBackup()
              toast(t('backupDone'))
            } catch (err) {
              toast(t('rsFailed', { msg: String((err as Error).message) }))
            } finally {
              setBusy(false)
            }
          }}
        >
          <Download size={15} /> {t('backupExport')}
        </button>
        <button type="button" className="btn" disabled={!canEdit} onClick={() => void restoreFromFile()}>
          <Upload size={15} /> {t('backupImport')}
        </button>
      </div>

      <h3 className="set-head">{t('rpTitle')}</h3>
      <p className="muted small set-note">{t('rpDesc')}</p>
      <div className="point-list">
        {!points.length && <div className="menu-empty">{t('rpEmpty')}</div>}
        {shown.map((p) => (
          <div key={p.id} className="point-row">
            <History size={15} className="muted" />
            <span className="point-when">{when(p.ts)}</span>
            <span className="muted small">
              {t(REASON[p.reason] ?? 'rp_auto')} · {t('rpPages', { n: num(p.pages, settings.numerals) })}
            </span>
            <span className="spacer" />
            <button type="button" className="btn-text" disabled={!canEdit} onClick={() => void restoreFromPoint(p)}>
              <RotateCcw size={14} /> {t('restore')}
            </button>
          </div>
        ))}
      </div>
      <div className="settings-actions">
        <button
          type="button"
          className="btn"
          onClick={async () => {
            const before = points[0]?.id
            const made = await takeSnapshot('manual')
            toast(made ? (made.id === before ? t('rpSame') : t('rpCreated')) : t('bkFailed'))
            reloadPoints()
          }}
        >
          {t('rpCreate')}
        </button>
        {points.length > 5 && !showAll && (
          <button type="button" className="btn-text" onClick={() => setShowAll(true)}>
            {t('rpShowAll', { n: num(points.length, settings.numerals) })}
          </button>
        )}
      </div>

      {!isNative() && storage.persisted !== null && (
        <>
          <h3 className="set-head">{t('stTitle')}</h3>
          <div className="set-status">
            <span className={storage.persisted ? 'is-good' : ''}>
              {storage.persisted && <ShieldCheck size={15} />} {storage.persisted ? t('stProtected') : t('stUnprotected')}
            </span>
            {!storage.persisted && (
              <button
                type="button"
                className="btn btn-small"
                onClick={async () => {
                  const ok = await navigator.storage.persist().catch(() => false)
                  setStorage((s) => ({ ...s, persisted: ok }))
                }}
              >
                {t('stProtect')}
              </button>
            )}
          </div>
          {storage.used !== null && <p className="muted small set-note">{t('stUsed', { used: formatBytes(storage.used, settings) })}</p>}
        </>
      )}

      <div className="danger-zone">
        <button
          type="button"
          className="btn is-danger"
          onClick={async () => {
            const word = await askText(t('wipeConfirm'), { requireText: t('wipeWord'), danger: true, confirmLabel: t('delete') })
            if (word?.trim() !== t('wipeWord')) return
            resetDocs()
            await wipeAll()
            await wipeVault().catch(() => {})
            localStorage.clear()
            location.hash = ''
            location.reload()
          }}
        >
          {t('wipe')}
        </button>
      </div>
      <p className="muted small">
        {t('version')} {__APP_VERSION__} · {__BUILD_DATE__}
      </p>

      {pending && (
        <RestoreDialog
          data={pending.data}
          plan={pending.plan}
          onClose={() => {
            setPending(null)
            reloadPoints()
          }}
        />
      )}
    </>
  )
}

function RestoreDialog({ data, plan, onClose }: { data: BackupData; plan: RestorePlan; onClose: () => void }) {
  const settings = useStore((s) => s.settings)
  const toast = useStore((s) => s.toast)
  const [mode, setMode] = useState<RestoreMode>('merge')
  const [progress, setProgress] = useState<number | null>(null)
  const n = (x: number) => num(x, settings.numerals)

  const run = async () => {
    setProgress(0)
    try {
      const r = await restoreData(data, mode, (done, total) => setProgress(total ? Math.round((done / total) * 100) : 100))
      toast(r.revived || r.changed || r.assets ? t('rsDone', { revived: n(r.revived), changed: n(r.changed) }) : t('rsDoneNothing'))
      onClose()
    } catch (err) {
      setProgress(null)
      toast(t('rsFailed', { msg: String((err as Error).message) }))
    }
  }

  return (
    <Modal open onClose={() => progress === null && onClose()} title={t('rsTitle', { when: formatWhen(plan.takenAt, settings) })} width={500}>
      <div className="restore">
        <p>
          {t('rsSummary', { n: n(plan.pages), ws: plan.wsName || t('appName') })} {plan.missing > 0 && t('rsMissing', { n: n(plan.missing) })}
        </p>
        {!plan.sameWorkspace && <p className="restore-warn">{t('rsOtherWs')}</p>}
        {plan.otherWorkspaces > 0 && <p className="muted small">{t('rsSkipped')}</p>}
        {data.unreadable > 0 && <p className="restore-warn">{t('rsUnreadable', { n: n(data.unreadable) })}</p>}
        <div className="restore-modes" role="radiogroup">
          {(['merge', 'rollback'] as RestoreMode[]).map((m) => (
            <label key={m} className={'restore-mode' + (mode === m ? ' is-on' : '')}>
              <input type="radio" name="restore-mode" checked={mode === m} disabled={progress !== null} onChange={() => setMode(m)} />
              <span>
                <b>{t(m === 'merge' ? 'rsMerge' : 'rsRollback')}</b>
                <span className="muted small">{t(m === 'merge' ? 'rsMergeDesc' : 'rsRollbackDesc')}</span>
              </span>
            </label>
          ))}
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn" disabled={progress !== null} onClick={onClose}>
            {t('cancel')}
          </button>
          <button type="button" className="btn btn-primary" disabled={progress !== null} onClick={() => void run()}>
            {progress === null ? t('restore') : `${t('rsRunning')} ${n(progress)}${settings.lang === 'ar' ? '٪' : '%'}`}
          </button>
        </div>
      </div>
    </Modal>
  )
}
