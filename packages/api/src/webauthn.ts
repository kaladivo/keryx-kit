/**
 * WebAuthn Level 3 JSON forms (`PublicKeyCredential.parseCreationOptionsFromJSON`,
 * `credential.toJSON()`), limited to what passkey registration and login use.
 * Binary members are base64url. The server verifies attestations and assertions; the
 * PRF output never leaves the browser (mvp-spec §5.4).
 */
import { Schema } from 'effect'
import { Base64url } from './values.ts'

const PublicKeyType = Schema.Literal('public-key')

const CredentialDescriptor = Schema.Struct({
  type: PublicKeyType,
  id: Base64url,
  transports: Schema.optionalKey(Schema.Array(Schema.String)),
})

/**
 * Registration options. The server always sends `residentKey: 'required'`,
 * `userVerification: 'required'` and `extensions: { prf: {} }`; the browser adds the
 * PRF `eval` input itself.
 */
export const CreationOptions = Schema.Struct({
  challenge: Base64url,
  rp: Schema.Struct({ id: Schema.String, name: Schema.String }),
  user: Schema.Struct({ id: Base64url, name: Schema.String, displayName: Schema.String }),
  pubKeyCredParams: Schema.Array(Schema.Struct({ type: PublicKeyType, alg: Schema.Int })),
  timeout: Schema.optionalKey(Schema.Int),
  excludeCredentials: Schema.optionalKey(Schema.Array(CredentialDescriptor)),
  authenticatorSelection: Schema.Struct({
    residentKey: Schema.Literal('required'),
    requireResidentKey: Schema.optionalKey(Schema.Boolean),
    userVerification: Schema.Literal('required'),
  }),
  attestation: Schema.optionalKey(Schema.Literals(['none', 'indirect', 'direct', 'enterprise'])),
  extensions: Schema.Struct({ prf: Schema.Struct({}) }),
})

/** Login options: discoverable (`allowCredentials` empty), user verification required. */
export const RequestOptions = Schema.Struct({
  challenge: Base64url,
  rpId: Schema.String,
  timeout: Schema.optionalKey(Schema.Int),
  allowCredentials: Schema.Array(CredentialDescriptor),
  userVerification: Schema.Literal('required'),
})

const ClientExtensionResults = Schema.Struct({
  prf: Schema.optionalKey(Schema.Struct({ enabled: Schema.optionalKey(Schema.Boolean) })),
})

const AuthenticatorAttachment = Schema.optionalKey(
  Schema.NullOr(Schema.Literals(['platform', 'cross-platform'])),
)

/** `credential.toJSON()` after `navigator.credentials.create`. */
export const RegistrationCredential = Schema.Struct({
  id: Base64url,
  rawId: Base64url,
  type: PublicKeyType,
  response: Schema.Struct({
    clientDataJSON: Base64url,
    attestationObject: Base64url,
    authenticatorData: Schema.optionalKey(Base64url),
    publicKey: Schema.optionalKey(Base64url),
    publicKeyAlgorithm: Schema.optionalKey(Schema.Int),
    transports: Schema.optionalKey(Schema.Array(Schema.String)),
  }),
  clientExtensionResults: ClientExtensionResults,
  authenticatorAttachment: AuthenticatorAttachment,
})

/** `credential.toJSON()` after `navigator.credentials.get`. */
export const AuthenticationCredential = Schema.Struct({
  id: Base64url,
  rawId: Base64url,
  type: PublicKeyType,
  response: Schema.Struct({
    clientDataJSON: Base64url,
    authenticatorData: Base64url,
    signature: Base64url,
    userHandle: Schema.optionalKey(Schema.NullOr(Base64url)),
  }),
  clientExtensionResults: ClientExtensionResults,
  authenticatorAttachment: AuthenticatorAttachment,
})

/**
 * The author key wrapped with the passkey PRF (AES-256-GCM, AAD = author public key):
 * a 12-byte IV and the 32-byte Ed25519 seed plus the 16-byte tag.
 */
export const WrappedKey = Schema.Struct({
  iv: Base64url.check(Schema.isBetweenLength(16, 16)),
  ciphertext: Base64url.check(Schema.isBetweenLength(64, 64)),
})
