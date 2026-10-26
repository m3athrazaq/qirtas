// Page actions shared by the sidebar, the top bar and database rows.
import { backTo, cameFromExpand, navigate } from '../data/nav'
import { useStore, ws } from '../data/store'
import type { PageMeta } from '../data/types'
import { t } from '../lib/i18n'

/** Is `id` the page `ancestor` or somewhere inside it? */
export function isInside(id: string, ancestor: string, pages: Record<string, PageMeta>): boolean {
  let cur: string | null = id
  for (let guard = 0; cur && guard < 500; guard++) {
    if (cur === ancestor) return true
    cur = pages[cur]?.parentId ?? null
  }
  return false
}

const alive = (id: string | null | undefined, pages: Record<string, PageMeta>) => !!id && !!pages[id] && !pages[id].deletedAt

/** The page exists and neither it nor any page above it is in the trash. */
export function isReachable(id: string, pages: Record<string, PageMeta>): boolean {
  let cur: string | null = id
  for (let guard = 0; cur && guard < 500; guard++) {
    const p: PageMeta | undefined = pages[cur]
    if (!p || p.deletedAt) return false
    cur = p.parentId
  }
  return true
}

/** The page that shows a page in context: a row inside its database, which may sit inside a page. */
function contextOf(page: PageMeta, pages: Record<string, PageMeta>): string | null {
  if (page.type === 'row') {
    const db = page.parentId ? pages[page.parentId] : undefined
    if (!db || db.deletedAt) return null
    return db.inline && alive(db.parentId, pages) ? db.parentId : db.id
  }
  return alive(page.parentId, pages) ? page.parentId : null
}

/** Move a page to the trash, leave it if it (or a page inside it) is on screen, offer undo. */
export function trashPage(page: PageMeta) {
  const st = useStore.getState()
  ws().trashPage(page.id)
  if (st.peek && isInside(st.peek, page.id, st.pages)) useStore.setState({ peek: null })
  if (st.route.name === 'page' && isInside(st.route.id, page.id, st.pages)) navigate(contextOf(page, st.pages), { replace: true })
  st.toast(page.type === 'row' ? t('rowDeleted') : t('movedToTrash'), { label: t('undo'), run: () => ws().restorePage(page.id) })
}

/** Where "minimize" goes for a page opened full size: a row back into its preview, an inline database back into its page. */
export function minimizeTarget(page: PageMeta, pages: Record<string, PageMeta>): { to: string; peek?: string; scrollTo?: string } | null {
  if (page.type === 'row') {
    const db = page.parentId ? pages[page.parentId] : undefined
    if (!db || db.deletedAt) return null
    if (db.inline && alive(db.parentId, pages)) return { to: db.parentId!, peek: page.id, scrollTo: db.id }
    return { to: db.id, peek: page.id }
  }
  if (page.type === 'database' && page.inline && alive(page.parentId, pages)) return { to: page.parentId!, scrollTo: page.id }
  return null
}

export function minimizePage(page: PageMeta) {
  const target = minimizeTarget(page, useStore.getState().pages)
  if (!target) return
  // Opened from that very place a moment ago: step back, so history stays tidy
  if (cameFromExpand(page.id)) backTo({ peek: target.peek, scrollTo: target.scrollTo })
  else navigate(target.to, { peek: target.peek, scrollTo: target.scrollTo })
}
