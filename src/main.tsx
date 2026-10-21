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
import { initNative } from './lib/native'
import { isNative } from './lib/platform'

// Offline support and "install app" for the web version (the Android app ships its own files)
if (import.meta.env.PROD && !import.meta.env.VITE_PREVIEW && !isNative() && 'serviceWorker' in navigator) {
  void import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true }))
}

const root = createRoot(document.getElementById('root')!)
boot()
  .then(() => initNative())
  .catch((err) => console.error('boot failed', err))
  .finally(() => {
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
  })
