import { X } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { t } from '../lib/i18n'

export function Modal({
  open,
  onClose,
  children,
  title,
  className = '',
  width = 560,
  top = false,
}: {
  open: boolean
  onClose: () => void
  children: ReactNode
  title?: ReactNode
  className?: string
  width?: number
  top?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('.popover')) onClose()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.activeElement as HTMLElement | null
    return () => {
      document.removeEventListener('keydown', onKey)
      prev?.focus?.()
    }
  }, [open, onClose])
  if (!open) return null
  return createPortal(
    <div className={'modal-backdrop' + (top ? ' is-top' : '')} onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={`modal ${className}`} role="dialog" aria-modal="true" style={{ maxWidth: width }} dir={document.documentElement.dir}>
        {title !== undefined && (
          <div className="modal-head">
            <h2 className="modal-title">{title}</h2>
            <button type="button" className="icon-btn" onClick={onClose} aria-label={t('close')}>
              <X size={18} />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body,
  )
}
