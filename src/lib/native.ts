// Android integration: system bars, the hardware back button, shortcuts and "share to Qirtas".
import { navigate } from '../data/nav'
import { runAction } from '../data/actions'
import { useStore } from '../data/store'
import { inboxPageId } from '../data/today'
import { closeAi, useAi } from '../ai/aiBus'
import { closePagePicker, usePicker } from '../ui/pickerBus'
import { minimizePage, minimizeTarget } from '../shell/pageOps'
import { isNative, QirtasNative } from './platform'

export async function initNative() {
  if (!isNative()) return
  const { App } = await import('@capacitor/app')
  const { SystemBars, SystemBarsStyle } = await import('@capacitor/core')

  const paintBars = async (theme: string) => {
    try {
      // DARK = light icons for a dark background
      await SystemBars.setStyle({ style: theme === 'dark' ? SystemBarsStyle.Dark : SystemBarsStyle.Light })
    } catch {
      /* not available */
    }
  }
  void paintBars(document.documentElement.dataset.theme ?? 'light')
  window.addEventListener('qirtas:appearance', (e) => void paintBars((e as CustomEvent).detail.theme))

  void App.addListener('backButton', () => {
    const st = useStore.getState()
    if (document.querySelector('.popover')) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      return
    }
    if (useAi.getState().editor) return closeAi()
    if (usePicker.getState().onPick) return closePagePicker()
    if (st.modal) return st.closeModal()
    if (st.peek) return useStore.setState({ peek: null })
    if (st.route.name === 'page') {
      const page = st.pages[st.route.id]
      // A row or inline database opened full size goes back to its preview / its page (like the top bar)
      if (page && minimizeTarget(page, st.pages)) return minimizePage(page)
      return navigate(page?.parentId && page.type !== 'row' ? page.parentId : null)
    }
    void App.exitApp()
  })

  void App.addListener('appUrlOpen', ({ url }) => handleUrl(url))
  const launch = await App.getLaunchUrl()
  if (launch?.url) handleUrl(launch.url)

  void App.addListener('resume', () => void checkShared())
  void checkShared()
}

function handleUrl(url: string) {
  // qirtas://new, qirtas://search, qirtas://today, qirtas://capture, qirtas://tasks, qirtas://task (the inbox), qirtas://page/<id>
  const u = url.replace(/^qirtas:\/\//, '').replace(/\/$/, '')
  if (u === 'new' || u === 'search' || u === 'today' || u === 'capture' || u === 'tasks') runAction(u)
  else if (u.startsWith('task')) navigate(inboxPageId())
  else if (u.startsWith('page/')) {
    // (a reminder's notification opens its page this way)
    const id = decodeURIComponent(u.slice(5).split('?')[0])
    if (id) navigate(id)
  }
}

async function checkShared() {
  try {
    const shared = await QirtasNative.getSharedContent()
    if (!shared || (!shared.text && !shared.image)) return
    const { addToInbox } = await import('./inbox')
    const id = await addToInbox(inboxPageId(), shared)
    navigate(id)
  } catch {
    /* plugin not present */
  }
}
