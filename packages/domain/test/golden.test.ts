import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import {
  addItemSignature,
  assignAuthor,
  canonicalJson,
  createChannel,
  ed25519Key,
  editChannel,
  editCompany,
  fromHex,
  type Item,
  type ItemDraft,
  initRepo,
  itemSignatureFor,
  keyidOf,
  parseRepoFiles,
  publicKeyFromSeed,
  publishItem,
  type Repo,
  type RepoState,
  refreshTimestamp,
  removeAuthor,
  repoFiles,
  seedSigner,
  signItem,
  signRole,
  toHex,
  unpublishItem,
  utf8,
  withFreshness,
} from '../src/index.ts'
import { asText, readRepoDir } from './files.ts'
import { authorKey, publicOf, signerOf } from './keys.ts'

const fixtures = join(import.meta.dirname, 'fixtures/go')

interface CanonicalFixture {
  readonly message: string
  readonly canonical: ReadonlyArray<{ readonly input: string; readonly canonical: string }>
  readonly keys: ReadonlyArray<{
    readonly name: string
    readonly seed: string
    readonly public: string
    readonly keyid: string
    readonly sig: string
  }>
}

const canonical = JSON.parse(
  readFileSync(join(fixtures, 'canonical.json'), 'utf8'),
) as CanonicalFixture

describe('golden: primitives match the Go SDK', () => {
  it.each(canonical.canonical)('OLPC bytes of $input', ({ input, canonical: expected }) => {
    expect(canonicalJson(JSON.parse(input))).toBe(expected)
  })

  it.effect.each(canonical.keys)('public key, keyid and signature of $name', (fixture) =>
    Effect.gen(function* () {
      const seed = fromHex(fixture.seed)
      expect(publicKeyFromSeed(seed)).toBe(fixture.public)
      expect(keyidOf(ed25519Key(fixture.public, fixture.name))).toBe(fixture.keyid)
      expect(toHex(yield* seedSigner(seed).sign(utf8(canonical.message)))).toBe(fixture.sig)
    }),
  )
})

const steps = [
  '01-init',
  '02-channel-add',
  '03-publish',
  '04-author-add',
  '05-publish-cosigned',
  '06-channel-set',
  '07-company-logo',
  '08-unpublish',
  '09-refresh-timestamp',
  '10-author-revoke',
] as const
type Step = (typeof steps)[number]

const goFiles = (step: Step) => readRepoDir(join(fixtures, 'steps', step))
const goRepo = (step: Step) => parseRepoFiles(goFiles(step))
const timing = (step: Step) => ({ now: new Date(Date.UTC(2026, 9, 26, 12 + steps.indexOf(step))) })

const sign = (
  state: RepoState,
  ...roles: ReadonlyArray<readonly [Parameters<typeof signRole>[1], string]>
) =>
  Effect.reduce(
    roles,
    () => state,
    (acc, [role, signer]) => signRole(acc, role, signerOf(signer)),
  )

const finish = (state: RepoState, previous: Repo | undefined, step: Step) =>
  withFreshness(state, previous, signerOf('ops'), timing(step))

const expectSameFiles = (repo: Repo, step: Step, only?: ReadonlyArray<string>) => {
  const ours = repoFiles(repo)
  const go = goFiles(step)
  expect(Object.keys(asText(go.base, only)).length).toBeGreaterThan(0)
  expect(asText(ours.anchor, only)).toEqual(asText(go.anchor, only))
  expect(asText(ours.base, only)).toEqual(asText(go.base, only))
}

const draft = (id: string, title: string): ItemDraft => ({
  id,
  title,
  content_html: '<p>Hello & welcome to <b>ACME</b>\u2028</p>',
  image: 'data:image/png;base64,iVBORw0KGgo=',
  date_published: '2026-10-26T12:00:00Z',
  tags: ['news', 'ünïcode'],
  language: 'en',
  attachments: [
    {
      name: 'Price list',
      url: 'https://acme.example/prices.pdf?a=1&b=2',
      mime_type: 'application/pdf',
      size_in_bytes: 12345,
      sha256: '0'.repeat(64),
    },
  ],
})

const signedBy = (item: ItemDraft, ...names: ReadonlyArray<string>): Effect.Effect<Item, unknown> =>
  Effect.reduce(
    names,
    () => item as Item,
    (acc, name) => signItem(acc, signerOf(name)),
  )

describe('golden: operations reproduce the Go publisher byte for byte', () => {
  it.effect('init', () =>
    Effect.gen(function* () {
      const state = yield* initRepo(
        {
          repoBase: 'https://repo.keryx-kit.test/acme/',
          companyName: 'ACME <Shop> & Co.',
          logo: 'data:image/png;base64,iVBORw0KGgo=',
          masterKey: publicOf('master'),
          opsKey: publicOf('ops'),
        },
        timing('01-init'),
      )
      const signed = yield* sign(state, ['root', 'master'], ['targets', 'master'])
      expectSameFiles(yield* finish(signed, undefined, '01-init'), '01-init')
    }),
  )

  it.effect('channel add', () =>
    Effect.gen(function* () {
      const prev = yield* goRepo('01-init')
      const state = yield* createChannel(
        prev,
        {
          channel: 'offers',
          displayName: 'Offers & deals',
          description: 'Weekly <b>deals</b>',
          channelKey: publicOf('offers'),
          authors: [authorKey('alice')],
        },
        timing('02-channel-add'),
      )
      const signed = yield* sign(
        state,
        ['targets', 'master'],
        ['channels.offers', 'offers'],
        ['channels.offers.authors', 'alice'],
      )
      expectSameFiles(yield* finish(signed, prev, '02-channel-add'), '02-channel-add')
    }),
  )

  const publishStep = (from: Step, step: Step, item: Effect.Effect<Item, unknown>) =>
    Effect.gen(function* () {
      const prev = yield* goRepo(from)
      const withChannelSig = yield* Effect.flatMap(item, (i) => signItem(i, signerOf('offers')))
      const state = yield* publishItem(
        prev,
        { channel: 'offers', item: withChannelSig },
        timing(step),
      )
      const signed = yield* sign(state, ['channels.offers', 'offers'])
      expectSameFiles(yield* finish(signed, prev, step), step)
    })

  it.effect('publish', () =>
    publishStep(
      '02-channel-add',
      '03-publish',
      signedBy(draft('welcome', 'Welcome <to> ACME & co'), 'alice'),
    ),
  )

  it.effect('author add (targets.json only: the Go SDK also recreates authors.json)', () =>
    Effect.gen(function* () {
      const prev = yield* goRepo('03-publish')
      const state = yield* assignAuthor(
        prev,
        { channel: 'offers', author: authorKey('bob') },
        timing('04-author-add'),
      )
      const signed = yield* sign(state, ['targets', 'master'])
      expectSameFiles(yield* finish(signed, prev, '04-author-add'), '04-author-add', [
        'targets.json',
        'channels.offers.json',
        'channels/offers/welcome.json',
      ])
    }),
  )

  it.effect('publish co-signed item', () =>
    publishStep(
      '04-author-add',
      '05-publish-cosigned',
      signedBy(draft('second', 'Second 😀'), 'alice', 'bob'),
    ),
  )

  it.effect('channel set', () =>
    Effect.gen(function* () {
      const prev = yield* goRepo('05-publish-cosigned')
      const state = yield* editChannel(
        prev,
        { channel: 'offers', displayName: 'Offers' },
        timing('06-channel-set'),
      )
      const signed = yield* sign(state, ['targets', 'master'])
      expectSameFiles(yield* finish(signed, prev, '06-channel-set'), '06-channel-set')
    }),
  )

  it.effect('company logo', () =>
    Effect.gen(function* () {
      const prev = yield* goRepo('06-channel-set')
      const state = yield* editCompany(
        prev,
        { logo: 'https://acme.example/logo.png', logoSha256: '0'.repeat(64) },
        timing('07-company-logo'),
      )
      const signed = yield* sign(state, ['targets', 'master'])
      expectSameFiles(yield* finish(signed, prev, '07-company-logo'), '07-company-logo')
    }),
  )

  it.effect('unpublish', () =>
    Effect.gen(function* () {
      const prev = yield* goRepo('07-company-logo')
      const state = yield* unpublishItem(
        prev,
        { channel: 'offers', id: 'second' },
        timing('08-unpublish'),
      )
      const signed = yield* sign(state, ['channels.offers', 'offers'])
      expectSameFiles(yield* finish(signed, prev, '08-unpublish'), '08-unpublish')
    }),
  )

  it.effect('refresh timestamp', () =>
    Effect.gen(function* () {
      const prev = yield* goRepo('08-unpublish')
      const next = yield* refreshTimestamp(prev, signerOf('ops'), timing('09-refresh-timestamp'))
      expectSameFiles(next, '09-refresh-timestamp')
    }),
  )

  it.effect('author revoke (targets.json and re-signed items)', () =>
    Effect.gen(function* () {
      const prev = yield* goRepo('09-refresh-timestamp')
      const welcome = draft('welcome', 'Welcome <to> ACME & co')
      const resigned = yield* addItemSignature(
        prev,
        {
          channel: 'offers',
          id: 'welcome',
          signature: yield* itemSignatureFor(welcome, signerOf('bob')),
        },
        timing('10-author-revoke'),
      )
      const alice = keyidOf(ed25519Key(publicOf('alice')))
      const state = yield* removeAuthor(
        resigned,
        { channel: 'offers', keyid: alice },
        timing('10-author-revoke'),
      )
      const signed = yield* sign(state, ['targets', 'master'], ['channels.offers', 'offers'])
      expectSameFiles(yield* finish(signed, prev, '10-author-revoke'), '10-author-revoke', [
        'targets.json',
        'channels/offers/welcome.json',
      ])
    }),
  )
})
