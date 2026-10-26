import { applyOperation, type Operation } from '@keryx-kit/api'
import { attachRoleSignature, signingBytes, toBase64url, utf8 } from '@keryx-kit/domain'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { reviewCeremony, signCeremony } from '../src/lib/ceremony.ts'
import { WrongWallet } from '../src/lib/masterKey.ts'
import { ceremonyFor, keyidOfName, member, publicOf, publishedRepo, seedOf } from './repo.ts'

const jana = member('jana', 'author-1')
const petr = member('petr', 'author-2')
const members = [jana, petr]
const assign: Operation = {
  _tag: 'assignAuthor',
  now: '2026-10-27T10:00:00.000Z',
  params: { channel: 'offers', author: { publicKey: petr.authorPublicKey, name: 'author-2' } },
}
const intent = { _tag: 'AssignAuthor', channel: 'offers', memberId: petr.id } as const

const honestCeremony = (operation: Operation = assign) => {
  const repo = publishedRepo()
  const next = Effect.runSync(applyOperation(repo, operation))
  return ceremonyFor(repo, intent, operation, [
    {
      role: 'targets',
      keyids: [keyidOfName('master')],
      signingBytes: toBase64url(signingBytes(next.targets)),
    },
  ])
}

const review = (ceremony: ReturnType<typeof honestCeremony>) =>
  Effect.runSync(Effect.result(reviewCeremony(ceremony, members)))

describe('ceremony rebuild and compare', () => {
  it('accepts matching bytes and summarizes its own rebuild with the key fingerprint', () => {
    const result = review(honestCeremony())
    expect(result._tag).toBe('Success')
    if (result._tag !== 'Success') return
    const { lines, checks } = result.success
    expect(checks).toMatchObject([{ role: 'targets', file: 'targets.json', version: 3 }])
    expect(lines[0]?.text).toBe('Add petr as author of Offers')
    expect(lines[0]?.keys?.[0]).toMatchObject({
      label: 'author-2',
      fingerprint: keyidOfName('petr').slice(0, 20).match(/.{4}/g)?.join(' '),
    })
  })

  it('refuses when the server sends different bytes than the browser builds', () => {
    const lying = honestCeremony()
    const forged = { ...lying.toSign[0], signingBytes: toBase64url(utf8('{"forged":true}')) }
    const result = review({ ...lying, toSign: [forged as (typeof lying.toSign)[number]] })
    expect(result._tag).toBe('Failure')
    if (result._tag === 'Failure')
      expect(result.failure.reason).toMatch(/different targets\.json bytes/)
  })

  it('refuses when the server swaps in another key than the member it names', () => {
    const swapped: Operation = {
      ...assign,
      params: { channel: 'offers', author: { publicKey: publicOf('attacker'), name: 'author-2' } },
    }
    const result = review(honestCeremony(swapped))
    expect(result._tag).toBe('Failure')
  })

  it('refuses a base whose metadata does not verify', () => {
    const ceremony = honestCeremony()
    const targets = JSON.parse(ceremony.base.base['targets.json'] ?? '{}')
    targets.signatures[0].sig = '0'.repeat(128)
    const tampered = {
      ...ceremony,
      base: {
        ...ceremony.base,
        base: { ...ceremony.base.base, 'targets.json': JSON.stringify(targets, null, '\t') },
      },
    }
    expect(review(tampered)._tag).toBe('Failure')
  })
})

describe('targets.json rollback', () => {
  it('shows the base version and refuses a base older than one this browser saw', () => {
    const ceremony = honestCeremony()
    const seen = Effect.runSync(Effect.result(reviewCeremony(ceremony, members, 2)))
    expect(seen._tag).toBe('Success')
    if (seen._tag === 'Success') {
      expect(seen.success.baseVersion).toBe(2)
      expect(seen.success.lines.at(-1)?.detail).toBe(
        'Built on the published targets.json version 2.',
      )
    }
    const rolledBack = Effect.runSync(Effect.result(reviewCeremony(ceremony, members, 3)))
    expect(rolledBack._tag).toBe('Failure')
    if (rolledBack._tag === 'Failure')
      expect(rolledBack.failure.reason).toMatch(/version 2, older than version 3/)
  })
})

describe('master keyid check', () => {
  it('signs with the published master key and the signature attaches', () => {
    const ceremony = honestCeremony()
    const result = review(ceremony)
    if (result._tag !== 'Success') throw new Error('review failed')
    const [signature] = Effect.runSync(signCeremony(result.success, seedOf('master')))
    expect(signature?.role).toBe('targets')
    const attached = Effect.runSync(
      Effect.result(
        attachRoleSignature(
          result.success.state,
          'targets',
          signature?.signature ?? { keyid: '', sig: '' },
        ),
      ),
    )
    expect(attached._tag).toBe('Success')
  })

  it('refuses a seed from another Suite wallet before signing', () => {
    const result = review(honestCeremony())
    if (result._tag !== 'Success') throw new Error('review failed')
    const signed = Effect.runSync(
      Effect.result(signCeremony(result.success, seedOf('hidden wallet'))),
    )
    expect(signed._tag).toBe('Failure')
    if (signed._tag === 'Failure') {
      expect(signed.failure).toBeInstanceOf(WrongWallet)
      expect(signed.failure.message).toMatch(
        /Switch Trezor Suite to the wallet you used at sign-up/,
      )
    }
  })
})
