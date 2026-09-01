import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: process.env.BACKEND_URL ?? 'http://127.0.0.1:8000',
        changeOrigin: true,
        rewrite: (requestPath) => requestPath.replace(/^\/api/, ''),
      },
      '/mcp': process.env.BACKEND_URL ?? 'http://127.0.0.1:8000',
      '/oauth': process.env.BACKEND_URL ?? 'http://127.0.0.1:8000',
      '/.well-known': process.env.BACKEND_URL ?? 'http://127.0.0.1:8000',
    },
  },
  preview: {
    proxy: {
      '/api': {
        target: process.env.BACKEND_URL ?? 'http://127.0.0.1:8000',
        changeOrigin: true,
        rewrite: (requestPath) => requestPath.replace(/^\/api/, ''),
      },
      '/mcp': process.env.BACKEND_URL ?? 'http://127.0.0.1:8000',
      '/oauth': process.env.BACKEND_URL ?? 'http://127.0.0.1:8000',
      '/.well-known': process.env.BACKEND_URL ?? 'http://127.0.0.1:8000',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
