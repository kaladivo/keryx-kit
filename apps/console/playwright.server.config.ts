import { join } from 'node:path'
import { defineConfig, devices } from '@playwright/test'

const root = join(import.meta.dirname, '..', '..')
const serverPort = 3998
const consolePort = 5176
const data = join(root, 'tmp/e2e/data')

/** Paths and origins `e2e/demo.spec.ts` reads back. */
export const e2e = {
  root,
  data,
  states: join(root, 'tmp/e2e/repo-states'),
  operatorToken: 'e2e-operator-token',
  repoOrigin: `http://repo.localhost:${serverPort}`,
} as const

/**
 * The demo script (mvp-spec §7) against the real server: a fresh data directory, the
 * server on its own port, and the console dev server proxying `/api` to it with the
 * Trezor stub. The server binds WebAuthn to the console dev server's origin.
 */
export default defineConfig({
  testDir: 'e2e',
  testMatch: 'demo.spec.ts',
  timeout: 180_000,
  workers: 1,
  reporter: 'list',
  use: { baseURL: `http://localhost:${consolePort}`, ...devices['Desktop Chrome'] },
  webServer: [
    {
      command: [
        `rm -rf ${data} && mkdir -p ${data}`,
        `head -c 32 /dev/urandom > ${data}/kek`,
        `printf ${e2e.operatorToken} > ${data}/operator-token`,
        'exec bun apps/server/src/main.ts',
      ].join(' && '),
      cwd: root,
      env: {
        KERYX_DATA_DIR: data,
        KERYX_KEK_FILE: `${data}/kek`,
        KERYX_OPERATOR_TOKEN_FILE: `${data}/operator-token`,
        KERYX_SERVICE_HOST: `localhost:${serverPort}`,
        KERYX_SCHEME: 'http',
        KERYX_CONSOLE_ORIGIN: `http://localhost:${consolePort}`,
        PORT: String(serverPort),
      },
      url: `http://localhost:${serverPort}/healthz`,
      reuseExistingServer: false,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: `bunx vite --port ${consolePort}`,
      env: {
        KERYX_API: `http://console.localhost:${serverPort}`,
        KERYX_TREZOR_STUB: '1',
        PORT: String(consolePort),
      },
      url: `http://localhost:${consolePort}`,
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
})
