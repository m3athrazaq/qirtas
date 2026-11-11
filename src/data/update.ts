// A new version of the web app is ready: switch to it without interrupting anyone, and never while
// something isn't saved yet. (The page reloads to switch.)
// The new version takes over every open window at once, so each window also decides for itself
// when to reload (reloadWhenSafe), instead of reloading the moment it is told.
import { t } from '../lib/i18n'
import { flushWrites, hasUnsaved } from './docs'
import { takeSnapshot } from './snapshots'
import { useBackup } from './autobackup'
import { useStore } from './store'

let lastTyped = 0
if (typeof window !== 'undefined') window.addEventListener('keydown', () => (lastTyped = Date.now()), true)

const QUIET = 30_000

/** Nothing would be lost or interrupted by a reload now. */
function safeNow(): boolean {
  const st = useStore.getState()
  if (hasUnsaved()) return false // the device refused writes: a reload would drop them
  if (st.modal === 'capture') return false // a quick note being written
  if (useBackup.getState().busy) return false // a backup file being written
  if (document.visibilityState === 'hidden') return true
  return Date.now() - lastTyped > QUIET && !st.modal && !st.peek
}

/** Run `act` at the first safe moment: now, when the app is put aside, or when it has been quiet.
 *  `offer` shows a button that runs `now` (or `act`) at once. */
function whenSafe(act: () => Promise<void> | void, offer?: { text: string; label: string }, now?: () => void) {
  let done = false
  const finish = () => {
    done = true
    document.removeEventListener('visibilitychange', onHide)
    clearInterval(timer)
  }
  const attempt = () => {
    if (done || !safeNow()) return
    finish()
    void act()
  }
  const onHide = () => document.visibilityState === 'hidden' && attempt()
  document.addEventListener('visibilitychange', onHide)
  const timer = setInterval(attempt, 60_000)
  if (safeNow()) return attempt()
  if (offer) {
    useStore.getState().toast(
      offer.text,
      {
        label: offer.label,
        run: () => {
          if (done) return
          if (hasUnsaved()) return useStore.getState().toast(t('saveFailing'), undefined, 10000)
          finish()
          if (now) now()
          else void act()
        },
      },
      15000,
    )
  }
}

// The new version takes over every window of the app at once, and a window that is still running
// the old one can't load the parts it hasn't loaded yet (they are removed). So before it takes
// over, every open window is asked whether it can reload now.
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('qirtas-update') : null
channel?.addEventListener('message', (e: MessageEvent<{ type?: string; id?: string }>) => {
  if (e.data?.type === 'ask' && !safeNow()) channel.postMessage({ type: 'busy', id: e.data.id })
})

function othersSafe(): Promise<boolean> {
  const ch = channel
  if (!ch) return Promise.resolve(true)
  const id = Math.random().toString(36).slice(2)
  return new Promise((resolve) => {
    let busy = false
    const on = (e: MessageEvent<{ type?: string; id?: string }>) => {
      if (e.data?.type === 'busy' && e.data.id === id) busy = true
    }
    ch.addEventListener('message', on)
    ch.postMessage({ type: 'ask', id })
    setTimeout(() => {
      ch.removeEventListener('message', on)
      resolve(!busy)
    }, 400)
  })
}

/** `apply` lets the new version take over (the reload follows through reloadWhenSafe). */
export function offerUpdate(apply: () => Promise<void>) {
  // asked: the user pressed "update now" (other windows are not waited for)
  const go = async (asked: boolean) => {
    await flushWrites()
    if (hasUnsaved()) {
      if (asked) useStore.getState().toast(t('saveFailing'), undefined, 10000)
      return offerUpdate(apply) // not now after all
    }
    // Another window is busy: try again in a minute
    if (!asked && !(await othersSafe())) return void setTimeout(() => offerUpdate(apply), 60_000)
    // A restore point of the data as the old version left it
    await takeSnapshot('before-update')
    await apply()
  }
  whenSafe(() => go(false), { text: t('updateReady'), label: t('updateNow') }, () => void go(true))
}

let reloading = false
/** The new version has taken over (from this window or another one): reload when it is safe here. */
export function reloadWhenSafe() {
  if (reloading) return
  reloading = true
  whenSafe(async () => {
    await flushWrites()
    if (hasUnsaved()) {
      reloading = false
      return reloadWhenSafe()
    }
    location.reload()
  })
}
