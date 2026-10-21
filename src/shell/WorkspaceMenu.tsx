import { Check, Link2, Plus, Settings } from 'lucide-react'
import { navigate } from '../data/nav'
import { useStore } from '../data/store'
import { t } from '../lib/i18n'
import { syncAvailable } from '../sync/config'
import { createWorkspace, switchWorkspace, useSession } from '../sync/session'
import { MenuItem, MenuLabel, MenuSep, Popover } from '../ui/Popover'
import { askText } from '../ui/dialogs'

export function WorkspaceMenu({ anchor, onClose }: { anchor: Element; onClose: () => void }) {
  const ws = useStore((s) => s.ws)
  const wsName = useStore((s) => s.wsName)
  const user = useSession((s) => s.user)
  const workspaces = useSession((s) => s.workspaces)
  const openModal = useStore((s) => s.openModal)
  const toast = useStore((s) => s.toast)
  const list = user && workspaces.length ? workspaces : ws ? [{ id: ws.id, name: wsName, role: 'owner' as const }] : []

  return (
    <Popover anchor={anchor} open onClose={onClose} sheet width={280}>
      <div className="menu-list">
        <MenuLabel>{t('workspaces')}</MenuLabel>
        {list.map((w) => (
          <MenuItem
            key={w.id}
            icon={<span className="ws-dot">{[...(w.name || t('appName'))][0]}</span>}
            label={w.name || t('appName')}
            hint={w.role === 'owner' ? '' : w.role === 'editor' ? t('canEdit') : t('canView')}
            trailing={w.id === ws?.id ? <Check size={15} className="menu-check" /> : null}
            onClick={() => {
              onClose()
              if (w.id !== ws?.id) void switchWorkspace(w.id)
            }}
          />
        ))}
        {syncAvailable() && user && (
          <>
            <MenuSep />
            <MenuItem
              icon={<Plus size={15} />}
              label={t('newWorkspace')}
              onClick={async () => {
                onClose()
                const name = (await askText(t('newWorkspaceName'), { confirmLabel: t('newWorkspace') }))?.trim()
                if (!name) return
                try {
                  await createWorkspace(name)
                } catch (err) {
                  toast((err as Error).message)
                }
              }}
            />
            <MenuItem
              icon={<Link2 size={15} />}
              label={t('joinWithLink')}
              onClick={async () => {
                onClose()
                const raw = (await askText(t('pasteInvite'), { confirmLabel: t('join') }))?.trim()
                if (!raw) return
                const token = raw.match(/join\/([A-Za-z0-9]+)/)?.[1] ?? raw.replace(/[^A-Za-z0-9]/g, '')
                if (token) location.hash = `#/join/${token}`
              }}
            />
          </>
        )}
        <MenuSep />
        <MenuItem
          icon={<Settings size={15} />}
          label={t('settings')}
          onClick={() => {
            onClose()
            openModal('settings')
          }}
        />
      </div>
    </Popover>
  )
}

export function goHomeAfterJoin() {
  navigate(null, { replace: true })
}
