import '@fontsource-variable/readex-pro'
import '@fontsource-variable/markazi-text'
import '@fontsource-variable/jetbrains-mono'
import './styles/tokens.css'
import './styles/app.css'
import './styles/editor.css'
import './styles/database.css'
import './styles/print.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { boot } from './data/boot'
import { useStore } from './data/store'
import { offerUpdate } from './data/update'
import { initNative } from './lib/native'
import { isNative } from './lib/platform'
import { AppBoundary } from './ui/ErrorBoundary'

// Offline support and "install app" for the web version (the Android app ships its own files)
if (import.meta.env.PROD && !import.meta.env.VITE_PREVIEW && !isNative() && 'serviceWorker' in navigator) {
  void import('virtual:pwa-register').then(({ registerSW }) => {
    const update = registerSW({
      immediate: true,
      // A new version waits until it can take over without a reload in the middle of typing
      onNeedRefresh: () => offerUpdate(() => update(true)),
      // An app left open for days still hears about new versions
      onRegisteredSW: (_url, registration) => {
        if (registration) setInterval(() => void registration.update().catch(() => {}), 60 * 60 * 1000)
      },
    })
  })
}

const root = createRoot(document.getElementById('root')!)
performance.mark('qirtas:start')
boot()
  .catch((err) => {
    console.error('boot failed', err)
    useStore.setState({ bootError: String((err as Error)?.message ?? err) })
  })
  .finally(() => {
    performance.mark('qirtas:booted')
    root.render(
      <StrictMode>
        <AppBoundary>
          <App />
        </AppBoundary>
      </StrictMode>,
    )
    requestAnimationFrame(() => performance.mark('qirtas:painted'))
    // Phone integration (back button, shortcuts, shared content) doesn't hold up the first paint
    void initNative()
  })
