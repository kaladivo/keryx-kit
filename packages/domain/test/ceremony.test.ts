import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import {
  attachRoleSignature,
  attachSignature,
  authorityOf,
  bytesEqual,
  createChannel,
  parseRepoFiles,
  repoFiles,
  signatureFor,
  signingBytes,
  utf8,
  validateRepo,
} from '../src/index.ts'
import { authorKey, publicOf, signerOf } from './keys.ts'
import { at, companyRepo, publish, signAll } from './support.ts'

const refusalCode = <A>(effect: Effect.Effect<A, { readonly code: string }>) =>
  Effect.map(Effect.flip(effect), (error) => error.code)

const intent = {
  channel: 'security',
  displayName: 'Security',
  channelKey: publicOf('security'),
  authors: [authorKey('carol')],
}

describe('ceremony: the server builds, the browser rebuilds and signs (§5.5)', () => {
  it.effect('the browser rebuild matches the server bytes and its signature applies', () =>
    Effect.gen(function* () {
      const published = yield* companyRepo
      const server = yield* createChannel(published, intent, at(12))

      const fetched = yield* parseRepoFiles(repoFiles(published))
      const browser = yield* createChannel(fetched, intent, at(12))
      expect(bytesEqual(signingBytes(browser.targets), signingBytes(server.targets))).toBe(true)

      const signature = yield* signatureFor(browser.targets, signerOf('master'))
      const staged = yield* attachRoleSignature(server, 'targets', signature)
      const live = yield* signAll(
        staged,
        ['channels.security', 'security'],
        ['channels.security.authors', 'carol'],
      )
      expect(
        validateRepo(yield* publish(live, published, at(12)), { previous: published }),
      ).toEqual([])
    }),
  )

  it.effect('a different intent or clock gives different signed bytes', () =>
    Effect.gen(function* () {
      const published = yield* companyRepo
      const server = yield* createChannel(published, intent, at(12))
      const otherName = yield* createChannel(published, { ...intent, displayName: 'Sec' }, at(12))
      const otherTime = yield* createChannel(published, intent, at(13))
      expect(bytesEqual(signingBytes(server.targets), signingBytes(otherName.targets))).toBe(false)
      expect(bytesEqual(signingBytes(server.targets), signingBytes(otherTime.targets))).toBe(false)
    }),
  )

  it.effect('refuses signatures by unauthorized keys or over other bytes', () =>
    Effect.gen(function* () {
      const published = yield* companyRepo
      const server = yield* createChannel(published, intent, at(12))
      const byOps = yield* signatureFor(server.targets, signerOf('ops'))
      expect(yield* refusalCode(attachRoleSignature(server, 'targets', byOps))).toBe(
        'unauthorized-signer',
      )
      const stale = yield* signatureFor(published.targets, signerOf('master'))
      expect(yield* refusalCode(attachRoleSignature(server, 'targets', stale))).toBe(
        'bad-signature',
      )
      const byAlice = yield* signatureFor(
        server.authors.security ?? published.targets,
        signerOf('alice'),
      )
      expect(
        yield* refusalCode(attachRoleSignature(server, 'channels.security.authors', byAlice)),
      ).toBe('unauthorized-signer')
    }),
  )
})

describe('malformed signatures', () => {
  it.effect('attachSignature and attachRoleSignature refuse non-hex or wrong-length sigs', () =>
    Effect.gen(function* () {
      const published = yield* companyRepo
      const server = yield* createChannel(published, intent, at(12))
      const authority = authorityOf(server, 'targets')
      if (!authority) throw new Error('fixture')
      const valid = yield* signatureFor(server.targets, signerOf('master'))
      for (const sig of ['zz'.repeat(64), valid.sig.slice(0, 126), `${valid.sig}00`, 'abc', '']) {
        const signature = { keyid: valid.keyid, sig }
        expect(yield* refusalCode(attachRoleSignature(server, 'targets', signature))).toBe(
          'bad-signature',
        )
        expect(yield* refusalCode(attachSignature(server.targets, signature, authority))).toBe(
          'bad-signature',
        )
      }
    }),
  )
})

describe('repo files', () => {
  it.effect('splits the anchor (all roots) from the base (no root files) and parses back', () =>
    Effect.gen(function* () {
      const repo = yield* companyRepo
      const files = repoFiles(repo)
      expect(Object.keys(files.anchor).sort()).toEqual(['1.root.json', 'root.json'])
      expect(Object.keys(files.base).sort()).toEqual([
        'channels.offers.authors.json',
        'channels.offers.json',
        'snapshot.json',
        'targets.json',
        'timestamp.json',
      ])
      expect(repoFiles(yield* parseRepoFiles(files))).toEqual(files)
    }),
  )

  it.effect('refuses files not in the go-tuf encoding or with unknown fields', () =>
    Effect.gen(function* () {
      const files = repoFiles(yield* companyRepo)
      const reindented = JSON.stringify(
        JSON.parse(new TextDecoder().decode(files.base['targets.json'])),
        null,
        2,
      )
      const withExtra = (() => {
        const doc = JSON.parse(new TextDecoder().decode(files.base['targets.json']))
        doc.signed.extra = true
        return JSON.stringify(doc)
      })()
      for (const targets of [reindented, withExtra]) {
        const broken = { ...files, base: { ...files.base, 'targets.json': utf8(targets) } }
        expect(yield* refusalCode(parseRepoFiles(broken))).toBe('invalid-repo')
      }
    }),
  )
})
