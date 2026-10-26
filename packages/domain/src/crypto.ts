import { getPublicKey, hashes, sign, verify } from '@noble/ed25519'
import { sha512 } from '@noble/hashes/sha2.js'
import { Effect } from 'effect'
import { fromHex, sha256Hex, toHex, utf8 } from './bytes.ts'
import { SigningFailed } from './errors.ts'
import { canonicalJson } from './json.ts'
import type { Key } from './schema.ts'

hashes.sha512 = sha512

/** TUF key object; `name` is the Go SDK's label and does not enter the keyid. */
export const ed25519Key = (publicKeyHex: string, name?: string): Key => ({
  keytype: 'ed25519',
  scheme: 'ed25519',
  keyval: { public: publicKeyHex },
  ...(name === undefined ? {} : { name }),
})

/** SHA-256 of the canonical `{keytype, scheme, keyval}` (spec/core.md §1). */
export const keyidOf = (key: Key): string =>
  sha256Hex(utf8(canonicalJson({ keytype: key.keytype, scheme: key.scheme, keyval: key.keyval })))

export const publicKeyFromSeed = (seed: Uint8Array): string => toHex(getPublicKey(seed))

/** Strict RFC 8032 verification, matching Go's crypto/ed25519. */
export const verifyEd25519 = (
  signature: Uint8Array,
  message: Uint8Array,
  publicKeyHex: string,
): boolean => {
  try {
    return verify(signature, message, fromHex(publicKeyHex), { zip215: false })
  } catch {
    return false
  }
}

/**
 * Anything that turns bytes into an Ed25519 signature for one keyid: a server-held
 * key, an author key unwrapped in the browser, a Trezor-derived master key.
 */
export interface Signer {
  readonly keyid: string
  readonly sign: (message: Uint8Array) => Effect.Effect<Uint8Array, SigningFailed>
}

/** A signer over a raw 32-byte Ed25519 seed. */
export const seedSigner = (seed: Uint8Array): Signer => {
  const keyid = keyidOf(ed25519Key(publicKeyFromSeed(seed)))
  return {
    keyid,
    sign: (message) =>
      Effect.try({
        try: () => sign(message, seed),
        catch: (cause) => new SigningFailed({ keyid, cause }),
      }),
  }
}
