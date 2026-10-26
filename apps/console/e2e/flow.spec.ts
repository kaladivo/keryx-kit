import { type Browser, type BrowserContext, expect, type Page, test } from '@playwright/test'
import { addPasskeyAuthenticator, ownerLogin, shoot } from './support.ts'

/**
 * The demo script (mvp-spec §7) against the mock API: the owner signs with the stub
 * Trezor, the author uses a CDP virtual authenticator with PRF. One browser context per
 * person for the whole run, so the author's passkey survives between steps.
 */
test.describe.configure({ mode: 'serial' })

let owner: Page
let author: Page
const contexts: Array<BrowserContext> = []

const open = async (browser: Browser) => {
  const context = await browser.newContext()
  contexts.push(context)
  return { context, page: await context.newPage() }
}

test.beforeAll(async ({ browser }) => {
  owner = (await open(browser)).page
  const authorSide = await open(browser)
  author = authorSide.page
  await addPasskeyAuthenticator(authorSide.context, author)
})

test.afterAll(async () => {
  for (const context of contexts) await context.close()
})

/** A colourful JPEG drawn in the page, so the editor's resize path runs on a real image. */
const photo = async (page: Page, hue: number, label: string): Promise<Buffer> => {
  const dataUrl = await page.evaluate(
    ([h, text]) => {
      const canvas = document.createElement('canvas')
      canvas.width = 1600
      canvas.height = 900
      const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
      const gradient = ctx.createLinearGradient(0, 0, 1600, 900)
      gradient.addColorStop(0, `hsl(${h} 80% 55%)`)
      gradient.addColorStop(1, `hsl(${Number(h) + 60} 70% 35%)`)
      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, 1600, 900)
      ctx.fillStyle = 'rgba(255,255,255,0.9)'
      ctx.font = 'bold 150px system-ui, sans-serif'
      ctx.fillText(String(text), 120, 520)
      return canvas.toDataURL('image/jpeg', 0.9)
    },
    [hue, label] as const,
  )
  return Buffer.from(dataUrl.split(',')[1] ?? '', 'base64')
}

let inviteUrl = ''
let janaFingerprint = ''

test('owner overview, domain check and invite (A3, A4, E3, B1)', async () => {
  await owner.goto('/')
  await shoot(owner, '01-home')
  await owner.goto('/login')
  await shoot(owner, '02-owner-login')
  await ownerLogin(owner)
  await expect(owner.getByText(/targets\.json\) expires in \d+ days/)).toBeVisible()
  await expect(owner.getByText('no longer matches your repo')).toBeVisible()
  await shoot(owner, '03-overview-mismatch')
  await owner.getByRole('button', { name: 'Check now' }).click()
  await expect(owner.getByText('Your domain serves the current root')).toBeVisible()
  await shoot(owner, '04-overview-live')

  await owner.goto('/owner/team')
  await owner.getByLabel('Who is it for?').fill('Jana, marketing')
  await owner.getByRole('button', { name: 'Create invite link' }).click()
  const link = owner.locator('.notice .mono')
  await expect(link).toContainText('/invite#')
  inviteUrl = (await link.textContent()) ?? ''
  await shoot(owner, '05-team-invite')
})

test('author registers with a PRF passkey and sees their fingerprint (B2)', async () => {
  await author.goto(inviteUrl)
  await expect(author.getByRole('heading', { name: 'Join Demo Shop as an author' })).toBeVisible()
  await shoot(author, '06-invite')
  await author.getByLabel('Your name').fill('Jana Dvořáková')
  await author.getByRole('button', { name: 'Continue' }).click()
  await author.getByRole('button', { name: 'Create passkey' }).click()
  await expect(author.getByText('You are registered')).toBeVisible()
  janaFingerprint = (await author.locator('.fingerprint-large').textContent()) ?? ''
  expect(janaFingerprint).toMatch(/^[0-9a-f]{4}( [0-9a-f]{4}){4}$/)
  await shoot(author, '07-registered')
  await author.getByRole('link', { name: 'Open the console' }).click()
  await expect(author.getByText('The owner has not added you to a channel yet')).toBeVisible()
  await author.getByRole('button', { name: 'Sign out' }).click()
})

test('owner creates a channel for the new author, compares the fingerprint (B3)', async () => {
  await owner.goto('/owner/channels')
  await shoot(owner, '08-channels')
  await owner.getByRole('button', { name: 'New channel' }).click()
  await owner.getByLabel('Display name').fill('Product launches')
  await expect(owner.getByLabel('Slug')).toHaveValue('product-launches')
  await owner.getByLabel('Description').fill('New products, a day before they reach the shelves.')
  await owner.getByLabel(/Jana Dvořáková/).check()
  await shoot(owner, '09-new-channel')
  await owner.getByRole('button', { name: 'Review and sign' }).click()
  await expect(owner.getByText('Create channel Product launches (product-launches)')).toBeVisible()
  await expect(owner.locator('.key-lines')).toContainText(janaFingerprint)
  await expect(owner.getByText('Match', { exact: true })).toBeVisible()
  await shoot(owner, '10-ceremony-create-channel')
  await owner.getByRole('button', { name: 'Sign with Trezor' }).click()
  await expect(owner.getByText('Signed, waiting for an author')).toBeVisible()
  await shoot(owner, '11-ceremony-staged')
})

test('author login signs the pending task with the same passkey prompt (B3)', async () => {
  await author.goto('/author/login')
  await shoot(author, '12-author-login')
  await author.getByRole('button', { name: 'Sign in with passkey' }).click()
  await expect(author.getByText('Signed 1 pending task')).toBeVisible()
  await expect(
    author.locator('.card', { hasText: 'Product launches' }).getByText('Live'),
  ).toBeVisible()
  await shoot(author, '13-author-home')
})

test('author writes and publishes a post with images (C1, C2, C3)', async () => {
  await author.getByRole('link', { name: 'Write a post' }).first().click()
  await author.getByLabel('Title').fill('Meet the Trailrunner 2')
  await expect(author.getByLabel('Post id')).toHaveValue('meet-the-trailrunner-2')
  await author
    .getByLabel('Body')
    .fill(
      'Our lightest rain jacket yet, **180 g** and fully taped seams.\n\n- Available in three colours\n- Free repairs for two years\n\nIn store from Friday. <script>alert(1)</script>',
    )
  await author
    .locator('input[type=file]')
    .nth(0)
    .setInputFiles({
      name: 'detail.jpg',
      mimeType: 'image/jpeg',
      buffer: await photo(author, 200, 'DETAIL'),
    })
  await expect(author.getByLabel('Body')).toHaveValue(/!\[detail\]\(image:1\)/)
  await author.getByLabel('Preview image').setInputFiles({
    name: 'hero.jpg',
    mimeType: 'image/jpeg',
    buffer: await photo(author, 20, 'LAUNCH'),
  })
  await author.getByLabel('Tags').fill('launch, rain gear')
  const preview = author.locator('.editor-preview')
  await expect(preview.locator('.article-body img')).toHaveCount(1)
  await expect(preview.locator('.article-body')).not.toContainText('alert')
  await expect(preview.locator('.article-body strong')).toHaveText('180 g')
  await author.getByRole('button', { name: 'Save draft' }).click()
  await expect(author.getByText(/Draft saved/)).toBeVisible()
  await shoot(author, '14-editor')
  await author.getByRole('button', { name: 'Sign and publish' }).click()
  await expect(author.getByText('Signed and live')).toBeVisible()
  await expect(author.getByText('Meet the Trailrunner 2')).toBeVisible()
  await expect(author.getByText(/signed by Jana Dvořáková/)).toBeVisible()
  await shoot(author, '15-author-posts')
})

test('author edits the post in place (C4)', async () => {
  await author.getByRole('link', { name: 'Edit' }).first().click()
  await expect(author.getByLabel('Post id')).toBeDisabled()
  await author.getByLabel('Title').fill('Meet the Trailrunner 2, now in green')
  await author.getByRole('button', { name: 'Sign and update' }).click()
  await expect(author.getByText('Meet the Trailrunner 2, now in green')).toBeVisible()
  await expect(author.getByText(/edited/).first()).toBeVisible()
})

test('join link, QR and newsletter snippet (D1)', async () => {
  await author.goto('/author/join')
  await author.getByLabel(/Product launches/).check()
  const url = await author.getByTestId('join-url').textContent()
  expect(url).toMatch(/^https:\/\/shop\.example\.com\/join\?p=/)
  await expect(author.locator('.qr img')).toBeVisible()
  await expect(author.locator('.snippet-preview a').first()).toHaveAttribute('href', url ?? '')
  await shoot(author, '16-join-link')
})

test('owner assigns the author to Offers, then removes the original author (B4, B5)', async () => {
  await owner.goto('/owner/channels/offers')
  await shoot(owner, '17-channel-detail')
  await owner.getByLabel('Add an author').selectOption({ label: 'Jana Dvořáková (author-2)' })
  await owner.getByRole('button', { name: 'Add with Trezor' }).click()
  await expect(owner.getByText('Add Jana Dvořáková as author of Offers')).toBeVisible()
  await owner.getByRole('button', { name: 'Sign with Trezor' }).click()
  await expect(owner.getByText('The change is live')).toBeVisible()

  await owner.goto('/owner/channels/offers')
  await owner
    .locator('li', { hasText: 'Petr Novák' })
    .getByRole('button', { name: 'Remove' })
    .click()
  await expect(owner.getByText('Remove Petr Novák from Offers')).toBeVisible()
  await expect(owner.getByText(/2 published posts are signed only by this author/)).toBeVisible()
  await shoot(owner, '18-ceremony-remove-author')

  // Jana's console re-signs Petr's posts (and the author list) with one prompt.
  await author.goto('/author')
  await expect(author.getByText(/Re-sign 2 posts in offers/)).toBeVisible()
  await shoot(author, '19-author-tasks')
  await author.getByRole('button', { name: 'Sign now' }).click()
  await expect(author.getByText(/Signed \d pending tasks?/)).toBeVisible()

  await owner.reload()
  await expect(
    owner.getByText('Every published post is also signed by a remaining author'),
  ).toBeVisible()
  await owner.getByRole('button', { name: 'Sign with Trezor' }).click()
  await expect(owner.getByText('The change is live')).toBeVisible()
  await owner.goto('/owner/channels/offers')
  await expect(owner.locator('li', { hasText: 'Petr Novák' })).toHaveCount(0)
  await expect(owner.getByText('Autumn sale: 20% off all rain gear')).toBeVisible()
})

test('a Trezor on another Suite wallet is refused before signing (§5.3)', async () => {
  await owner.goto('/owner/settings')
  await owner.getByRole('button', { name: 'Renew with Trezor' }).last().click()
  await expect(owner.getByText(/Renew targets\.json until/)).toBeVisible()
  await owner.evaluate(() => localStorage.setItem('keryx-stub-wallet', 'hidden'))
  await owner.getByRole('button', { name: 'Sign with Trezor' }).click()
  await expect(
    owner.getByText(/Switch Trezor Suite to the wallet you used at sign-up/),
  ).toBeVisible()
  await shoot(owner, '20-ceremony-wrong-wallet')
  await owner.evaluate(() => localStorage.removeItem('keryx-stub-wallet'))
  await owner.getByRole('button', { name: 'Sign with Trezor' }).click()
  await expect(owner.getByText('The change is live')).toBeVisible()
  await expect(owner.getByText(/targets\.json\) expires in/)).toHaveCount(0)
})

test('owner activity and company screens (E4, A5)', async () => {
  await owner.goto('/owner/activity')
  await expect(owner.getByText(/Published “Meet the Trailrunner 2”/)).toBeVisible()
  await shoot(owner, '21-activity')
  await owner.goto('/owner/settings')
  await shoot(owner, '22-company')
  await owner.goto('/owner/join?channel=offers')
  await shoot(owner, '23-owner-join-link')
})

test('sign-up wizard with the stub Trezor (A1, A2)', async () => {
  const page = owner
  await page.goto('/signup')
  await page.getByLabel('Invite code').fill('PILOT-2026')
  await page.getByLabel('Company name').fill('Kavárna U Mostu')
  await expect(page.getByLabel('Company slug')).toHaveValue('kavarna-u-mostu')
  await page.getByLabel('Join origin').fill('umostu.example')
  await page.getByLabel('Contact email').fill('tomas@umostu.example')
  await shoot(page, '24-signup-details')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByText('Connect your Trezor')).toBeVisible()
  await shoot(page, '25-signup-login')
  await page.getByRole('button', { name: 'Sign in with Trezor' }).click()
  await expect(page.getByText('Create your master key')).toBeVisible()
  await shoot(page, '26-signup-master')
  await page.getByRole('button', { name: 'Create master key and sign' }).click()
  await expect(page.getByText('Your company is set up')).toBeVisible()
  await shoot(page, '27-signup-done')
  await page.getByRole('link', { name: 'Go to your console' }).click()
  await expect(page.getByRole('heading', { name: 'Kavárna U Mostu' })).toBeVisible()
})

test('operator dashboard, invite codes and pilot requests (F1, F2, G2)', async () => {
  await owner.goto('/operator/login')
  await shoot(owner, '28-operator-login')
  await owner.getByLabel('Operator token').fill('operator-demo-token')
  await owner.getByRole('button', { name: 'Sign in' }).click()
  await expect(owner.getByRole('heading', { name: 'Companies' })).toBeVisible()
  await expect(owner.getByText('Kavárna U Mostu').first()).toBeVisible()
  await shoot(owner, '29-operator-companies')
  await owner.getByRole('link', { name: 'Invite codes' }).click()
  await owner.getByPlaceholder(/Who is it for/).fill('Northwind Bank pilot')
  await owner.getByRole('button', { name: 'Create code' }).click()
  await expect(owner.getByText('Northwind Bank pilot')).toBeVisible()
  await shoot(owner, '30-operator-codes')
  await owner.getByRole('link', { name: 'Pilot requests' }).click()
  await expect(owner.getByText('Northwind Bank')).toBeVisible()
  await shoot(owner, '31-operator-pilots')
})
