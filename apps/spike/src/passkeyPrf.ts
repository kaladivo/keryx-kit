import * as ed from '@noble/ed25519'
import { bytesEqual, bytesToHex, randomBytes, utf8ToBytes, wipe } from './bytes.ts'
import type { Check } from './check.ts'

/** Passed as `prf.eval.first`; the browser hashes it with the "WebAuthn PRF" context itself. */
export const prfSalt = utf8ToBytes('keryx/author-key/v1')
export const hkdfInfo = utf8ToBytes('keryx/author-key/v1/aes-256-gcm')

const createPasskey = async (): Promise<PublicKeyCredential> => {
  const credential = await navigator.credentials.create({
    publicKey: {
      rp: { name: 'keryx-kit spike' },
      user: { id: randomBytes(16), name: 'spike-author', displayName: 'Spike author' },
      challenge: randomBytes(32),
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      extensions: { prf: {} },
    },
  })
  if (!(credential instanceof PublicKeyCredential)) throw new Error('no credential created')
  return credential
}

/** Without `credentialId` the assertion is discoverable (the browser lists passkeys). */
const prfAssertion = async (credentialId?: ArrayBuffer) => {
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: randomBytes(32),
      userVerification: 'required',
      allowCredentials: credentialId ? [{ type: 'public-key', id: credentialId }] : [],
      extensions: { prf: { eval: { first: prfSalt } } },
    },
  })
  if (!(assertion instanceof PublicKeyCredential)) throw new Error('no assertion')
  const extensions = assertion.getClientExtensionResults()
  const prf = asBytes(extensions.prf?.results?.first)
  if (!prf) throw new Error(`assertion returned no PRF output: ${summarize(extensions)}`)
  return { rawId: new Uint8Array(assertion.rawId), prf }
}

/**
 * Passkey-manager extensions (1Password) build results in their own JS realm, where
 * `instanceof ArrayBuffer` is false for a real buffer; check the tag instead.
 */
const asBytes = (value: unknown): Uint8Array<ArrayBuffer> | undefined => {
  if (ArrayBuffer.isView(value))
    return Uint8Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))
  if (Object.prototype.toString.call(value) === '[object ArrayBuffer]')
    return new Uint8Array(value as ArrayBuffer)
  return undefined
}

const summarize = (extensions: AuthenticationExtensionsClientOutputs): string =>
  JSON.stringify(extensions, (_, v) => {
    const bytes = asBytes(v)
    return bytes ? `<${bytes.length} bytes>` : v
  })

const wrappingKey = async (prfOutput: Uint8Array<ArrayBuffer>): Promise<CryptoKey> => {
  const ikm = await crypto.subtle.importKey('raw', prfOutput, 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: hkdfInfo },
    ikm,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export type WrappedKey = { iv: Uint8Array<ArrayBuffer>; ciphertext: Uint8Array<ArrayBuffer> }

/** The author public key is the AAD, so a ciphertext cannot be moved to another author. */
const wrap = async (
  key: CryptoKey,
  secret: Uint8Array<ArrayBuffer>,
  aad: Uint8Array<ArrayBuffer>,
) => {
  const iv = randomBytes(12)
  const params = { name: 'AES-GCM', iv, additionalData: aad }
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(params, key, secret))
  return { iv, ciphertext }
}

const unwrap = async (
  key: CryptoKey,
  { iv, ciphertext }: WrappedKey,
  aad: Uint8Array<ArrayBuffer>,
) =>
  new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, ciphertext),
  )

const knownProviders: Record<string, string> = {
  'ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4': 'Google Password Manager',
  'adce0002-35bc-c60a-648b-0b25f1f05503': 'Chrome on Mac (profile)',
  'fbfc3007-154e-4ecc-8c0b-6e020557d7bd': 'iCloud Keychain',
  'dd4ec289-e01d-41c9-bb89-70fa845d4bf2': 'iCloud Keychain (managed)',
  'bada5566-a7aa-401f-bd96-45619a55120d': '1Password',
  'd548826e-79b4-db40-a3d8-11116f7e8349': 'Bitwarden',
  '08987058-cadc-4b81-b6e1-30de50dcbe96': 'Windows Hello',
  '00000000-0000-0000-0000-000000000000': 'unknown (provider hides its AAGUID)',
}

/** The AAGUID sits after rpIdHash (32), flags (1) and signCount (4) in the authenticator data. */
const providerOf = (credential: PublicKeyCredential): string => {
  const response = credential.response as AuthenticatorAttestationResponse
  const hex = bytesToHex(new Uint8Array(response.getAuthenticatorData()).slice(37, 53))
  const aaguid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  return `${knownProviders[aaguid] ?? 'unlisted'} (AAGUID ${aaguid})`
}

export const runPasskeyPrf = async (check: Check): Promise<void> => {
  const credential = await createPasskey()
  const created = credential.getClientExtensionResults().prf
  check.info(`credential id ${bytesToHex(new Uint8Array(credential.rawId))}`)
  check.info(`provider ${providerOf(credential)}`)
  check.info(`attachment ${credential.authenticatorAttachment ?? 'not reported'}`)
  check.info(`registration prf result ${JSON.stringify(created)}`)
  if (created?.enabled !== true)
    check.info('prf.enabled is not true at registration; trying the assertions anyway')

  const first = await prfAssertion()
  const second = await prfAssertion(credential.rawId)
  const createdId = new Uint8Array(credential.rawId)
  check.assert(bytesEqual(first.rawId, createdId), 'discoverable assertion used the new passkey')
  check.assert(first.prf.length === 32, `PRF output is 32 bytes (got ${first.prf.length})`)
  check.assert(bytesEqual(first.prf, second.prf), 'two assertions give identical PRF output')

  const authorSecret = ed.utils.randomSecretKey() as Uint8Array<ArrayBuffer>
  const authorPublic = (await ed.getPublicKeyAsync(authorSecret)) as Uint8Array<ArrayBuffer>
  const wrapped = await wrap(await wrappingKey(first.prf), authorSecret, authorPublic)
  check.info(`wrapped author key ${bytesToHex(wrapped.ciphertext)} (iv ${bytesToHex(wrapped.iv)})`)

  const unwrapped = await unwrap(await wrappingKey(second.prf), wrapped, authorPublic)
  check.assert(bytesEqual(unwrapped, authorSecret), 'unwrapped key equals the original')
  const message = utf8ToBytes('keryx-kit spike item')
  const signature = await ed.signAsync(message, unwrapped)
  check.assert(await ed.verifyAsync(signature, message, authorPublic), 'unwrapped key signs')

  check.result('authorPublicKey', bytesToHex(authorPublic))
  wipe(authorSecret, unwrapped, first.prf, second.prf)
}
