/** Author key custody, exactly as mvp-spec §5.4 freezes it. */
import { fromBase64url, fromHex, publicKeyFromSeed, toBase64url, utf8 } from '@keryx-kit/domain'
import { ownBytes, randomBytes, wipe } from './bytes.ts'

/** Passed as `prf.eval.first`; the browser hashes it with the WebAuthn PRF context. */
export const PRF_INPUT = ownBytes(utf8('keryx/author-key/v1'))
const HKDF_INFO = ownBytes(utf8('keryx/author-key/v1/aes-256-gcm'))
const HKDF_SALT = new Uint8Array(32)

export interface WrappedSecret {
  readonly iv: Uint8Array
  readonly ciphertext: Uint8Array
}

export class AuthorKeyError extends Error {}

const wrappingKey = async (prfOutput: Uint8Array): Promise<CryptoKey> => {
  if (prfOutput.length !== 32)
    throw new AuthorKeyError(`The passkey returned ${prfOutput.length} PRF bytes instead of 32.`)
  const ikm = ownBytes(prfOutput)
  try {
    const hkdf = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveKey'])
    return await crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: HKDF_SALT, info: HKDF_INFO },
      hkdf,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    )
  } finally {
    wipe(ikm)
  }
}

/** The author public key is the AAD, so a ciphertext cannot be moved to another author. */
const gcm = (iv: Uint8Array, authorPublicKey: string) => ({
  name: 'AES-GCM',
  iv: ownBytes(iv),
  additionalData: ownBytes(fromHex(authorPublicKey)),
})

export const generateAuthorKey = (): { seed: Uint8Array<ArrayBuffer>; publicKey: string } => {
  const seed = randomBytes(32)
  return { seed, publicKey: publicKeyFromSeed(seed) }
}

export const wrapAuthorKey = async (
  prfOutput: Uint8Array,
  seed: Uint8Array,
  authorPublicKey: string,
): Promise<WrappedSecret> => {
  const key = await wrappingKey(prfOutput)
  const iv = randomBytes(12)
  const plaintext = ownBytes(seed)
  try {
    const sealed = await crypto.subtle.encrypt(gcm(iv, authorPublicKey), key, plaintext)
    return { iv, ciphertext: new Uint8Array(sealed) }
  } finally {
    wipe(plaintext)
  }
}

/** Unwraps and checks the seed really belongs to `authorPublicKey`. Caller wipes the result. */
export const unwrapAuthorKey = async (
  prfOutput: Uint8Array,
  wrapped: WrappedSecret,
  authorPublicKey: string,
): Promise<Uint8Array<ArrayBuffer>> => {
  const key = await wrappingKey(prfOutput)
  let seed: Uint8Array<ArrayBuffer>
  try {
    const opened = await crypto.subtle.decrypt(
      gcm(wrapped.iv, authorPublicKey),
      key,
      ownBytes(wrapped.ciphertext),
    )
    seed = new Uint8Array(opened)
  } catch {
    throw new AuthorKeyError(
      'This passkey cannot open your author key. Pick the passkey you registered with.',
    )
  }
  if (publicKeyFromSeed(seed) !== authorPublicKey) {
    wipe(seed)
    throw new AuthorKeyError('The unwrapped key does not match your author public key.')
  }
  return seed
}

export const wrappedToWire = (wrapped: WrappedSecret) => ({
  iv: toBase64url(wrapped.iv),
  ciphertext: toBase64url(wrapped.ciphertext),
})

export const wrappedFromWire = (wire: { iv: string; ciphertext: string }): WrappedSecret => ({
  iv: fromBase64url(wire.iv),
  ciphertext: fromBase64url(wire.ciphertext),
})
