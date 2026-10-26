/**
 * The conformance scenario: a company repo built step by step with the domain
 * package, every intermediate published state kept. `write-scenario.ts` writes it for
 * the Go verifier (tools/conformance); the tests feed it to the subscriber app.
 */
import { sha256 } from '@noble/hashes/sha2.js'
import { Effect } from 'effect'
import {
  addItemSignature,
  assignAuthor,
  createChannel,
  decodeItem,
  ed25519Key,
  editChannel,
  editCompany,
  type ItemDraft,
  initRepo,
  itemSignatureFor,
  itemsSignedOnlyBy,
  keyidOf,
  publicKeyFromSeed,
  publishItem,
  type Repo,
  type RepoState,
  refreshTimestamp,
  removeAuthor,
  renewAuthors,
  renewChannel,
  renewTargets,
  seedSigner,
  signItem,
  signRole,
  type Timing,
  unpublishItem,
  utf8,
  validateRepo,
  withFreshness,
} from '../src/index.ts'

const seed = (name: string) => sha256(utf8(`keryx-conformance/${name}`))
const signer = (name: string) => seedSigner(seed(name))
const publicKey = (name: string) => publicKeyFromSeed(seed(name))
const keyid = (name: string) => keyidOf(ed25519Key(publicKey(name)))
const author = (name: string) => ({ publicKey: publicKey(name), name: `author-${name}` })

export const SCENARIO_START = new Date(Date.UTC(2026, 9, 26, 12))

export interface ScenarioStep {
  readonly name: string
  readonly now: Date
  readonly repo: Repo
}

type Role = Parameters<typeof signRole>[1]

const signAll = (state: RepoState, roles: ReadonlyArray<readonly [Role, string]>) =>
  Effect.reduce(
    roles,
    () => state,
    (acc, [role, name]) => signRole(acc, role, signer(name)),
  )

const draft = (id: string, title: string, extra: Partial<ItemDraft> = {}): ItemDraft => ({
  id,
  title,
  content_html: `<p>${title} &amp; more</p>`,
  date_published: SCENARIO_START.toISOString().replace('.000', ''),
  tags: ['news'],
  language: 'en',
  ...extra,
})

/** An item signed by its author plus the channel key's portability signature. */
const signedItem = (item: ItemDraft, by: string, channelKey: string) =>
  Effect.flatMap(signItem(item, signer(by)), (signed) => signItem(signed, signer(channelKey)))

export const buildScenario: Effect.Effect<ReadonlyArray<ScenarioStep>, unknown> = Effect.gen(
  function* () {
    const steps: Array<ScenarioStep> = []
    const timing = (): Timing => ({
      now: new Date(SCENARIO_START.getTime() + steps.length * 3_600_000),
    })
    const previous = () => steps.at(-1)?.repo
    const record = (name: string, repo: Repo, at: Timing) => {
      const issues = validateRepo(repo, { now: at.now, previous: previous() })
      if (issues.length > 0) throw new Error(`${name}: ${JSON.stringify(issues, null, 2)}`)
      steps.push({ name, now: at.now, repo })
    }
    const change = (
      name: string,
      build: (prev: Repo, at: Timing) => Effect.Effect<RepoState, unknown>,
      roles: ReadonlyArray<readonly [Role, string]>,
    ) =>
      Effect.gen(function* () {
        const at = timing()
        const prev = previous() as Repo
        const signed = yield* signAll(yield* build(prev, at), roles)
        record(name, yield* withFreshness(signed, prev, signer('ops'), at), at)
      })
    const publish = (name: string, channel: string, item: ItemDraft, by: string) =>
      change(
        name,
        (prev, at) =>
          Effect.flatMap(signedItem(item, by, channel), (signed) =>
            publishItem(prev, { channel, item: signed }, at),
          ),
        [[`channels.${channel}`, channel]],
      )
    const tick = (name: string) =>
      Effect.gen(function* () {
        const at = timing()
        record(name, yield* refreshTimestamp(previous() as Repo, signer('ops'), at), at)
      })

    const initAt = timing()
    const init = yield* initRepo(
      {
        repoBase: 'https://repo.keryx-kit.test/acme/',
        companyName: 'ACME s.r.o.',
        logo: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        masterKey: publicKey('master'),
        opsKey: publicKey('ops'),
      },
      initAt,
    )
    record(
      'init',
      yield* withFreshness(
        yield* signAll(init, [
          ['root', 'master'],
          ['targets', 'master'],
        ]),
        undefined,
        signer('ops'),
        initAt,
      ),
      initAt,
    )

    yield* change(
      'create-offers',
      (prev, at) =>
        createChannel(
          prev,
          {
            channel: 'offers',
            displayName: 'Offers & deals',
            description: 'Weekly <b>deals</b>',
            channelKey: publicKey('offers'),
            authors: [author('alice'), author('bob')],
          },
          at,
        ),
      [
        ['targets', 'master'],
        ['channels.offers', 'offers'],
        ['channels.offers.authors', 'alice'],
      ],
    )
    yield* change(
      'create-security',
      (prev, at) =>
        createChannel(
          prev,
          {
            channel: 'security',
            displayName: 'Security',
            channelKey: publicKey('security'),
            authors: [author('carol')],
          },
          at,
        ),
      [
        ['targets', 'master'],
        ['channels.security', 'security'],
        ['channels.security.authors', 'carol'],
      ],
    )
    yield* publish('publish-welcome', 'offers', draft('welcome', 'Welcome to ACME'), 'alice')
    yield* publish(
      'publish-spring-sale',
      'offers',
      draft('spring-sale', 'Spring sale', { image: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' }),
      'bob',
    )
    yield* publish(
      'publish-advisory-1',
      'security',
      draft('advisory-1', 'Advisory <1>', {
        attachments: [
          { name: 'Details', url: 'https://acme.example/advisory-1.pdf', sha256: '0'.repeat(64) },
        ],
      }),
      'carol',
    )
    yield* tick('refresh-timestamp-1')
    yield* publish(
      'edit-welcome',
      'offers',
      draft('welcome', 'Welcome to ACME (updated)', { date_modified: '2026-10-26T20:00:00Z' }),
      'alice',
    )
    yield* change(
      'unpublish-spring-sale',
      (prev, at) => unpublishItem(prev, { channel: 'offers', id: 'spring-sale' }, at),
      [['channels.offers', 'offers']],
    )
    yield* publish('publish-summer', 'offers', draft('summer', 'Summer collection'), 'alice')

    yield* change(
      'bob-resigns-alice-items',
      (prev, at) =>
        Effect.gen(function* () {
          let state: RepoState = prev
          for (const id of yield* itemsSignedOnlyBy(prev, {
            channel: 'offers',
            keyid: keyid('alice'),
          })) {
            const item = yield* decodeItem(
              prev.items[`channels/offers/${id}.json`] ?? new Uint8Array(),
            )
            const signature = yield* itemSignatureFor(item, signer('bob'))
            state = yield* addItemSignature(state, { channel: 'offers', id, signature }, at)
          }
          return state
        }),
      [['channels.offers', 'offers']],
    )
    yield* change('bob-renews-offers-authors', (prev, at) => renewAuthors(prev, 'offers', at), [
      ['channels.offers.authors', 'bob'],
    ])
    yield* change(
      'remove-alice',
      (prev, at) =>
        Effect.gen(function* () {
          const orphaned = yield* itemsSignedOnlyBy(prev, {
            channel: 'offers',
            keyid: keyid('alice'),
          })
          if (orphaned.length > 0)
            throw new Error(`items still signed only by alice: ${orphaned.join(', ')}`)
          return yield* removeAuthor(prev, { channel: 'offers', keyid: keyid('alice') }, at)
        }),
      [
        ['targets', 'master'],
        ['channels.offers', 'offers'],
      ],
    )
    yield* change(
      'change-logo',
      (prev, at) =>
        editCompany(
          prev,
          { logo: 'https://acme.example/logo.png', logoSha256: 'ab'.repeat(32) },
          at,
        ),
      [['targets', 'master']],
    )
    yield* change(
      'edit-security-display',
      (prev, at) =>
        editChannel(
          prev,
          { channel: 'security', displayName: 'Security advisories', description: 'Fixes & CVEs' },
          at,
        ),
      [['targets', 'master']],
    )
    yield* change(
      'assign-dave',
      (prev, at) => assignAuthor(prev, { channel: 'security', author: author('dave') }, at),
      [['targets', 'master']],
    )
    yield* publish('publish-advisory-2', 'security', draft('advisory-2', 'Advisory 2'), 'dave')
    yield* tick('refresh-timestamp-2')
    yield* change(
      'renew-channel-and-targets',
      (prev, at) =>
        Effect.map(renewChannel(prev, 'security', at), (state) => renewTargets(state, at)),
      [
        ['targets', 'master'],
        ['channels.security', 'security'],
      ],
    )
    return steps
  },
)
