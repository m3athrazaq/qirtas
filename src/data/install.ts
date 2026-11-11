// "Install Qirtas as an app" on a computer (Chrome, Edge): the browser tells us when it is possible
// and lets us show its install question later, from a button.
import { create } from 'zustand'

interface InstallEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: InstallEvent | null = null
export const useInstall = create<{ available: boolean }>(() => ({ available: false }))

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault() // no banner of the browser's own: the button is in the settings
    deferred = e as InstallEvent
    useInstall.setState({ available: true })
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    useInstall.setState({ available: false })
  })
}

export const canInstall = () => !!deferred

export async function promptInstall(): Promise<boolean> {
  const e = deferred
  if (!e) return false
  await e.prompt()
  const { outcome } = await e.userChoice
  deferred = null
  useInstall.setState({ available: false })
  return outcome === 'accepted'
}
