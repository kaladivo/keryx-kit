/**
 * Ceremonies (mvp-spec §5.5) and author tasks. The server never sends metadata for the
 * browser to trust: it sends the published repo (`base`), the domain operation with its
 * exact parameters and clock (`operation`), and the bytes it wants signed (`toSign`).
 * The browser runs `rebuild(base, operation)`, compares `signingBytes` of its own copy
 * with `toSign`, and signs its own copy only when they are equal.
 */
import {
  assignAuthor,
  ChannelName,
  createChannel,
  editChannel,
  editCompany,
  fromUtf8,
  Item,
  ItemSignature,
  KeyId,
  PublicKeyHex,
  parseRepoFiles,
  type Refused,
  type RepoFiles,
  type RepoState,
  removeAuthor,
  renewAuthors,
  renewTargets,
  Sha256Hex,
  Signature,
  utf8,
} from '@keryx-kit/domain'
import { Effect, Schema } from 'effect'
import { AuthorRef, ItemRef } from './records.ts'
import { AuthorKeyLabel, Base64url, Id, Instant, LogoDataUrl } from './values.ts'

const files = Schema.Record(Schema.String, Schema.String)

/** `RepoFiles` with every file as its UTF-8 text (all repo files are JSON). */
export const RepoFilesText = Schema.Struct({ anchor: files, base: files })
export type RepoFilesText = typeof RepoFilesText.Type

const mapValues = <A, B>(record: Readonly<Record<string, A>>, f: (a: A) => B) =>
  Object.fromEntries(Object.entries(record).map(([k, v]) => [k, f(v)]))

export const repoFilesToText = (repo: RepoFiles): RepoFilesText => ({
  anchor: mapValues(repo.anchor, fromUtf8),
  base: mapValues(repo.base, fromUtf8),
})

export const repoFilesFromText = (text: RepoFilesText): RepoFiles => ({
  anchor: mapValues(text.anchor, utf8),
  base: mapValues(text.base, utf8),
})

/** Domain `PublicKey`: the key and its public label (`author-3`, never a person's name). */
const AuthorPublicKey = Schema.Struct({ publicKey: PublicKeyHex, name: AuthorKeyLabel })

/**
 * One `@keryx-kit/domain` operation call: `_tag` is the function, `params` its
 * arguments, `now` the `Timing.now` (expiries are always `DefaultExpiries`).
 */
export const Operation = Schema.Union([
  Schema.TaggedStruct('createChannel', {
    now: Instant,
    params: Schema.Struct({
      channel: ChannelName,
      displayName: Schema.optionalKey(Schema.String),
      description: Schema.optionalKey(Schema.String),
      channelKey: PublicKeyHex,
      authors: Schema.Array(AuthorPublicKey),
    }),
  }),
  Schema.TaggedStruct('assignAuthor', {
    now: Instant,
    params: Schema.Struct({ channel: ChannelName, author: AuthorPublicKey }),
  }),
  Schema.TaggedStruct('removeAuthor', {
    now: Instant,
    params: Schema.Struct({ channel: ChannelName, keyid: KeyId }),
  }),
  Schema.TaggedStruct('editChannel', {
    now: Instant,
    params: Schema.Struct({
      channel: ChannelName,
      displayName: Schema.optionalKey(Schema.String),
      description: Schema.optionalKey(Schema.String),
    }),
  }),
  Schema.TaggedStruct('editCompany', {
    now: Instant,
    params: Schema.Struct({
      logo: Schema.optionalKey(Schema.String),
      logoSha256: Schema.optionalKey(Sha256Hex),
    }),
  }),
  Schema.TaggedStruct('renewTargets', { now: Instant }),
  Schema.TaggedStruct('renewAuthors', {
    now: Instant,
    params: Schema.Struct({ channel: ChannelName }),
  }),
])
export type Operation = typeof Operation.Type

export const applyOperation = (
  state: RepoState,
  operation: Operation,
): Effect.Effect<RepoState, Refused> => {
  const timing = { now: new Date(operation.now) }
  switch (operation._tag) {
    case 'createChannel':
      return createChannel(state, operation.params, timing)
    case 'assignAuthor':
      return assignAuthor(state, operation.params, timing)
    case 'removeAuthor':
      return removeAuthor(state, operation.params, timing)
    case 'editChannel':
      return editChannel(state, operation.params, timing)
    case 'editCompany':
      return editCompany(state, operation.params, timing)
    case 'renewTargets':
      return Effect.succeed(renewTargets(state, timing))
    case 'renewAuthors':
      return renewAuthors(state, operation.params.channel, timing)
  }
}

/** What the browser does before signing: the published repo plus the operation. */
export const rebuild = (
  base: RepoFilesText,
  operation: Operation,
): Effect.Effect<RepoState, Refused> =>
  Effect.flatMap(parseRepoFiles(repoFilesFromText(base)), (repo) => applyOperation(repo, operation))

/**
 * Bytes one role needs signed: `signingBytes` of the unsigned document, base64url.
 * `role` is `targets`, `root` or `channels.<c>.authors`; any key in `keyids` may sign.
 */
export const SigningRequest = Schema.Struct({
  role: Schema.String,
  keyids: Schema.Array(KeyId),
  signingBytes: Base64url,
})

/** What the owner asks for. The server turns it into an `Operation`. */
export const Intent = Schema.Union([
  Schema.TaggedStruct('CreateChannel', {
    channel: ChannelName,
    displayName: Schema.String,
    description: Schema.String,
    authors: Schema.NonEmptyArray(Id),
  }),
  Schema.TaggedStruct('AssignAuthor', { channel: ChannelName, memberId: Id }),
  Schema.TaggedStruct('RemoveAuthor', { channel: ChannelName, memberId: Id }),
  Schema.TaggedStruct('EditChannel', {
    channel: ChannelName,
    displayName: Schema.String,
    description: Schema.String,
  }),
  Schema.TaggedStruct('ChangeLogo', { logo: LogoDataUrl }),
  Schema.TaggedStruct('RenewTargets', {}),
])
export type Intent = typeof Intent.Type

/**
 * - `awaiting-owner`: built, the owner has not signed yet.
 * - `staged`: the owner signed; `missing` lists the signatures still needed.
 * - `applied`: live in the repo. `discarded`: dropped by the owner.
 */
export const CeremonyStatus = Schema.Literals(['awaiting-owner', 'staged', 'applied', 'discarded'])

/** A role whose threshold the change cannot meet yet, and who can sign it. */
export const MissingSignature = Schema.Struct({
  role: Schema.String,
  file: Schema.String,
  signers: Schema.Array(AuthorRef),
})

/** For `RemoveAuthor` (mvp-spec B5), recomputed as remaining authors re-sign. */
export const RemovalImpact = Schema.Struct({
  /** Unpublished when the revocation applies unless another author re-signs them first. */
  itemsSignedOnlyByAuthor: Schema.Array(ItemRef),
  /** `channels.<c>.authors.json` is signed only by the removed author. */
  authorsMetadataNeedsResign: Schema.Boolean,
})

export const CeremonySummary = Schema.Struct({
  id: Id,
  intent: Intent,
  /** The server's wording. The console shows its own summary of its own rebuild. */
  summary: Schema.String,
  status: CeremonyStatus,
  missing: Schema.Array(MissingSignature),
  removal: Schema.optionalKey(RemovalImpact),
  createdAt: Instant,
  updatedAt: Instant,
})

export const Ceremony = Schema.Struct({
  ...CeremonySummary.fields,
  /** The published repo now. Unpublished staged changes are never part of it. */
  base: RepoFilesText,
  operation: Operation,
  /** What the owner signs; empty once the owner has signed. */
  toSign: Schema.Array(SigningRequest),
})

export const OwnerSignature = Schema.Struct({
  role: Schema.Literals(['root', 'targets']),
  signature: Signature,
})

export const SignCeremony = Schema.Struct({ signatures: Schema.NonEmptyArray(OwnerSignature) })

/**
 * Pending signatures an author's console performs on its own (mvp-spec B3, B5, E3),
 * all with one passkey unwrap:
 *
 * - `SignAuthorsMetadata`: sign `channels.<c>.authors.json`. `reason` is `new-channel`
 *   (v1 of a staged channel; `operation` is that ceremony's `createChannel`),
 *   `renewal` (within 60 days of expiry) or `author-removal` (the removed author was its
 *   only signer); both of the latter use `renewAuthors`.
 * - `ResignItems`: add a signature to published items before an author is removed.
 *   The browser signs `itemSigningBytes(item)` of each.
 */
export const AuthorTask = Schema.Union([
  Schema.TaggedStruct('SignAuthorsMetadata', {
    id: Id,
    channel: ChannelName,
    reason: Schema.Literals(['new-channel', 'renewal', 'author-removal']),
    ceremonyId: Schema.optionalKey(Id),
    base: RepoFilesText,
    operation: Operation,
    toSign: SigningRequest,
  }),
  Schema.TaggedStruct('ResignItems', {
    id: Id,
    channel: ChannelName,
    ceremonyId: Id,
    items: Schema.Array(Item),
  }),
])
export type AuthorTask = typeof AuthorTask.Type

export const TaskCompletion = Schema.Union([
  Schema.TaggedStruct('AuthorsSignature', { signature: Signature }),
  Schema.TaggedStruct('ItemSignatures', {
    signatures: Schema.NonEmptyArray(
      Schema.Struct({ itemId: Item.fields.id, signature: ItemSignature }),
    ),
  }),
])
