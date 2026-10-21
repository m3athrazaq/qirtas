// One self-contained HTML file of the web app, for previewing it as a claude.ai artifact.
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

export default defineConfig({
  base: './',
  plugins: [react(), viteSingleFile({ removeViteModuleLoader: true })],
  define: { 'import.meta.env.VITE_PREVIEW': JSON.stringify('1') },
  build: {
    outDir: 'dist-preview',
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    chunkSizeWarningLimit: 10_000,
  },
})
