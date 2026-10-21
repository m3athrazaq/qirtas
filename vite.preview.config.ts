// One self-contained HTML file of the web app, for previewing it as a claude.ai artifact.
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

export default defineConfig({
  base: './',
  plugins: [react(), viteSingleFile({ removeViteModuleLoader: true })],
  // The preview runs inside a sandbox that can't reach the server, so accounts are switched off there.
  define: {
    'import.meta.env.VITE_PREVIEW': JSON.stringify('1'),
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(''),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(''),
  },
  build: {
    outDir: 'dist-preview',
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    chunkSizeWarningLimit: 10_000,
  },
})
