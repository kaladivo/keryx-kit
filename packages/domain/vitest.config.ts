import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const local = (path: string) => fileURLToPath(new URL(path, import.meta.url))

// The subscriber app's verifier (vendor/keryx/app) is imported from outside this
// package: point its bare imports at our dependencies and stub its native bridge.
export default defineConfig({
  resolve: {
    alias: {
      '@noble/ed25519': local('./node_modules/@noble/ed25519/index.js'),
      '@noble/hashes': local('./node_modules/@noble/hashes'),
      '@capacitor/core': local('./test/stubs/capacitor-core.ts'),
    },
  },
  test: { include: ['test/**/*.test.ts'] },
})
