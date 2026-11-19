import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api/': {
        target: process.env.API_URL || 'http://mock-api:8001',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api\//, '/'),
      },
    },
  },
})
