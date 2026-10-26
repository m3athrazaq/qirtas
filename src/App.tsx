import { useEffect, useRef } from 'react'
import { AiPanel } from './ai/AiPanel'
import { getRecent, navigate } from './data/nav'
import { useStore } from './data/store'
import { PageView } from './page/PageView'
import { PagePicker } from './shell/PagePicker'
import { RowPeek } from './shell/RowPeek'
import { SearchDialog } from './shell/SearchDialog'
import { SettingsDialog } from './shell/SettingsDialog'
import { ShareDialog } from './shell/ShareDialog'
import { Sidebar } from './shell/Sidebar'
import { TemplatesDialog } from './shell/TemplatesDialog'
import { Toasts } from './shell/Toasts'
import { JoinDialog } from './shell/JoinDialog'
import { DialogHost } from './ui/dialogs'
import { TopBar } from './shell/TopBar'
import { TrashDialog } from './shell/TrashDialog'
import { compareOrder } from './lib/ids'
import { t } from './lib/i18n'
import { isReachable } from './shell/pageOps'

export default function App() {
  const ready = useStore((s) => s.ready)
  const route = useStore((s) => s.route)
  const isMobile = useStore((s) => s.isMobile)
  const sidebarOpen = useStore((s) => s.sidebarOpen)
  const width = useStore((s) => s.settings.sidebarWidth)
  useStore((s) => s.settings.lang)

  // On wide screens the home route opens the last page you were on
  useEffect(() => {
    if (!ready || isMobile || route.name !== 'home') return
    const pages = useStore.getState().pages
    // Not a page whose parent was just deleted
    const recent = getRecent().find((id) => isReachable(id, pages))
    const first = Object.values(pages)
      .filter((p) => !p.parentId && !p.deletedAt && p.type !== 'row')
      .sort(compareOrder)[0]?.id
    const target = recent ?? first
    if (target) navigate(target, { replace: true })
  }, [ready, isMobile, route.name])

  if (!ready) return <div className="boot">{t('loading')}</div>
  const pageId = route.name === 'page' ? route.id : null

  return (
    <div className={'app' + (isMobile ? ' is-mobile' : '') + (sidebarOpen && !isMobile ? ' sb-open' : '')}>
      {!isMobile && sidebarOpen && (
        <aside className="sb-wrap" style={{ width }}>
          <Sidebar />
          <SidebarResizer />
        </aside>
      )}
      <main className="main">
        {isMobile && !pageId ? (
          <Sidebar variant="home" />
        ) : (
          <>
            <TopBar pageId={pageId} />
            <div className="scroller" id="scroller">
              {pageId ? <PageView key={pageId} pageId={pageId} /> : <div className="empty-home">{t('noPagesYet')}</div>}
            </div>
          </>
        )}
      </main>
      <SearchDialog />
      <TemplatesDialog />
      <SettingsDialog />
      <TrashDialog />
      <ShareDialog />
      <PagePicker />
      <RowPeek />
      <AiPanel />
      <JoinDialog />
      <DialogHost />
      <Toasts />
    </div>
  )
}

function SidebarResizer() {
  const ref = useRef<HTMLDivElement>(null)
  const rtl = useStore((s) => s.settings.lang === 'ar')
  return (
    <div
      ref={ref}
      className="sb-resizer"
      onPointerDown={(e) => {
        e.preventDefault()
        const startX = e.clientX
        const start = useStore.getState().settings.sidebarWidth
        const aside = ref.current?.parentElement
        let w = start
        const move = (ev: PointerEvent) => {
          const dx = (ev.clientX - startX) * (rtl ? -1 : 1)
          w = Math.max(200, Math.min(440, start + dx))
          if (aside) aside.style.width = `${w}px`
        }
        const up = () => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', up)
          useStore.getState().setSettings({ sidebarWidth: Math.round(w) })
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
      }}
    />
  )
}
