import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { BrowserContext, Page } from '@playwright/test'
import { expect } from '@playwright/test'

/** Adds a CDP virtual authenticator with PRF, like a passkey manager that supports it. */
export const addPasskeyAuthenticator = async (context: BrowserContext, page: Page) => {
  const cdp = await context.newCDPSession(page)
  await cdp.send('WebAuthn.enable')
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      ctap2Version: 'ctap2_1',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      hasPrf: true,
      automaticPresenceSimulation: true,
    },
  })
  return cdp
}

/** Owner login through the dev Trezor stub. */
export const ownerLogin = async (page: Page) => {
  await page.goto('/login')
  await page.getByLabel('Company slug').fill('demo-shop')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: 'Sign in with Trezor' }).click()
  await expect(page).toHaveURL(/\/owner$/)
}

const shotsDir = process.env.SHOTS_DIR

const variants = [
  { name: 'desktop', width: 1366, height: 900 },
  { name: 'phone', width: 390, height: 844 },
] as const

/** Full-page screenshots at desktop and phone width, light and dark (only with SHOTS_DIR). */
export const shoot = async (page: Page, name: string) => {
  if (!shotsDir) return
  mkdirSync(shotsDir, { recursive: true })
  const original = page.viewportSize()
  for (const variant of variants) {
    await page.setViewportSize({ width: variant.width, height: variant.height })
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme })
      await page.waitForTimeout(150)
      await page.screenshot({
        path: join(shotsDir, `${name}-${variant.name}-${scheme}.png`),
        fullPage: true,
      })
    }
  }
  await page.emulateMedia({ colorScheme: 'light' })
  if (original) await page.setViewportSize(original)
}
