import { useState } from 'react'
import { navigate } from '../data/nav'
import { useStore } from '../data/store'
import { t } from '../lib/i18n'
import { TEMPLATES } from '../templates'
import { Modal } from '../ui/Modal'

export function TemplatesDialog() {
  const open = useStore((s) => s.modal === 'templates')
  const close = useStore((s) => s.closeModal)
  const toast = useStore((s) => s.toast)
  useStore((s) => s.settings.lang)
  const [busy, setBusy] = useState<string | null>(null)

  const use = async (id: string) => {
    const tpl = TEMPLATES.find((x) => x.id === id)
    if (!tpl || busy) return
    setBusy(id)
    try {
      const pageId = await tpl.create()
      close()
      navigate(pageId)
      toast(t('templateCreated'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Modal open={open} onClose={close} title={t('templatesTitle')} width={760} className="templates-modal">
      <p className="modal-sub">{t('templatesSub')}</p>
      <div className="tpl-grid">
        {TEMPLATES.map((tpl) => (
          <button type="button" key={tpl.id} className={'tpl' + (busy === tpl.id ? ' is-busy' : '')} onClick={() => void use(tpl.id)} disabled={!!busy}>
            <span className="tpl-icon">{tpl.icon}</span>
            <span className="tpl-text">
              <span className="tpl-name">{tpl.name()}</span>
              <span className="tpl-desc">{tpl.desc()}</span>
            </span>
          </button>
        ))}
      </div>
    </Modal>
  )
}
