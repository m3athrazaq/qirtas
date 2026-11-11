// A new version of the web app is ready: switch to it without interrupting anyone mid-sentence.
// (The page reloads to switch. Changes are on the device by then, but a reload while typing is rude.)
import { t } from '../lib/i18n'
import { flushWrites } from './docs'
import { useStore } from './store'

let lastTyped = 0
if (typeof window !== 'undefined') window.addEventListener('keydown', () => (lastTyped = Date.now()), true)

const QUIET = 30_000

/** `apply` activates the new version and reloads the page. */
export function offerUpdate(apply: () => Promise<void>) {
  let done = false
  const run = async () => {
    if (done) return
    done = true
    document.removeEventListener('visibilitychange', onHide)
    await flushWrites()
    await apply()
  }
  const onHide = () => {
    if (document.visibilityState === 'hidden') void run()
  }
  const st = useStore.getState()
  const idle = document.visibilityState === 'hidden' || (Date.now() - lastTyped > QUIET && !st.modal && !st.peek)
  if (idle) return void run()
  // Busy: offer it, and take the next moment the app is put aside
  st.toast(t('updateReady'), { label: t('updateNow'), run: () => void run() }, 15000)
  document.addEventListener('visibilitychange', onHide)
}
