import { ChevronsLeft, ChevronsRight, Cloud, CloudOff, Database, FileText, LayoutTemplate, Plus, Search, Settings, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { getRecent, navigate } from '../data/nav'
import { useCanEdit, useStore, ws } from '../data/store'
import { t } from '../lib/i18n'
import { num } from '../lib/hijri'
import { PageTree } from './PageTree'
import { WorkspaceMenu } from './WorkspaceMenu'

function isMac() {
  return /Mac|iPhone|iPad/.test(navigator.platform)
}

export function Sidebar({ variant = 'side' }: { variant?: 'side' | 'home' }) {
  const wsName = useStore((s) => s.wsName)
  const favorites = useStore((s) => s.favorites)
  const pages = useStore((s) => s.pages)
  const lang = useStore((s) => s.settings.lang)
  const numerals = useStore((s) => s.settings.numerals)
  const syncStatus = useStore((s) => s.syncStatus)
  const openModal = useStore((s) => s.openModal)
  const rtl = lang === 'ar'
  const canEdit = useCanEdit()
  const [wsMenu, setWsMenu] = useState<Element | null>(null)
  const Collapse = rtl ? ChevronsRight : ChevronsLeft
  const favs = favorites.map((id) => pages[id]).filter((p) => p && !p.deletedAt)
  const recent = useMemo(
    () =>
      variant === 'home'
        ? getRecent()
            .map((id) => pages[id])
            .filter((p) => p && !p.deletedAt)
            .slice(0, 8)
        : [],
    [variant, pages],
  )
  const trashCount = useMemo(() => Object.values(pages).filter((p) => p.deletedAt && !(p.parentId && pages[p.parentId]?.deletedAt)).length, [pages])

  const newPage = () => navigate(ws().createPage({ parentId: null }))

  return (
    <nav className={'sidebar' + (variant === 'home' ? ' is-home' : '')} aria-label={t('pages')}>
      <div className="sb-head">
        <button type="button" className="sb-brand" onClick={(e) => setWsMenu(e.currentTarget)}>
          <span className="brand-mark" aria-hidden="true">
            ق
          </span>
          <span className="sb-ws">{wsName || t('appName')}</span>
        </button>
        {wsMenu && <WorkspaceMenu anchor={wsMenu} onClose={() => setWsMenu(null)} />}
        <span className={'sync-dot is-' + syncStatus} title={syncStatus === 'local' ? t('syncOff') : syncStatus === 'offline' ? t('offline') : t('syncOn')}>
          {syncStatus === 'offline' ? <CloudOff size={14} /> : syncStatus !== 'local' ? <Cloud size={14} /> : null}
        </span>
        {variant === 'side' && (
          <button type="button" className="icon-btn" title={t('collapseSidebar')} onClick={() => useStore.setState({ sidebarOpen: false })}>
            <Collapse size={17} />
          </button>
        )}
      </div>

      <div className="sb-quick">
        <button type="button" className="sb-item" onClick={() => openModal('search')}>
          <Search size={17} strokeWidth={1.7} />
          <span>{t('search')}</span>
          {variant === 'side' && <kbd>{isMac() ? '⌘K' : 'Ctrl K'}</kbd>}
        </button>
        <button type="button" className="sb-item" onClick={() => openModal('templates')}>
          <LayoutTemplate size={17} strokeWidth={1.7} />
          <span>{t('templates')}</span>
        </button>
      </div>

      <div className="sb-scroll">
        {recent.length > 0 && (
          <section className="sb-section">
            <h3 className="sb-label">{t('recent')}</h3>
            <div className="recent-strip">
              {recent.map((p) => (
                <button type="button" key={p.id} className="recent-card" onClick={() => navigate(p.id)}>
                  <span className="rc-icon">{p.icon || (p.type === 'database' ? <Database size={20} strokeWidth={1.5} /> : <FileText size={20} strokeWidth={1.5} />)}</span>
                  <span className="rc-title">{p.title || t('untitled')}</span>
                </button>
              ))}
            </div>
          </section>
        )}
        {favs.length > 0 && (
          <section className="sb-section">
            <h3 className="sb-label">{t('favorites')}</h3>
            {favs.map((p) => (
              <button type="button" key={p.id} className="sb-item sb-fav" onClick={() => navigate(p.id)}>
                <span className="tree-icon">{p.icon || <FileText size={16} strokeWidth={1.6} />}</span>
                <span className="tree-title">{p.title || t('untitled')}</span>
              </button>
            ))}
          </section>
        )}
        <section className="sb-section">
          <div className="sb-label-row">
            <h3 className="sb-label">{t('pages')}</h3>
            {canEdit && (
              <button type="button" className="icon-btn" title={t('newPage')} onClick={newPage}>
                <Plus size={15} />
              </button>
            )}
          </div>
          <PageTree />
        </section>
      </div>

      <div className="sb-foot">
        {canEdit && (
          <button type="button" className="sb-item" onClick={newPage}>
            <Plus size={17} strokeWidth={1.7} />
            <span>{t('newPage')}</span>
          </button>
        )}
        <button type="button" className="sb-item" onClick={() => openModal('trash')}>
          <Trash2 size={17} strokeWidth={1.7} />
          <span>{t('trash')}</span>
          {trashCount > 0 && <span className="count">{num(trashCount, numerals)}</span>}
        </button>
        <button type="button" className="sb-item" onClick={() => openModal('settings')}>
          <Settings size={17} strokeWidth={1.7} />
          <span>{t('settings')}</span>
        </button>
      </div>
      {variant === 'home' && canEdit && (
        <button type="button" className="fab" aria-label={t('newPage')} onClick={newPage}>
          <Plus size={26} />
        </button>
      )}
    </nav>
  )
}
