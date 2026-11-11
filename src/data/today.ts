// The journal (one page a day, made the first time it is opened), the shelf of the user's own
// templates, and the Inbox. Their ids are fixed per workspace (day-<workspace>-2026-11-11), so two
// devices that open "today" before syncing end up with one page, not two. The workspace is part of
// the id because this device keeps the pages of all its workspaces side by side: a fixed id shared
// by two workspaces would mix their content.
import { formatGregorian, formatHijri, todayIso, WEEKDAYS_AR, WEEKDAYS_EN, weekday } from '../lib/hijri'
import { t } from '../lib/i18n'
import * as Y from 'yjs'
import { getDoc, pageDocId } from './docs'
import { ORIGIN_SYSTEM } from './history'
import { kvGet } from './idb'
import { navigate } from './nav'
import { useStore, ws } from './store'
import { withGen } from './purged'
import type { PageMeta } from './types'

const tag = () => (useStore.getState().ws?.id ?? 'local').replace(/[^A-Za-z0-9]/g, '').slice(0, 12)
/** A fixed id, with the generation that "delete forever" moved it to (see purged.ts). */
const fixed = (base: string) => withGen(base, Number(useStore.getState().ws?.meta.get(`gen:${base}`)) || 0)
export const journalId = () => fixed(`journal-${tag()}`)
export const templatesId = () => fixed(`templates-${tag()}`)
export const dayPageId = (iso: string) => fixed(`day-${tag()}-${iso}`)
/** The day a journal page is for (also for pages that came from another workspace, after signing in). */
export const dayOfPage = (id: string): string | null => /^day-[A-Za-z0-9]+-(\d{4}-\d{2}-\d{2})(?:-g\d+)?$/.exec(id)?.[1] ?? null
const isShelf = (id: string) => /^templates-[A-Za-z0-9]+(?:-g\d+)?$/.test(id)

export function dayTitle(iso: string): string {
  const s = useStore.getState().settings
  const fmt = { lang: s.lang, numerals: s.numerals } as const
  const wd = (s.lang === 'ar' ? WEEKDAYS_AR : WEEKDAYS_EN)[weekday(iso)]
  const date = s.calendar === 'hijri' ? formatHijri(iso, fmt) : formatGregorian(iso, fmt)
  return `${wd}${s.lang === 'ar' ? '،' : ','} ${date}`
}

/** A page with a fixed id that the app keeps for the user (the journal, the template shelf): made
 *  when missing, taken out of the trash when it is there. Not an undo step. */
async function ensureFixedPage(id: string, init: { title: string; icon: string; parentId: string | null }, atStart = true): Promise<boolean> {
  // Made fresh on a device that hasn't heard from the server yet, it would compete with the one
  // another device made (and could reset its title or place): wait a moment for the first sync
  if (!useStore.getState().pages[id]) await settleSync()
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

/** In a workspace that syncs, wait (a few seconds at most) for the first sync of this session. */
async function settleSync() {
  const st = useStore.getState()
  if (!st.ws || st.syncStatus === 'synced' || st.syncStatus === 'offline') return
  if (!(await kvGet(`sync:linked:${st.ws.id}`).catch(() => null))) return
  await new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer)
      stop()
      resolve()
    }
    const timer = setTimeout(done, 5000)
    const stop = useStore.subscribe((s) => (s.syncStatus === 'synced' || s.syncStatus === 'offline') && done())
  })
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
  const journal = findFixed(journalId(), (p) => !p.parentId && /^journal-[A-Za-z0-9]+(?:-g\d+)?$/.test(p.id))
  const id = findFixed(dayPageId(iso), (p) => dayOfPage(p.id) === iso)
  const day = useStore.getState().pages[id]
  // The journal is there (and out of the trash) for a new day page, or one that still sits in it
  if ((!day || day.parentId === journal) && !(await ensureFixedPage(journal, { title: t('journal'), icon: '📓', parentId: null }))) return null
  if (!(await ensureFixedPage(id, { title: dayTitle(iso), icon: '', parentId: journal }))) return null
  return id
}

/** Keep a copy of a page (with its sub-pages) on the "My templates" shelf. */
export async function saveAsTemplate(pageId: string): Promise<boolean> {
  const shelf = findFixed(templatesId(), (p) => !p.parentId && isShelf(p.id))
  if (!(await ensureFixedPage(shelf, { title: t('myTemplates'), icon: '🗂️', parentId: null }, false))) return false
  return !!(await ws().duplicatePage(pageId, '', shelf))
}

/** A new page from one of the user's templates, at the top level. Its reminders start unset: the
 *  template's times are in the past by now. */
export async function pageFromTemplate(templateId: string): Promise<string | null> {
  const w = ws()
  const id = await w.duplicatePage(templateId, '', null)
  if (!id) return null
  for (const pageId of [id, ...w.descendants(id)]) {
    const doc = await getDoc(pageDocId(pageId))
    const reminders: Y.XmlElement[] = []
    const walk = (n: Y.XmlFragment | Y.XmlElement) =>
      n.toArray().forEach((c) => {
        if (!(c instanceof Y.XmlElement)) return
        if (c.nodeName === 'reminder') reminders.push(c)
        walk(c)
      })
    walk(doc.getXmlFragment('default'))
    if (reminders.length)
      doc.transact(() => {
        for (const r of reminders) {
          r.setAttribute('at', null as unknown as string)
          r.setAttribute('done', false as unknown as string)
        }
      }, ORIGIN_SYSTEM)
  }
  return id
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
