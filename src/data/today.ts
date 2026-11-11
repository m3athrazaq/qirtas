// The journal (one page a day, made the first time it is opened), the shelf of the user's own
// templates, and the Inbox. Their ids are fixed per workspace (day-<workspace>-2026-11-11), so two
// devices that open "today" before syncing end up with one page, not two. The workspace is part of
// the id because this device keeps the pages of all its workspaces side by side: a fixed id shared
// by two workspaces would mix their content.
import { formatGregorian, formatHijri, todayIso, WEEKDAYS_AR, WEEKDAYS_EN, weekday } from '../lib/hijri'
import { t } from '../lib/i18n'
import { ORIGIN_SYSTEM } from './history'
import { navigate } from './nav'
import { useStore, ws } from './store'
import type { PageMeta } from './types'

const tag = () => (useStore.getState().ws?.id ?? 'local').replace(/[^A-Za-z0-9]/g, '').slice(0, 12)
export const journalId = () => `journal-${tag()}`
export const templatesId = () => `templates-${tag()}`
export const dayPageId = (iso: string) => `day-${tag()}-${iso}`
/** The day a journal page is for (also for pages that came from another workspace, after signing in). */
export const dayOfPage = (id: string): string | null => /^day-[A-Za-z0-9]+-(\d{4}-\d{2}-\d{2})$/.exec(id)?.[1] ?? null
const isShelf = (id: string) => /^templates-[A-Za-z0-9]+$/.test(id)

export function dayTitle(iso: string): string {
  const s = useStore.getState().settings
  const fmt = { lang: s.lang, numerals: s.numerals } as const
  const wd = (s.lang === 'ar' ? WEEKDAYS_AR : WEEKDAYS_EN)[weekday(iso)]
  const date = s.calendar === 'hijri' ? formatHijri(iso, fmt) : formatGregorian(iso, fmt)
  return `${wd}${s.lang === 'ar' ? '،' : ','} ${date}`
}

/** A page with a fixed id that the app keeps for the user (the journal, the template shelf): made
 *  when missing, taken out of the trash when it is there. Not an undo step. */
function ensureFixedPage(id: string, init: { title: string; icon: string; parentId: string | null }, atStart = true): boolean {
  const st = useStore.getState()
  const w = ws()
  const cur = st.pages[id]
  if (cur && !cur.deletedAt) return true
  if (st.wsRole === 'viewer') return false
  w.doc.transact(() => {
    if (!cur) w.createPage({ id, ...init }, { atStart })
    else w.restorePage(id)
  }, ORIGIN_SYSTEM)
  return true
}

/** This workspace's page with that fixed id, else one like it that came along from another
 *  workspace when signing in merged the pages (so the user doesn't get a second journal). */
function findFixed(own: string, like: (p: PageMeta) => boolean): string {
  const pages = useStore.getState().pages
  if (pages[own]) return own
  return Object.values(pages).find((p) => !p.deletedAt && like(p))?.id ?? own
}

/** The page of a day (today when not given), created on first use. Null in a read-only workspace that has none. */
export async function ensureDayPage(iso = todayIso()): Promise<string | null> {
  const journal = findFixed(journalId(), (p) => !p.parentId && /^journal-[A-Za-z0-9]+$/.test(p.id))
  const id = findFixed(dayPageId(iso), (p) => dayOfPage(p.id) === iso)
  const day = useStore.getState().pages[id]
  // The journal is there (and out of the trash) for a new day page, or one that still sits in it
  if ((!day || day.parentId === journal) && !ensureFixedPage(journal, { title: t('journal'), icon: '📓', parentId: null })) return null
  if (!ensureFixedPage(id, { title: dayTitle(iso), icon: '', parentId: journal })) return null
  return id
}

/** Keep a copy of a page (with its sub-pages) on the "My templates" shelf. */
export async function saveAsTemplate(pageId: string): Promise<boolean> {
  const shelf = findFixed(templatesId(), (p) => !p.parentId && isShelf(p.id))
  if (!ensureFixedPage(shelf, { title: t('myTemplates'), icon: '🗂️', parentId: null }, false)) return false
  return !!(await ws().duplicatePage(pageId, '', shelf))
}

/** A new page from one of the user's templates, at the top level. */
export async function pageFromTemplate(templateId: string): Promise<string | null> {
  return ws().duplicatePage(templateId, '', null)
}

/** The user's own templates: the pages on the shelf (or shelves, after a merge). */
export function myTemplates(pages: Record<string, PageMeta>): PageMeta[] {
  return Object.values(pages)
    .filter((p) => !p.deletedAt && p.type !== 'row' && !!p.parentId && isShelf(p.parentId) && !pages[p.parentId]?.deletedAt)
    .sort((a, b) => (a.order < b.order ? -1 : 1))
}

/** Is the page a template, or inside one? Its tasks and reminders are a pattern, not things to do. */
export function inTemplates(pageId: string, pages: Record<string, PageMeta>): boolean {
  let id: string | null = pageId
  for (let i = 0; id && i < 50; i++) {
    if (isShelf(id)) return true
    id = pages[id]?.parentId ?? null
  }
  return false
}

/** The page that collects quick notes and things shared from other apps (made on first use). */
export function inboxPageId(): string {
  const existing = Object.values(useStore.getState().pages).find((p) => !p.deletedAt && !p.parentId && p.icon === '📥')
  return existing?.id ?? ws().createPage({ title: t('inbox'), icon: '📥', parentId: null })
}

export async function openToday() {
  const id = await ensureDayPage()
  if (id) navigate(id)
  else useStore.getState().toast(t('readOnly'))
}
