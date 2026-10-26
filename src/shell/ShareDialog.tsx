import { Copy, Link2, LogOut, Users, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useStore } from '../data/store'
import { openSettingsAt } from './SettingsDialog'
import { t } from '../lib/i18n'
import { copyText } from '../lib/platform'
import { syncAvailable } from '../sync/config'
import type { Role } from '../sync/engine'
import {
  appBaseUrl,
  createInvite,
  inviteLink,
  leaveWorkspace,
  listInvites,
  listMembers,
  removeMember,
  revokeInvite,
  setMemberRole,
  useSession,
  type Member,
} from '../sync/session'
import { Modal } from '../ui/Modal'

export function ShareDialog() {
  const open = useStore((s) => s.modal === 'share')
  const close = useStore((s) => s.closeModal)
  const user = useSession((s) => s.user)
  const role = useSession((s) => s.role)
  return (
    <Modal open={open} onClose={close} title={t('shareTitle')} width={520}>
      {!syncAvailable() || !user || !role ? (
        <div className="share-empty">
          <Users size={26} className="muted" />
          <p>{t('shareNeedsAccount')}</p>
          {syncAvailable() && (
            <button type="button" className="btn btn-primary" onClick={() => openSettingsAt('account')}>
              {t('signIn')}
            </button>
          )}
        </div>
      ) : (
        <ShareBody role={role} />
      )}
    </Modal>
  )
}

function ShareBody({ role }: { role: Role }) {
  const ws = useStore((s) => s.ws)!
  const user = useSession((s) => s.user)!
  const presence = useSession((s) => s.presence)
  const toast = useStore((s) => s.toast)
  const [members, setMembers] = useState<Member[]>([])
  const [invites, setInvites] = useState<{ token: string; role: 'editor' | 'viewer' }[]>([])
  const [newRole, setNewRole] = useState<'editor' | 'viewer'>('editor')
  const isOwner = role === 'owner'

  const reload = useCallback(async () => {
    setMembers(await listMembers(ws.id))
    if (isOwner) setInvites(await listInvites(ws.id))
  }, [ws.id, isOwner])

  useEffect(() => {
    void reload()
  }, [reload])

  const roleLabel = (r: Role) => (r === 'owner' ? t('owner') : r === 'editor' ? t('canEdit') : t('canView'))

  return (
    <div className="share">
      {isOwner && (
        <section className="share-sec">
          <h3 className="share-h">{t('inviteLink')}</h3>
          <p className="muted small">{appBaseUrl() ? t('shareHint') : t('noWebUrl')}</p>
          <div className="share-row">
            <select className="select" value={newRole} onChange={(e) => setNewRole(e.target.value as 'editor' | 'viewer')}>
              <option value="editor">{t('canEdit')}</option>
              <option value="viewer">{t('canView')}</option>
            </select>
            <button
              type="button"
              className="btn btn-primary"
              onClick={async () => {
                try {
                  const token = await createInvite(ws.id, newRole)
                  await copyText(inviteLink(token))
                  toast(t('linkCopied'))
                  void reload()
                } catch (err) {
                  toast((err as Error).message)
                }
              }}
            >
              <Link2 size={15} /> {t('createLink')}
            </button>
          </div>
          {invites.length > 0 && (
            <div className="share-list">
              <div className="menu-group">{t('activeLinks')}</div>
              {invites.map((inv) => (
                <div key={inv.token} className="share-item">
                  <span className="share-token" dir="ltr">
                    …{inv.token.slice(-8)}
                  </span>
                  <span className="muted small">{roleLabel(inv.role)}</span>
                  <span className="spacer" />
                  <button
                    type="button"
                    className="icon-btn"
                    title={t('copyLink')}
                    onClick={async () => {
                      await copyText(inviteLink(inv.token))
                      toast(t('linkCopied'))
                    }}
                  >
                    <Copy size={15} />
                  </button>
                  <button
                    type="button"
                    className="btn-text"
                    onClick={async () => {
                      await revokeInvite(inv.token)
                      void reload()
                    }}
                  >
                    {t('revoke')}
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
      <section className="share-sec">
        <h3 className="share-h">{t('members')}</h3>
        <div className="share-list">
          {members.map((m) => {
            const online = presence.some((p) => p.userId === m.user_id)
            const name = m.display_name || m.email || '…'
            return (
              <div key={m.user_id} className="share-item">
                <span className={'avatar tag-blue' + (online ? ' is-online' : '')}>{[...name][0]}</span>
                <span className="share-name">
                  {name}
                  {m.user_id === user.id && <span className="muted"> ({t('you')})</span>}
                  {m.email && m.display_name && <span className="muted small share-email">{m.email}</span>}
                </span>
                <span className="spacer" />
                {isOwner && m.role !== 'owner' ? (
                  <>
                    <select
                      className="select"
                      value={m.role}
                      onChange={async (e) => {
                        await setMemberRole(ws.id, m.user_id, e.target.value as Role)
                        void reload()
                      }}
                    >
                      <option value="editor">{t('canEdit')}</option>
                      <option value="viewer">{t('canView')}</option>
                    </select>
                    <button
                      type="button"
                      className="icon-btn"
                      title={t('remove')}
                      onClick={async () => {
                        await removeMember(ws.id, m.user_id)
                        useStore.getState().toast(t('memberRemovedLinks'))
                        void reload()
                      }}
                    >
                      <X size={15} />
                    </button>
                  </>
                ) : (
                  <span className="muted small">{roleLabel(m.role)}</span>
                )}
              </div>
            )
          })}
        </div>
      </section>
      {!isOwner && (
        <div className="settings-actions">
          <button type="button" className="btn is-danger" onClick={() => void leaveWorkspace(ws.id)}>
            <LogOut size={15} /> {t('leaveWorkspace')}
          </button>
        </div>
      )}
    </div>
  )
}
