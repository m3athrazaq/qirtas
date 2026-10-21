import { autoUpdate, computePosition, flip, offset, shift, size, type Placement, type VirtualElement } from '@floating-ui/dom'
import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../data/store'

interface PopoverProps {
  anchor: Element | VirtualElement | null
  open: boolean
  onClose: () => void
  placement?: Placement
  children: ReactNode
  className?: string
  /** On phones, show as a bottom sheet instead of a floating box */
  sheet?: boolean
  width?: number
  offsetPx?: number
}

export function Popover({ anchor, open, onClose, placement = 'bottom-start', children, className = '', sheet = false, width, offsetPx = 6 }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null)
  const isMobile = useStore((s) => s.isMobile)
  const asSheet = sheet && isMobile

  useLayoutEffect(() => {
    if (!open || asSheet || !anchor || !ref.current) return
    const el = ref.current
    const update = () =>
      computePosition(anchor, el, {
        placement,
        strategy: 'fixed',
        middleware: [
          offset(offsetPx),
          flip({ padding: 8 }),
          shift({ padding: 8 }),
          size({
            padding: 8,
            apply({ availableHeight }) {
              el.style.maxHeight = `${Math.max(140, availableHeight)}px`
            },
          }),
        ],
      }).then(({ x, y }) => {
        Object.assign(el.style, { left: `${x}px`, top: `${y}px`, visibility: 'visible' })
      })
    const isEl = anchor instanceof Element
    const cleanup = isEl ? autoUpdate(anchor as Element, el, update) : (update(), () => {})
    return cleanup
  }, [open, anchor, placement, asSheet, offsetPx])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node
      if (ref.current?.contains(target)) return
      if (anchor instanceof Element && anchor.contains(target)) return
      // Don't close when interacting with a nested popover rendered later in the body
      const top = (target as Element).closest?.('.popover')
      if (top && top !== ref.current && isAfter(top, ref.current)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open, onClose, anchor])

  if (!open) return null
  const dir = document.documentElement.dir

  if (asSheet) {
    return createPortal(
      <div className="sheet-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
        <div ref={ref} className={`popover sheet ${className}`} dir={dir}>
          <div className="sheet-grip" />
          {children}
        </div>
      </div>,
      document.body,
    )
  }

  return createPortal(
    <div ref={ref} className={`popover ${className}`} dir={dir} style={{ position: 'fixed', visibility: 'hidden', width }}>
      {children}
    </div>,
    document.body,
  )
}

function isAfter(a: Element, b: Element | null) {
  if (!b) return true
  return !!(b.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING)
}

interface MenuItemProps {
  icon?: ReactNode
  label: ReactNode
  hint?: ReactNode
  onClick?: () => void
  danger?: boolean
  active?: boolean
  disabled?: boolean
  trailing?: ReactNode
}

export function MenuItem({ icon, label, hint, onClick, danger, active, disabled, trailing }: MenuItemProps) {
  return (
    <button
      type="button"
      className={'menu-item' + (danger ? ' is-danger' : '') + (active ? ' is-active' : '')}
      onClick={onClick}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
    >
      {icon && <span className="menu-icon">{icon}</span>}
      <span className="menu-label">{label}</span>
      {hint && <span className="menu-hint">{hint}</span>}
      {trailing}
    </button>
  )
}

export function MenuSep() {
  return <div className="menu-sep" role="separator" />
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <div className="menu-group">{children}</div>
}
