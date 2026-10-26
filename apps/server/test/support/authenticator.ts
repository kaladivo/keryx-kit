/** A software passkey (ES256, attestation "none") so tests run real WebAuthn verification. */
import type {
  AuthenticationCredential,
  CreationOptions,
  RegistrationCredential,
  RequestOptions,
} from '@keryx-kit/api'
import { toBase64url, utf8 } from '@keryx-kit/domain'
import { p256 } from '@noble/curves/nist.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { isoCBOR } from '@simplewebauthn/server/helpers'

const concat = (...parts: ReadonlyArray<Uint8Array>): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

const u32 = (n: number) =>
  Uint8Array.of((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255)

const UP = 0x01
const UV = 0x04
const AT = 0x40

interface Passkey {
  readonly secretKey: Uint8Array
  readonly rpId: string
  counter: number
}

export class Authenticator {
  readonly passkeys = new Map<string, Passkey>()

  constructor(readonly origin: string) {}

  create(options: typeof CreationOptions.Type): typeof RegistrationCredential.Type {
    const secretKey = p256.utils.randomSecretKey()
    const publicKey = p256.getPublicKey(secretKey, false)
    const credentialId = crypto.getRandomValues(new Uint8Array(16))
    const id = toBase64url(credentialId)
    const cose = new Map<number, number | Uint8Array>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, publicKey.slice(1, 33)],
      [-3, publicKey.slice(33, 65)],
    ])
    const authData = concat(
      sha256(utf8(options.rp.id)),
      Uint8Array.of(UP | UV | AT),
      u32(0),
      new Uint8Array(16),
      Uint8Array.of(0, credentialId.length),
      credentialId,
      isoCBOR.encode(cose),
    )
    const attestationObject = isoCBOR.encode(
      new Map<string, string | Map<string, never> | Uint8Array>([
        ['fmt', 'none'],
        ['attStmt', new Map<string, never>()],
        ['authData', authData],
      ]),
    )
    const clientData = utf8(
      JSON.stringify({
        type: 'webauthn.create',
        challenge: options.challenge,
        origin: this.origin,
      }),
    )
    this.passkeys.set(id, { secretKey, rpId: options.rp.id, counter: 0 })
    return {
      id,
      rawId: id,
      type: 'public-key',
      response: {
        clientDataJSON: toBase64url(clientData),
        attestationObject: toBase64url(attestationObject),
        transports: ['internal'],
      },
      clientExtensionResults: { prf: { enabled: true } },
      authenticatorAttachment: 'platform',
    }
  }

  /** A discoverable assertion with the given passkey (the first one by default). */
  get(
    options: typeof RequestOptions.Type,
    credentialId?: string,
  ): typeof AuthenticationCredential.Type {
    const id = credentialId ?? [...this.passkeys.keys()][0] ?? ''
    const passkey = this.passkeys.get(id)
    if (!passkey) throw new Error('no passkey')
    passkey.counter += 1
    const authData = concat(
      sha256(utf8(passkey.rpId)),
      Uint8Array.of(UP | UV),
      u32(passkey.counter),
    )
    const clientData = utf8(
      JSON.stringify({ type: 'webauthn.get', challenge: options.challenge, origin: this.origin }),
    )
    const signature = p256.sign(concat(authData, sha256(clientData)), passkey.secretKey, {
      format: 'der',
    })
    return {
      id,
      rawId: id,
      type: 'public-key',
      response: {
        clientDataJSON: toBase64url(clientData),
        authenticatorData: toBase64url(authData),
        signature: toBase64url(signature),
      },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
    }
  }
}
