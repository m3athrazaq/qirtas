import { Database, FileText, Home, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useStore, ws } from '../data/store'
import { findMatches, matchScore } from '../lib/arabic'
import { t } from '../lib/i18n'
import { Modal } from '../ui/Modal'
import { closePagePicker, usePicker } from '../ui/pickerBus'
import { Highlight } from './SearchDialog'

export function PagePicker() {
  const { onPick, title, excludeId, allowRoot } = usePicker()
  const pages = useStore((s) => s.pages)
  const [q, setQ] = useState('')
  const open = !!onPick

  const list = useMemo(() => {
    if (!open) return []
    const banned = new Set<string>()
    if (excludeId) {
      banned.add(excludeId)
      ws()
        .descendants(excludeId)
        .forEach((d) => banned.add(d))
    }
    const all = Object.values(pages).filter((p) => !p.deletedAt && p.type !== 'row' && !banned.has(p.id))
    const scored = q.trim() ? all.map((p) => ({ p, s: matchScore(p.title, q) })).filter((x) => x.s > 0) : all.map((p) => ({ p, s: 0 }))
    scored.sort((a, b) => b.s - a.s || b.p.updatedAt - a.p.updatedAt)
    return scored.slice(0, 40).map((x) => x.p)
  }, [open, pages, q, excludeId])

  const pick = (id: string) => {
    onPick?.(id)
    closePagePicker()
    setQ('')
  }

  return (
    <Modal open={open} onClose={closePagePicker} title={title || t('bLinkPage')} width={480} top>
      <div className="search-box">
        <Search size={17} className="muted" />
        <input autoFocus dir="auto" value={q} placeholder={t('search')} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="search-results">
        {allowRoot && !q.trim() && (
          <button type="button" className="search-item" onClick={() => pick('__root__')}>
            <span className="si-icon">
              <Home size={17} strokeWidth={1.5} />
            </span>
            <span className="si-title">{t('moveToTop')}</span>
          </button>
        )}
        {list.map((p) => (
          <button type="button" key={p.id} className="search-item" onClick={() => pick(p.id)}>
            <span className="si-icon">{p.icon || (p.type === 'database' ? <Database size={17} strokeWidth={1.5} /> : <FileText size={17} strokeWidth={1.5} />)}</span>
            <span className="si-title">
              <Highlight text={p.title || t('untitled')} ranges={q.trim() ? findMatches(p.title, q) : []} />
            </span>
          </button>
        ))}
      </div>
    </Modal>
  )
}
