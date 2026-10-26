import type { AuthenticationCredential, RegistrationCredential } from '@keryx-kit/api'
import {
  type AuthenticationResponseJSON,
  type AuthenticatorTransport,
  type RegistrationResponseJSON,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'
import { Effect } from 'effect'

/** COSE algorithms offered at registration: EdDSA, ES256, RS256. */
export const SUPPORTED_ALGORITHMS = [-8, -7, -257]

const toLibraryJson = <T>(credential: unknown): T => {
  const { authenticatorAttachment, ...rest } = credential as Record<string, unknown>
  return (authenticatorAttachment ? { ...rest, authenticatorAttachment } : rest) as T
}

export interface Expected {
  readonly challenge: string
  readonly origin: string
  readonly rpId: string
}

export interface VerifiedPasskey {
  readonly credentialId: string
  readonly publicKey: Uint8Array
  readonly counter: number
  readonly transports: ReadonlyArray<string>
}

/** `undefined` when the attestation does not verify. */
export const verifyRegistration = (
  credential: typeof RegistrationCredential.Type,
  expected: Expected,
) =>
  Effect.tryPromise(() =>
    verifyRegistrationResponse({
      response: toLibraryJson<RegistrationResponseJSON>(credential),
      expectedChallenge: expected.challenge,
      expectedOrigin: expected.origin,
      expectedRPID: expected.rpId,
      requireUserVerification: true,
      supportedAlgorithmIDs: SUPPORTED_ALGORITHMS,
    }),
  ).pipe(
    Effect.map((result): VerifiedPasskey | undefined =>
      result.verified
        ? {
            credentialId: result.registrationInfo.credential.id,
            publicKey: result.registrationInfo.credential.publicKey,
            counter: result.registrationInfo.credential.counter,
            transports: credential.response.transports ?? [],
          }
        : undefined,
    ),
    Effect.orElseSucceed(() => undefined),
  )

/** The new signature counter, or `undefined` when the assertion does not verify. */
export const verifyAuthentication = (
  credential: typeof AuthenticationCredential.Type,
  passkey: VerifiedPasskey,
  expected: Expected,
) =>
  Effect.tryPromise(() =>
    verifyAuthenticationResponse({
      response: toLibraryJson<AuthenticationResponseJSON>(credential),
      expectedChallenge: expected.challenge,
      expectedOrigin: expected.origin,
      expectedRPID: expected.rpId,
      requireUserVerification: true,
      credential: {
        id: passkey.credentialId,
        publicKey: new Uint8Array(passkey.publicKey),
        counter: passkey.counter,
        transports: passkey.transports as Array<AuthenticatorTransport>,
      },
    }),
  ).pipe(
    Effect.map((result) => (result.verified ? result.authenticationInfo.newCounter : undefined)),
    Effect.orElseSucceed(() => undefined),
  )
