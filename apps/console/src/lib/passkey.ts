/**
 * WebAuthn with the PRF extension (mvp-spec §5.4). Credentials are serialized by hand
 * instead of `toJSON()` so the PRF output can never end up in a request body.
 */
import type {
  AuthenticationCredential,
  CreationOptions,
  RegistrationCredential,
  RequestOptions,
} from '@keryx-kit/api'
import { fromBase64url, toBase64url } from '@keryx-kit/domain'
import { PRF_INPUT } from './authorKey.ts'
import { ownBytes, randomBytes } from './bytes.ts'
import { prfEnabled, prfFirst } from './prf.ts'

export const SUPPORTED_SETUPS = [
  'Chrome or Edge 118+ with Google Password Manager, on desktop or Android',
  'Safari 18+ on macOS 15 or iOS 18 with iCloud Keychain',
  '1Password (browser extension 8.10.48+)',
  'A FIDO2 security key with hmac-secret, such as a YubiKey 5',
] as const

export class PasskeyError extends Error {}

export class PrfUnsupported extends PasskeyError {
  constructor() {
    super(
      'This browser or passkey provider does not support the PRF extension, which keeps your signing key encrypted. Registration stopped and nothing was saved.',
    )
  }
}

const bytes = (text: string) => ownBytes(fromBase64url(text))
const encode = (buffer: ArrayBuffer | ArrayBufferView) =>
  toBase64url(
    ArrayBuffer.isView(buffer)
      ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
      : new Uint8Array(buffer),
  )

const attachment = (
  credential: PublicKeyCredential,
): { authenticatorAttachment?: 'platform' | 'cross-platform' } => {
  const value = credential.authenticatorAttachment
  return value === 'platform' || value === 'cross-platform'
    ? { authenticatorAttachment: value }
    : {}
}

/** `false` when the browser says PRF is unsupported; `undefined` when it cannot tell. */
export const prfSupport = async (): Promise<boolean | undefined> => {
  if (typeof PublicKeyCredential === 'undefined' || !navigator.credentials) return false
  const capabilities = (
    PublicKeyCredential as unknown as {
      getClientCapabilities?: () => Promise<Record<string, boolean | undefined>>
    }
  ).getClientCapabilities
  if (!capabilities) return undefined
  try {
    return (await capabilities.call(PublicKeyCredential))['extension:prf']
  } catch {
    return undefined
  }
}

const asPublicKeyCredential = (credential: Credential | null): PublicKeyCredential => {
  if (credential === null || credential.type !== 'public-key')
    throw new PasskeyError('No passkey was returned.')
  return credential as PublicKeyCredential
}

const cancelled = (error: unknown): never => {
  if (error instanceof DOMException && error.name === 'NotAllowedError')
    throw new PasskeyError('The passkey prompt was closed or timed out. Try again.')
  if (error instanceof DOMException && error.name === 'InvalidStateError')
    throw new PasskeyError('This device already has a passkey for this invite.')
  throw error
}

export interface CreatedPasskey {
  readonly credential: typeof RegistrationCredential.Type
  readonly credentialId: string
  /** Present when the authenticator evaluated PRF during creation (saves one prompt). */
  readonly prf: Uint8Array<ArrayBuffer> | undefined
}

export const createPasskey = async (
  options: typeof CreationOptions.Type,
): Promise<CreatedPasskey> => {
  const publicKey: PublicKeyCredentialCreationOptions = {
    challenge: bytes(options.challenge),
    rp: options.rp,
    user: { ...options.user, id: bytes(options.user.id) },
    pubKeyCredParams: [...options.pubKeyCredParams],
    authenticatorSelection: { ...options.authenticatorSelection },
    ...(options.timeout === undefined ? {} : { timeout: options.timeout }),
    ...(options.attestation === undefined ? {} : { attestation: options.attestation }),
    excludeCredentials: (options.excludeCredentials ?? []).map((descriptor) => ({
      type: descriptor.type,
      id: bytes(descriptor.id),
    })),
    extensions: { prf: { eval: { first: PRF_INPUT } } },
  }
  const credential = asPublicKeyCredential(
    await navigator.credentials.create({ publicKey }).catch(cancelled),
  )
  const extensions = credential.getClientExtensionResults()
  if (!prfEnabled(extensions)) throw new PrfUnsupported()
  const response = credential.response as AuthenticatorAttestationResponse
  const publicKeyBytes = response.getPublicKey?.()
  const credentialId = encode(credential.rawId)
  return {
    credentialId,
    prf: prfFirst(extensions),
    credential: {
      id: credentialId,
      rawId: credentialId,
      type: 'public-key',
      response: {
        clientDataJSON: encode(response.clientDataJSON),
        attestationObject: encode(response.attestationObject),
        ...(response.getAuthenticatorData
          ? { authenticatorData: encode(response.getAuthenticatorData()) }
          : {}),
        ...(publicKeyBytes ? { publicKey: encode(publicKeyBytes) } : {}),
        ...(response.getPublicKeyAlgorithm
          ? { publicKeyAlgorithm: response.getPublicKeyAlgorithm() }
          : {}),
        ...(response.getTransports ? { transports: response.getTransports() } : {}),
      },
      clientExtensionResults: { prf: { enabled: true } },
      ...attachment(credential),
    },
  }
}

export interface PrfAssertion {
  readonly credential: typeof AuthenticationCredential.Type
  readonly credentialId: string
  /** Missing when the passkey provider does not support PRF. */
  readonly prf: Uint8Array<ArrayBuffer> | undefined
}

/**
 * One assertion that also evaluates PRF. With server `options` it doubles as a login;
 * without, it uses a local challenge and only unlocks the author key. A discoverable
 * assertion may return any passkey for the site, so callers key off `credentialId`.
 */
export const prfAssertion = async (params: {
  readonly options?: typeof RequestOptions.Type
  readonly allowCredentials?: ReadonlyArray<string>
}): Promise<PrfAssertion> => {
  const allow = params.options?.allowCredentials.map((d) => d.id) ?? params.allowCredentials ?? []
  const publicKey: PublicKeyCredentialRequestOptions = {
    challenge: params.options ? bytes(params.options.challenge) : randomBytes(32),
    userVerification: 'required',
    ...(params.options ? { rpId: params.options.rpId } : {}),
    ...(params.options?.timeout === undefined ? {} : { timeout: params.options.timeout }),
    allowCredentials: allow.map((id) => ({ type: 'public-key', id: bytes(id) })),
    extensions: { prf: { eval: { first: PRF_INPUT } } },
  }
  const credential = asPublicKeyCredential(
    await navigator.credentials.get({ publicKey }).catch(cancelled),
  )
  const prf = prfFirst(credential.getClientExtensionResults())
  const response = credential.response as AuthenticatorAssertionResponse
  const credentialId = encode(credential.rawId)
  return {
    credentialId,
    prf,
    credential: {
      id: credentialId,
      rawId: credentialId,
      type: 'public-key',
      response: {
        clientDataJSON: encode(response.clientDataJSON),
        authenticatorData: encode(response.authenticatorData),
        signature: encode(response.signature),
        userHandle: response.userHandle ? encode(response.userHandle) : null,
      },
      clientExtensionResults: {},
      ...attachment(credential),
    },
  }
}
