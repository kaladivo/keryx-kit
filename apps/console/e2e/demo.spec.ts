import { execFileSync } from 'node:child_process'
import { cpSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { type Browser, type BrowserContext, expect, type Page, test } from '@playwright/test'
import { e2e } from '../playwright.server.config.ts'
import { addPasskeyAuthenticator, photo } from './support.ts'

/**
 * The demo script (mvp-spec §7 steps 1 to 5 and 7, plus B4 and B5) against the real
 * server. The owner signs with the dev Trezor stub (real SLIP-0013 and Ed25519
 * signatures from fixed test keys), each author has their own CDP virtual authenticator
 * with PRF. After every repo change the company's anchor and base are copied, and the
 * last test runs the Go conformance verifier and the subscriber app's verifier on them.
 */
test.describe.configure({ mode: 'serial' })

const SLUG = 'demo-shop'

let owner: Page
let jana: Page
let petr: Page
const contexts: Array<BrowserContext> = []

const open = async (browser: Browser, withPasskeys = false) => {
  const context = await browser.newContext()
  contexts.push(context)
  const page = await context.newPage()
  if (withPasskeys) await addPasskeyAuthenticator(context, page)
  return page
}

test.beforeAll(async ({ browser }) => {
  rmSync(e2e.states, { recursive: true, force: true })
  owner = await open(browser)
  jana = await open(browser, true)
  petr = await open(browser, true)
})

test.afterAll(async () => {
  for (const context of contexts) await context.close()
})

const states: Array<{ dir: string; now: string }> = []

/** Copies the repo the server wrote, in the layout tools/conformance reads. */
const snapshot = (name: string) => {
  const dir = `${String(states.length + 1).padStart(2, '0')}-${name}`
  const repo = join(e2e.data, 'repos', SLUG)
  for (const part of ['anchor', 'base'])
    cpSync(join(repo, part), join(e2e.states, dir, part), { recursive: true })
  states.push({ dir, now: new Date().toISOString() })
  writeFileSync(
    join(e2e.states, 'scenario.json'),
    `${JSON.stringify({ steps: states }, null, 2)}\n`,
  )
}

const invite = async (label: string): Promise<string> => {
  await owner.goto('/owner/team')
  await owner.getByLabel('Who is it for?').fill(label)
  await owner.getByRole('button', { name: 'Create invite link' }).click()
  const link = owner.locator('.notice .mono')
  await expect(link).toContainText('/invite#')
  return (await link.textContent()) ?? ''
}

const register = async (page: Page, url: string, name: string): Promise<string> => {
  await page.goto(url)
  await expect(page.getByRole('heading', { name: 'Join Demo Shop as an author' })).toBeVisible()
  await page.getByLabel('Your name').fill(name)
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: 'Create passkey' }).click()
  await expect(page.getByText('You are registered')).toBeVisible()
  const fingerprint = (await page.locator('.fingerprint-large').textContent()) ?? ''
  expect(fingerprint).toMatch(/^[0-9a-f]{4}( [0-9a-f]{4}){4}$/)
  return fingerprint
}

let inviteCode = ''

const operatorLogin = async () => {
  await owner.goto('/operator/login')
  await owner.getByLabel('Operator token').fill(e2e.operatorToken)
  await owner.getByRole('button', { name: 'Sign in' }).click()
  await expect(owner.getByRole('heading', { name: 'Companies' })).toBeVisible()
}

test('operator creates an invite code (F1)', async () => {
  await operatorLogin()
  await owner.getByRole('link', { name: 'Invite codes' }).click()
  await owner.getByPlaceholder(/Who is it for/).fill('Demo Shop pilot')
  await owner.getByRole('button', { name: 'Create code' }).click()
  const row = owner.locator('li', { hasText: 'Demo Shop pilot' })
  await expect(row).toBeVisible()
  inviteCode = (await row.locator('strong.mono').textContent()) ?? ''
  expect(inviteCode).not.toBe('')
})

test('1. owner signs up Demo Shop with the Trezor (A1, A2)', async () => {
  await owner.goto('/signup')
  await owner.getByLabel('Invite code').fill(inviteCode)
  await owner.getByLabel('Company name').fill('Demo Shop')
  await expect(owner.getByLabel('Company slug')).toHaveValue(SLUG)
  await owner.getByLabel('Join origin').fill('demo-shop.example')
  await owner.getByLabel('Contact email').fill('owner@demo-shop.example')
  await owner.getByRole('button', { name: 'Continue' }).click()
  await owner.getByRole('button', { name: 'Sign in with Trezor' }).click()
  await expect(owner.getByText('Create your master key')).toBeVisible()
  await owner.getByRole('button', { name: 'Create master key and sign' }).click()
  await expect(owner.getByText('Your company is set up')).toBeVisible()
  await owner.getByRole('link', { name: 'Go to your console' }).click()
  await expect(owner.getByRole('heading', { name: 'Demo Shop' })).toBeVisible()
  snapshot('signup')
})

test('owner logs in again with the Trezor (§5.3)', async () => {
  await owner.context().clearCookies()
  await owner.goto('/login')
  await owner.getByLabel('Company slug').fill(SLUG)
  await owner.getByRole('button', { name: 'Continue' }).click()
  await owner.getByRole('button', { name: 'Sign in with Trezor' }).click()
  await expect(owner).toHaveURL(/\/owner$/)
  await expect(owner.getByRole('heading', { name: 'Demo Shop' })).toBeVisible()
})

let janaFingerprint = ''

test('3. an invited author registers with a passkey (B1, B2)', async () => {
  janaFingerprint = await register(jana, await invite('Jana, marketing'), 'Jana Dvořáková')
  await jana.getByRole('link', { name: 'Open the console' }).click()
  await expect(jana.getByText('The owner has not added you to a channel yet')).toBeVisible()
  await jana.getByRole('button', { name: 'Sign out' }).click()
})

test('4. owner creates Offers with that author; it waits for the author (B3)', async () => {
  await owner.goto('/owner/channels')
  await owner.getByRole('button', { name: 'New channel' }).click()
  await owner.getByLabel('Display name').fill('Offers')
  await expect(owner.getByLabel('Slug')).toHaveValue('offers')
  await owner.getByLabel('Description').fill('Weekly deals for our regulars.')
  await owner.getByLabel(/Jana Dvořáková/).check()
  await owner.getByRole('button', { name: 'Review and sign' }).click()
  await expect(owner.getByText('Create channel Offers (offers)')).toBeVisible()
  await expect(owner.locator('.key-lines')).toContainText(janaFingerprint)
  await owner.getByRole('button', { name: 'Sign with Trezor' }).click()
  await expect(owner.getByText('Signed, waiting for an author')).toBeVisible()
})

test('4. the author’s console visit signs the task and the channel goes live (B3)', async () => {
  await jana.goto('/author/login')
  await jana.getByRole('button', { name: 'Sign in with passkey' }).click()
  await expect(jana.getByText('Signed 1 pending task')).toBeVisible()
  await expect(jana.locator('.card', { hasText: 'Offers' }).getByText('Live')).toBeVisible()
  snapshot('channel-live')
})

const TITLE = 'Autumn sale: 20% off all rain gear'

test('5. the author writes a post with an image and publishes it (C1, C2, C3)', async () => {
  await jana.getByRole('link', { name: 'Write a post' }).first().click()
  await jana.getByLabel('Title').fill(TITLE)
  await expect(jana.getByLabel('Post id')).toHaveValue('autumn-sale-20-off-all-rain-gear')
  await jana
    .getByLabel('Body')
    .fill('Every jacket and boot, **this week only**.\n\n- In store and online')
  await jana.getByLabel('Preview image').setInputFiles({
    name: 'sale.jpg',
    mimeType: 'image/jpeg',
    buffer: await photo(jana, 20, 'SALE'),
  })
  await jana.getByLabel('Tags').fill('sale')
  await expect(jana.locator('.editor-preview .article-body strong')).toHaveText('this week only')
  await jana.getByRole('button', { name: 'Save draft' }).click()
  await expect(jana.getByText(/Draft saved/)).toBeVisible()
  await jana.getByRole('button', { name: 'Sign and publish' }).click()
  await expect(jana.getByText('Signed and live')).toBeVisible()
  await expect(jana.getByText(TITLE)).toBeVisible()
  snapshot('published')
})

const EDITED = `${TITLE}, now 30%`

test('7. the author edits the post in place (C4)', async () => {
  await jana.getByRole('link', { name: 'Edit' }).first().click()
  await expect(jana.getByLabel('Post id')).toBeDisabled()
  await jana.getByLabel('Title').fill(EDITED)
  await jana.getByRole('button', { name: 'Sign and update' }).click()
  await expect(jana.getByText(EDITED)).toBeVisible()
  await expect(jana.getByText(/edited/).first()).toBeVisible()
  snapshot('edited')
})

test('owner assigns a second author (B2, B4)', async () => {
  await register(petr, await invite('Petr, sales'), 'Petr Novák')
  await owner.goto('/owner/channels/offers')
  await owner.getByLabel('Add an author').selectOption({ label: 'Petr Novák (author-2)' })
  await owner.getByRole('button', { name: 'Add with Trezor' }).click()
  await expect(owner.getByText('Add Petr Novák as author of Offers')).toBeVisible()
  await owner.getByRole('button', { name: 'Sign with Trezor' }).click()
  await expect(owner.getByText('The change is live')).toBeVisible()
  snapshot('assigned')
})

test('owner removes the first author after the second re-signs (B5)', async () => {
  await owner.goto('/owner/channels/offers')
  await owner
    .locator('li', { hasText: 'Jana Dvořáková' })
    .getByRole('button', { name: 'Remove' })
    .click()
  await expect(owner.getByText('Remove Jana Dvořáková from Offers')).toBeVisible()
  await expect(owner.getByText(/1 published post is signed only by this author/)).toBeVisible()

  await petr.goto('/author')
  await expect(petr.getByText(/Re-sign 1 post in offers/)).toBeVisible()
  await petr.getByRole('button', { name: 'Sign now' }).click()
  await expect(petr.getByText('Signed 2 pending tasks')).toBeVisible()
  snapshot('resigned')

  await owner.reload()
  await expect(
    owner.getByText('Every published post is also signed by a remaining author'),
  ).toBeVisible()
  await owner.getByRole('button', { name: 'Sign with Trezor' }).click()
  await expect(owner.getByText('The change is live')).toBeVisible()
  await owner.goto('/owner/channels/offers')
  await expect(owner.locator('li', { hasText: 'Jana Dvořáková' })).toHaveCount(0)
  await expect(owner.getByText(EDITED)).toBeVisible()
  await expect(owner.getByText('signed by Petr Novák')).toBeVisible()
  snapshot('removed')
})

// Beyond the demo script: the other console flows, against the same server.

const signAndApply = async () => {
  await owner.getByRole('button', { name: 'Sign with Trezor' }).click()
  await expect(owner.getByText('The change is live')).toBeVisible()
}

test('owner edits the channel and the logo (B6, A5)', async () => {
  await owner.goto('/owner/channels/offers')
  await owner.getByLabel('Description').fill('Weekly deals for our regulars, every Monday.')
  await owner.getByRole('button', { name: 'Save with Trezor' }).click()
  await signAndApply()
  await owner.goto('/owner/settings')
  await owner.getByLabel('New logo').setInputFiles({
    name: 'logo.jpg',
    mimeType: 'image/jpeg',
    buffer: await photo(owner, 140, 'DS'),
  })
  await owner.getByRole('button', { name: 'Review and sign' }).click()
  await signAndApply()
  snapshot('channel-and-logo')
})

test('a Trezor on another Suite wallet is refused, then targets.json is renewed (§5.3, E3)', async () => {
  await owner.goto('/owner/settings')
  await owner.getByRole('button', { name: 'Renew with Trezor' }).click()
  await expect(owner.getByText(/Renew targets\.json until/)).toBeVisible()
  await owner.evaluate(() => localStorage.setItem('keryx-stub-wallet', 'hidden'))
  await owner.getByRole('button', { name: 'Sign with Trezor' }).click()
  await expect(
    owner.getByText(/Switch Trezor Suite to the wallet you used at sign-up/),
  ).toBeVisible()
  await owner.evaluate(() => localStorage.removeItem('keryx-stub-wallet'))
  await signAndApply()
  snapshot('targets-renewed')
})

test('a second post is published by one author and unpublished by the owner (C2, C5)', async () => {
  await petr.goto('/author/write?channel=offers')
  await petr.getByLabel('Title').fill('Closed on Friday')
  await petr.getByLabel('Body').fill('We are closed on Friday for inventory.')
  await petr.getByRole('button', { name: 'Sign and publish' }).click()
  await expect(petr.getByText('Signed and live')).toBeVisible()
  snapshot('second-post')
  await owner.goto('/owner/channels/offers')
  const post = owner.locator('li', { hasText: 'Closed on Friday' })
  await post.getByRole('button', { name: 'Unpublish' }).click()
  await post.getByRole('button', { name: 'Unpublish' }).click()
  await expect(owner.locator('li', { hasText: 'Closed on Friday' })).toHaveCount(0)
  snapshot('unpublished')
})

test('join link, join kit and domain check (D1, A3, A4)', async () => {
  await owner.goto('/owner/join?channel=offers')
  const url = await owner.getByTestId('join-url').textContent()
  expect(url).toMatch(/^https:\/\/demo-shop\.example\/join\?p=/)
  await expect(owner.locator('.qr img')).toBeVisible()
  await owner.goto('/owner')
  const download = owner.waitForEvent('download')
  await owner.getByRole('button', { name: 'Download zip' }).click()
  expect((await download).suggestedFilename()).toMatch(/\.zip$/)
  const domain = owner.locator('#domain')
  await expect(domain).toContainText('Never')
  await owner.getByRole('button', { name: 'Check now' }).click()
  await expect(domain).not.toContainText('Never')
  await expect(domain).toContainText('Not set up')
})

test('activity log, operator dashboard and pilot requests (E4, F2, G2)', async () => {
  await owner.goto('/owner/activity')
  await expect(owner.getByText(`Edited "${EDITED}" on offers`)).toBeVisible()
  const pilot = await owner.request.post('/api/pilot-requests', {
    data: { company: 'Northwind Bank', name: 'Eva', email: 'eva@northwind.example', message: '' },
  })
  expect(pilot.status()).toBe(201)
  await operatorLogin()
  await expect(owner.getByText('Demo Shop').first()).toBeVisible()
  await owner.getByRole('link', { name: 'Pilot requests' }).click()
  await expect(owner.getByText('Northwind Bank')).toBeVisible()
})

test('everyone signs out, and a missing session answers 401 Unauthorized', async () => {
  await petr.goto('/author')
  await petr.getByRole('button', { name: 'Sign out' }).click()
  const me = await petr.request.get('/api/me')
  expect(me.status()).toBe(401)
  expect(await me.json()).toEqual({ _tag: 'Unauthorized' })
  await owner.goto('/owner')
  await owner.getByRole('button', { name: 'Sign out' }).click()
  expect((await owner.request.get('/api/auth/owner/session')).status()).toBe(401)
})

test('the server-written repo passes the Go SDK and the subscriber app', () => {
  const run = (cwd: string, command: string, ...args: ReadonlyArray<string>) =>
    console.log(
      execFileSync(command, args, {
        cwd: join(e2e.root, cwd),
        env: { ...process.env, KERYX_SCENARIO_DIR: e2e.states },
        encoding: 'utf8',
      }),
    )
  run('tools/conformance', 'go', 'run', '.', e2e.states)
  run(
    'packages/domain',
    'bunx',
    'vitest',
    'run',
    '--reporter=verbose',
    'test/subscriber-app-dir.test.ts',
  )
})
