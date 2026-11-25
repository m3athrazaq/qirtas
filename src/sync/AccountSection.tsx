import { Check, Copy, KeyRound, Laptop, Link2, LogOut, Smartphone, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useStore } from '../data/store'
import { t } from '../lib/i18n'
import { Row } from '../shell/SettingsDialog'
import { emergencyBackup } from '../data/autobackup'
import { num } from '../lib/hijri'
import { copyText } from '../lib/platform'
import { formatWhen } from '../lib/when'
import { askConfirm, askText } from '../ui/dialogs'
import { syncAvailable } from './config'
import { friendlyError } from './errors'
import {
  accountDevices,
  deleteAccount,
  hasUnsyncedWork,
  linkWithCode,
  linkWithRecoveryKey,
  makeLinkCode,
  newRecoveryKey,
  relinkWithCode,
  removeDevice,
  renameAccount,
  signOut,
  startAccount,
  useSession,
  type DeviceInfo,
} from './session'

export function AccountSection() {
  const user = useSession((s) => s.user)
  // Shown right after the account is made (once): the key that recovers it
  const [recovery, setRecovery] = useState<string | null>(null)
  if (!syncAvailable()) {
    return (
      <div className="account-empty">
        <p>{t('syncOff')}</p>
      </div>
    )
  }
  return (
    <>
      {recovery && <RecoveryKey value={recovery} onDone={() => setRecovery(null)} />}
      {user ? <Linked onRecovery={setRecovery} /> : <NotLinked onRecovery={setRecovery} />}
    </>
  )
}

/** 25 characters in groups of five, easy to copy by hand. */
const groups = (key: string) => key.match(/.{1,5}/g)?.join('-') ?? key

function RecoveryKey({ value, onDone }: { value: string; onDone: () => void }) {
  const toast = useStore((s) => s.toast)
  return (
    <div className="recovery-box">
      <div className="recovery-head">
        <KeyRound size={18} />
        <b>{t('recoveryTitle')}</b>
      </div>
      <p className="muted small">{t('recoveryExplain')}</p>
      <code className="recovery-key" dir="ltr">
        {groups(value)}
      </code>
      <div className="recovery-actions">
        <button
          type="button"
          className="btn"
          onClick={async () => {
            if (await copyText(groups(value))) toast(t('copied'))
          }}
        >
          <Copy size={15} /> {t('copy')}
        </button>
        <button type="button" className="btn btn-primary" onClick={onDone}>
          <Check size={15} /> {t('recoverySaved')}
        </button>
      </div>
    </div>
  )
}

function NotLinked({ onRecovery }: { onRecovery: (key: string) => void }) {
  const [mode, setMode] = useState<'start' | 'code' | 'key' | null>(null)
  const [name, setName] = useState(useStore.getState().settings.userName)
  const [code, setCode] = useState('')
  const [key, setKey] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setMsg(null)
    try {
      await fn()
    } catch (err) {
      setMsg(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth link-setup">
      <p className="muted">{t('linkIntro')}</p>
      <div className="link-choices">
        <button type="button" className={'link-choice' + (mode === 'start' ? ' is-on' : '')} onClick={() => setMode('start')}>
          <Laptop size={18} />
          <span>
            <b>{t('linkFirst')}</b>
            <small className="muted">{t('linkFirstDesc')}</small>
          </span>
        </button>
        <button type="button" className={'link-choice' + (mode === 'code' ? ' is-on' : '')} onClick={() => setMode('code')}>
          <Smartphone size={18} />
          <span>
            <b>{t('linkJoin')}</b>
            <small className="muted">{t('linkJoinDesc')}</small>
          </span>
        </button>
      </div>
      {mode === 'start' && (
        <form
          className="link-form"
          onSubmit={(e) => {
            e.preventDefault()
            void run(async () => {
              if (name.trim()) useStore.getState().setSettings({ userName: name.trim() })
              onRecovery(await startAccount(name.trim()))
            })
          }}
        >
          <label className="field">
            <span>{t('fullName')}</span>
            <input className="input" dir="auto" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </label>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {t('linkStart')}
          </button>
        </form>
      )}
      {mode === 'code' && (
        <form
          className="link-form"
          onSubmit={(e) => {
            e.preventDefault()
            if (code.replace(/[^0-9a-z]/gi, '').length < 8) return
            void run(() => linkWithCode(code))
          }}
        >
          <p className="muted small">{t('linkJoinHow')}</p>
          <label className="field">
            <span>{t('linkCode')}</span>
            <input
              className="input link-code-input"
              dir="ltr"
              value={code}
              placeholder="XXXX-XXXX"
              autoCapitalize="characters"
              autoComplete="one-time-code"
              spellCheck={false}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
          </label>
          <button type="submit" className="btn btn-primary" disabled={busy || code.replace(/[^0-9a-z]/gi, '').length < 8}>
            {t('linkThisDevice')}
          </button>
        </form>
      )}
      {mode === 'key' && (
        <form
          className="link-form"
          onSubmit={(e) => {
            e.preventDefault()
            void run(() => linkWithRecoveryKey(key))
          }}
        >
          <label className="field">
            <span>{t('recoveryTitle')}</span>
            <input className="input link-code-input" dir="ltr" value={key} placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX" spellCheck={false} onChange={(e) => setKey(e.target.value.toUpperCase())} />
          </label>
          <button type="submit" className="btn btn-primary" disabled={busy || key.replace(/[^0-9a-z]/gi, '').length < 25}>
            {t('linkThisDevice')}
          </button>
        </form>
      )}
      {msg && <p className="auth-msg">{msg}</p>}
      {mode !== 'key' && (
        <button type="button" className="btn-text link-lost" onClick={() => setMode('key')}>
          {t('linkLost')}
        </button>
      )}
    </div>
  )
}

function Linked({ onRecovery }: { onRecovery: (key: string) => void }) {
  const user = useSession((s) => s.user)!
  const role = useSession((s) => s.role)
  const status = useStore((s) => s.syncStatus)
  const pendingSync = useStore((s) => s.pendingSync)
  const lastSyncedAt = useStore((s) => s.lastSyncedAt)
  const settings = useStore((s) => s.settings)
  const toast = useStore((s) => s.toast)
  const [devices, setDevices] = useState<DeviceInfo[] | null>(null)
  const [code, setCode] = useState<{ code: string; expires_at: number } | null>(null)
  const [left, setLeft] = useState(0)
  const [leaving, setLeaving] = useState(false)
  const [relink, setRelink] = useState<string | null>(null)

  const load = useCallback(() => {
    void accountDevices().then(setDevices, () => setDevices((d) => d ?? []))
  }, [])
  useEffect(() => {
    load()
    const back = () => document.visibilityState === 'visible' && load()
    document.addEventListener('visibilitychange', back)
    return () => document.removeEventListener('visibilitychange', back)
  }, [load])

  // The code's minutes left; when it is used, the new device shows up in the list
  useEffect(() => {
    if (!code) return
    const tick = () => {
      const ms = code.expires_at - Date.now()
      if (ms <= 0) setCode(null)
      setLeft(Math.max(0, Math.ceil(ms / 60_000)))
    }
    tick()
    const timer = setInterval(() => {
      tick()
      load()
    }, 5000)
    return () => clearInterval(timer)
  }, [code, load])

  // Unlinking clears this device: anything the account doesn't have yet is saved to a file first
  const leave = async () => {
    if (leaving) return
    setLeaving(true)
    try {
      if (await hasUnsyncedWork()) {
        if (!(await askConfirm(t('signOutUnsynced'), { confirmLabel: t('signOutBackupFirst') }))) return
        let where: string
        try {
          where = await emergencyBackup()
        } catch {
          toast(t('bkFailed'))
          return
        }
        if (!(await askConfirm(where ? t('signOutSavedDevice', { where }) : t('signOutSavedDownload'), { confirmLabel: t('unlinkDevice'), danger: true }))) return
      } else if (!(await askConfirm(t('unlinkConfirm'), { confirmLabel: t('unlinkDevice') }))) return
      await signOut()
    } finally {
      setLeaving(false)
    }
  }

  const syncNote = [
    pendingSync > 0 ? t('syncPending', { n: num(pendingSync, settings.numerals) }) : '',
    lastSyncedAt ? t('syncLast', { when: formatWhen(lastSyncedAt, settings) }) : '',
  ]
    .filter(Boolean)
    .join(' — ')

  return (
    <>
      <Row label={t('syncAccount')} desc={user.name || ''}>
        <span className={'sync-pill is-' + status}>{status === 'synced' ? t('syncedNow') : status === 'syncing' ? t('syncing') : status === 'offline' ? t('offline') : t('syncOff')}</span>
      </Row>
      {syncNote && <p className="muted small set-note sync-note">{syncNote}</p>}
      {role && (
        <Row label={t('workspace')}>
          <span className="muted">{role === 'owner' ? t('owner') : role === 'editor' ? t('canEdit') : t('canView')}</span>
        </Row>
      )}
      <Row label={t('fullName')}>
        <button
          type="button"
          className="btn btn-small"
          onClick={async () => {
            const name = await askText(t('fullName'), { initial: user.name })
            if (name === null || name === undefined || !name.trim()) return
            try {
              await renameAccount(name.trim())
              useStore.getState().setSettings({ userName: name.trim() })
              useSession.setState({ user: { ...user, name: name.trim() } })
            } catch (err) {
              toast(friendlyError(err))
            }
          }}
        >
          {t('rename')}
        </button>
      </Row>

      <div className="devices">
        <div className="devices-head">
          <b>{t('yourDevices')}</b>
          <button
            type="button"
            className="btn btn-small"
            onClick={async () => {
              try {
                setCode(await makeLinkCode())
              } catch (err) {
                toast(friendlyError(err))
              }
            }}
          >
            <Link2 size={15} /> {t('linkAnother')}
          </button>
        </div>
        {code && (
          <div className="link-code-box">
            <p className="muted small">{t('linkCodeHow')}</p>
            <code className="link-code" dir="ltr">
              {code.code}
            </code>
            <p className="muted small">{t('linkCodeLeft', { n: num(left, settings.numerals) })}</p>
          </div>
        )}
        <ul className="device-list">
          {(devices ?? []).map((d) => (
            <li key={d.id}>
              <span className="device-name">
                {d.label || t('thisDevice')}
                {d.current && <span className="muted"> ({t('thisDevice')})</span>}
              </span>
              <span className="muted small">{t('deviceSeen', { when: formatWhen(d.seen_at, settings) })}</span>
              {!d.current && (
                <button
                  type="button"
                  className="icon-btn"
                  title={t('removeDevice')}
                  aria-label={t('removeDevice')}
                  onClick={async () => {
                    if (!(await askConfirm(t('removeDeviceConfirm', { name: d.label }), { confirmLabel: t('removeDevice'), danger: true }))) return
                    try {
                      await removeDevice(d.id)
                      load()
                    } catch (err) {
                      toast(friendlyError(err))
                    }
                  }}
                >
                  <X size={15} />
                </button>
              )}
            </li>
          ))}
        </ul>
        {relink === null ? (
          <button type="button" className="btn-text link-lost" onClick={() => setRelink('')}>
            {t('relink')}
          </button>
        ) : (
          <form
            className="link-form"
            onSubmit={async (e) => {
              e.preventDefault()
              try {
                await relinkWithCode(relink)
                setRelink(null)
              } catch (err) {
                toast(friendlyError(err))
              }
            }}
          >
            <p className="muted small">{t('relinkHow')}</p>
            <input
              className="input link-code-input"
              dir="ltr"
              value={relink}
              placeholder="XXXX-XXXX"
              autoCapitalize="characters"
              spellCheck={false}
              onChange={(e) => setRelink(e.target.value.toUpperCase())}
            />
            <button type="submit" className="btn btn-primary" disabled={relink.replace(/[^0-9a-z]/gi, '').length < 8}>
              {t('linkThisDevice')}
            </button>
          </form>
        )}
      </div>

      <Row label={t('recoveryTitle')} desc={t('recoveryDesc')}>
        <button
          type="button"
          className="btn btn-small"
          onClick={async () => {
            if (!(await askConfirm(t('recoveryNewConfirm'), { confirmLabel: t('recoveryNew') }))) return
            try {
              onRecovery(await newRecoveryKey())
            } catch (err) {
              toast(friendlyError(err))
            }
          }}
        >
          <KeyRound size={15} /> {t('recoveryNew')}
        </button>
      </Row>

      <div className="settings-actions">
        <button type="button" className="btn" disabled={leaving} onClick={() => void leave()}>
          <LogOut size={15} /> {t('unlinkDevice')}
        </button>
      </div>
      <div className="danger-zone">
        <button
          type="button"
          className="btn is-danger"
          onClick={async () => {
            const word = await askText(t('deleteAccountConfirm'), { requireText: t('wipeWord'), danger: true, confirmLabel: t('delete') })
            if (word?.trim() !== t('wipeWord')) return
            try {
              await deleteAccount()
            } catch (err) {
              toast(friendlyError(err))
            }
          }}
        >
          {t('deleteAccount')}
        </button>
      </div>
    </>
  )
}
