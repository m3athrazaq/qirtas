import { Database, FileText, Search, Zap } from 'lucide-react'
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { valueText } from '../data/dbops'
import { getRecent, navigate } from '../data/nav'
import { useStore, ws } from '../data/store'
import type { PageMeta } from '../data/types'
import { findMatches, matchScore, snippet, type MatchRange } from '../lib/arabic'
import { t } from '../lib/i18n'
import { Modal } from '../ui/Modal'
import { findCommands, type Command } from './commands'

export function Highlight({ text, ranges }: { text: string; ranges: MatchRange[] }) {
  if (!ranges.length) return <>{text}</>
  const out: React.ReactNode[] = []
  let i = 0
  ranges.forEach((r, k) => {
    if (r.start > i) out.push(text.slice(i, r.start))
    out.push(<mark key={k}>{text.slice(r.start, r.end)}</mark>)
    i = r.end
  })
  if (i < text.length) out.push(text.slice(i))
  return <>{out}</>
}

interface Result {
  page: PageMeta
  score: number
  snip: { text: string; ranges: MatchRange[] } | null
}

function search(query: string, pages: Record<string, PageMeta>): Result[] {
  const q = query.trim()
  if (!q) return []
  const out: Result[] = []
  const w = ws()
  for (const id in pages) {
    const p = pages[id]
    if (p.deletedAt) continue
    if (p.parentId && pages[p.parentId]?.deletedAt) continue
    const titleScore = matchScore(p.title, q)
    let body = w.getText(id)
    if (p.type === 'row' && p.parentId) {
      const db = pages[p.parentId]
      const propText = (db?.schema ?? [])
        .filter((s) => s.type !== 'title')
        .map((s) => valueText(p, s))
        .filter(Boolean)
        .join('، ')
      if (propText) body = propText + '\n' + body
    }
    const snip = body ? snippet(body, q) : null
    const score = titleScore ? titleScore + 100 : snip ? 30 : 0
    if (score) out.push({ page: p, score, snip })
  }
  out.sort((a, b) => b.score - a.score || b.page.updatedAt - a.page.updatedAt)
  return out.slice(0, 60)
}

export function SearchDialog() {
  const open = useStore((s) => s.modal === 'search')
  const close = useStore((s) => s.closeModal)
  const pages = useStore((s) => s.pages)
  const [q, setQ] = useState('')
  const dq = useDeferredValue(q)
  const [index, setIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      setQ('')
      setIndex(0)
    }
  }, [open])

  const results = useMemo(() => (open ? search(dq, pages) : []), [dq, pages, open])
  const recent = useMemo(
    () =>
      getRecent()
        .map((id) => pages[id])
        .filter((p) => p && !p.deletedAt)
        .slice(0, 8),
    [pages, open],
  )
  // What is listed: pages, then the app's own commands (so Enter still opens the best page).
  // ">" asks for commands only.
  const typed = q.trim()
  const onlyCommands = typed.startsWith('>')
  const commands = useMemo(() => (open ? findCommands(dq) : []), [dq, open])
  const pageItems: Result[] = onlyCommands ? [] : typed ? results : recent.map((page) => ({ page, score: 0, snip: null }))
  const shownCommands = onlyCommands || !typed ? commands : commands.slice(0, 3)
  type Item = { kind: 'page'; r: Result } | { kind: 'cmd'; c: Command }
  const cmdItems: Item[] = shownCommands.map((c) => ({ kind: 'cmd', c }))
  const pgItems: Item[] = pageItems.map((r) => ({ kind: 'page', r }))
  const items: Item[] = [...pgItems, ...cmdItems]

  useEffect(() => setIndex(0), [dq])
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${index}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [index])

  const go = (p: PageMeta) => {
    close()
    if (p.type === 'row') useStore.setState({ peek: p.id })
    else navigate(p.id)
  }
  const run = (it: Item) => {
    if (it.kind === 'page') return go(it.r.page)
    close()
    it.c.run()
  }

  return (
    <Modal open={open} onClose={close} className="search-modal" width={640} top>
      <div className="search-box">
        <Search size={18} className="muted" />
        <input
          autoFocus
          dir="auto"
          value={q}
          placeholder={t('searchPlaceholder')}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setIndex((i) => Math.min(items.length - 1, i + 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setIndex((i) => Math.max(0, i - 1))
            } else if (e.key === 'Enter' && items[index]) {
              run(items[index])
            }
          }}
        />
      </div>
      <div className="search-results" ref={listRef}>
        {items.map((it, i) => {
          const first = i === 0 || items[i - 1].kind !== it.kind
          if (it.kind === 'cmd') {
            return (
              <div key={'c:' + it.c.id}>
                {first && <div className="menu-group">{t('commands')}</div>}
                <button type="button" data-i={i} className={'search-item is-command' + (i === index ? ' is-active' : '')} onMouseEnter={() => setIndex(i)} onClick={() => run(it)}>
                  <span className="si-icon">
                    <Zap size={16} strokeWidth={1.6} />
                  </span>
                  <span className="si-body">
                    <span className="si-title">{it.c.label}</span>
                  </span>
                  {it.c.keys && (
                    <kbd className="si-keys" dir="ltr">
                      {it.c.keys}
                    </kbd>
                  )}
                </button>
              </div>
            )
          }
          const r = it.r
          const parent = r.page.parentId ? pages[r.page.parentId] : undefined
          return (
            <div key={r.page.id}>
              {first && !typed && <div className="menu-group">{t('recent')}</div>}
              <button type="button" data-i={i} className={'search-item' + (i === index ? ' is-active' : '')} onMouseEnter={() => setIndex(i)} onClick={() => run(it)}>
                <span className="si-icon">{r.page.icon || (r.page.type === 'database' ? <Database size={17} strokeWidth={1.5} /> : <FileText size={17} strokeWidth={1.5} />)}</span>
                <span className="si-body">
                  <span className="si-title">
                    <Highlight text={r.page.title || t('untitled')} ranges={typed ? findMatches(r.page.title, q) : []} />
                    {parent && <span className="si-path">{parent.title || t('untitled')}</span>}
                  </span>
                  {r.snip && (
                    <span className="si-snip" dir="auto">
                      <Highlight text={r.snip.text} ranges={r.snip.ranges} />
                    </span>
                  )}
                </span>
              </button>
            </div>
          )
        })}
        {typed && !items.length && <div className="search-empty">{t('searchEmpty', { q: typed })}</div>}
      </div>
      <div className="search-hint">{t('searchHint')}</div>
    </Modal>
  )
}
