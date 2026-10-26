import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { mockApi } from './mock/plugin.ts'

/**
 * `KERYX_MOCK=demo|empty` serves an in-memory API from the dev server and swaps the
 * Trezor for a deterministic stub. It only exists under `vite` (serve): `vite build`
 * never sees the plugin, and `__TREZOR_STUB__` is `false`, so the stub is dropped.
 */
export default defineConfig(({ command }) => {
  const mock = command === 'serve' ? process.env.KERYX_MOCK : undefined
  return {
    plugins: [react(), ...(mock ? [mockApi(mock)] : [])],
    define: { __TREZOR_STUB__: JSON.stringify(Boolean(mock)) },
    server: { port: Number(process.env.PORT ?? 5174), strictPort: true },
    build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 800 },
    test: {
      environment: 'jsdom',
      include: ['test/**/*.test.ts'],
    },
  }
})
