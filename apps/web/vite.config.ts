import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

const here = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@relay/shared': path.resolve(here, '../../packages/shared/src/index.ts') } },
  server: { port: 5173, proxy: { '/api': 'http://localhost:3001', '/hooks': 'http://localhost:3001' } },
  build: { chunkSizeWarningLimit: 900 },
})
