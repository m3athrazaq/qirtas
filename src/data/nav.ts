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

// What to show once the next route applies: a row's preview on top, or a block to scroll to
let pendingPeek: string | null = null
let pendingScroll: string | null = null

const stateIndex = () => {
  const idx = (history.state as { idx?: unknown } | null)?.idx
  return typeof idx === 'number' ? idx : 0
}

export function navigate(id: string | null, opts: { replace?: boolean; peek?: string; scrollTo?: string } = {}) {
  const hash = id ? `#/p/${id}` : '#/'
  pendingPeek = opts.peek ?? null
  pendingScroll = opts.scrollTo ?? null
  if (location.hash === hash) {
    if (pendingPeek || pendingScroll) applyRoute()
    return
  }
  if (opts.replace) history.replaceState({ idx: stateIndex() }, '', hash)
  else history.pushState({ idx: stateIndex() + 1 }, '', hash)
  applyRoute()
}

export function goBack() {
  if (stateIndex() > 0) history.back()
  else navigate(null)
}

/** Open a row or an inline database as a full page. The new history entry remembers it was opened
 *  this way, so "minimize" can step back to where it came from. */
export function expandTo(id: string) {
  const before = stateIndex()
  navigate(id)
  if (stateIndex() === before + 1) history.replaceState({ ...(history.state as object), expanded: id }, '')
}

/** True when this history entry was made by expanding this page (the entry before it is where it came from). */
export function cameFromExpand(id: string): boolean {
  return (history.state as { expanded?: unknown } | null)?.expanded === id && stateIndex() > 0
}

/** Go back one step in history, then show this row's preview / scroll to this block. */
export function backTo(opts: { peek?: string; scrollTo?: string }) {
  pendingPeek = opts.peek ?? null
  pendingScroll = opts.scrollTo ?? null
  history.back()
}

/** The block a just-opened page should scroll to (cleared with clearPendingScroll once done). */
export function pendingScrollTarget(): string | null {
  return pendingScroll
}

export function clearPendingScroll() {
  pendingScroll = null
}

const sameRoute = (a: Route, b: Route) =>
  a.name === b.name && (a.name !== 'page' || a.id === (b as typeof a).id) && (a.name !== 'join' || a.token === (b as typeof a).token)

function applyRoute() {
  const route = parseHash()
  const cur = useStore.getState()
  // Going back fires both popstate and hashchange: the second one must not undo the first
  const same = sameRoute(cur.route, route)
  const peek = pendingPeek ?? (same ? cur.peek : null)
  pendingPeek = null
  useStore.setState({ route: same ? cur.route : route, peek, navIndex: stateIndex() })
  if (route.name === 'page') pushRecent(route.id)
  if (useStore.getState().isMobile) useStore.setState({ sidebarOpen: false })
}

export function initRouter() {
  // Number the entries so the app knows whether "back" stays inside it
  if (typeof (history.state as { idx?: unknown } | null)?.idx !== 'number') history.replaceState({ idx: 0 }, '')
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
