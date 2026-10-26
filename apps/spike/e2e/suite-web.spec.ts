import { expect, type Locator, type Page, test } from '@playwright/test'
import { bridgePort, pairingCode, screenContent, startEmulator, tenv } from './tenv.ts'

/**
 * Production path: @trezor/connect-web -> Suite Web popup (suite.trezor.io) -> Bridge.
 * Suite Web talks to the Bridge on 127.0.0.1:21328, which a running Suite desktop also uses,
 * so requests are rerouted to the trezor-user-env Bridge.
 */
test.use({
  launchOptions: { args: ['--disable-features=LocalNetworkAccessChecks,StorageAccessAPI'] },
})
test.describe.configure({ mode: 'serial' })
test.setTimeout(300_000)

test.beforeAll(async () => {
  await startEmulator()
})

const suiteNextButton = [
  '[data-testid="@analytics/continue-button"]',
  '[data-testid="@connect-permissions-modal/confirm-button"]',
]
  .map((selector) => `${selector}:visible`)
  .join(', ')

/** One step of what a user does: answer the device, or the Suite popup. */
const step = async (popup: Page | undefined, log: string[]) => {
  const { title, body } = await screenContent()
  const code = pairingCode(body)
  if (code && popup) {
    log.push(`device: ${title} | ${body} -> code typed into Suite`)
    await popup.locator('input:visible').first().pressSequentially(code)
    await popup.keyboard.press('Enter')
  } else if (title && !code) {
    log.push(`device: ${title} | ${body} -> confirmed`)
    await tenv('emulator-press-yes')
  } else if (popup) {
    const next = popup.locator(suiteNextButton).first()
    if (await next.count()) {
      log.push(`suite: ${await next.getAttribute('data-testid')}`)
      await next.click({ timeout: 5000 }).catch(() => undefined)
    }
  }
}

const runThroughSuite = async (page: Page, section: Locator) => {
  let popup: Page | undefined
  page.context().on('page', (opened) => {
    popup = opened
    opened.on('close', () => {
      if (popup === opened) popup = undefined
    })
  })
  await section.getByRole('button', { name: 'Run' }).click()
  const log: string[] = []
  const deadline = Date.now() + 240_000
  while ((await section.getAttribute('data-status')) === 'running' && Date.now() < deadline) {
    await page.waitForTimeout(2000)
    await step(popup, log)
  }
  console.log(`${log.join('\n')}\n${await section.locator('pre').textContent()}`)
  await expect(section).toHaveAttribute('data-status', 'pass')
  return log
}

const openSuiteWebPage = async (page: Page, query = '') => {
  const context = page.context()
  await context.grantPermissions(['storage-access', 'local-network-access'])
  await context.route(/127\.0\.0\.1:21328/, (route) =>
    route.continue({ url: route.request().url().replace(':21328', `:${bridgePort}`) }),
  )
  await page.goto(`/?trezor=suite-web${query}`)
}

let identityPublicKey: string | null = null

test('Suite Web: owner login', async ({ page }) => {
  await openSuiteWebPage(page)
  const section = page.locator('[data-test="owner-login"]')
  await runThroughSuite(page, section)
  identityPublicKey = await section.getAttribute('data-identity-public-key')
  expect(identityPublicKey).toMatch(/^0[23][0-9a-f]{64}$/)
})

test('Suite Web: login identity is bound to the calling origin', async ({ page }) => {
  await openSuiteWebPage(page, '&loginOrigin=https://keryx-kit.roguedave.codes')
  const section = page.locator('[data-test="owner-login"]')
  const log = await runThroughSuite(page, section)
  expect(
    log.some((line) => line.startsWith('device: Sign HTTP') && line.includes('localhost:5173')),
  ).toBe(true)
  expect(await section.getAttribute('data-identity-public-key')).toBe(identityPublicKey)
})

test('Suite Web: master key', async ({ page }) => {
  await openSuiteWebPage(page)
  const section = page.locator('[data-test="master-key"]')
  await runThroughSuite(page, section)
  await expect(section).toHaveAttribute('data-master-public-key', /^[0-9a-f]{64}$/)
})
