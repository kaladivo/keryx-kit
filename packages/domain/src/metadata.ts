import { Effect } from 'effect'
import { fromHex, toHex, utf8 } from './bytes.ts'
import { type Signer, verifyEd25519 } from './crypto.ts'
import { type Refused, refuse, type SigningFailed } from './errors.ts'
import { canonicalJson, goJson } from './json.ts'
import type { AnyMetadata, Key, Signature } from './schema.ts'

export const SPEC_VERSION = '1.0.31'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

/** Metadata lifetimes in milliseconds. */
export interface Expiries {
  readonly root: number
  readonly targets: number
  readonly snapshot: number
  readonly timestamp: number
  readonly channel: number
  readonly authors: number
}

/** The Go SDK's reference lifetimes (`tufrepo.DefaultExpiries`). */
export const DefaultExpiries: Expiries = {
  root: 3650 * DAY,
  targets: 365 * DAY,
  snapshot: 30 * DAY,
  timestamp: 48 * HOUR,
  channel: 180 * DAY,
  authors: 180 * DAY,
}

/** Every operation takes the clock explicitly so the same inputs build the same bytes. */
export interface Timing {
  readonly now: Date
  readonly expiries?: Expiries
}

/** `now + lifetime`, truncated to seconds like the Go SDK's clock. */
export const expiresAt = (timing: Timing, lifetime: keyof Expiries): string => {
  const now = Math.floor(timing.now.getTime() / 1000) * 1000
  const period = (timing.expiries ?? DefaultExpiries)[lifetime]
  return new Date(now + period).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

/** The exact bytes a metadata signature covers: OLPC canonical JSON of `signed`. */
export const signingBytes = (metadata: { readonly signed: unknown }): Uint8Array =>
  utf8(canonicalJson(metadata.signed))

/** The file bytes, identical to go-tuf's `ToBytes(true)`. */
export const metadataFileBytes = (metadata: AnyMetadata): Uint8Array =>
  utf8(goJson(metadata, { indent: '\t', escapeHtml: true }))

/** Who may sign a role: key objects, authorized keyids, threshold. */
export interface Authority {
  readonly keys: Readonly<Record<string, Key>>
  readonly keyids: ReadonlyArray<string>
  readonly threshold: number
}

const signatureVerifies = (
  message: Uint8Array,
  signature: Signature,
  authority: Authority,
): boolean => {
  const key = authority.keys[signature.keyid]
  return key !== undefined && verifyEd25519(fromHex(signature.sig), message, key.keyval.public)
}

/** Distinct authorized keyids whose signature verifies. */
export const validSignerKeyids = (
  metadata: AnyMetadata,
  authority: Authority,
): ReadonlyArray<string> => {
  const message = signingBytes(metadata)
  const valid = new Set<string>()
  for (const signature of metadata.signatures) {
    if (
      authority.keyids.includes(signature.keyid) &&
      signatureVerifies(message, signature, authority)
    ) {
      valid.add(signature.keyid)
    }
  }
  return [...valid]
}

export const meetsThreshold = (metadata: AnyMetadata, authority: Authority): boolean =>
  validSignerKeyids(metadata, authority).length >= authority.threshold

const withSignatureEntry = <M extends AnyMetadata>(metadata: M, signature: Signature): M => ({
  ...metadata,
  signatures: [...metadata.signatures.filter((s) => s.keyid !== signature.keyid), signature],
})

/**
 * Attach a signature produced elsewhere (e.g. by the browser). Refuses a keyid the
 * authority does not list or a signature that does not verify over `signingBytes`.
 */
export const attachSignature = <M extends AnyMetadata>(
  metadata: M,
  signature: Signature,
  authority: Authority,
): Effect.Effect<M, Refused> => {
  if (!authority.keyids.includes(signature.keyid) || !authority.keys[signature.keyid]) {
    return Effect.fail(
      refuse('unauthorized-signer', `key ${signature.keyid} may not sign this role`),
    )
  }
  if (!signatureVerifies(signingBytes(metadata), signature, authority)) {
    return Effect.fail(refuse('bad-signature', `signature by ${signature.keyid} does not verify`))
  }
  return Effect.succeed(withSignatureEntry(metadata, signature))
}

/** Produce a metadata signature without attaching it (the browser side of a ceremony). */
export const signatureFor = (
  metadata: { readonly signed: unknown },
  signer: Signer,
): Effect.Effect<Signature, SigningFailed> =>
  Effect.map(signer.sign(signingBytes(metadata)), (sig) => ({
    keyid: signer.keyid,
    sig: toHex(sig),
  }))

export const signMetadata = <M extends AnyMetadata>(
  metadata: M,
  signer: Signer,
  authority: Authority,
): Effect.Effect<M, Refused | SigningFailed> =>
  Effect.flatMap(signatureFor(metadata, signer), (signature) =>
    attachSignature(metadata, signature, authority),
  )
