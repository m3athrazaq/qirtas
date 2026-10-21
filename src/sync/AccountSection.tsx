import { CloudOff, LogOut } from 'lucide-react'
import { useState } from 'react'
import { useStore } from '../data/store'
import { t } from '../lib/i18n'
import { Row } from '../shell/SettingsDialog'
import { askConfirm, askText } from '../ui/dialogs'
import { syncAvailable } from './config'
import { deleteAccount, resetPassword, signIn, signOut, signUp, updatePassword, useSession } from './session'

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
      setMsg((err as Error).message)
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
                setMsg((err as Error).message)
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
  const toast = useStore((s) => s.toast)
  const [pw, setPw] = useState('')
  return (
    <>
      <Row label={t('signedInAs')} desc={user.email ?? ''}>
        <span className={'sync-pill is-' + status}>{status === 'synced' ? t('syncedNow') : status === 'syncing' ? t('syncing') : status === 'offline' ? t('offline') : t('syncOff')}</span>
      </Row>
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
              toast((err as Error).message)
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
        <button type="button" className="btn" onClick={async () => (await askConfirm(t('signOutConfirm'), { confirmLabel: t('signOut') })) && void signOut()}>
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
              toast((err as Error).message)
            }
          }}
        >
          {t('deleteAccount')}
        </button>
      </div>
    </>
  )
}
