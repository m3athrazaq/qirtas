// Android integration: system bars, the hardware back button, shortcuts and "share to Qirtas".
import { navigate } from '../data/nav'
import { useStore, ws } from '../data/store'
import { closeAi, useAi } from '../ai/aiBus'
import { closePagePicker, usePicker } from '../ui/pickerBus'
import { isNative, QirtasNative } from './platform'
import { t } from './i18n'

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
  // qirtas://new, qirtas://search, qirtas://page/<id>
  const u = url.replace(/^qirtas:\/\//, '')
  if (u.startsWith('new')) navigate(ws().createPage({ parentId: null }))
  else if (u.startsWith('search')) useStore.getState().openModal('search')
  else if (u.startsWith('task')) navigate(inboxPage())
  else if (u.startsWith('page/')) navigate(u.slice(5))
}

/** A page named "Inbox" that collects things shared from other apps. */
function inboxPage(): string {
  const st = useStore.getState()
  const title = t('inbox')
  const existing = Object.values(st.pages).find((p) => !p.deletedAt && !p.parentId && p.icon === '📥')
  return existing?.id ?? ws().createPage({ title, icon: '📥', parentId: null })
}

async function checkShared() {
  try {
    const shared = await QirtasNative.getSharedContent()
    if (!shared || (!shared.text && !shared.image)) return
    const { addToInbox } = await import('./inbox')
    const id = await addToInbox(inboxPage(), shared)
    navigate(id)
  } catch {
    /* plugin not present */
  }
}
