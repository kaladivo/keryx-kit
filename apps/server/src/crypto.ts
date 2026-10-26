import { fromHex, toBase64url, toHex, utf8 } from '@keryx-kit/domain'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { Context, Effect, Layer } from 'effect'
import { ServerConfig } from './config.ts'

export const randomBytes = (length: number): Uint8Array<ArrayBuffer> =>
  crypto.getRandomValues(new Uint8Array(length))

/** An unguessable id or token, base64url. */
export const randomToken = (bytes = 24): string => toBase64url(randomBytes(bytes))

export const sha256Hex = (value: string): string => toHex(sha256(utf8(value)))

const concat = (...parts: ReadonlyArray<Uint8Array>): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

export interface TrezorProof {
  readonly challengeHidden: string
  readonly challengeVisual: string
  readonly publicKey: string
  readonly signature: string
}

const bitcoinMessagePrefix = utf8('\x18Bitcoin Signed Message:\n')

/** SLIP-0013 with the Bitcoin sigtype, as `apps/spike/src/ownerLogin.ts` verifies it. */
export const loginDigest = (challengeHidden: string, challengeVisual: string): Uint8Array => {
  const challenge = concat(sha256(fromHex(challengeHidden)), sha256(utf8(challengeVisual)))
  return sha256(sha256(concat(bitcoinMessagePrefix, Uint8Array.of(challenge.length), challenge)))
}

/** The signature is header (27 + 4 + recovery id) ‖ r ‖ s. */
export const verifyTrezorLogin = (proof: TrezorProof): boolean => {
  try {
    const signature = fromHex(proof.signature)
    const publicKey = fromHex(proof.publicKey)
    const header = signature[0]
    if (signature.length !== 65 || header === undefined) return false
    const digest = loginDigest(proof.challengeHidden, proof.challengeVisual)
    const compact = signature.subarray(1)
    const recovered = secp256k1.recoverPublicKey(
      concat(Uint8Array.of((header - 27) & 3), compact),
      digest,
      { prehash: false },
    )
    return (
      secp256k1.verify(compact, digest, publicKey, { prehash: false }) &&
      toHex(recovered) === proof.publicKey
    )
  } catch {
    return false
  }
}

export interface Sealed {
  readonly iv: Uint8Array
  readonly ciphertext: Uint8Array
}

/** AES-256-GCM under the key-encryption key (mvp-spec §5.9). */
export class Vault extends Context.Service<
  Vault,
  {
    readonly seal: (plaintext: Uint8Array, aad: string) => Effect.Effect<Sealed>
    readonly open: (sealed: Sealed, aad: string) => Effect.Effect<Uint8Array>
  }
>()('keryx-kit/Vault') {}

export const vaultFromKey = (kek: Uint8Array) =>
  Effect.gen(function* () {
    if (kek.length !== 32) return yield* Effect.die(new Error('the KEK must be 32 bytes'))
    const key = yield* Effect.promise(() =>
      crypto.subtle.importKey('raw', new Uint8Array(kek), 'AES-GCM', false, ['encrypt', 'decrypt']),
    )
    return Vault.of({
      seal: (plaintext, aad) =>
        Effect.promise(async () => {
          const iv = randomBytes(12)
          const ciphertext = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv, additionalData: new Uint8Array(utf8(aad)) },
            key,
            new Uint8Array(plaintext),
          )
          return { iv, ciphertext: new Uint8Array(ciphertext) }
        }),
      open: (sealed, aad) =>
        Effect.promise(async () => {
          const plaintext = await crypto.subtle.decrypt(
            {
              name: 'AES-GCM',
              iv: new Uint8Array(sealed.iv),
              additionalData: new Uint8Array(utf8(aad)),
            },
            key,
            new Uint8Array(sealed.ciphertext),
          )
          return new Uint8Array(plaintext)
        }),
    })
  })

export const VaultLive = Layer.effect(Vault)(
  Effect.gen(function* () {
    const config = yield* ServerConfig
    const kek = yield* Effect.promise(() => Bun.file(config.kekFile).bytes())
    return yield* vaultFromKey(kek)
  }),
)
