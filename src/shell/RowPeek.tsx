import { ArrowUpLeft, ArrowUpRight, MoreHorizontal, X } from 'lucide-react'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { navigate } from '../data/nav'
import { useStore } from '../data/store'
import { RowMenu } from '../database/TableView'
import { PageView } from '../page/PageView'
import { t } from '../lib/i18n'
import { Popover } from '../ui/Popover'

export function RowPeek() {
  const peek = useStore((s) => s.peek)
  const row = useStore((s) => (s.peek ? s.pages[s.peek] : undefined))
  const rtl = useStore((s) => s.settings.lang === 'ar')
  const [menu, setMenu] = useState<Element | null>(null)
  if (!peek || !row || row.deletedAt) return null
  const close = () => useStore.setState({ peek: null })
  const Open = rtl ? ArrowUpLeft : ArrowUpRight
  return createPortal(
    <div className="modal-backdrop peek-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal peek" role="dialog" aria-modal="true" dir={document.documentElement.dir}>
        <div className="peek-bar">
          <button type="button" className="icon-btn" onClick={close} aria-label={t('close')}>
            <X size={18} />
          </button>
          <button
            type="button"
            className="btn-text"
            onClick={() => {
              close()
              navigate(row.id)
            }}
          >
            <Open size={15} /> {t('openFull')}
          </button>
          <span className="spacer" />
          <button type="button" className="icon-btn" onClick={(e) => setMenu(e.currentTarget)} aria-label={t('more')}>
            <MoreHorizontal size={18} />
          </button>
        </div>
        <div className="peek-body">
          <PageView pageId={row.id} inPeek />
        </div>
      </div>
      {menu && (
        <Popover anchor={menu} open onClose={() => setMenu(null)} placement="bottom-end" sheet>
          <RowMenu
            row={row}
            onClose={() => {
              setMenu(null)
            }}
          />
        </Popover>
      )}
    </div>,
    document.body,
  )
}
