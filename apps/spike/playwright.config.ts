import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  timeout: 240_000,
  workers: 1,
  reporter: 'list',
  use: { baseURL: 'http://localhost:5173', ...devices['Desktop Chrome'] },
  webServer: { command: 'bun run dev', url: 'http://localhost:5173', reuseExistingServer: true },
})
