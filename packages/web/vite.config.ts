import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

const here = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': resolve(here, 'src') },
  },
  server: {
    // The API and the UI share one process in production; proxy in dev so the
    // frontend code never needs to know the difference.
    proxy: { '/api': 'http://127.0.0.1:3000' },
  },
  build: { outDir: 'dist', emptyOutDir: true },
})
