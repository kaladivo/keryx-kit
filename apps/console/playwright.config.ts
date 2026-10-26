import { defineConfig, devices } from '@playwright/test'

const port = 5175

/** Runs against the dev server with the in-memory mock API and the stub Trezor. */
export default defineConfig({
  testDir: 'e2e',
  testMatch: 'flow.spec.ts',
  timeout: 120_000,
  workers: 1,
  reporter: 'list',
  use: { baseURL: `http://localhost:${port}`, ...devices['Desktop Chrome'] },
  webServer: {
    command: `bunx vite --port ${port}`,
    env: { KERYX_MOCK: 'demo', PORT: String(port) },
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
