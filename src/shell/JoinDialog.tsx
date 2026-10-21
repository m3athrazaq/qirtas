import { Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { navigate } from '../data/nav'
import { useStore } from '../data/store'
import { openSettingsAt } from './SettingsDialog'
import { t } from '../lib/i18n'
import { syncAvailable } from '../sync/config'
import { acceptInvite, inviteInfo, useSession } from '../sync/session'
import { Modal } from '../ui/Modal'

export function JoinDialog() {
  const route = useStore((s) => s.route)
  const user = useSession((s) => s.user)
  const token = route.name === 'join' ? route.token : null
  const [info, setInfo] = useState<{ name: string; role: string } | null | 'invalid'>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!token || !user || !syncAvailable()) return
    setInfo(null)
    void inviteInfo(token).then((r) => setInfo(r ? { name: r.name, role: r.role } : 'invalid'))
  }, [token, user])

  if (!token) return null
  const close = () => navigate(null, { replace: true })

  return (
    <Modal open onClose={close} title={t('joinTitle')} width={440}>
      <div className="share-empty">
        <Users size={26} className="muted" />
        {!syncAvailable() ? (
          <p>{t('shareNeedsAccount')}</p>
        ) : !user ? (
          <>
            <p>{t('signInToJoin')}</p>
            <button type="button" className="btn btn-primary" onClick={() => openSettingsAt('account')}>
              {t('signIn')}
            </button>
          </>
        ) : info === 'invalid' ? (
          <p>{t('inviteInvalid')}</p>
        ) : info ? (
          <>
            <p className="join-title">{t('joinAs', { name: info.name || t('appName') })}</p>
            <p className="muted small">{info.role === 'editor' ? t('canEdit') : t('canView')}</p>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  await acceptInvite(token)
                } catch (err) {
                  useStore.getState().toast((err as Error).message)
                  setBusy(false)
                }
              }}
            >
              {t('join')}
            </button>
          </>
        ) : (
          <p className="muted">{t('loading')}</p>
        )}
      </div>
    </Modal>
  )
}
