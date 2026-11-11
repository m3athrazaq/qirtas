// A new version of the web app is ready: switch to it without interrupting anyone, and never while
// something isn't saved yet. (The page reloads to switch.)
// The new version takes over every open window at once, so each window also decides for itself
// when to reload (reloadWhenSafe), instead of reloading the moment it is told.
import { t } from '../lib/i18n'
import { flushWrites, hasUnsaved } from './docs'
import { takeSnapshot } from './snapshots'
import { useStore } from './store'

let lastTyped = 0
if (typeof window !== 'undefined') window.addEventListener('keydown', () => (lastTyped = Date.now()), true)

const QUIET = 30_000

/** Nothing would be lost or interrupted by a reload now. */
function safeNow(): boolean {
  const st = useStore.getState()
  if (hasUnsaved()) return false // the device refused writes: a reload would drop them
  if (st.modal === 'capture') return false // a quick note being written
  if (document.visibilityState === 'hidden') return true
  return Date.now() - lastTyped > QUIET && !st.modal && !st.peek
}

/** Run `act` at the first safe moment: now, when the app is put aside, or when it has been quiet. */
function whenSafe(act: () => Promise<void> | void, offer?: { text: string; label: string }) {
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
          void act()
        },
      },
      15000,
    )
  }
}

/** `apply` lets the new version take over (the reload follows through reloadWhenSafe). */
export function offerUpdate(apply: () => Promise<void>) {
  whenSafe(
    async () => {
      await flushWrites()
      if (hasUnsaved()) return offerUpdate(apply) // not now after all
      // A restore point of the data as the old version left it
      await takeSnapshot('before-update')
      await apply()
    },
    { text: t('updateReady'), label: t('updateNow') },
  )
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
