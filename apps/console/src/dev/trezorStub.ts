/**
 * Dev-only stand-in for Trezor Connect (loaded only when `__TREZOR_STUB__`). It signs
 * with fixed test keys, so the real server's checks pass: the login is a real SLIP-0013
 * signature (as `apps/spike/src/ownerLogin.ts` verifies it) and the master seed is a real
 * Ed25519 seed. Set `localStorage['keryx-stub-wallet'] = 'hidden'` to act like a
 * passphrase wallet.
 */
import { fromHex, toHex, utf8 } from '@keryx-kit/domain'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import type { TrezorClient } from '../lib/trezor.ts'

const identityKey = sha256(utf8('keryx-kit stub trezor identity'))

export const STUB_IDENTITY_KEY = toHex(secp256k1.getPublicKey(identityKey, true))

export const stubMasterSeedHex = (label: string, wallet = 'standard'): string =>
  toHex(sha256(utf8(`keryx-kit stub trezor/${wallet}/${label}`)))

const concat = (...parts: ReadonlyArray<Uint8Array>): Uint8Array =>
  Uint8Array.from(parts.flatMap((part) => [...part]))

/** SHA-256d("\x18Bitcoin Signed Message:\n" ‖ len ‖ SHA-256(hidden) ‖ SHA-256(visual)). */
const loginDigest = (challengeHidden: string, challengeVisual: string): Uint8Array => {
  const challenge = concat(sha256(fromHex(challengeHidden)), sha256(utf8(challengeVisual)))
  const prefix = utf8('\x18Bitcoin Signed Message:\n')
  const message = concat(prefix, Uint8Array.of(challenge.length), challenge)
  return sha256(sha256(message))
}

const signLogin = (challengeHidden: string, challengeVisual: string): string => {
  const digest = loginDigest(challengeHidden, challengeVisual)
  const [recovery = 0, ...compact] = secp256k1.sign(digest, identityKey, {
    prehash: false,
    format: 'recovered',
  })
  // Trezor's header for a compressed key: 27 + 4 + recovery id.
  return toHex(Uint8Array.of(31 + recovery, ...compact))
}

const wallet = (): string => {
  try {
    return localStorage.getItem('keryx-stub-wallet') ?? 'standard'
  } catch {
    return 'standard'
  }
}

const deviceDelay = () => new Promise((resolve) => setTimeout(resolve, 400))

export const stubTrezor = (): TrezorClient => ({
  requestLogin: async ({ challengeHidden, challengeVisual }) => {
    await deviceDelay()
    return {
      publicKey: STUB_IDENTITY_KEY,
      signature: signLogin(challengeHidden, challengeVisual),
    }
  },
  cipherKeyValue: async (bundle) => {
    await deviceDelay()
    return bundle.map((derivation) => stubMasterSeedHex(derivation.key, wallet()))
  },
})
