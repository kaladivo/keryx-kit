/**
 * Wire formats (spec/repository.md, spec/feeds.md, spec/core.md §3), shaped exactly as
 * the Go SDK writes them. Decoding is strict (`onExcessProperty: "error"`) so nothing
 * we do not understand is silently dropped when metadata is rebuilt.
 */
import { Schema } from 'effect'

const pattern = (regExp: RegExp) => Schema.String.check(Schema.isPattern(regExp))

export const CHANNEL_NAME = /^[a-z0-9_-]+$/
export const ITEM_ID = CHANNEL_NAME

export const ChannelName = pattern(CHANNEL_NAME)
export const KeyId = pattern(/^[0-9a-f]{64}$/)
export const Sha256Hex = pattern(/^[0-9a-f]{64}$/)
export const PublicKeyHex = pattern(/^[0-9a-f]{64}$/)
export const SignatureHex = pattern(/^[0-9a-f]{128}$/)
export const SignatureBase64url = pattern(/^[A-Za-z0-9_-]{86}$/)
/** TUF `expires`: whole seconds in UTC, as go-tuf marshals a truncated UTC time. */
export const Expires = pattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
export const Rfc3339 = pattern(
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/,
).check(Schema.makeFilter<string>((value) => !Number.isNaN(Date.parse(value)) || 'invalid date'))
const Version = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))
const Threshold = Version
const Length = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

export const Key = Schema.Struct({
  keytype: Schema.Literal('ed25519'),
  scheme: Schema.Literal('ed25519'),
  keyval: Schema.Struct({ public: PublicKeyHex }),
  /** Human-readable label the Go SDK attaches; not part of the keyid. */
  name: Schema.optionalKey(Schema.String),
})
export type Key = typeof Key.Type

export const Signature = Schema.Struct({ keyid: KeyId, sig: SignatureHex })
export type Signature = typeof Signature.Type

const Keys = Schema.Record(KeyId, Key)

export const Role = Schema.Struct({ keyids: Schema.Array(KeyId), threshold: Threshold })
export type Role = typeof Role.Type

const Hashes = Schema.Struct({ sha256: Sha256Hex })

export const TargetFile = Schema.Struct({ length: Length, hashes: Hashes })
export type TargetFile = typeof TargetFile.Type

export const MetaFile = Schema.Struct({ version: Version, length: Length, hashes: Hashes })
export type MetaFile = typeof MetaFile.Type

const common = {
  spec_version: Schema.String,
  version: Version,
  expires: Expires,
}

export const RootSigned = Schema.Struct({
  _type: Schema.Literal('root'),
  ...common,
  consistent_snapshot: Schema.Boolean,
  keys: Keys,
  roles: Schema.Struct({ root: Role, snapshot: Role, targets: Role, timestamp: Role }),
  custom: Schema.Struct({
    repo_base: Schema.String,
    mode: Schema.Literals(['full', 'lite']),
    mirrors: Schema.optionalKey(Schema.Array(Schema.String)),
  }),
})
export type RootSigned = typeof RootSigned.Type

export const DelegatedRole = Schema.Struct({
  name: Schema.String,
  keyids: Schema.Array(KeyId),
  threshold: Threshold,
  terminating: Schema.Boolean,
  paths: Schema.Array(Schema.String),
})
export type DelegatedRole = typeof DelegatedRole.Type

export const Delegations = Schema.Struct({ keys: Keys, roles: Schema.Array(DelegatedRole) })
export type Delegations = typeof Delegations.Type

export const ChannelDisplay = Schema.Struct({
  display_name: Schema.optionalKey(Schema.String),
  description: Schema.optionalKey(Schema.String),
})
export type ChannelDisplay = typeof ChannelDisplay.Type

export const PrivateFeedPattern = Schema.Struct({
  channel: ChannelName,
  pattern: Schema.String,
  keys: Keys,
  keyids: Schema.Array(KeyId),
  threshold: Threshold,
  display_name: Schema.optionalKey(Schema.String),
  purpose: Schema.optionalKey(Schema.String),
})
export type PrivateFeedPattern = typeof PrivateFeedPattern.Type

export const TargetsCustom = Schema.Struct({
  company_name: Schema.String,
  logo: Schema.optionalKey(Schema.String),
  logo_sha256: Schema.optionalKey(Sha256Hex),
  channels: Schema.Record(ChannelName, ChannelDisplay),
  private_feed_patterns: Schema.Array(PrivateFeedPattern),
})
export type TargetsCustom = typeof TargetsCustom.Type

const targetsFields = {
  _type: Schema.Literal('targets'),
  ...common,
  targets: Schema.Record(Schema.String, TargetFile),
  delegations: Delegations,
}

/** Top-level `targets.json`, signed by the master key. */
export const TargetsSigned = Schema.Struct({ ...targetsFields, custom: TargetsCustom })
export type TargetsSigned = typeof TargetsSigned.Type

/** `channels.<c>.json` (the item index) and `channels.<c>.authors.json`. */
export const DelegatedTargetsSigned = Schema.Struct(targetsFields)
export type DelegatedTargetsSigned = typeof DelegatedTargetsSigned.Type

const freshnessFields = { ...common, meta: Schema.Record(Schema.String, MetaFile) }

export const SnapshotSigned = Schema.Struct({
  _type: Schema.Literal('snapshot'),
  ...freshnessFields,
})
export type SnapshotSigned = typeof SnapshotSigned.Type

export const TimestampSigned = Schema.Struct({
  _type: Schema.Literal('timestamp'),
  ...freshnessFields,
})
export type TimestampSigned = typeof TimestampSigned.Type

const metadata = <S extends Schema.Top>(signed: S) =>
  Schema.Struct({ signatures: Schema.Array(Signature), signed })

export const RootMetadata = metadata(RootSigned)
export type RootMetadata = typeof RootMetadata.Type
export const TargetsMetadata = metadata(TargetsSigned)
export type TargetsMetadata = typeof TargetsMetadata.Type
export const DelegatedTargetsMetadata = metadata(DelegatedTargetsSigned)
export type DelegatedTargetsMetadata = typeof DelegatedTargetsMetadata.Type
export const SnapshotMetadata = metadata(SnapshotSigned)
export type SnapshotMetadata = typeof SnapshotMetadata.Type
export const TimestampMetadata = metadata(TimestampSigned)
export type TimestampMetadata = typeof TimestampMetadata.Type

export type AnyMetadata =
  | RootMetadata
  | TargetsMetadata
  | DelegatedTargetsMetadata
  | SnapshotMetadata
  | TimestampMetadata

export const ItemSignature = Schema.Struct({ keyid: KeyId, sig: SignatureBase64url })
export type ItemSignature = typeof ItemSignature.Type

export const Attachment = Schema.Struct({
  name: Schema.optionalKey(Schema.String),
  url: Schema.String,
  mime_type: Schema.optionalKey(Schema.String),
  size_in_bytes: Schema.optionalKey(Length),
  sha256: Schema.optionalKey(Sha256Hex),
})
export type Attachment = typeof Attachment.Type

const itemFields = {
  id: pattern(ITEM_ID),
  title: Schema.String,
  content_html: Schema.String,
  image: Schema.optionalKey(Schema.String),
  image_sha256: Schema.optionalKey(Sha256Hex),
  date_published: Rfc3339,
  date_modified: Schema.optionalKey(Rfc3339),
  tags: Schema.optionalKey(Schema.Array(Schema.String)),
  language: Schema.optionalKey(Schema.String),
  attachments: Schema.optionalKey(Schema.Array(Attachment)),
}

/** A public channel item as published (spec/feeds.md §1.1). */
export const Item = Schema.Struct({ ...itemFields, sig: Schema.Array(ItemSignature) })
export type Item = typeof Item.Type

/** An item before (or while) it collects signatures. */
export const ItemDraft = Schema.Struct({
  ...itemFields,
  sig: Schema.optionalKey(Schema.Array(ItemSignature)),
})
export type ItemDraft = typeof ItemDraft.Type

/** Join URL payload (spec/core.md §3). Unknown members are ignored on decode. */
export const JoinPayload = Schema.Struct({
  v: Schema.Literal(1),
  channels: Schema.Array(ChannelName),
  private_feeds: Schema.Array(Schema.String),
})
export type JoinPayload = typeof JoinPayload.Type

export const strict = { onExcessProperty: 'error' } as const
