import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// The version shown in the settings: 1.1.<build number> for the Android app (built by GitHub),
// 1.1 for the web app (which is always the latest), each with the day it was built.
const run = process.env.GITHUB_RUN_NUMBER
const version = run ? `1.1.${run}` : '1.1'
// Changes with every build (the web app's version stays "1.1"): a restore point is taken before
// the first start of a new build.
const buildId = (process.env.CF_PAGES_COMMIT_SHA || process.env.GITHUB_SHA || '').slice(0, 8) || String(Date.now())

// Relative base so the same build runs on any web host and inside the Android app.
export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
    __BUILD_ID__: JSON.stringify(buildId),
  },
  plugins: [
    react(),
    VitePWA({
      injectRegister: null,
      // 'prompt': the new version takes over when the app says so (see data/update.ts), not mid-typing
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        id: './',
        name: 'قِرطاس',
        short_name: 'قِرطاس',
        description: 'ملاحظاتك ومهامك ومشاريعك بالعربية، مع تقويم هجري وبحث يفهم العربية.',
        lang: 'ar',
        dir: 'rtl',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#f4f5f2',
        theme_color: '#f4f5f2',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        // Right-click the app in the taskbar / long-press its icon
        shortcuts: [
          { name: 'اليوم', url: './#/today' },
          { name: 'ملاحظة سريعة', url: './#/capture' },
          { name: 'صفحة جديدة', url: './#/new' },
          { name: 'بحث', url: './#/search' },
          { name: 'مهامي', url: './#/tasks' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  build: {
    chunkSizeWarningLimit: 2000,
  },
})
