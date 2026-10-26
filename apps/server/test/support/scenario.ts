/**
 * mvp-spec §7 demo path plus B4, B5 and the renewals, against a running test server.
 * After every repo change the company's anchor and base directories are copied, so
 * `tools/conformance` can replay what the server wrote, step by step.
 */
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Effect } from 'effect'
import { refreshTimestamps, renewServerMetadata } from '../../src/jobs.ts'
import { Repos } from '../../src/repos.ts'
import {
  ceremony,
  doTasks,
  draftItem,
  memberLogin,
  ownerLogin,
  registerAuthor,
  signAsOwner,
  signedItem,
  signUp,
  trezor,
} from './actors.ts'
import { advance, call, DAY, failure, type TestServer } from './harness.ts'

export const SLUG = 'demo-shop'

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(`scenario: ${message}`)
}

export interface Snapshot {
  readonly dir: string
  readonly now: string
}

export const runDemo = async (server: TestServer, snapshotDir?: string) => {
  let step = 'start'
  try {
    return await demo(server, snapshotDir, (name) => {
      step = name
    })
  } catch (error) {
    throw new Error(`demo failed at "${step}": ${JSON.stringify(error) ?? String(error)}`, {
      cause: error,
    })
  }
}

const demo = async (
  server: TestServer,
  snapshotDir: string | undefined,
  at: (step: string) => void,
) => {
  const snapshots: Array<Snapshot> = []
  const snapshot = async (name: string) => {
    if (!snapshotDir) return
    const dirs = await server.runWithServices(Effect.map(Repos, (repos) => repos.directory(SLUG)))
    const dir = `${String(snapshots.length + 1).padStart(2, '0')}-${name}`
    cpSync(dirs.anchor, join(snapshotDir, dir, 'anchor'), { recursive: true })
    cpSync(dirs.base, join(snapshotDir, dir, 'base'), { recursive: true })
    snapshots.push({ dir, now: server.clock.current.toISOString() })
  }
  if (snapshotDir) {
    rmSync(snapshotDir, { recursive: true, force: true })
    mkdirSync(snapshotDir, { recursive: true })
  }

  // 1. Sign up "Demo Shop".
  at('1. Sign up "Demo Shop".')
  const device = trezor('dave')
  const { owner, operator } = await signUp(server, {
    slug: SLUG,
    companyName: 'Demo Shop',
    joinOrigin: 'https://demo-shop.example',
    device,
  })
  await snapshot('signup')

  // 3. Invite an author, who registers with a passkey.
  at('3. Invite an author, who registers with ')
  const jana = await registerAuthor(server, owner, 'Jana')
  const petr = await registerAuthor(server, owner, 'Petr')

  // 4. Create "Offers" with Jana. Staged until her console signs the authors metadata.
  at('4. Create "Offers" with Jana. Staged unt')
  const created = await ceremony(owner, device, SLUG, {
    _tag: 'CreateChannel',
    channel: 'offers',
    displayName: 'Offers',
    description: 'Weekly offers',
    authors: [jana.memberId],
  })
  assert(created.status === 'staged', `channel should be staged, is ${created.status}`)
  assert(created.missing[0]?.file === 'channels.offers.authors.json', 'authors signature missing')
  const waiting = await call(owner.client.channels.list())
  assert(waiting[0]?.status === 'waiting-for-author', 'channel waits for an author')
  const blocked = await failure(
    owner.client.ceremonies.start({ payload: { intent: { _tag: 'RenewTargets' } } }),
  )
  assert(blocked._tag === 'CeremonyInProgress', 'one open ceremony per company')
  const janaTasks = await doTasks(jana)
  assert(janaTasks[0]?._tag === 'SignAuthorsMetadata', 'Jana gets the new-channel task')
  const live = await call(owner.client.channels.list())
  assert(live[0]?.status === 'live', 'channel is live after the author signed')
  await snapshot('channel-live')

  // 5. Jana writes and publishes a post.
  at('5. Jana writes and publishes a post.')
  advance(server, 60_000)
  const post = await signedItem(
    jana,
    draftItem('summer-sale', 'Summer sale', server.clock.current, {
      image: 'data:image/png;base64,iVBORw0KGgo=',
      tags: ['sale'],
    }),
  )
  const draft = await call(
    jana.browser.client.items.createDraft({
      payload: {
        channel: 'offers',
        content: { itemId: 'summer-sale', title: 'Summer sale', markdown: 'Hi', tags: ['sale'] },
      },
    }),
  )
  await call(
    jana.browser.client.items.publish({
      params: { channel: 'offers' },
      payload: {
        item: post,
        draftId: draft.id,
        source: { itemId: 'summer-sale', title: 'Summer sale', markdown: 'Hi', tags: ['sale'] },
      },
    }),
  )
  assert((await call(jana.browser.client.items.drafts())).length === 0, 'draft removed on publish')
  await snapshot('published')

  // 7. Edit the post in place.
  at('7. Edit the post in place.')
  advance(server, 60_000)
  const edited = await signedItem(
    jana,
    draftItem('summer-sale', 'Summer sale, now 30% off', new Date(post.date_published), {
      date_modified: server.clock.current.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    }),
  )
  await call(
    jana.browser.client.items.edit({
      params: { channel: 'offers', itemId: 'summer-sale' },
      payload: { item: edited },
    }),
  )
  await snapshot('edited')

  // C5: a second post, unpublished by the owner.
  at('C5: a second post, unpublished by the ow')
  advance(server, 60_000)
  const flash = await signedItem(jana, draftItem('flash-sale', 'Flash sale', server.clock.current))
  await call(
    jana.browser.client.items.publish({ params: { channel: 'offers' }, payload: { item: flash } }),
  )
  await call(owner.client.items.unpublish({ params: { channel: 'offers', itemId: 'flash-sale' } }))
  await snapshot('unpublished')

  // B4: assign Petr. Live at once.
  at('B4: assign Petr. Live at once.')
  const assigned = await ceremony(owner, device, SLUG, {
    _tag: 'AssignAuthor',
    channel: 'offers',
    memberId: petr.memberId,
  })
  assert(assigned.status === 'applied', 'assignment applies at once')
  await snapshot('assigned')

  // B5: remove Jana. Petr re-signs her post and the authors metadata she signed.
  at('B5: remove Jana. Petr re-signs her post ')
  const removal = await call(
    owner.client.ceremonies.start({
      payload: { intent: { _tag: 'RemoveAuthor', channel: 'offers', memberId: jana.memberId } },
    }),
  )
  assert(removal.removal?.itemsSignedOnlyByAuthor.length === 1, 'one post signed only by Jana')
  assert(removal.removal?.authorsMetadataNeedsResign === true, 'authors metadata needs Petr')
  const petrTasks = await doTasks(petr)
  assert(
    petrTasks.map((t) => t._tag).join() === 'ResignItems,SignAuthorsMetadata',
    'Petr re-signs the post and the authors metadata',
  )
  await snapshot('resigned')
  const afterResign = await call(
    owner.client.ceremonies.get({ params: { ceremonyId: removal.id } }),
  )
  assert(afterResign.removal?.itemsSignedOnlyByAuthor.length === 0, 'nothing left only by Jana')
  const removed = await signAsOwner(owner, afterResign, device, SLUG)
  assert(removed.status === 'applied', `removal applies, is ${removed.status}`)
  const items = await call(owner.client.items.list({ params: { channel: 'offers' } }))
  assert(items.length === 1, 'the re-signed post stays published')
  await snapshot('removed')

  // E1: timestamps are re-signed on schedule.
  at('E1: timestamps are re-signed on schedule')
  advance(server, 12 * 60 * 60 * 1000)
  await server.runWithServices(refreshTimestamps)
  await snapshot('timestamp')

  // E2 + E3: 160 days later the channel metadata is renewed by the server and Petr's
  at('E2 + E3: 160 days later the channel meta')
  // console renews the authors metadata; then the owner renews targets.json.
  advance(server, 160 * DAY)
  await server.runWithServices(renewServerMetadata)
  await snapshot('server-renewal')
  await ownerLogin(owner, device, SLUG)
  await memberLogin(petr)
  const renewals = await doTasks(petr)
  assert(
    renewals.length === 1 && renewals[0]?._tag === 'SignAuthorsMetadata',
    'Petr renews the authors metadata',
  )
  await snapshot('authors-renewal')
  const renewed = await ceremony(owner, device, SLUG, { _tag: 'RenewTargets' })
  assert(renewed.status === 'applied', 'targets renewal applies')
  await snapshot('targets-renewal')

  if (snapshotDir) {
    writeFileSync(
      join(snapshotDir, 'scenario.json'),
      `${JSON.stringify({ steps: snapshots }, null, 2)}\n`,
    )
  }
  return { owner, operator, jana, petr, device, snapshots }
}
