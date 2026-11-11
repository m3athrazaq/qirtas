// Reminders: which ones are coming, and telling the user when one is due.
// On the phone the system shows the notification at its time even with the app closed (they are
// scheduled with Android while the app is open). In a browser a notification can only appear while
// Qirtas is open; reminders that came due meanwhile are reported at the next start.
import { num } from '../lib/hijri'
import { t } from '../lib/i18n'
import { isNative } from '../lib/platform'
import { isReachable } from '../shell/pageOps'
import { navigate } from './nav'
import { usePageIndex, type PageIndexEntry } from './pageIndex'
import { useStore } from './store'
import { inTemplates } from './today'
import type { PageMeta } from './types'

export interface ReminderItem {
  pageId: string
  pageTitle: string
  id: string | null
  key: string
  at: number
  done: boolean
  text: string
  task: number | null
}

/** Every reminder on a page that can be reached (templates aside), soonest first. */
export function listReminders(entries: Record<string, PageIndexEntry>, pages: Record<string, PageMeta>): ReminderItem[] {
  const out: ReminderItem[] = []
  for (const [pageId, e] of Object.entries(entries)) {
    if (!e.reminders.length || !isReachable(pageId, pages) || inTemplates(pageId, pages)) continue
    const pageTitle = pages[pageId]?.title || t('untitled')
    for (const r of e.reminders) out.push({ pageId, pageTitle, ...r })
  }
  return out.sort((a, b) => a.at - b.at)
}

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
/** Reminders announced on this device (by key, with the time they were for). */
const FIRED_KEY = 'qirtas.reminders.fired'
/** Reminders handed to Android, which shows them at their time even when the app is closed. */
const NATIVE_KEY = 'qirtas.reminders.native'
/** Older reminders that were never announced are not brought up as "missed" any more. */
const MISSED_WINDOW = 3 * DAY

function loadMap(key: string): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(key) || '{}') as Record<string, number>
  } catch {
    return {}
  }
}

function saveMap(key: string, f: Record<string, number>) {
  try {
    // Entries for reminders long past are dropped
    const cut = Date.now() - 60 * DAY
    localStorage.setItem(key, JSON.stringify(Object.fromEntries(Object.entries(f).filter(([, at]) => at > cut))))
  } catch {
    /* ignore */
  }
}

const keyOf = (r: ReminderItem) => `${r.pageId}:${r.key}`
const label = (r: ReminderItem) => r.text || r.pageTitle

async function announce(r: ReminderItem) {
  useStore.getState().toast(`${t('reminder')}: ${label(r)}`, { label: t('open'), run: () => navigate(r.pageId) }, 20000)
  if (isNative()) return // Android shows its own notification
  await showWebNotification(label(r), r.text ? r.pageTitle : '', `${r.pageId}:${r.key}`, () => navigate(r.pageId))
}

async function showWebNotification(title: string, body: string, tag: string, onClick?: () => void) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  const options = { body, tag, icon: './pwa-192.png', lang: useStore.getState().settings.lang, dir: 'auto' as const }
  try {
    const n = new Notification(title, options)
    n.onclick = () => {
      window.focus()
      onClick?.()
      n.close()
    }
  } catch {
    // Browsers on phones only allow notifications through the service worker
    try {
      await (await navigator.serviceWorker?.getRegistration())?.showNotification(title, options)
    } catch {
      /* no notification: the in-app message is there */
    }
  }
}

let timer: ReturnType<typeof setTimeout> | null = null
let openTasks: () => void = () => {}

function check() {
  if (timer) clearTimeout(timer)
  timer = null
  const st = useStore.getState()
  if (!st.ready) {
    timer = setTimeout(check, 2000)
    return
  }
  const now = Date.now()
  const all = listReminders(usePageIndex.getState().entries, st.pages).filter((r) => !r.done)
  const fired = loadMap(FIRED_KEY)
  const handed = isNative() ? loadMap(NATIVE_KEY) : {}
  const missed: ReminderItem[] = []
  let changed = false
  for (const r of all) {
    if (r.at > now) break
    const k = keyOf(r)
    if (fired[k] === r.at) continue
    fired[k] = r.at
    changed = true
    if (now - r.at < 2 * MINUTE) void announce(r) // came due just now
    else if (handed[k] === r.at) continue // Android showed it while the app was closed
    else if (now - r.at < MISSED_WINDOW) missed.push(r)
  }
  if (changed) saveMap(FIRED_KEY, fired)
  if (missed.length === 1) void announce(missed[0])
  else if (missed.length > 1) st.toast(t('remMissed', { n: num(missed.length, st.settings.numerals) }), { label: t('show'), run: openTasks }, 20000)
  const next = all.find((r) => r.at > now)
  // Wake at the next reminder, and at least every half hour (clocks change, laptops sleep)
  const wait = Math.min(next ? next.at - now + 400 : 30 * MINUTE, 30 * MINUTE)
  timer = setTimeout(check, wait)
  if (isNative()) scheduleNative()
}

// ---------------------------------------------------------------- Android: scheduled with the system

const CHANNEL = 'reminders'
/** Android wants a number for each notification: a stable one from the reminder's own id. */
function nid(r: ReminderItem): number {
  let h = 0x811c9dc5
  const s = keyOf(r)
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return ((h >>> 0) % 2_000_000_000) + 100
}

let nativeTimer: ReturnType<typeof setTimeout> | null = null
function scheduleNative() {
  if (nativeTimer) clearTimeout(nativeTimer)
  nativeTimer = setTimeout(() => void syncNative().catch((err) => console.warn('[qirtas] reminders not scheduled', err)), 800)
}

async function syncNative() {
  // Only from the full list: a list still being read would cancel the reminders it doesn't have yet
  if (!usePageIndex.getState().ready) return
  const { LocalNotifications } = await import('@capacitor/local-notifications')
  if ((await LocalNotifications.checkPermissions()).display !== 'granted') return
  const st = useStore.getState()
  const now = Date.now()
  const wanted = listReminders(usePageIndex.getState().entries, st.pages)
    .filter((r) => !r.done && r.at > now + 3000)
    .slice(0, 60)
  const want = new Map(wanted.map((r) => [nid(r), r]))
  const pending = (await LocalNotifications.getPending()).notifications
  const stale = pending.filter((p) => {
    const w = want.get(p.id)
    return !w || (p.extra as { at?: number } | undefined)?.at !== w.at || p.title !== label(w)
  })
  if (stale.length) await LocalNotifications.cancel({ notifications: stale.map((p) => ({ id: p.id })) })
  const kept = new Set(pending.filter((p) => !stale.includes(p)).map((p) => p.id))
  const add = wanted.filter((r) => !kept.has(nid(r)))
  if (add.length) {
    await LocalNotifications.schedule({
      notifications: add.map((r) => ({
        id: nid(r),
        title: label(r),
        body: r.text ? r.pageTitle : t('reminder'),
        schedule: { at: new Date(r.at), allowWhileIdle: true },
        channelId: CHANNEL,
        extra: { pageId: r.pageId, key: r.key, at: r.at },
      })),
    })
  }
  // Remember what Android will show, so it isn't reported as missed when the app opens later
  const handed = loadMap(NATIVE_KEY)
  for (const r of wanted) handed[keyOf(r)] = r.at
  saveMap(NATIVE_KEY, handed)
}

async function initNative() {
  const { LocalNotifications } = await import('@capacitor/local-notifications')
  await LocalNotifications.createChannel({ id: CHANNEL, name: t('reminders'), importance: 4, visibility: 1 }).catch(() => {})
  await LocalNotifications.addListener('localNotificationActionPerformed', (a) => {
    const pageId = (a.notification.extra as { pageId?: string } | undefined)?.pageId
    if (pageId && useStore.getState().pages[pageId]) navigate(pageId)
  })
}

// ---------------------------------------------------------------- permission

export type NotifyState = 'granted' | 'denied' | 'ask' | 'none'

/** May the app show notifications here? */
export async function notificationState(): Promise<NotifyState> {
  try {
    if (isNative()) {
      const { LocalNotifications } = await import('@capacitor/local-notifications')
      const s = (await LocalNotifications.checkPermissions()).display
      return s === 'granted' ? 'granted' : s === 'denied' ? 'denied' : 'ask'
    }
    if (typeof Notification === 'undefined') return 'none'
    return Notification.permission === 'granted' ? 'granted' : Notification.permission === 'denied' ? 'denied' : 'ask'
  } catch {
    return 'none'
  }
}

/** Ask for permission (from the settings, or when the first reminder is set). */
export async function requestNotifications(): Promise<NotifyState> {
  try {
    if (isNative()) {
      const { LocalNotifications } = await import('@capacitor/local-notifications')
      let s = (await LocalNotifications.checkPermissions()).display
      if (s !== 'granted' && s !== 'denied') s = (await LocalNotifications.requestPermissions()).display
      if (s === 'granted') scheduleNative()
      return s === 'granted' ? 'granted' : s === 'denied' ? 'denied' : 'ask'
    }
    if (typeof Notification === 'undefined') return 'none'
    if (Notification.permission === 'default') await Notification.requestPermission()
    return notificationState()
  } catch {
    return 'none'
  }
}

/** A notification right away, to see that they arrive. */
export async function testNotification() {
  if (isNative()) {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    await LocalNotifications.schedule({
      notifications: [{ id: 42, title: t('appName'), body: t('notificationsTestText'), schedule: { at: new Date(Date.now() + 1500), allowWhileIdle: true }, channelId: CHANNEL }],
    })
  } else await showWebNotification(t('appName'), t('notificationsTestText'), 'qirtas-test')
}

let asked = false
/** Ask once for permission to show notifications (called when the user sets a reminder). */
export async function askReminderPermission() {
  if (asked) return
  asked = true
  const before = await notificationState()
  if (before === 'granted' || before === 'none') return
  const after = before === 'ask' ? await requestNotifications() : before
  if (after !== 'granted') useStore.getState().toast(t('remNoPermission'), undefined, 8000)
}

let started = false
export function startReminders(showTasks: () => void) {
  if (started) return
  started = true
  openTasks = showTasks
  if (isNative()) void initNative().catch(() => {})
  let debounce: ReturnType<typeof setTimeout> | null = null
  const soon = () => {
    if (debounce) clearTimeout(debounce)
    debounce = setTimeout(check, 600)
  }
  usePageIndex.subscribe(soon)
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && soon())
  soon()
}
