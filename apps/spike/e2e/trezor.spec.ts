import { expect, type Locator, type Page, test } from '@playwright/test'
import { bridgePort, pairingCode, screenContent, startEmulator, tenv } from './tenv.ts'

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  await startEmulator()
})

const openTest = async (page: Page, name: string): Promise<Locator> => {
  page.on('console', (message) => console.log(`[page] ${message.text()}`))
  await page.goto(`/?trezor=bridge&bridgePort=${bridgePort}`)
  return page.locator(`[data-test="${name}"]`)
}

/**
 * Confirms every screen the device shows until the page reports a result. A THP pairing code
 * screen is answered by typing the code into the page, as a user would.
 */
const confirmOnDevice = async (page: Page, section: Locator): Promise<string[]> => {
  const screens: string[] = []
  const deadline = Date.now() + 90_000
  while ((await section.getAttribute('data-status')) === 'running' && Date.now() < deadline) {
    const { title, body } = await screenContent()
    const code = pairingCode(body)
    if (code && (await page.locator('#pairing').isVisible())) {
      screens.push(`${title} | ${body}`)
      await page.locator('#pairing-code').fill(code)
      await page.getByRole('button', { name: 'Pair' }).click()
    } else if (title && !code) {
      screens.push(`${title} | ${body}`)
      await tenv('emulator-press-yes')
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return screens
}

const runOnDevice = async (page: Page, section: Locator) => {
  await section.getByRole('button', { name: 'Run' }).click()
  const screens = await confirmOnDevice(page, section)
  console.log(`device screens:\n  ${screens.join('\n  ')}`)
  console.log(await section.locator('pre').textContent())
  await expect(section).toHaveAttribute('data-status', 'pass')
  return screens
}

test('owner login: requestLogin signature verifies', async ({ page }) => {
  const section = await openTest(page, 'owner-login')
  await runOnDevice(page, section)
  await expect(section).toHaveAttribute('data-identity-public-key', /^0[23][0-9a-f]{64}$/)
})

test('master key: cipherKeyValue is deterministic and company-specific', async ({ page }) => {
  const section = await openTest(page, 'master-key')
  const screens = await runOnDevice(page, section)
  expect(screens.length).toBeGreaterThanOrEqual(3)
  const firstKey = await section.getAttribute('data-master-public-key')
  expect(firstKey).toMatch(/^[0-9a-f]{64}$/)

  await page.reload()
  await runOnDevice(page, section)
  expect(await section.getAttribute('data-master-public-key')).toBe(firstKey)
})
