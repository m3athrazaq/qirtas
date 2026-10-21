import { useStore, type Route } from './store'

const RECENT_KEY = 'qirtas.recent'
let pendingAction: 'new' | 'search' | null = null
/** A shortcut from the installed web app ("new page" / "search") waiting to run. */
export function takePendingAction() {
  const a = pendingAction
  pendingAction = null
  return a
}

export function parseHash(): Route {
  const h = location.hash.replace(/^#\/?/, '')
  const m = h.match(/^p\/([A-Za-z0-9_-]+)/)
  if (m) return { name: 'page', id: m[1] }
  if (h === 'new' || h === 'search') {
    pendingAction = h
    return { name: 'home' }
  }
  const j = h.match(/^join\/([A-Za-z0-9]+)/)
  if (j) return { name: 'join', token: j[1] }
  return { name: 'home' }
}

export function navigate(id: string | null, opts: { replace?: boolean } = {}) {
  const hash = id ? `#/p/${id}` : '#/'
  if (location.hash === hash) return
  if (opts.replace) history.replaceState(null, '', hash)
  else history.pushState(null, '', hash)
  applyRoute()
}

export function goBack() {
  if (history.length > 1) history.back()
  else navigate(null)
}

function applyRoute() {
  const route = parseHash()
  useStore.setState({ route, peek: null })
  if (route.name === 'page') pushRecent(route.id)
  if (useStore.getState().isMobile) useStore.setState({ sidebarOpen: false })
}

export function initRouter() {
  window.addEventListener('popstate', applyRoute)
  window.addEventListener('hashchange', applyRoute)
  applyRoute()
}

export function getRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]')
  } catch {
    return []
  }
}

function pushRecent(id: string) {
  const list = [id, ...getRecent().filter((x) => x !== id)].slice(0, 20)
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list))
  } catch {
    /* ignore */
  }
}

export function pageUrl(id: string): string {
  return `${location.origin}${location.pathname}#/p/${id}`
}
