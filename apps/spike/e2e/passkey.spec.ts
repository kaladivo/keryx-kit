import { expect, test } from '@playwright/test'

test('passkey PRF: deterministic output wraps and unwraps an author key', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page)
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

  await page.goto('/')
  const section = page.locator('[data-test="passkey-prf"]')
  await section.getByRole('button', { name: 'Run' }).click()
  await expect(section).not.toHaveAttribute('data-status', 'running')
  console.log(await section.locator('pre').textContent())
  await expect(section).toHaveAttribute('data-status', 'pass')
  await expect(section).toHaveAttribute('data-author-public-key', /^[0-9a-f]{64}$/)
})
