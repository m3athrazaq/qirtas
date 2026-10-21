import { Database, FileText, RotateCcw, Trash2 } from 'lucide-react'
import { useMemo } from 'react'
import { useStore, ws } from '../data/store'
import { t } from '../lib/i18n'
import { Modal } from '../ui/Modal'
import { askConfirm } from '../ui/dialogs'

export function TrashDialog() {
  const open = useStore((s) => s.modal === 'trash')
  const close = useStore((s) => s.closeModal)
  const pages = useStore((s) => s.pages)
  const settings = useStore((s) => s.settings)
  const items = useMemo(
    () =>
      Object.values(pages)
        .filter((p) => p.deletedAt && !(p.parentId && pages[p.parentId]?.deletedAt))
        .sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0)),
    [pages],
  )
  const loc = settings.lang === 'ar' ? `ar-u-nu-${settings.numerals}` : 'en'
  return (
    <Modal open={open} onClose={close} title={t('trashTitle')} width={560}>
      <div className="trash-list">
        {!items.length && <div className="menu-empty">{t('trashEmpty')}</div>}
        {items.map((p) => (
          <div key={p.id} className="trash-row">
            <span className="si-icon">{p.icon || (p.type === 'database' ? <Database size={17} strokeWidth={1.5} /> : <FileText size={17} strokeWidth={1.5} />)}</span>
            <span className="trash-title">
              {p.title || t('untitled')}
              <span className="muted trash-date">
                {t('deletedOn')} {new Date(p.deletedAt!).toLocaleDateString(loc, { day: 'numeric', month: 'short' })}
              </span>
            </span>
            <button type="button" className="btn-text" onClick={() => ws().restorePage(p.id)}>
              <RotateCcw size={14} /> {t('restore')}
            </button>
            <button
              type="button"
              className="btn-text is-danger"
              onClick={async () => {
                if (await askConfirm(t('deleteForeverConfirm', { title: p.title || t('untitled') }), { danger: true, confirmLabel: t('deleteForever') })) void ws().purgePage(p.id)
              }}
            >
              <Trash2 size={14} /> {t('deleteForever')}
            </button>
          </div>
        ))}
      </div>
    </Modal>
  )
}
