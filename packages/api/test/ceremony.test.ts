import { describe, expect, it } from '@effect/vitest'
import {
  attachRoleSignature,
  bytesEqual,
  ed25519Key,
  fromBase64url,
  fromHex,
  initRepo,
  keyidOf,
  publicKeyFromSeed,
  type RepoState,
  repoFiles,
  seedSigner,
  sha256Hex,
  signatureFor,
  signingBytes,
  signRole,
  toBase64url,
  utf8,
  validateRepo,
  withFreshness,
} from '@keryx-kit/domain'
import { Effect, Schema } from 'effect'
import {
  AuthorTask,
  applyOperation,
  Ceremony,
  type Operation,
  rebuild,
  repoFilesToText,
  SignupStarted,
} from '../src/index.ts'

const seedOf = (name: string) => fromHex(sha256Hex(utf8(`keryx-kit-api-test/${name}`)))
const signerOf = (name: string) => seedSigner(seedOf(name))
const publicOf = (name: string) => publicKeyFromSeed(seedOf(name))
const keyid = (name: string) => keyidOf(ed25519Key(publicOf(name)))

/** What the browser decodes after the response crossed the wire as JSON. */
const overTheWire = <S extends Schema.Codec<unknown, unknown>>(schema: S, value: S['Type']) =>
  Schema.decodeUnknownSync(schema)(JSON.parse(JSON.stringify(Schema.encodeSync(schema)(value))))

const unsignedBytes = (state: RepoState, role: 'targets' | 'channels.offers.authors') =>
  toBase64url(
    signingBytes(role === 'targets' ? state.targets : (state.authors.offers ?? state.targets)),
  )

describe('the ceremony contract fits @keryx-kit/domain', () => {
  it.effect('sign-up, then create a channel that goes live after its author signs', () =>
    Effect.gen(function* () {
      // Sign-up: the server hands out the ops key and clock, the browser builds and signs.
      const started = overTheWire(SignupStarted, {
        signupId: 's1',
        challenge: { challengeHidden: '0'.repeat(64), challengeVisual: '2026-10-26 10:00:00' },
        init: {
          now: '2026-10-26T10:00:00.000Z',
          params: {
            repoBase: 'https://repo.test/acme/',
            companyName: 'ACME',
            opsKey: publicOf('ops'),
          },
        },
        expiresAt: '2026-10-26T11:00:00.000Z',
      })
      const init = { ...started.init.params, masterKey: publicOf('master') }
      const timing = { now: new Date(started.init.now) }
      const browserInit = yield* initRepo(init, timing)
      const rootSig = yield* signatureFor(
        browserInit.roots[0] ?? browserInit.targets,
        signerOf('master'),
      )
      const targetsSig = yield* signatureFor(browserInit.targets, signerOf('master'))

      const serverInit = yield* initRepo(init, timing)
      const signedInit = yield* attachRoleSignature(
        yield* attachRoleSignature(serverInit, 'root', rootSig),
        'targets',
        targetsSig,
      )
      const published = yield* withFreshness(signedInit, undefined, signerOf('ops'), timing)
      expect(validateRepo(published)).toEqual([])

      // Owner ceremony: create channel `offers` with one author.
      const operation: Operation = {
        _tag: 'createChannel',
        now: '2026-10-26T11:00:00.000Z',
        params: {
          channel: 'offers',
          displayName: 'Offers',
          channelKey: publicOf('offers'),
          authors: [{ publicKey: publicOf('jana'), name: 'author-1' }],
        },
      }
      const serverChange = yield* applyOperation(published, operation)
      const ceremony = overTheWire(Ceremony, {
        id: 'c1',
        intent: {
          _tag: 'CreateChannel',
          channel: 'offers',
          displayName: 'Offers',
          description: '',
          authors: ['m1'],
        },
        summary: 'Create channel Offers with author Jana',
        status: 'awaiting-owner',
        missing: [],
        createdAt: operation.now,
        updatedAt: operation.now,
        base: repoFilesToText(repoFiles(published)),
        operation,
        toSign: [
          {
            role: 'targets',
            keyids: [keyid('master')],
            signingBytes: unsignedBytes(serverChange, 'targets'),
          },
        ],
      })

      const browserChange = yield* rebuild(ceremony.base, ceremony.operation)
      const request = ceremony.toSign[0]
      expect(request).toBeDefined()
      expect(
        bytesEqual(signingBytes(browserChange.targets), fromBase64url(request?.signingBytes ?? '')),
      ).toBe(true)
      const ownerSig = yield* signatureFor(browserChange.targets, signerOf('master'))

      const staged = yield* signRole(
        yield* attachRoleSignature(serverChange, 'targets', ownerSig),
        'channels.offers',
        signerOf('offers'),
      )
      expect(validateRepo(staged).map((issue) => [issue.code, issue.file])).toEqual([
        ['signature-threshold', 'channels.offers.authors.json'],
      ])

      // Author task: Jana's console rebuilds the staged channel and signs authors v1.
      const task = overTheWire(AuthorTask, {
        _tag: 'SignAuthorsMetadata',
        id: 't1',
        channel: 'offers',
        reason: 'new-channel',
        ceremonyId: 'c1',
        base: ceremony.base,
        operation,
        toSign: {
          role: 'channels.offers.authors',
          keyids: [keyid('jana')],
          signingBytes: unsignedBytes(serverChange, 'channels.offers.authors'),
        },
      })
      if (task._tag !== 'SignAuthorsMetadata') throw new Error('unexpected task')
      const authorView = yield* rebuild(task.base, task.operation)
      const authors = authorView.authors[task.channel]
      expect(authors).toBeDefined()
      expect(
        bytesEqual(
          signingBytes(authors ?? authorView.targets),
          fromBase64url(task.toSign.signingBytes),
        ),
      ).toBe(true)
      const authorSig = yield* signatureFor(authors ?? authorView.targets, signerOf('jana'))

      const live = yield* withFreshness(
        yield* attachRoleSignature(staged, 'channels.offers.authors', authorSig),
        published,
        signerOf('ops'),
        { now: new Date(operation.now) },
      )
      expect(validateRepo(live, { previous: published })).toEqual([])
      expect(live.targets.signed.delegations.keys[keyid('jana')]?.name).toBe('author-1')
    }),
  )
})
