import { ImagePlus, Smile } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { importImage, pickFile, useAssetUrl } from '../data/assets'
import { useStore, ws } from '../data/store'
import type { Cover, PageMeta } from '../data/types'
import { t } from '../lib/i18n'
import { coverBackground, COVER_COLORS, coverPatterns } from '../ui/covers'
import { EmojiPicker, randomEmoji } from '../ui/EmojiPicker'
import { Popover } from '../ui/Popover'

export function PageCover({ page, editable }: { page: PageMeta; editable: boolean }) {
  const rtl = useStore((s) => s.settings.lang === 'ar')
  const [picker, setPicker] = useState<Element | null>(null)
  const [repositioning, setRepositioning] = useState(false)
  const [y, setY] = useState(page.coverY)
  const cover = page.cover
  const { url } = useAssetUrl(cover?.kind === 'image' ? `asset:${cover.assetId}` : null)
  useEffect(() => setY(page.coverY), [page.coverY])
  if (!cover) return null

  const style: React.CSSProperties =
    cover.kind === 'image' ? { backgroundImage: url ? `url(${url})` : undefined, backgroundPosition: `center ${y}%`, backgroundSize: 'cover' } : { background: coverBackground(cover, rtl) }

  const startDrag = (e: React.PointerEvent) => {
    if (!repositioning) return
    e.preventDefault()
    const startY = e.clientY
    const startPos = y
    const h = (e.currentTarget as HTMLElement).offsetHeight
    let cur = startPos
    const move = (ev: PointerEvent) => {
      cur = Math.max(0, Math.min(100, startPos - ((ev.clientY - startY) / h) * 100))
      setY(cur)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div className={'cover' + (repositioning ? ' is-repositioning' : '')} style={style} onPointerDown={startDrag}>
      {editable && (
        <div className="cover-actions">
          {repositioning ? (
            <button
              type="button"
              className="chip-btn"
              onClick={() => {
                ws().updatePage(page.id, { coverY: Math.round(y) })
                setRepositioning(false)
              }}
            >
              {t('savePosition')}
            </button>
          ) : (
            <>
              <button type="button" className="chip-btn" onClick={(e) => setPicker(e.currentTarget)}>
                {t('changeCover')}
              </button>
              {cover.kind === 'image' && (
                <button type="button" className="chip-btn" onClick={() => setRepositioning(true)}>
                  {t('reposition')}
                </button>
              )}
            </>
          )}
        </div>
      )}
      {picker && <CoverPicker page={page} anchor={picker} onClose={() => setPicker(null)} />}
    </div>
  )
}

export function CoverPicker({ page, anchor, onClose }: { page: PageMeta; anchor: Element; onClose: () => void }) {
  const rtl = useStore((s) => s.settings.lang === 'ar')
  const set = (cover: Cover | null) => {
    ws().updatePage(page.id, { cover, coverY: 50 })
    onClose()
  }
  const patterns = coverPatterns(rtl)
  return (
    <Popover anchor={anchor} open onClose={onClose} sheet width={420} placement="bottom-end">
      <div className="cover-picker">
        <div className="cp-head">
          <button
            type="button"
            className="btn"
            onClick={async () => {
              const f = await pickFile('image/*')
              if (!f) return
              const src = await importImage(f, 2400)
              set({ kind: 'image', assetId: src.slice(6) })
            }}
          >
            <ImagePlus size={15} /> {t('upload')}
          </button>
          {page.cover && (
            <button type="button" className="btn-text" onClick={() => set(null)}>
              {t('removeCover')}
            </button>
          )}
        </div>
        <div className="cp-label">{t('patterns')}</div>
        <div className="cp-grid">
          {Object.keys(patterns).map((k) => (
            <button key={k} type="button" className="cp-swatch" style={{ background: patterns[k] }} onClick={() => set({ kind: 'pattern', value: k })} aria-label={k} />
          ))}
        </div>
        <div className="cp-label">{t('colors')}</div>
        <div className="cp-grid">
          {Object.keys(COVER_COLORS).map((k) => (
            <button key={k} type="button" className="cp-swatch" style={{ background: COVER_COLORS[k] }} onClick={() => set({ kind: 'color', value: k })} aria-label={k} />
          ))}
        </div>
      </div>
    </Popover>
  )
}

export function PageTitleBlock({ page, editable, onEnter }: { page: PageMeta; editable: boolean; onEnter: () => void }) {
  const [iconPicker, setIconPicker] = useState<Element | null>(null)
  const [coverPicker, setCoverPicker] = useState<Element | null>(null)
  const iconRef = useRef<HTMLButtonElement>(null)

  const setIcon = (icon: string) => {
    ws().updatePage(page.id, { icon })
    setIconPicker(null)
  }

  return (
    <div className={'page-head' + (page.cover ? ' has-cover' : '') + (page.icon ? ' has-icon' : '')}>
      {page.icon && (
        <button type="button" ref={iconRef} className="page-icon" onClick={(e) => editable && setIconPicker(e.currentTarget)} aria-label={t('addIcon')}>
          {page.icon}
        </button>
      )}
      {editable && (
        <div className="head-actions">
          {!page.icon && (
            <button type="button" className="btn-text" onClick={() => setIcon(randomEmoji())}>
              <Smile size={15} /> {t('addIcon')}
            </button>
          )}
          {!page.cover && (
            <button type="button" className="btn-text" onClick={(e) => setCoverPicker(e.currentTarget)}>
              <ImagePlus size={15} /> {t('addCover')}
            </button>
          )}
        </div>
      )}
      <TitleInput page={page} editable={editable} onEnter={onEnter} />
      {iconPicker && (
        <Popover anchor={iconPicker} open onClose={() => setIconPicker(null)} sheet>
          <EmojiPicker onPick={setIcon} onRemove={() => setIcon('')} />
        </Popover>
      )}
      {coverPicker && <CoverPicker page={page} anchor={coverPicker} onClose={() => setCoverPicker(null)} />}
    </div>
  )
}

function TitleInput({ page, editable, onEnter }: { page: PageMeta; editable: boolean; onEnter: () => void }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const [val, setVal] = useState(page.title)
  const focused = useRef(false)
  const pageId = page.id

  useEffect(() => {
    if (!focused.current) setVal(page.title)
  }, [page.title])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${el.scrollHeight}px`
  }, [val])

  // New, empty pages start with the cursor in the title
  useEffect(() => {
    const p = useStore.getState().pages[pageId]
    if (editable && p && !p.title && Date.now() - p.createdAt < 4000) ref.current?.focus()
  }, [pageId, editable])

  return (
    <textarea
      ref={ref}
      className="page-title"
      dir="auto"
      rows={1}
      value={val}
      readOnly={!editable}
      placeholder={t('titlePlaceholder')}
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false
        if (val !== page.title) ws().updatePage(pageId, { title: val })
      }}
      onChange={(e) => {
        const v = e.target.value.replace(/\n/g, '')
        setVal(v)
        ws().updatePage(pageId, { title: v })
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || (e.key === 'ArrowDown' && ref.current?.selectionStart === val.length)) {
          e.preventDefault()
          onEnter()
        }
      }}
    />
  )
}
