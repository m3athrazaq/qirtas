import { useState } from 'react'
import { navigate } from '../data/nav'
import { useStore } from '../data/store'
import { myTemplates, pageFromTemplate } from '../data/today'
import { t } from '../lib/i18n'
import { TEMPLATES } from '../templates'
import { Modal } from '../ui/Modal'

export function TemplatesDialog() {
  const open = useStore((s) => s.modal === 'templates')
  const close = useStore((s) => s.closeModal)
  const toast = useStore((s) => s.toast)
  useStore((s) => s.settings.lang)
  const [busy, setBusy] = useState<string | null>(null)
  const pages = useStore((s) => s.pages)
  const mine = open ? myTemplates(pages) : []

  const fromMine = async (id: string) => {
    if (busy) return
    setBusy(id)
    try {
      const pageId = await pageFromTemplate(id)
      if (!pageId) return
      close()
      navigate(pageId)
      toast(t('templateCreated'))
    } finally {
      setBusy(null)
    }
  }

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
      <div className="tpl-scroll">
        {mine.length > 0 && (
          <>
            <h3 className="tpl-head">{t('myTemplates')}</h3>
            <div className="tpl-grid">
              {mine.map((p) => (
                <button type="button" key={p.id} className={'tpl' + (busy === p.id ? ' is-busy' : '')} onClick={() => void fromMine(p.id)} disabled={!!busy}>
                  <span className="tpl-icon">{pages[p.id].icon || '📄'}</span>
                  <span className="tpl-text">
                    <span className="tpl-name">{pages[p.id].title || t('untitled')}</span>
                    <span className="tpl-desc">{t('myTemplateDesc')}</span>
                  </span>
                </button>
              ))}
            </div>
            <h3 className="tpl-head">{t('readyTemplates')}</h3>
          </>
        )}
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
      </div>
    </Modal>
  )
}
