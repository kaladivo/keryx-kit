import { describe, expect, it } from 'vitest'
import {
  AuthorKeyError,
  generateAuthorKey,
  unwrapAuthorKey,
  wrapAuthorKey,
  wrappedFromWire,
  wrappedToWire,
} from '../src/lib/authorKey.ts'

const prf = Uint8Array.from({ length: 32 }, (_, i) => i)

describe('author key wrapping (mvp-spec §5.4)', () => {
  it('round-trips through the wire format', async () => {
    const { seed, publicKey } = generateAuthorKey()
    const wire = wrappedToWire(await wrapAuthorKey(prf, seed, publicKey))
    expect(wire.iv).toHaveLength(16)
    expect(wire.ciphertext).toHaveLength(64)
    const opened = await unwrapAuthorKey(prf, wrappedFromWire(wire), publicKey)
    expect(opened).toEqual(seed)
  })

  it('binds the ciphertext to the author public key (AAD)', async () => {
    const jana = generateAuthorKey()
    const petr = generateAuthorKey()
    const wrapped = await wrapAuthorKey(prf, jana.seed, jana.publicKey)
    await expect(unwrapAuthorKey(prf, wrapped, petr.publicKey)).rejects.toBeInstanceOf(
      AuthorKeyError,
    )
  })

  it('refuses another passkey (different PRF output)', async () => {
    const { seed, publicKey } = generateAuthorKey()
    const wrapped = await wrapAuthorKey(prf, seed, publicKey)
    const other = prf.map((b) => b ^ 1)
    await expect(unwrapAuthorKey(other, wrapped, publicKey)).rejects.toThrow(/cannot open/)
  })

  it('refuses to wrap with an all-zero PRF output, e.g. one already wiped', async () => {
    const { seed, publicKey } = generateAuthorKey()
    await expect(wrapAuthorKey(new Uint8Array(32), seed, publicKey)).rejects.toThrow(/empty PRF/)
  })

  it('refuses a PRF output of the wrong length', async () => {
    const { seed, publicKey } = generateAuthorKey()
    await expect(wrapAuthorKey(prf.slice(0, 16), seed, publicKey)).rejects.toThrow(/16 PRF bytes/)
  })

  it('leaves the caller seed intact', async () => {
    const { seed, publicKey } = generateAuthorKey()
    const before = Array.from(seed)
    await wrapAuthorKey(prf, seed, publicKey)
    expect(Array.from(seed)).toEqual(before)
  })
})
