import { resolve } from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    rolldownOptions: {
      input: {
        landing: resolve(import.meta.dirname, 'index.html'),
        subscribers: resolve(import.meta.dirname, 'subscribers/index.html'),
      },
    },
  },
})
