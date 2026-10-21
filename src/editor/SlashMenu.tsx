import type { SuggestionProps } from '@tiptap/suggestion'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { t } from '../lib/i18n'
import type { SlashItem } from './slashItems'

export interface SlashMenuHandle {
  onKeyDown: (e: KeyboardEvent) => boolean
}

export const SlashMenu = forwardRef<SlashMenuHandle, SuggestionProps<SlashItem, SlashItem>>(function SlashMenu(props, ref) {
  const { items, command } = props
  const [index, setIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => setIndex(0), [items])

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [index])

  useImperativeHandle(ref, () => ({
    onKeyDown: (e) => {
      if (!items.length) return false
      if (e.key === 'ArrowDown') {
        setIndex((i) => (i + 1) % items.length)
        return true
      }
      if (e.key === 'ArrowUp') {
        setIndex((i) => (i - 1 + items.length) % items.length)
        return true
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        const it = items[index]
        if (it) command(it)
        return true
      }
      return false
    },
  }))

  if (!items.length) {
    return (
      <div className="menu slash-menu" role="listbox">
        <div className="menu-empty">{t('noResults')}</div>
      </div>
    )
  }

  let lastGroup = ''
  return (
    <div className="menu slash-menu" role="listbox" ref={listRef} onMouseDown={(e) => e.preventDefault()}>
      {items.map((it, i) => {
        const showGroup = it.group !== lastGroup && props.query === ''
        lastGroup = it.group
        const Icon = it.icon
        return (
          <div key={it.id}>
            {showGroup && <div className="menu-group">{t(it.group)}</div>}
            <button
              type="button"
              data-index={i}
              role="option"
              aria-selected={i === index}
              className={'slash-item' + (i === index ? ' is-active' : '')}
              onMouseEnter={() => setIndex(i)}
              onClick={() => command(it)}
            >
              <span className="slash-icon">
                <Icon size={18} strokeWidth={1.6} />
              </span>
              <span className="slash-text">
                <span className="slash-title">{t(it.title)}</span>
                <span className="slash-desc">{t(it.desc)}</span>
              </span>
              {it.hint && <kbd className="slash-hint">{it.hint}</kbd>}
            </button>
          </div>
        )
      })}
    </div>
  )
})
