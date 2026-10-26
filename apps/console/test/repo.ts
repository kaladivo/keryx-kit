import { type Ceremony, type Member, type Operation, repoFilesToText } from '@keryx-kit/api'
import {
  attachRoleSignature,
  createChannel,
  ed25519Key,
  fromHex,
  initRepo,
  keyidOf,
  publicKeyFromSeed,
  type Repo,
  repoFiles,
  seedSigner,
  sha256Hex,
  signatureFor,
  signRole,
  utf8,
  withFreshness,
} from '@keryx-kit/domain'
import { Effect } from 'effect'

export const seedOf = (name: string) => fromHex(sha256Hex(utf8(`console-test/${name}`)))
export const publicOf = (name: string) => publicKeyFromSeed(seedOf(name))
export const keyidOfName = (name: string) => keyidOf(ed25519Key(publicOf(name)))

const now = new Date('2026-10-26T10:00:00Z')

export const member = (name: string, label: string): typeof Member.Type => ({
  id: `m-${name}`,
  name,
  keyLabel: label,
  keyid: keyidOfName(name),
  authorPublicKey: publicOf(name),
  registeredAt: now.toISOString(),
  channels: [],
})

/** A published repo with channel `offers` authored by Jana. */
export const publishedRepo = (): Repo =>
  Effect.runSync(
    Effect.gen(function* () {
      const master = seedSigner(seedOf('master'))
      let s = yield* initRepo(
        {
          repoBase: 'https://repo.test/acme/',
          companyName: 'ACME',
          masterKey: publicOf('master'),
          opsKey: publicOf('ops'),
        },
        { now },
      )
      s = yield* attachRoleSignature(
        s,
        'root',
        yield* signatureFor(s.roots[0] ?? s.targets, master),
      )
      s = yield* createChannel(
        s,
        {
          channel: 'offers',
          displayName: 'Offers',
          channelKey: publicOf('offers'),
          authors: [{ publicKey: publicOf('jana'), name: 'author-1' }],
        },
        { now },
      )
      s = yield* signRole(s, 'targets', master)
      s = yield* signRole(s, 'channels.offers', seedSigner(seedOf('offers')))
      s = yield* signRole(s, 'channels.offers.authors', seedSigner(seedOf('jana')))
      return yield* withFreshness(s, undefined, seedSigner(seedOf('ops')), { now })
    }),
  )

export const ceremonyFor = (
  repo: Repo,
  intent: (typeof Ceremony.Type)['intent'],
  operation: Operation,
  toSign: (typeof Ceremony.Type)['toSign'],
): typeof Ceremony.Type => ({
  id: 'c1',
  intent,
  summary: 'server words',
  status: 'awaiting-owner',
  missing: [],
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
  base: repoFilesToText(repoFiles(repo)),
  operation,
  toSign,
})
