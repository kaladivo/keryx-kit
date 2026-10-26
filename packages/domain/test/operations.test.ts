import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import {
  addItemSignature,
  assignAuthor,
  createChannel,
  decodeItem,
  editChannel,
  editCompany,
  encodeItem,
  type Item,
  initRepo,
  itemSignatureFor,
  itemsSignedOnlyBy,
  metadataFileBytes,
  publishItem,
  refreshTimestamp,
  removeAuthor,
  renewAuthors,
  renewChannel,
  renewTargets,
  repoFiles,
  type SigningFailed,
  sha256Hex,
  signItem,
  unpublishItem,
  validateRepo,
} from '../src/index.ts'
import { authorKey, publicOf, signerOf } from './keys.ts'
import { at, companyRepo, draft, keyid, publish, signAll } from './support.ts'

const refusal = <A, E extends { readonly code?: string }>(effect: Effect.Effect<A, E>) =>
  Effect.map(Effect.flip(effect), (error) => error.code)

const signedItem = (
  id: string,
  ...signers: ReadonlyArray<string>
): Effect.Effect<Item, SigningFailed> =>
  Effect.reduce(
    signers,
    (): Item => ({ ...draft(id), sig: [] }),
    (item, name) => signItem(item, signerOf(name)),
  )

const publishAs = (id: string, ...signers: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const repo = yield* companyRepo
    const item = yield* signedItem(id, ...signers)
    return { repo, state: yield* publishItem(repo, { channel: 'offers', item }, at(12)) }
  })

describe('initRepo', () => {
  it.effect('builds root v1 (master: root+targets, ops: snapshot+timestamp) and targets v1', () =>
    Effect.gen(function* () {
      const state = yield* initRepo(
        {
          repoBase: 'https://repo.test/acme/',
          companyName: 'ACME',
          logo: 'https://acme.example/logo.png',
          logoSha256: 'ab'.repeat(32),
          masterKey: publicOf('master'),
          opsKey: publicOf('ops'),
        },
        at(10),
      )
      const root = state.roots[0]?.signed
      expect(root?.version).toBe(1)
      expect(root?.roles.root.keyids).toEqual([keyid('master')])
      expect(root?.roles.targets.keyids).toEqual([keyid('master')])
      expect(root?.roles.snapshot.keyids).toEqual([keyid('ops')])
      expect(root?.roles.timestamp.keyids).toEqual([keyid('ops')])
      expect(root?.custom).toEqual({ repo_base: 'https://repo.test/acme/', mode: 'full' })
      expect(root?.expires).toBe('2036-10-23T10:00:00Z')
      expect(state.targets.signed.version).toBe(1)
      expect(state.targets.signed.expires).toBe('2027-10-26T10:00:00Z')
      expect(state.targets.signed.custom).toEqual({
        company_name: 'ACME',
        logo: 'https://acme.example/logo.png',
        logo_sha256: 'ab'.repeat(32),
        channels: {},
        private_feed_patterns: [],
      })
      expect(state.targets.signed.delegations).toEqual({ keys: {}, roles: [] })
      expect(state.targets.signatures).toEqual([])
    }),
  )

  it.effect('refuses a missing company name and malformed logos', () =>
    Effect.gen(function* () {
      const base = {
        repoBase: 'https://r/',
        companyName: 'A',
        masterKey: publicOf('master'),
        opsKey: publicOf('ops'),
      }
      expect(yield* refusal(initRepo({ ...base, companyName: '' }, at(10)))).toBe('invalid-company')
      expect(yield* refusal(initRepo({ ...base, logo: 'http://a/logo.png' }, at(10)))).toBe(
        'invalid-logo',
      )
      expect(yield* refusal(initRepo({ ...base, logo: 'https://a/logo.png' }, at(10)))).toBe(
        'invalid-logo',
      )
      expect(yield* refusal(initRepo({ ...base, logo: 'data:image/png,raw' }, at(10)))).toBe(
        'invalid-logo',
      )
      expect(yield* refusal(initRepo({ ...base, opsKey: publicOf('master') }, at(10)))).toBe(
        'key-overlap',
      )
    }),
  )
})

describe('createChannel', () => {
  it.effect('adds the channel and authors delegations in the Go SDK order', () =>
    Effect.gen(function* () {
      const repo = yield* companyRepo
      const { roles, keys } = repo.targets.signed.delegations
      expect(roles).toEqual([
        {
          name: 'channels.offers',
          keyids: [keyid('offers')],
          threshold: 1,
          terminating: true,
          paths: ['channels/offers/*'],
        },
        {
          name: 'channels.offers.authors',
          keyids: [keyid('alice'), keyid('bob')],
          threshold: 1,
          terminating: false,
          paths: ['channels/offers/*'],
        },
      ])
      expect(keys[keyid('offers')]?.name).toBe('offers')
      expect(keys[keyid('alice')]?.name).toBe('alice')
      expect(repo.targets.signed.custom.channels).toEqual({ offers: { display_name: 'Offers' } })
      expect(repo.targets.signed.version).toBe(2)
      expect(repo.channels.offers?.signed.version).toBe(1)
      expect(repo.authors.offers?.signed.version).toBe(1)
      expect(validateRepo(repo)).toEqual([])
    }),
  )

  it.effect('stays staged until an author signs the authors metadata', () =>
    Effect.gen(function* () {
      const repo = yield* companyRepo
      const state = yield* createChannel(
        repo,
        { channel: 'security', channelKey: publicOf('security'), authors: [authorKey('carol')] },
        at(12),
      )
      const signed = yield* signAll(state, ['targets', 'master'], ['channels.security', 'security'])
      const issues = validateRepo(yield* publish(signed, repo, at(12)), { previous: repo })
      expect(issues.map((i) => [i.code, i.file])).toEqual([
        ['signature-threshold', 'channels.security.authors.json'],
      ])
    }),
  )

  it.effect('refuses bad slugs, duplicates, no authors and key overlap', () =>
    Effect.gen(function* () {
      const repo = yield* companyRepo
      const params = {
        channel: 'news',
        channelKey: publicOf('news'),
        authors: [authorKey('carol')],
      }
      for (const channel of ['News', 'a.b', '', 'a/b', 'ü']) {
        expect(yield* refusal(createChannel(repo, { ...params, channel }, at(12)))).toBe(
          'invalid-channel-name',
        )
      }
      expect(yield* refusal(createChannel(repo, { ...params, channel: 'offers' }, at(12)))).toBe(
        'channel-exists',
      )
      expect(yield* refusal(createChannel(repo, { ...params, authors: [] }, at(12)))).toBe(
        'no-authors',
      )
      const ownKeyAsAuthor = { ...params, authors: [{ publicKey: publicOf('news') }] }
      expect(yield* refusal(createChannel(repo, ownKeyAsAuthor, at(12)))).toBe('key-overlap')
      const otherChannelKey = { ...params, authors: [{ publicKey: publicOf('offers') }] }
      expect(yield* refusal(createChannel(repo, otherChannelKey, at(12)))).toBe('key-overlap')
      const reusedChannelKey = { ...params, channelKey: publicOf('alice') }
      expect(yield* refusal(createChannel(repo, reusedChannelKey, at(12)))).toBe('key-overlap')
    }),
  )
})

describe('assignAuthor', () => {
  it.effect('adds the key and leaves the authors metadata untouched', () =>
    Effect.gen(function* () {
      const repo = yield* companyRepo
      const state = yield* assignAuthor(
        repo,
        { channel: 'offers', author: authorKey('carol') },
        at(12),
      )
      expect(state.targets.signed.delegations.roles[1]?.keyids).toEqual([
        keyid('alice'),
        keyid('bob'),
        keyid('carol'),
      ])
      expect(state.targets.signed.version).toBe(3)
      expect(state.authors.offers).toBe(repo.authors.offers)
      const signed = yield* signAll(state, ['targets', 'master'])
      expect(validateRepo(yield* publish(signed, repo, at(12)), { previous: repo })).toEqual([])
    }),
  )

  it.effect('refuses listed authors, channel keys and unknown channels', () =>
    Effect.gen(function* () {
      const repo = yield* companyRepo
      expect(
        yield* refusal(
          assignAuthor(repo, { channel: 'offers', author: authorKey('alice') }, at(12)),
        ),
      ).toBe('author-listed')
      expect(
        yield* refusal(
          assignAuthor(
            repo,
            { channel: 'offers', author: { publicKey: publicOf('offers') } },
            at(12),
          ),
        ),
      ).toBe('key-overlap')
      expect(
        yield* refusal(assignAuthor(repo, { channel: 'nope', author: authorKey('carol') }, at(12))),
      ).toBe('unknown-channel')
    }),
  )
})

describe('publishItem', () => {
  it.effect('pins the item and bumps the channel role metadata', () =>
    Effect.gen(function* () {
      const { repo, state } = yield* publishAs('hello', 'offers', 'alice')
      const bytes = state.items['channels/offers/hello.json'] as Uint8Array
      expect(state.channels.offers?.signed.targets).toEqual({
        'channels/offers/hello.json': {
          length: bytes.length,
          hashes: { sha256: sha256Hex(bytes) },
        },
      })
      expect(state.channels.offers?.signed.version).toBe(2)
      expect(state.channels.offers?.signed.expires).toBe('2027-04-24T12:00:00Z')
      expect(state.targets).toBe(repo.targets)
      const item = yield* decodeItem(bytes)
      expect(item.sig.map((s) => s.keyid)).toEqual([keyid('alice'), keyid('offers')])
      const signed = yield* signAll(state, ['channels.offers', 'offers'])
      expect(
        validateRepo(yield* publish(signed, repo, at(12)), { previous: repo, now: at(12).now }),
      ).toEqual([])
    }),
  )

  it.effect('replaces an item published under the same id', () =>
    Effect.gen(function* () {
      const { state } = yield* publishAs('hello', 'alice')
      const edited = yield* signItem({ ...draft('hello'), title: 'Edited' }, signerOf('bob'))
      const next = yield* publishItem(state, { channel: 'offers', item: edited }, at(13))
      expect(Object.keys(next.items)).toEqual(['channels/offers/hello.json'])
      expect(
        (yield* decodeItem(next.items['channels/offers/hello.json'] as Uint8Array)).title,
      ).toBe('Edited')
      expect(next.channels.offers?.signed.version).toBe(3)
    }),
  )

  it.effect('refuses unauthorized, unsigned, tampered and malformed items', () =>
    Effect.gen(function* () {
      const repo = yield* companyRepo
      const publishing = (item: Parameters<typeof publishItem>[1]['item'], channel = 'offers') =>
        refusal(publishItem(repo, { channel, item }, at(12)))
      expect(yield* publishing(yield* signedItem('x', 'carol'))).toBe('unauthorized-item')
      expect(yield* publishing(yield* signedItem('x', 'offers'))).toBe('unauthorized-item')
      expect(yield* publishing({ ...draft('x'), sig: [] })).toBe('unauthorized-item')
      const signed = yield* signedItem('x', 'alice')
      expect(yield* publishing({ ...signed, title: 'tampered' })).toBe('bad-signature')
      expect(yield* publishing(yield* signedItem('Bad.Id', 'alice'))).toBe('invalid-item')
      const linked = yield* signItem({ ...draft('x'), image: 'https://a/i.png' }, signerOf('alice'))
      expect(yield* publishing(linked)).toBe('invalid-item')
      const big = yield* signItem(
        { ...draft('x'), content_html: 'x'.repeat(1024 * 1024) },
        signerOf('alice'),
      )
      expect(yield* publishing(big)).toBe('item-too-large')
      expect(yield* publishing(signed, 'nope')).toBe('unknown-channel')
    }),
  )
})

describe('unpublishItem', () => {
  it.effect('removes the index entry and the item file', () =>
    Effect.gen(function* () {
      const { state } = yield* publishAs('hello', 'alice')
      const next = yield* unpublishItem(state, { channel: 'offers', id: 'hello' }, at(13))
      expect(next.channels.offers?.signed.targets).toEqual({})
      expect(next.items).toEqual({})
      expect(next.channels.offers?.signed.version).toBe(3)
      expect(yield* refusal(unpublishItem(next, { channel: 'offers', id: 'hello' }, at(13)))).toBe(
        'item-not-published',
      )
    }),
  )
})

describe('removeAuthor (B5)', () => {
  it.effect('lists, re-signs, then revokes: only re-signed items stay published', () =>
    Effect.gen(function* () {
      const { state: one } = yield* publishAs('kept', 'alice')
      const two = yield* publishItem(
        one,
        { channel: 'offers', item: yield* signedItem('dropped', 'alice') },
        at(12),
      )
      const both = yield* publishItem(
        two,
        { channel: 'offers', item: yield* signedItem('shared', 'alice', 'bob') },
        at(12),
      )
      const orphans = yield* itemsSignedOnlyBy(both, { channel: 'offers', keyid: keyid('alice') })
      expect([...orphans].sort()).toEqual(['dropped', 'kept'])

      const signature = yield* itemSignatureFor(draft('kept'), signerOf('bob'))
      const resigned = yield* addItemSignature(
        both,
        { channel: 'offers', id: 'kept', signature },
        at(13),
      )
      const revoked = yield* removeAuthor(
        resigned,
        { channel: 'offers', keyid: keyid('alice') },
        at(14),
      )

      expect(revoked.targets.signed.delegations.roles[1]?.keyids).toEqual([keyid('bob')])
      expect(revoked.targets.signed.delegations.keys[keyid('alice')]).toBeDefined()
      expect(Object.keys(revoked.items).sort()).toEqual([
        'channels/offers/kept.json',
        'channels/offers/shared.json',
      ])
      for (const bytes of Object.values(revoked.items)) {
        expect((yield* decodeItem(bytes)).sig.map((s) => s.keyid)).toEqual([keyid('bob')])
      }
    }),
  )

  it.effect('needs a remaining author to re-sign authors metadata the revoked author signed', () =>
    Effect.gen(function* () {
      const repo = yield* companyRepo
      const revoked = yield* removeAuthor(
        repo,
        { channel: 'offers', keyid: keyid('alice') },
        at(12),
      )
      const signed = yield* signAll(revoked, ['targets', 'master'], ['channels.offers', 'offers'])
      const issues = validateRepo(yield* publish(signed, repo, at(12)), { previous: repo })
      expect(issues.map((i) => i.file)).toEqual(['channels.offers.authors.json'])

      const renewed = yield* renewAuthors(repo, 'offers', at(12))
      const bobSigned = yield* signAll(renewed, ['channels.offers.authors', 'bob'])
      const ready = yield* removeAuthor(
        bobSigned,
        { channel: 'offers', keyid: keyid('alice') },
        at(12),
      )
      const final = yield* signAll(ready, ['targets', 'master'], ['channels.offers', 'offers'])
      expect(validateRepo(yield* publish(final, repo, at(12)), { previous: repo })).toEqual([])
    }),
  )

  it.effect('refuses removing the last author or one not listed', () =>
    Effect.gen(function* () {
      const repo = yield* companyRepo
      const one = yield* removeAuthor(repo, { channel: 'offers', keyid: keyid('alice') }, at(12))
      expect(
        yield* refusal(removeAuthor(one, { channel: 'offers', keyid: keyid('bob') }, at(12))),
      ).toBe('last-author')
      expect(
        yield* refusal(removeAuthor(repo, { channel: 'offers', keyid: keyid('carol') }, at(12))),
      ).toBe('author-not-listed')
    }),
  )

  it.effect('addItemSignature refuses non-authors and bad signatures', () =>
    Effect.gen(function* () {
      const { state } = yield* publishAs('kept', 'alice')
      const carol = yield* itemSignatureFor(draft('kept'), signerOf('carol'))
      expect(
        yield* refusal(
          addItemSignature(state, { channel: 'offers', id: 'kept', signature: carol }, at(13)),
        ),
      ).toBe('unauthorized-signer')
      const wrong = yield* itemSignatureFor(draft('other'), signerOf('bob'))
      expect(
        yield* refusal(
          addItemSignature(state, { channel: 'offers', id: 'kept', signature: wrong }, at(13)),
        ),
      ).toBe('bad-signature')
    }),
  )
})

describe('display and identity', () => {
  it.effect('editChannel replaces the display entry; editCompany switches logo kinds', () =>
    Effect.gen(function* () {
      const repo = yield* companyRepo
      const edited = yield* editChannel(repo, { channel: 'offers', description: 'Deals' }, at(12))
      expect(edited.targets.signed.custom.channels.offers).toEqual({ description: 'Deals' })
      expect(yield* refusal(editChannel(repo, { channel: 'nope' }, at(12)))).toBe('unknown-channel')

      const linked = yield* editCompany(
        repo,
        { logo: 'https://a/logo.png', logoSha256: 'cd'.repeat(32) },
        at(12),
      )
      expect(linked.targets.signed.custom.logo_sha256).toBe('cd'.repeat(32))
      const inline = yield* editCompany(
        linked,
        { logo: 'data:image/png;base64,AAAA', companyName: 'ACME 2' },
        at(13),
      )
      expect(inline.targets.signed.custom).toMatchObject({
        company_name: 'ACME 2',
        logo: 'data:image/png;base64,AAAA',
      })
      expect(inline.targets.signed.custom.logo_sha256).toBeUndefined()
      expect(inline.targets.signed.version).toBe(4)
      expect(yield* refusal(editCompany(repo, { logo: 'https://a/logo.png' }, at(12)))).toBe(
        'invalid-logo',
      )
    }),
  )
})

describe('renewals and freshness', () => {
  it.effect('renew bumps version and expiry without changing content', () =>
    Effect.gen(function* () {
      const repo = yield* companyRepo
      const targets = renewTargets(repo, at(20)).targets.signed
      expect([targets.version, targets.expires]).toEqual([3, '2027-10-26T20:00:00Z'])
      expect(targets.delegations).toEqual(repo.targets.signed.delegations)
      const channel = (yield* renewChannel(repo, 'offers', at(20))).channels.offers?.signed
      expect([channel?.version, channel?.expires]).toEqual([2, '2027-04-24T20:00:00Z'])
      const authors = (yield* renewAuthors(repo, 'offers', at(20))).authors.offers
      expect([authors?.signed.version, authors?.signatures]).toEqual([2, []])
    }),
  )

  it.effect(
    'snapshot pins every metadata file; a timestamp refresh changes only the timestamp',
    () =>
      Effect.gen(function* () {
        const repo = yield* companyRepo
        expect(Object.keys(repo.snapshot.signed.meta).sort()).toEqual([
          'channels.offers.authors.json',
          'channels.offers.json',
          'targets.json',
        ])
        expect(repo.snapshot.signed.meta['targets.json']?.hashes.sha256).toBe(
          sha256Hex(metadataFileBytes(repo.targets)),
        )
        const refreshed = yield* refreshTimestamp(repo, signerOf('ops'), at(23))
        expect(refreshed.snapshot).toBe(repo.snapshot)
        expect(refreshed.timestamp.signed.version).toBe(repo.timestamp.signed.version + 1)
        expect(refreshed.timestamp.signed.expires).toBe('2026-10-28T23:00:00Z')
        expect(validateRepo(refreshed, { previous: repo, now: at(23).now })).toEqual([])
      }),
  )

  it.effect('the same inputs build the same bytes', () =>
    Effect.gen(function* () {
      const a = repoFiles(yield* companyRepo)
      const b = repoFiles(yield* companyRepo)
      expect(a).toEqual(b)
      const item = yield* signedItem('x', 'alice')
      expect(encodeItem(item)).toEqual(encodeItem(item))
    }),
  )
})
