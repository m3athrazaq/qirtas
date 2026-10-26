import {
  ArrowLeft,
  ArrowRight,
  ChevronsLeft,
  ChevronsRight,
  Copy,
  FileDown,
  FolderInput,
  Link2,
  Minimize2,
  MoreHorizontal,
  Printer,
  Redo2,
  Search,
  Share2,
  Star,
  Trash2,
  Undo2,
} from 'lucide-react'
import { Fragment, useState } from 'react'
import { historyRedo, historyUndo } from '../data/history'
import { goBack, navigate, pageUrl } from '../data/nav'
import { useStore, ws } from '../data/store'
import type { PageFont, PageMeta } from '../data/types'
import { getActor } from '../data/workspace'
import { exportMarkdown, exportPdf } from '../lib/exporter'
import { num } from '../lib/hijri'
import { t } from '../lib/i18n'
import { copyText } from '../lib/platform'
import { requestPagePicker } from '../ui/pickerBus'
import { useSession } from '../sync/session'
import { MenuItem, MenuLabel, MenuSep, Popover } from '../ui/Popover'
import { minimizePage, minimizeTarget, trashPage } from './pageOps'

const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+'

function useCrumbs(page: PageMeta | undefined) {
  const pages = useStore((s) => s.pages)
  const list: PageMeta[] = []
  let cur = page
  let guard = 0
  while (cur && guard++ < 20) {
    list.unshift(cur)
    cur = cur.parentId ? pages[cur.parentId] : undefined
  }
  return list
}

export function TopBar({ pageId }: { pageId: string | null }) {
  const page = useStore((s) => (pageId ? s.pages[pageId] : undefined))
  const sidebarOpen = useStore((s) => s.sidebarOpen)
  const isMobile = useStore((s) => s.isMobile)
  const favorites = useStore((s) => s.favorites)
  const lang = useStore((s) => s.settings.lang)
  const crumbs = useCrumbs(page)
  const [menu, setMenu] = useState<Element | null>(null)
  const rtl = lang === 'ar'
  const Back = rtl ? ArrowRight : ArrowLeft
  const Expand = rtl ? ChevronsLeft : ChevronsRight
  const fav = !!pageId && favorites.includes(pageId)
  const viewers = useSession((s) => s.presence).filter((p) => p.pageId === pageId)
  const role = useStore((s) => s.wsRole)
  const pages = useStore((s) => s.pages)
  const canUndo = useStore((s) => s.canUndo)
  const canRedo = useStore((s) => s.canRedo)
  const navIndex = useStore((s) => s.navIndex)
  const canEdit = role !== 'viewer'
  // A row or inline database opened full size can go back to its smaller view
  const mini = page ? minimizeTarget(page, pages) : null

  return (
    <header className="topbar">
      <div className="tb-start">
        {isMobile ? (
          <button
            type="button"
            className="icon-btn"
            onClick={() => (page && mini ? minimizePage(page) : page?.parentId ? navigate(page.parentId) : goBack())}
            aria-label={t('back')}
          >
            <Back size={20} />
          </button>
        ) : (
          <>
            {!sidebarOpen && (
              <button type="button" className="icon-btn" onClick={() => useStore.setState({ sidebarOpen: true })} title={t('openSidebar')}>
                <Expand size={18} />
              </button>
            )}
            {navIndex > 0 && (
              <button type="button" className="icon-btn" onClick={goBack} title={`${t('back')} (Alt+←)`} aria-label={t('back')}>
                <Back size={18} />
              </button>
            )}
          </>
        )}
        <nav className="crumbs" aria-label="breadcrumbs">
          {(isMobile ? crumbs.slice(-1) : crumbs).map((c, i, arr) => (
            <Fragment key={c.id}>
              <button type="button" className="crumb" onClick={() => navigate(c.id)}>
                {c.icon && <span className="crumb-icon">{c.icon}</span>}
                <span className="crumb-t">{c.title || t('untitled')}</span>
              </button>
              {i < arr.length - 1 && <span className="crumb-sep">/</span>}
            </Fragment>
          ))}
        </nav>
      </div>
      <div className="tb-end">
        {viewers.length > 0 && (
          <div className="presence" title={t('viewingNow')}>
            {viewers.slice(0, 4).map((v) => (
              <span key={v.userId} className="presence-avatar" style={{ background: v.color }} title={v.name}>
                {[...(v.name || '?')][0]}
              </span>
            ))}
          </div>
        )}
        {role === 'viewer' && <span className="ro-pill">{t('readOnly')}</span>}
        {isMobile && (
          <button type="button" className="icon-btn" onClick={() => useStore.getState().openModal('search')} aria-label={t('search')}>
            <Search size={19} />
          </button>
        )}
        {page && canEdit && (!isMobile || canUndo || canRedo) && (
          <span className="tb-history">
            <button
              type="button"
              className="icon-btn"
              disabled={!canUndo}
              title={`${t('undo')} (${MOD}Z)`}
              aria-label={t('undo')}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => historyUndo()}
            >
              <Undo2 size={18} className="flip-rtl" />
            </button>
            <button
              type="button"
              className="icon-btn"
              disabled={!canRedo}
              title={`${t('redo')} (${MOD}Y)`}
              aria-label={t('redo')}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => historyRedo()}
            >
              <Redo2 size={18} className="flip-rtl" />
            </button>
          </span>
        )}
        {page && mini && (
          <button type="button" className={isMobile ? 'icon-btn' : 'btn-text'} title={t('minimizeHint')} aria-label={t('minimize')} onClick={() => minimizePage(page)}>
            <Minimize2 size={isMobile ? 18 : 15} />
            {!isMobile && ` ${t('minimize')}`}
          </button>
        )}
        {page && (
          <>
            {!isMobile && (
              <button type="button" className="btn-text" onClick={() => useStore.getState().openModal('share')}>
                <Share2 size={15} /> {t('share')}
              </button>
            )}
            <button
              type="button"
              className={'icon-btn' + (fav ? ' is-fav' : '')}
              title={fav ? t('removeFromFavorites') : t('addToFavorites')}
              onClick={() => ws().toggleFavorite(getActor().id, page.id)}
            >
              <Star size={18} fill={fav ? 'currentColor' : 'none'} />
            </button>
            <button type="button" className="icon-btn" title={t('more')} onClick={(e) => setMenu(e.currentTarget)}>
              <MoreHorizontal size={19} />
            </button>
          </>
        )}
      </div>
      {menu && page && <PageActions page={page} anchor={menu} onClose={() => setMenu(null)} />}
    </header>
  )
}

function PageActions({ page, anchor, onClose }: { page: PageMeta; anchor: Element; onClose: () => void }) {
  const st = useStore.getState()
  const canEdit = useStore((s) => s.wsRole !== 'viewer')
  const settings = useStore((s) => s.settings)
  const fonts: { id: PageFont; label: string; sample: string }[] = [
    { id: 'sans', label: t('fontSans'), sample: 'أب' },
    { id: 'naskh', label: t('fontNaskh'), sample: 'أب' },
    { id: 'mono', label: t('fontMono'), sample: 'Ab' },
  ]
  const edited = new Date(page.updatedAt)
  return (
    <Popover anchor={anchor} open onClose={onClose} placement="bottom-end" sheet width={260}>
      <div className="menu-list">
        {canEdit && page.type !== 'database' && (
          <>
            <MenuLabel>{t('font')}</MenuLabel>
            <div className="font-choices">
              {fonts.map((f) => (
                <button key={f.id} type="button" className={'font-choice font-' + f.id + (page.font === f.id ? ' is-on' : '')} onClick={() => ws().updatePage(page.id, { font: f.id })}>
                  <span className="fc-sample">{f.sample}</span>
                  <span className="fc-label">{f.label}</span>
                </button>
              ))}
            </div>
            <label className="menu-toggle">
              <span>{t('smallText')}</span>
              <input type="checkbox" className="switch" checked={page.smallText} onChange={(e) => ws().updatePage(page.id, { smallText: e.target.checked })} />
            </label>
            <label className="menu-toggle">
              <span>{t('fullWidth')}</span>
              <input type="checkbox" className="switch" checked={page.fullWidth} onChange={(e) => ws().updatePage(page.id, { fullWidth: e.target.checked })} />
            </label>
            <MenuSep />
          </>
        )}
        <MenuItem
          icon={<Link2 size={15} />}
          label={t('copyLink')}
          onClick={async () => {
            await copyText(pageUrl(page.id))
            st.toast(t('linkCopied'))
            onClose()
          }}
        />
        {canEdit && (
        <MenuItem
          icon={<Copy size={15} />}
          label={t('duplicate')}
          onClick={async () => {
            onClose()
            const id = await ws().duplicatePage(page.id, t('copySuffix'))
            if (id) navigate(id)
          }}
        />
        )}
        {canEdit && (
        <MenuItem
          icon={<FolderInput size={15} />}
          label={t('moveTo')}
          onClick={() => {
            onClose()
            requestPagePicker((target) => ws().movePage(page.id, target === '__root__' ? null : target), { title: t('moveTo'), excludeId: page.id, allowRoot: true })
          }}
        />
        )}
        <MenuSep />
        <MenuItem
          icon={<FileDown size={15} />}
          label={t('exportMarkdown')}
          onClick={() => {
            onClose()
            void exportMarkdown(page.id)
          }}
        />
        <MenuItem
          icon={<Printer size={15} />}
          label={t('exportPdf')}
          onClick={() => {
            onClose()
            setTimeout(() => void exportPdf(), 150)
          }}
        />
        {canEdit && <MenuSep />}
        {canEdit && (
        <MenuItem
          icon={<Trash2 size={15} />}
          label={t('delete')}
          danger
          onClick={() => {
            onClose()
            trashPage(page)
          }}
        />
        )}
        <div className="menu-meta">
          {t('lastEdited')}: {num(edited.toLocaleDateString(settings.lang === 'ar' ? `ar-u-nu-${settings.numerals}` : 'en'), 'latn')}{' '}
          {edited.toLocaleTimeString(settings.lang === 'ar' ? `ar-u-nu-${settings.numerals}` : 'en', { hour: 'numeric', minute: '2-digit' })}
        </div>
      </div>
    </Popover>
  )
}
