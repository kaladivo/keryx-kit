import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import {
  ed25519Key,
  editChannel,
  encodeItem,
  publishItem,
  type Repo,
  renewTargets,
  sha256Hex,
  signItem,
  utf8,
  validateRepo,
  withFreshness,
} from '../src/index.ts'
import { publicOf, signerOf } from './keys.ts'
import { at, companyRepo, draft, keyid, publish, signAll } from './support.ts'

const codes = (
  repo: Parameters<typeof validateRepo>[0],
  options?: Parameters<typeof validateRepo>[1],
) => validateRepo(repo, options).map((issue) => issue.code)

const editedRepo = (repo: Repo) =>
  Effect.gen(function* () {
    const state = yield* editChannel(repo, { channel: 'offers', displayName: 'Deals' }, at(12))
    return yield* publish(yield* signAll(state, ['targets', 'master']), repo, at(12))
  })

describe('validateRepo', () => {
  it.effect('accepts a published repo, also against its predecessor', () =>
    Effect.gen(function* () {
      const repo = yield* companyRepo
      expect(codes(repo, { now: at(12).now })).toEqual([])
      expect(codes(yield* editedRepo(repo), { previous: repo, now: at(12).now })).toEqual([])
    }),
  )

  it.effect('rejects non-monotonic versions against the published repo', () =>
    Effect.gen(function* () {
      const repo = yield* companyRepo
      const newer = yield* editedRepo(repo)
      expect(codes(repo, { previous: newer })).toContain('version-rollback')

      const sameVersion = { ...newer.targets.signed, version: repo.targets.signed.version }
      const resigned = yield* signAll(
        { ...newer, targets: { signatures: [], signed: sameVersion } },
        ['targets', 'master'],
      )
      const rebuilt = yield* withFreshness(resigned, repo, signerOf('ops'), at(12))
      expect(codes(rebuilt, { previous: repo })).toEqual(['version-not-bumped'])
    }),
  )

  it.effect('rejects expired metadata only when a clock is given', () =>
    Effect.gen(function* () {
      const repo = yield* companyRepo
      expect(codes(repo)).toEqual([])
      expect(new Set(codes(repo, { now: new Date(Date.UTC(2027, 0, 1)) }))).toEqual(
        new Set(['expired']),
      )
    }),
  )

  it.effect('rejects missing signatures, tampered items and unpinned metadata', () =>
    Effect.gen(function* () {
      const repo = yield* companyRepo
      expect(codes({ ...repo, targets: { ...repo.targets, signatures: [] } })).toContain(
        'signature-threshold',
      )

      const item = yield* signItem(draft('x'), signerOf('alice'))
      const state = yield* publishItem(repo, { channel: 'offers', item }, at(12))
      const published = yield* publish(
        yield* signAll(state, ['channels.offers', 'offers']),
        repo,
        at(12),
      )
      const tampered = { ...published, items: { 'channels/offers/x.json': utf8('{}') } }
      expect(codes(tampered)).toEqual(expect.arrayContaining(['pin-mismatch', 'item-invalid']))

      const renewed = yield* signAll(renewTargets(repo, at(13)), ['targets', 'master'])
      expect(
        new Set(codes({ ...renewed, snapshot: repo.snapshot, timestamp: repo.timestamp })),
      ).toEqual(new Set(['pin-mismatch']))
    }),
  )

  it.effect('rejects author keys that are also channel keys and channels without authors', () =>
    Effect.gen(function* () {
      const repo = yield* companyRepo
      const { delegations } = repo.targets.signed
      const [channel, authors] = delegations.roles
      if (!channel || !authors) throw new Error('fixture')
      const overlapping = {
        ...repo.targets.signed,
        delegations: {
          ...delegations,
          roles: [channel, { ...authors, keyids: [...authors.keyids, keyid('offers')] }],
        },
      }
      expect(codes({ ...repo, targets: { ...repo.targets, signed: overlapping } })).toContain(
        'key-overlap',
      )

      const simple = { ...repo.targets.signed, delegations: { ...delegations, roles: [channel] } }
      const { offers: _offers, ...noAuthors } = repo.authors
      expect(
        codes({ ...repo, authors: noAuthors, targets: { ...repo.targets, signed: simple } }),
      ).toContain('not-authored')
    }),
  )

  it.effect.each(['https://cdn.acme .com/a.png', 'https://a.com:99999/x.png'])(
    'rejects items and logos linking %s',
    (url) =>
      Effect.gen(function* () {
        const repo = yield* companyRepo
        const item = yield* signItem(
          { ...draft('x'), image: url, image_sha256: '0'.repeat(64) },
          signerOf('alice'),
        )
        const bytes = encodeItem(item)
        const path = 'channels/offers/x.json'
        const offers = repo.channels.offers
        if (!offers) throw new Error('fixture')
        const index = {
          signatures: [],
          signed: {
            ...offers.signed,
            version: offers.signed.version + 1,
            targets: { [path]: { length: bytes.length, hashes: { sha256: sha256Hex(bytes) } } },
          },
        }
        const state = { ...repo, channels: { offers: index }, items: { [path]: bytes } }
        const withItem = yield* publish(
          yield* signAll(state, ['channels.offers', 'offers']),
          repo,
          at(12),
        )
        expect(validateRepo(withItem).map((i) => [i.code, i.file])).toEqual([
          ['item-invalid', path],
        ])

        const custom = { ...repo.targets.signed.custom, logo: url, logo_sha256: 'ab'.repeat(32) }
        const targets = { signatures: [], signed: { ...repo.targets.signed, version: 3, custom } }
        const withLogo = yield* publish(
          yield* signAll({ ...repo, targets }, ['targets', 'master']),
          repo,
          at(12),
        )
        expect(codes(withLogo)).toEqual(['structure'])
      }),
  )

  it.effect('rejects a key object published under the wrong keyid', () =>
    Effect.gen(function* () {
      const repo = yield* companyRepo
      const { delegations } = repo.targets.signed
      const keys = { ...delegations.keys, [keyid('alice')]: ed25519Key(publicOf('mallory')) }
      const signed = { ...repo.targets.signed, delegations: { ...delegations, keys } }
      expect(codes({ ...repo, targets: { ...repo.targets, signed } })).toContain('keyid-mismatch')
    }),
  )

  it.effect('rejects metadata that disappears from a published repo', () =>
    Effect.gen(function* () {
      const repo = yield* companyRepo
      const { offers: _authors, ...authors } = repo.authors
      expect(codes({ ...repo, authors }, { previous: repo })).toContain('metadata-removed')
    }),
  )
})
