import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// Relative base so the same build runs on any web host and inside the Android app.
export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      injectRegister: null,
      registerType: 'autoUpdate',
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
        shortcuts: [
          { name: 'صفحة جديدة', url: './#/new' },
          { name: 'بحث', url: './#/search' },
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
