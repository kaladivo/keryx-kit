import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { mockApi } from './mock/plugin.ts'

/**
 * Dev server modes (`vite` serve only; `vite build` sees none of them, and
 * `__TREZOR_STUB__` is `false` there, so the stub is dropped from the bundle):
 * - `KERYX_MOCK=demo|empty`: an in-memory API on the dev server and the Trezor stub.
 * - otherwise `/api` goes to the real server at `KERYX_API` (default
 *   `http://console.localhost:3999`); `KERYX_TREZOR_STUB=1` swaps in the Trezor stub.
 */
export default defineConfig(({ command }) => {
  const serve = command === 'serve'
  const mock = serve ? process.env.KERYX_MOCK : undefined
  const trezorStub = serve && (Boolean(mock) || process.env.KERYX_TREZOR_STUB === '1')
  const api = process.env.KERYX_API ?? 'http://console.localhost:3999'
  return {
    plugins: [react(), ...(mock ? [mockApi(mock)] : [])],
    define: { __TREZOR_STUB__: JSON.stringify(trezorStub) },
    server: {
      port: Number(process.env.PORT ?? 5174),
      strictPort: true,
      proxy: mock ? {} : { '/api': { target: api, changeOrigin: true } },
    },
    build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 800 },
    test: {
      environment: 'jsdom',
      include: ['test/**/*.test.ts'],
    },
  }
})
