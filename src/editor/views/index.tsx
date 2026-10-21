import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { ArrowUpLeft, ArrowUpRight, FileText, ImageOff, Loader2 } from 'lucide-react'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useAssetUrl } from '../../data/assets'
import { useStore } from '../../data/store'
import { t } from '../../lib/i18n'
import { formatDual, formatHijri, formatGregorian } from '../../lib/hijri'
import { DatePicker } from '../../ui/DatePicker'
import { EmojiPicker } from '../../ui/EmojiPicker'
import { Popover } from '../../ui/Popover'
import { openPageFromEditor } from '../actions'
import { consumeOpenNext } from './dateChipBus'

const DatabaseView = lazy(() => import('../../database/DatabaseView'))

export function CalloutView({ node, updateAttributes, editor }: NodeViewProps) {
  const [open, setOpen] = useState(false)
  const btn = useRef<HTMLButtonElement>(null)
  return (
    <NodeViewWrapper className="callout" data-color={node.attrs.color}>
      <button
        type="button"
        ref={btn}
        className="callout-icon"
        contentEditable={false}
        onClick={() => editor.isEditable && setOpen(true)}
        aria-label={t('addIcon')}
      >
        {node.attrs.icon}
      </button>
      <NodeViewContent className="callout-body" />
      <Popover anchor={btn.current} open={open} onClose={() => setOpen(false)} sheet>
        <EmojiPicker
          onPick={(e) => {
            updateAttributes({ icon: e })
            setOpen(false)
          }}
        />
      </Popover>
    </NodeViewWrapper>
  )
}

function usePage(id: string | null) {
  return useStore((s) => (id ? s.pages[id] : undefined))
}

export function PageLinkView({ node, selected }: NodeViewProps) {
  const page = usePage(node.attrs.pageId)
  const missing = !page || !!page.deletedAt
  return (
    <NodeViewWrapper className={'page-link' + (selected ? ' is-selected' : '') + (missing ? ' is-missing' : '')} data-drag-handle="">
      <button
        type="button"
        contentEditable={false}
        className="page-link-btn"
        onClick={() => !missing && openPageFromEditor(node.attrs.pageId)}
      >
        <span className="page-link-icon">{page?.icon || <FileText size={18} strokeWidth={1.5} />}</span>
        <span className="page-link-title">{missing ? t('pageLinkMissing') : page.title || t('untitled')}</span>
      </button>
    </NodeViewWrapper>
  )
}

export function PageMentionView({ node, selected }: NodeViewProps) {
  const page = usePage(node.attrs.pageId)
  const lang = useStore((s) => s.settings.lang)
  const missing = !page || !!page.deletedAt
  const Arrow = lang === 'ar' ? ArrowUpLeft : ArrowUpRight
  return (
    <NodeViewWrapper as="span" className={'page-mention' + (selected ? ' is-selected' : '') + (missing ? ' is-missing' : '')}>
      <span contentEditable={false} role="link" tabIndex={0} onClick={() => !missing && openPageFromEditor(node.attrs.pageId)}>
        <span className="pm-icon">{page?.icon || <Arrow size={13} />}</span>
        <span className="pm-title">{missing ? t('pageLinkMissing') : page.title || t('untitled')}</span>
      </span>
    </NodeViewWrapper>
  )
}

export function DateChipView({ node, updateAttributes, selected, editor }: NodeViewProps) {
  const settings = useStore((s) => s.settings)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (consumeOpenNext()) setTimeout(() => setOpen(true), 30)
  }, [])
  const iso = node.attrs.date as string | null
  const fmt = { lang: settings.lang, numerals: settings.numerals } as const
  const primary = iso ? (settings.calendar === 'hijri' ? formatHijri(iso, fmt) : formatGregorian(iso, fmt)) : '—'
  const secondary = iso ? (settings.calendar === 'hijri' ? formatGregorian(iso, fmt) : formatHijri(iso, fmt)) : ''
  return (
    <NodeViewWrapper as="span" className={'date-chip' + (selected ? ' is-selected' : '')}>
      <span
        ref={ref}
        contentEditable={false}
        role="button"
        tabIndex={0}
        title={iso ? formatDual(iso, settings.calendar, { ...fmt, weekday: true }) : ''}
        onClick={() => editor.isEditable && setOpen(true)}
      >
        <span className="dc-main">{primary}</span>
        {secondary && <span className="dc-sub">{secondary}</span>}
      </span>
      <Popover anchor={ref.current} open={open} onClose={() => setOpen(false)} sheet>
        <DatePicker
          value={iso}
          allowClear={false}
          onChange={(v) => {
            if (v) updateAttributes({ date: v })
            setOpen(false)
          }}
        />
      </Popover>
    </NodeViewWrapper>
  )
}

export function DatabaseBlockView({ node, selected }: NodeViewProps) {
  const id = node.attrs.databaseId as string
  return (
    <NodeViewWrapper className={'db-block' + (selected ? ' is-selected' : '')} contentEditable={false}>
      <Suspense fallback={<div className="db-loading">{t('loading')}</div>}>
        <DatabaseView dbId={id} inline />
      </Suspense>
    </NodeViewWrapper>
  )
}

export function ImageView({ node, updateAttributes, selected, editor }: NodeViewProps) {
  const { url, loading } = useAssetUrl(node.attrs.src)
  const [width, setWidth] = useState<number>(node.attrs.width ?? 100)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => setWidth(node.attrs.width ?? 100), [node.attrs.width])

  const startResize = (e: React.PointerEvent, side: 'start' | 'end') => {
    e.preventDefault()
    e.stopPropagation()
    const parent = box.current?.parentElement
    if (!parent) return
    const total = parent.getBoundingClientRect().width
    const startX = e.clientX
    const startW = width
    const rtl = getComputedStyle(parent).direction === 'rtl'
    let w = startW
    const move = (ev: PointerEvent) => {
      let dx = ((ev.clientX - startX) / total) * 100 * 2
      if (rtl) dx = -dx
      if (side === 'start') dx = -dx
      w = Math.max(20, Math.min(100, startW + dx))
      setWidth(w)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      updateAttributes({ width: Math.round(w) })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <NodeViewWrapper className={'image-block' + (selected ? ' is-selected' : '')} data-align={node.attrs.align}>
      <div ref={box} className="image-box" style={{ width: `${width}%` }} contentEditable={false} data-drag-handle="">
        {url ? (
          <img src={url} alt={node.attrs.alt ?? ''} draggable={false} />
        ) : (
          <div className="image-placeholder">
            {loading ? <Loader2 className="spin" size={20} /> : <ImageOff size={20} />}
            <span>{loading ? t('imageUploading') : t('imageFailed')}</span>
          </div>
        )}
        {editor.isEditable && url && (
          <>
            <span className="img-handle start" onPointerDown={(e) => startResize(e, 'start')} />
            <span className="img-handle end" onPointerDown={(e) => startResize(e, 'end')} />
          </>
        )}
      </div>
    </NodeViewWrapper>
  )
}
