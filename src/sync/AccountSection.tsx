import { CloudOff, LogOut } from 'lucide-react'
import { useState } from 'react'
import { useStore } from '../data/store'
import { t } from '../lib/i18n'
import { Row } from '../shell/SettingsDialog'
import { emergencyBackup } from '../data/autobackup'
import { num } from '../lib/hijri'
import { formatWhen } from '../lib/when'
import { askConfirm, askText } from '../ui/dialogs'
import { syncAvailable } from './config'
import { friendlyError } from './errors'
import { deleteAccount, hasUnsyncedWork, resetPassword, signIn, signOut, signUp, updatePassword, useSession } from './session'

export function AccountSection() {
  const user = useSession((s) => s.user)
  if (!syncAvailable()) {
    return (
      <div className="account-empty">
        <CloudOff size={22} className="muted" />
        <p>{t('syncOff')}</p>
        <p className="muted small">{t('shareNeedsAccount')}</p>
      </div>
    )
  }
  return user ? <SignedIn /> : <AuthForm />
}

function AuthForm() {
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState(useStore.getState().settings.userName)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    try {
      if (mode === 'in') await signIn(email.trim(), password)
      else {
        if (name.trim()) useStore.getState().setSettings({ userName: name.trim() })
        const { needsConfirm } = await signUp(email.trim(), password, name.trim())
        if (needsConfirm) setMsg(t('confirmEmail'))
      }
    } catch (err) {
      setMsg(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="auth" onSubmit={submit}>
      <p className="muted">{t('accountIntro')}</p>
      <div className="seg">
        <button type="button" className={mode === 'in' ? 'is-on' : ''} onClick={() => setMode('in')}>
          {t('signIn')}
        </button>
        <button type="button" className={mode === 'up' ? 'is-on' : ''} onClick={() => setMode('up')}>
          {t('signUp')}
        </button>
      </div>
      {mode === 'up' && (
        <label className="field">
          <span>{t('fullName')}</span>
          <input className="input" dir="auto" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        </label>
      )}
      <label className="field">
        <span>{t('email')}</span>
        <input className="input" type="email" dir="ltr" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
      </label>
      <label className="field">
        <span>{t('password')}</span>
        <input
          className="input"
          type="password"
          dir="ltr"
          required
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
        />
      </label>
      {msg && <p className="auth-msg">{msg}</p>}
      <div className="auth-actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {mode === 'in' ? t('signIn') : t('signUp')}
        </button>
        {mode === 'in' && (
          <button
            type="button"
            className="btn-text"
            onClick={async () => {
              if (!email.trim()) return
              try {
                await resetPassword(email.trim())
                setMsg(t('resetSent'))
              } catch (err) {
                setMsg(friendlyError(err))
              }
            }}
          >
            {t('forgotPassword')}
          </button>
        )}
      </div>
    </form>
  )
}

function SignedIn() {
  const user = useSession((s) => s.user)!
  const role = useSession((s) => s.role)
  const status = useStore((s) => s.syncStatus)
  const pendingSync = useStore((s) => s.pendingSync)
  const lastSyncedAt = useStore((s) => s.lastSyncedAt)
  const settings = useStore((s) => s.settings)
  const toast = useStore((s) => s.toast)
  const [pw, setPw] = useState('')
  const [leaving, setLeaving] = useState(false)

  // Signing out clears this device: anything the account doesn't have yet is saved to a file first
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
        if (!(await askConfirm(where ? t('signOutSavedDevice', { where }) : t('signOutSavedDownload'), { confirmLabel: t('signOut'), danger: true }))) return
      } else if (!(await askConfirm(t('signOutConfirm'), { confirmLabel: t('signOut') }))) return
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
      <Row label={t('signedInAs')} desc={user.email ?? ''}>
        <span className={'sync-pill is-' + status}>{status === 'synced' ? t('syncedNow') : status === 'syncing' ? t('syncing') : status === 'offline' ? t('offline') : t('syncOff')}</span>
      </Row>
      {syncNote && <p className="muted small set-note sync-note">{syncNote}</p>}
      {role && (
        <Row label={t('workspace')}>
          <span className="muted">{role === 'owner' ? t('owner') : role === 'editor' ? t('canEdit') : t('canView')}</span>
        </Row>
      )}
      <Row label={t('changePassword')}>
        <form
          className="inline-form"
          onSubmit={async (e) => {
            e.preventDefault()
            if (pw.length < 6) return
            try {
              await updatePassword(pw)
              setPw('')
              toast(t('passwordChanged'))
            } catch (err) {
              toast(friendlyError(err))
            }
          }}
        >
          <input className="input" type="password" dir="ltr" placeholder={t('newPassword')} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
          <button type="submit" className="btn" disabled={pw.length < 6}>
            {t('save')}
          </button>
        </form>
      </Row>
      <div className="settings-actions">
        <button type="button" className="btn" disabled={leaving} onClick={() => void leave()}>
          <LogOut size={15} /> {t('signOut')}
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
