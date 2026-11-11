// Reminders: which ones are coming, and telling the user when one is due.
// On the phone the system shows the notification at its time even with the app closed: the app
// hands its reminders to Android (Reminders.java), sets their alarms again every time it opens, and
// learns from Android which ones were shown, so a reminder the phone held back is not lost silently.
// In a browser a notification can only appear while Qirtas is open; reminders that came due
// meanwhile are reported at the next start.
import { num } from '../lib/hijri'
import { t } from '../lib/i18n'
import { isNative, QirtasNative, type ReminderHealth, type ReminderLog } from '../lib/platform'
import { askConfirm } from '../ui/dialogs'
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
let openFix: () => void = () => {}

/** A reminder shown this much after its time was held back by the phone. */
const LATE = 3 * MINUTE
/** A reminder Android hasn't shown this long after its time is taken as held back. */
const HELD_AFTER = 10 * MINUTE

function check() {
  if (timer) clearTimeout(timer)
  timer = null
  if (!useStore.getState().ready) {
    timer = setTimeout(check, 2000)
    return
  }
  // On the phone, first ask Android which reminders it showed
  if (isNative())
    void QirtasNative.reminderLog().then(
      (l) => review(l.shown),
      () => review(null),
    )
  else review(null)
}

export interface DueReminders {
  /** Came due just now: announce. */
  now: ReminderItem[]
  /** Came due a while ago and nobody was told. */
  missed: ReminderItem[]
  /** The phone held one back or showed it late. */
  held: boolean
  /** One came due while notifications were off. */
  off: boolean
  /** Reminders dealt with (key -> its time), to keep. */
  fired: Record<string, number>
  /** Some handed to Android may still be on their way. */
  waiting: boolean
}

/** Which due reminders to announce, which were missed, and whether the phone held any back.
 *  `handed`: reminders given to Android; `shown`: Android's note of those it showed (null on the web). */
export function sortDue(all: ReminderItem[], fired: Record<string, number>, handed: Record<string, number>, shown: ReminderLog | null, now: number): DueReminders {
  const out: DueReminders = { now: [], missed: [], held: false, off: false, fired: { ...fired }, waiting: false }
  for (const r of all) {
    if (r.done || r.at > now) continue
    const k = keyOf(r)
    if (out.fired[k] === r.at) continue
    if (now - r.at < 2 * MINUTE) {
      out.fired[k] = r.at
      out.now.push(r)
      continue
    }
    if (handed[k] === r.at && shown) {
      // Handed to Android: did it show it, and on time?
      const e = shown[`${nid(r)}@${r.at}`]
      if (!e && now - r.at < HELD_AFTER) {
        out.waiting = true // not yet: look again later
        continue
      }
      out.fired[k] = r.at
      if (!e || e.r === 'off') {
        if (e) out.off = true
        else out.held = true
        if (now - r.at < MISSED_WINDOW) out.missed.push(r)
      } else if (!e.r && e.t - r.at > LATE) out.held = true
      continue
    }
    out.fired[k] = r.at
    if (handed[k] === r.at) continue // Android showed it while the app was closed
    if (now - r.at < MISSED_WINDOW) out.missed.push(r)
  }
  return out
}

function review(shown: ReminderLog | null) {
  if (timer) clearTimeout(timer)
  const st = useStore.getState()
  const now = Date.now()
  const all = listReminders(usePageIndex.getState().entries, st.pages).filter((r) => !r.done)
  const fired = loadMap(FIRED_KEY)
  const due = sortDue(all, fired, isNative() ? loadMap(NATIVE_KEY) : {}, shown, now)
  if (Object.keys(due.fired).length !== Object.keys(fired).length || Object.entries(due.fired).some(([k, v]) => fired[k] !== v)) saveMap(FIRED_KEY, due.fired)
  due.now.forEach((r) => void announce(r))
  if (due.missed.length === 1) void announce(due.missed[0])
  else if (due.missed.length > 1) st.toast(t('remMissed', { n: num(due.missed.length, st.settings.numerals) }), { label: t('show'), run: openTasks }, 20000)
  if (due.held || due.off) tellHeld(due.off)
  const next = all.find((r) => r.at > now)
  // Wake at the next reminder, and at least every half hour (clocks change, laptops sleep); sooner
  // while one handed to Android may still be on its way
  const wait = Math.min(next ? next.at - now + 400 : 30 * MINUTE, due.waiting ? 2 * MINUTE : 30 * MINUTE)
  timer = setTimeout(check, wait)
  if (isNative()) scheduleNative()
}

const HELD_TIP_KEY = 'qirtas.reminders.heldTip'
/** The phone held a reminder back (or notifications were off): say so, and how to fix it (twice a day at most). */
function tellHeld(off: boolean) {
  try {
    const last = Number(localStorage.getItem(HELD_TIP_KEY) || 0)
    if (Date.now() - last < 12 * 60 * MINUTE) return
    localStorage.setItem(HELD_TIP_KEY, String(Date.now()))
  } catch {
    /* ignore */
  }
  useStore.getState().toast(t(off ? 'remOff' : 'remHeld'), { label: t('remFix'), run: openFix }, 20000)
}

// ---------------------------------------------------------------- Android: scheduled with the system

const CHANNEL = 'reminders'
/** Android wants a number for each notification: a stable one from the reminder's own id. */
export function nid(r: ReminderItem): number {
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

/** What was last handed to Android; cleared when the app comes back, so every alarm is set again
 *  (a phone that cleared them, or an app that was stopped, gets them back). */
let handedList = ''

async function syncNative() {
  // Only from the full list: a list still being read would take off the reminders it doesn't have yet
  if (!usePageIndex.getState().ready) return
  await leavePlugin()
  const st = useStore.getState()
  const now = Date.now()
  // Coming ones, and those that came due a moment ago (Android shows them now if it hasn't yet)
  const wanted = listReminders(usePageIndex.getState().entries, st.pages)
    .filter((r) => !r.done && r.at > now - HELD_AFTER)
    .slice(0, 60)
  const wsId = st.ws?.id ?? ''
  const items = wanted.map((r) => ({ id: nid(r), at: r.at, title: label(r), body: r.text ? r.pageTitle : t('reminder'), page: r.pageId }))
  const list = wsId + JSON.stringify(items)
  if (list === handedList) return
  await QirtasNative.setReminders({ ws: wsId, items })
  handedList = list
  // Remember what Android will show, so it isn't reported as missed when the app opens later
  const handed = loadMap(NATIVE_KEY)
  for (const r of wanted) handed[keyOf(r)] = r.at
  saveMap(NATIVE_KEY, handed)
}

const LEFT_PLUGIN_KEY = 'qirtas.reminders.v2'
let leftPlugin = false
/** Reminders used to be scheduled through the notifications plugin: take those off once, the app's
 *  own alarms replace them. */
async function leavePlugin() {
  if (leftPlugin) return
  leftPlugin = true
  try {
    if (localStorage.getItem(LEFT_PLUGIN_KEY)) return
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    const old = (await LocalNotifications.getPending()).notifications.filter((p) => !!(p.extra as { pageId?: string } | undefined)?.pageId)
    if (old.length) await LocalNotifications.cancel({ notifications: old.map((p) => ({ id: p.id })) })
    localStorage.setItem(LEFT_PLUGIN_KEY, '1')
  } catch {
    /* nothing to take off */
  }
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

/** Cancel scheduled reminders on Android: all of them (signing out, clearing the device), or those of
 *  workspaces not in `keepWs` (one the user left or was removed from). Never throws. */
export async function cancelReminders(keepWs?: string[]) {
  if (!isNative()) return
  try {
    await QirtasNative.clearReminders({ keep: keepWs ?? null })
    handedList = ''
  } catch {
    /* an older app */
  }
  try {
    // Any still scheduled the older way
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    const pending = (await LocalNotifications.getPending()).notifications.filter((p) => {
      const x = p.extra as { pageId?: string; wsId?: string } | undefined
      if (!x?.pageId) return false
      return !keepWs || (!!x.wsId && !keepWs.includes(x.wsId))
    })
    if (pending.length) await LocalNotifications.cancel({ notifications: pending.map((p) => ({ id: p.id })) })
  } catch {
    /* nothing scheduled, or no permission */
  }
  if (!keepWs) {
    try {
      localStorage.removeItem(NATIVE_KEY)
      localStorage.removeItem(FIRED_KEY)
    } catch {
      /* ignore */
    }
  }
}

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

/** A notification in a moment (or in `seconds`, to close the app meanwhile), the way reminders arrive. */
export async function testNotification(seconds = 2) {
  if (isNative()) {
    await QirtasNative.testReminder({ seconds, title: t('appName'), body: t(seconds > 10 ? 'notificationsTestLaterText' : 'notificationsTestText') })
    if (seconds > 10) useStore.getState().toast(t('notificationsTestLaterSet'), undefined, 8000)
  } else await showWebNotification(t('appName'), t('notificationsTestText'), 'qirtas-test')
}

/** Android: what may keep reminders from arriving on time with the app closed. */
export async function reminderHealth(): Promise<ReminderHealth | null> {
  if (!isNative()) return null
  try {
    return await QirtasNative.reminderHealth()
  } catch {
    return null
  }
}

/** Android's own question: may Qirtas run in the background without battery restrictions? */
export const allowBackground = () => QirtasNative.allowBackground().catch(() => {})
export const allowExactAlarms = () => QirtasNative.allowExactAlarms().catch(() => {})
export const openAppSettings = () => QirtasNative.openAppSettings().catch(() => {})

let asked = false
const BACKGROUND_ASKED_KEY = 'qirtas.reminders.bgAsked'
/** Ask once for permission to show notifications (called when the user sets a reminder); on the
 *  phone, also once for running in the background, which some phones need for reminders to arrive. */
export async function askReminderPermission() {
  if (asked) return
  asked = true
  const before = await notificationState()
  if (before === 'none') return
  const after = before === 'granted' ? before : before === 'ask' ? await requestNotifications() : before
  if (after !== 'granted') {
    useStore.getState().toast(t('remNoPermission'), undefined, 8000)
    return
  }
  const health = await reminderHealth()
  if (!health || (health.battery && !health.restricted)) return
  try {
    if (localStorage.getItem(BACKGROUND_ASKED_KEY)) return
    localStorage.setItem(BACKGROUND_ASKED_KEY, '1')
  } catch {
    return
  }
  if (await askConfirm(t('remBackgroundAsk'), { confirmLabel: t('remBackgroundAllow') })) {
    if (health.restricted) void openAppSettings()
    else void allowBackground()
  }
}

let started = false
export function startReminders(showTasks: () => void, showFix: () => void) {
  if (started) return
  started = true
  openTasks = showTasks
  openFix = showFix
  if (isNative()) void initNative().catch(() => {})
  let debounce: ReturnType<typeof setTimeout> | null = null
  const soon = () => {
    if (debounce) clearTimeout(debounce)
    debounce = setTimeout(check, 600)
  }
  usePageIndex.subscribe(soon)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return
    handedList = '' // back in the app: every alarm is set again
    soon()
  })
  soon()
}
