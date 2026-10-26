import type { IssueCode, RefusalCode } from '@keryx-kit/domain'
import { Schema } from 'effect'

const pattern = (regExp: RegExp) => Schema.String.check(Schema.isPattern(regExp))

/** Opaque server-issued id (members, ceremonies, drafts, tasks, invites, ...). */
export const Id = pattern(/^[A-Za-z0-9_-]{1,64}$/)

export const Base64url = pattern(/^[A-Za-z0-9_-]*$/)

/**
 * Immutable after sign-up: it is part of the Trezor derivation label
 * (`"Keryx master key " + slug`, mvp-spec §5.3) and of the repo base URL. Short and
 * readable because the Safe 7 shows it on every ceremony.
 */
export const CompanySlug = pattern(/^[a-z0-9](?:[a-z0-9-]{0,22}[a-z0-9])?$/)

/** `https://<hostname>`: no port, path, query or trailing slash. */
export const JoinOrigin = pattern(/^https:\/\/(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/)

/** Logo as uploaded, embedded in `targets.json` (mvp-spec A1). */
export const LogoDataUrl = pattern(/^data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/]+={0,2}$/)

/** Non-personal key label as it appears in public `targets.json`, e.g. `author-3`. */
export const AuthorKeyLabel = pattern(/^author-[1-9][0-9]*$/)

export const Email = pattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)

/** ISO 8601 UTC instant, e.g. `2026-10-26T12:00:00.000Z`. */
export const Instant = pattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/)

/** secp256k1 compressed public key (SLIP-0013 identity), hex. */
export const IdentityPublicKey = pattern(/^0[23][0-9a-f]{64}$/)

/** SLIP-0013 signature: header ‖ r ‖ s, 65 bytes, hex. */
export const IdentitySignature = pattern(/^[0-9a-f]{130}$/)

const refusalCodes = [
  'invalid-channel-name',
  'reserved-channel-name',
  'channel-exists',
  'unknown-channel',
  'not-authored',
  'no-authors',
  'key-overlap',
  'author-listed',
  'author-not-listed',
  'last-author',
  'invalid-company',
  'invalid-logo',
  'invalid-item',
  'item-too-large',
  'unauthorized-item',
  'item-not-published',
  'unauthorized-signer',
  'bad-signature',
  'invalid-metadata',
  'invalid-repo',
  'invalid-join',
] as const satisfies ReadonlyArray<RefusalCode>
export const RefusalCodeSchema = Schema.Literals(refusalCodes)

const issueCodes = [
  'root-chain',
  'structure',
  'keyid-mismatch',
  'signature-threshold',
  'pin-mismatch',
  'key-overlap',
  'not-authored',
  'item-invalid',
  'expired',
  'version-rollback',
  'version-not-bumped',
  'metadata-removed',
] as const satisfies ReadonlyArray<IssueCode>

/** `validateRepo` output (domain `Issue`). */
export const IssueSchema = Schema.Struct({
  code: Schema.Literals(issueCodes),
  file: Schema.String,
  message: Schema.String,
})

type MissingFrom<All, Listed> = [Exclude<All, Listed>] extends [never] ? true : Exclude<All, Listed>
// Fails to compile when domain adds a code the API does not list.
export const codesInSync: [
  MissingFrom<RefusalCode, (typeof refusalCodes)[number]>,
  MissingFrom<IssueCode, (typeof issueCodes)[number]>,
] = [true, true]
