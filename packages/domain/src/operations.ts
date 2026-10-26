/**
 * Pure, deterministic repo operations, ported from the Go SDK's publisher. Each one
 * takes the current state plus the intended change and returns the new state with
 * every changed metadata document version-bumped, re-expired and unsigned. Signing
 * (`signRole`, `attachRoleSignature`) and freshness (`withFreshness`) come after.
 */
import { Effect } from 'effect'
import { sha256Hex } from './bytes.ts'
import { ed25519Key, keyidOf, type Signer } from './crypto.ts'
import { type Refused, refuse, type SigningFailed } from './errors.ts'
import {
  decodeItem,
  decodeItemJson,
  encodeItem,
  ITEM_MAX_BYTES,
  itemContentProblem,
  itemPath,
  verifyItemSignatures,
  withItemSignature,
} from './item.ts'
import {
  type Authority,
  type Expiries,
  expiresAt,
  metadataFileBytes,
  SPEC_VERSION,
  signMetadata,
  type Timing,
} from './metadata.ts'
import {
  authorityOf,
  authorsRoleName,
  channelRoleName,
  currentRoot,
  pinnedMetadata,
  type Repo,
  type RepoState,
  repoState,
} from './repo.ts'
import {
  CHANNEL_NAME,
  type ChannelDisplay,
  type DelegatedRole,
  type DelegatedTargetsMetadata,
  type Item,
  type ItemSignature,
  type Key,
  type SnapshotMetadata,
  type TargetFile,
  type TargetsSigned,
  type TimestampMetadata,
} from './schema.ts'

/** A public key (hex) plus the Go SDK's optional label for it. */
export interface PublicKey {
  readonly publicKey: string
  readonly name?: string
}

const keyFor = (key: PublicKey, defaultName?: string): Key =>
  ed25519Key(key.publicKey, key.name ?? defaultName)

interface Versioned {
  readonly version: number
  readonly expires: string
}

const bumped = <S extends Versioned>(signed: S, timing: Timing, lifetime: keyof Expiries): S => ({
  ...signed,
  version: signed.version + 1,
  expires: expiresAt(timing, lifetime),
})

const fileInfo = (bytes: Uint8Array): TargetFile => ({
  length: bytes.length,
  hashes: { sha256: sha256Hex(bytes) },
})

const emptyDelegations = { keys: {}, roles: [] }

const emptyRoleMetadata = (
  timing: Timing,
  lifetime: 'channel' | 'authors',
): DelegatedTargetsMetadata => ({
  signatures: [],
  signed: {
    _type: 'targets',
    spec_version: SPEC_VERSION,
    version: 1,
    expires: expiresAt(timing, lifetime),
    targets: {},
    delegations: emptyDelegations,
  },
})

const withTargets = (state: RepoState, signed: TargetsSigned, timing: Timing): RepoState => ({
  ...repoState(state),
  targets: { signatures: [], signed: bumped(signed, timing, 'targets') },
})

const logoProblem = (
  logo: string | undefined,
  logoSha256: string | undefined,
): string | undefined => {
  if (logo === undefined) return undefined
  if (logo.startsWith('data:'))
    return logo.includes(';base64,') ? undefined : 'logo data URL must be base64'
  if (!logo.startsWith('https://')) return 'logo must be a data URL or an absolute HTTPS URL'
  return logoSha256 !== undefined && /^[0-9a-f]{64}$/.test(logoSha256)
    ? undefined
    : 'linked logo requires logo_sha256 as a lowercase hex SHA-256'
}

const logoFields = (logo: string, logoSha256: string | undefined) =>
  logo.startsWith('https://') && logoSha256 !== undefined
    ? { logo, logo_sha256: logoSha256 }
    : { logo }

export interface InitParams {
  readonly repoBase: string
  readonly companyName: string
  /** Inline data URL, or an absolute HTTPS URL together with `logoSha256`. */
  readonly logo?: string
  readonly logoSha256?: string
  readonly masterKey: string
  readonly opsKey: string
}

/**
 * A fresh company repo (`pub init`): root v1 with master as root + targets and the ops
 * key as snapshot + timestamp; targets v1 with the company identity and no channels.
 */
export const initRepo = (params: InitParams, timing: Timing): Effect.Effect<RepoState, Refused> => {
  if (params.companyName === '')
    return Effect.fail(refuse('invalid-company', 'company name is required'))
  if (params.repoBase === '')
    return Effect.fail(refuse('invalid-metadata', 'repo base is required'))
  const problem = logoProblem(params.logo, params.logoSha256)
  if (problem) return Effect.fail(refuse('invalid-logo', problem))
  const master = ed25519Key(params.masterKey, 'master')
  const ops = ed25519Key(params.opsKey, 'ops')
  const masterId = keyidOf(master)
  const opsId = keyidOf(ops)
  if (masterId === opsId)
    return Effect.fail(refuse('key-overlap', 'master and ops keys must differ'))
  return Effect.succeed({
    roots: [
      {
        signatures: [],
        signed: {
          _type: 'root',
          spec_version: SPEC_VERSION,
          consistent_snapshot: false,
          version: 1,
          expires: expiresAt(timing, 'root'),
          keys: { [masterId]: master, [opsId]: ops },
          roles: {
            root: { keyids: [masterId], threshold: 1 },
            snapshot: { keyids: [opsId], threshold: 1 },
            targets: { keyids: [masterId], threshold: 1 },
            timestamp: { keyids: [opsId], threshold: 1 },
          },
          custom: { repo_base: params.repoBase, mode: 'full' },
        },
      },
    ],
    targets: {
      signatures: [],
      signed: {
        _type: 'targets',
        spec_version: SPEC_VERSION,
        version: 1,
        expires: expiresAt(timing, 'targets'),
        targets: {},
        delegations: emptyDelegations,
        custom: {
          company_name: params.companyName,
          ...(params.logo === undefined ? {} : logoFields(params.logo, params.logoSha256)),
          channels: {},
          private_feed_patterns: [],
        },
      },
    },
    channels: {},
    authors: {},
    items: {},
  })
}

const display = (
  displayName: string | undefined,
  description: string | undefined,
): ChannelDisplay => ({
  ...(displayName ? { display_name: displayName } : {}),
  ...(description ? { description } : {}),
})

/** Keys the server holds or the root uses: an author key must never be one of them. */
const reservedKeyids = (state: RepoState): ReadonlySet<string> => {
  const reserved = new Set(Object.keys(currentRoot(state).signed.keys))
  for (const role of state.targets.signed.delegations.roles) {
    if (!role.name.endsWith('.authors')) for (const keyid of role.keyids) reserved.add(keyid)
  }
  return reserved
}

const channelExists = (state: RepoState, channel: string): boolean =>
  state.channels[channel] !== undefined &&
  authorityOf(state, channelRoleName(channel)) !== undefined

const requireAuthors = (state: RepoState, channel: string): Effect.Effect<Authority, Refused> => {
  if (!channelExists(state, channel))
    return Effect.fail(refuse('unknown-channel', `unknown channel ${channel}`))
  const authors = authorityOf(state, authorsRoleName(channel))
  return authors && state.authors[channel]
    ? Effect.succeed(authors)
    : Effect.fail(refuse('not-authored', `channel ${channel} has no authors role`))
}

export interface CreateChannelParams {
  readonly channel: string
  readonly displayName?: string
  readonly description?: string
  /** The server-held channel key (labelled with the channel name, as the Go SDK does). */
  readonly channelKey: string
  readonly authors: ReadonlyArray<PublicKey>
}

/**
 * `pub channel add` in authored mode: the `channels.<c>` delegation (terminating) and
 * the `channels.<c>.authors` delegation (threshold 1), display metadata in
 * `custom.channels`, and empty v1 role metadata for both roles.
 */
export const createChannel = (
  state: RepoState,
  params: CreateChannelParams,
  timing: Timing,
): Effect.Effect<RepoState, Refused> =>
  Effect.gen(function* () {
    const { channel } = params
    if (!CHANNEL_NAME.test(channel)) {
      return yield* refuse('invalid-channel-name', `channel name ${channel} must match [a-z0-9-_]+`)
    }
    const signed = state.targets.signed
    const roleName = channelRoleName(channel)
    if (
      state.channels[channel] ||
      signed.delegations.roles.some(
        (r) => r.name === roleName || r.name === authorsRoleName(channel),
      )
    ) {
      return yield* refuse('channel-exists', `channel ${channel} already exists`)
    }
    if (params.authors.length === 0)
      return yield* refuse('no-authors', 'a channel needs at least one author')
    const channelKey = ed25519Key(params.channelKey, channel)
    const channelKeyid = keyidOf(channelKey)
    const knownKeyids = new Set([
      ...Object.keys(currentRoot(state).signed.keys),
      ...Object.keys(signed.delegations.keys),
    ])
    if (knownKeyids.has(channelKeyid)) {
      return yield* refuse('key-overlap', 'the channel key is already used in this repo')
    }
    const authorKeys = params.authors.map((author) => keyFor(author))
    const authorKeyids = authorKeys.map(keyidOf)
    const reserved = reservedKeyids(state)
    if (authorKeyids.some((keyid) => keyid === channelKeyid || reserved.has(keyid))) {
      return yield* refuse('key-overlap', 'an author key is also a channel or root key')
    }
    if (new Set(authorKeyids).size !== authorKeyids.length) {
      return yield* refuse('author-listed', 'an author is listed twice')
    }
    const paths = [`channels/${channel}/*`]
    const roles: ReadonlyArray<DelegatedRole> = [
      { name: roleName, keyids: [channelKeyid], threshold: 1, terminating: true, paths },
      {
        name: authorsRoleName(channel),
        keyids: authorKeyids,
        threshold: 1,
        terminating: false,
        paths,
      },
    ]
    const keys = {
      ...signed.delegations.keys,
      [channelKeyid]: channelKey,
      ...Object.fromEntries(authorKeys.map((key) => [keyidOf(key), key])),
    }
    const next = withTargets(
      state,
      {
        ...signed,
        delegations: { keys, roles: [...signed.delegations.roles, ...roles] },
        custom: {
          ...signed.custom,
          channels: {
            ...signed.custom.channels,
            [channel]: display(params.displayName, params.description),
          },
        },
      },
      timing,
    )
    return {
      ...next,
      channels: { ...next.channels, [channel]: emptyRoleMetadata(timing, 'channel') },
      authors: { ...next.authors, [channel]: emptyRoleMetadata(timing, 'authors') },
    }
  })

const replaceRole = (signed: TargetsSigned, role: DelegatedRole): TargetsSigned => ({
  ...signed,
  delegations: {
    ...signed.delegations,
    roles: signed.delegations.roles.map((r) => (r.name === role.name ? role : r)),
  },
})

const authorsDelegation = (state: RepoState, channel: string): DelegatedRole | undefined =>
  state.targets.signed.delegations.roles.find((r) => r.name === authorsRoleName(channel))

/**
 * `pub author add`: adds the key to the authors delegation. The authors role metadata
 * is left as is: its existing signatures stay valid (mvp-spec B4).
 */
export const assignAuthor = (
  state: RepoState,
  params: { readonly channel: string; readonly author: PublicKey },
  timing: Timing,
): Effect.Effect<RepoState, Refused> =>
  Effect.gen(function* () {
    yield* requireAuthors(state, params.channel)
    const role = authorsDelegation(state, params.channel) as DelegatedRole
    const key = keyFor(params.author)
    const keyid = keyidOf(key)
    if (role.keyids.includes(keyid)) {
      return yield* refuse(
        'author-listed',
        `author ${keyid} is already listed on ${params.channel}`,
      )
    }
    if (reservedKeyids(state).has(keyid)) {
      return yield* refuse('key-overlap', `key ${keyid} is a channel or root key`)
    }
    const signed = replaceRole(state.targets.signed, { ...role, keyids: [...role.keyids, keyid] })
    return withTargets(
      state,
      {
        ...signed,
        delegations: { ...signed.delegations, keys: { ...signed.delegations.keys, [keyid]: key } },
      },
      timing,
    )
  })

const channelAuthority = (state: RepoState, channel: string): Authority =>
  authorityOf(state, channelRoleName(channel)) as Authority

/** Author entries in delegation order, then channel-key entries; other keys are dropped. */
const orderedSignatures = (
  item: Item,
  authors: Authority,
  channel: Authority,
): ReadonlyArray<ItemSignature> =>
  [...authors.keyids, ...channel.keyids].flatMap(
    (keyid) => item.sig.find((s) => s.keyid === keyid) ?? [],
  )

const combined = (a: Authority, b: Authority): Authority => ({
  keys: { ...a.keys, ...b.keys },
  keyids: [...a.keyids, ...b.keyids],
  threshold: a.threshold,
})

const withChannelTargets = (
  state: RepoState,
  channel: string,
  targets: Readonly<Record<string, TargetFile>>,
  items: Readonly<Record<string, Uint8Array>>,
  timing: Timing,
): RepoState => {
  const current = state.channels[channel] as DelegatedTargetsMetadata
  return {
    ...repoState(state),
    channels: {
      ...state.channels,
      [channel]: {
        signatures: [],
        signed: bumped({ ...current.signed, targets }, timing, 'channel'),
      },
    },
    items,
  }
}

const channelItemPaths = (state: RepoState, channel: string): ReadonlyArray<string> =>
  Object.keys(state.channels[channel]?.signed.targets ?? {})

/**
 * Normalizes, verifies and encodes an item for a channel: the authors role threshold
 * must be met and every entry by a role key must verify.
 */
const finalizeItem = (
  state: RepoState,
  channel: string,
  input: Item,
): Effect.Effect<readonly [Item, Uint8Array], Refused> =>
  Effect.gen(function* () {
    const authors = yield* requireAuthors(state, channel)
    const decoded = yield* decodeItemJson(input)
    const problem = itemContentProblem(decoded)
    if (problem) return yield* refuse('invalid-item', `item ${decoded.id}: ${problem}`)
    const channelKeys = channelAuthority(state, channel)
    const item: Item = { ...decoded, sig: orderedSignatures(decoded, authors, channelKeys) }
    yield* verifyItemSignatures(item, authors, combined(authors, channelKeys))
    const bytes = encodeItem(item)
    if (bytes.length > ITEM_MAX_BYTES) {
      return yield* refuse(
        'item-too-large',
        `item ${item.id} is ${bytes.length} bytes, over ${ITEM_MAX_BYTES}`,
      )
    }
    return [item, bytes] as const
  })

/**
 * `pub publish`: verifies the author signatures, writes the item target and bumps the
 * channel role metadata. Publishing an existing id replaces the item (in-place edit).
 * Add the Go SDK's portability signature with `signItem(item, channelSigner)` first.
 */
export const publishItem = (
  state: RepoState,
  params: { readonly channel: string; readonly item: Item },
  timing: Timing,
): Effect.Effect<RepoState, Refused> =>
  Effect.map(finalizeItem(state, params.channel, params.item), ([item, bytes]) => {
    const path = itemPath(params.channel, item.id)
    const current = state.channels[params.channel] as DelegatedTargetsMetadata
    return withChannelTargets(
      state,
      params.channel,
      { ...current.signed.targets, [path]: fileInfo(bytes) },
      { ...state.items, [path]: bytes },
      timing,
    )
  })

const withoutKey = <V>(record: Readonly<Record<string, V>>, key: string): Record<string, V> =>
  Object.fromEntries(Object.entries(record).filter(([k]) => k !== key))

/** `pub item unpublish`: absence from the index is unpublished (spec/feeds.md §1.3). */
export const unpublishItem = (
  state: RepoState,
  params: { readonly channel: string; readonly id: string },
  timing: Timing,
): Effect.Effect<RepoState, Refused> => {
  const path = itemPath(params.channel, params.id)
  const current = state.channels[params.channel]
  if (!current) return Effect.fail(refuse('unknown-channel', `unknown channel ${params.channel}`))
  if (!current.signed.targets[path]) {
    return Effect.fail(
      refuse('item-not-published', `item ${params.id} is not published on ${params.channel}`),
    )
  }
  return Effect.succeed(
    withChannelTargets(
      state,
      params.channel,
      withoutKey(current.signed.targets, path),
      withoutKey(state.items, path),
      timing,
    ),
  )
}

const publishedItem = (
  state: RepoState,
  channel: string,
  id: string,
): Effect.Effect<Item, Refused> => {
  const bytes = state.items[itemPath(channel, id)]
  return bytes && state.channels[channel]?.signed.targets[itemPath(channel, id)]
    ? decodeItem(bytes)
    : Effect.fail(refuse('item-not-published', `item ${id} is not published on ${channel}`))
}

/** A remaining author re-signs a published item (mvp-spec B5): adds their entry. */
export const addItemSignature = (
  state: RepoState,
  params: { readonly channel: string; readonly id: string; readonly signature: ItemSignature },
  timing: Timing,
): Effect.Effect<RepoState, Refused> =>
  Effect.gen(function* () {
    const authors = yield* requireAuthors(state, params.channel)
    if (!authors.keyids.includes(params.signature.keyid)) {
      return yield* refuse(
        'unauthorized-signer',
        `${params.signature.keyid} is not an author of ${params.channel}`,
      )
    }
    const item = yield* publishedItem(state, params.channel, params.id)
    return yield* publishItem(
      state,
      { channel: params.channel, item: withItemSignature(item, params.signature) },
      timing,
    )
  })

/** Published item ids that lose their last valid author signature if `keyid` is revoked. */
export const itemsSignedOnlyBy = (
  state: RepoState,
  params: { readonly channel: string; readonly keyid: string },
): Effect.Effect<ReadonlyArray<string>, Refused> =>
  Effect.gen(function* () {
    const authors = yield* requireAuthors(state, params.channel)
    const remaining = { ...authors, keyids: authors.keyids.filter((k) => k !== params.keyid) }
    const ids: Array<string> = []
    for (const path of channelItemPaths(state, params.channel)) {
      const item = yield* decodeItem(state.items[path] ?? new Uint8Array())
      const verified = yield* Effect.result(verifyItemSignatures(item, remaining, authors))
      if (verified._tag === 'Failure') ids.push(item.id)
    }
    return ids
  })

/**
 * `pub author revoke`: drops the key from the authors delegation (the key object stays
 * in `delegations.keys`, as in the Go SDK), strips its item signatures and unpublishes
 * items no remaining author has signed. Refuses to remove the last author.
 */
export const removeAuthor = (
  state: RepoState,
  params: { readonly channel: string; readonly keyid: string },
  timing: Timing,
): Effect.Effect<RepoState, Refused> =>
  Effect.gen(function* () {
    const authors = yield* requireAuthors(state, params.channel)
    const role = authorsDelegation(state, params.channel) as DelegatedRole
    if (!role.keyids.includes(params.keyid)) {
      return yield* refuse(
        'author-not-listed',
        `author ${params.keyid} is not listed on ${params.channel}`,
      )
    }
    const keyids = role.keyids.filter((k) => k !== params.keyid)
    if (keyids.length === 0)
      return yield* refuse('last-author', 'cannot remove the last author of a channel')
    if (keyids.length < role.threshold) {
      return yield* refuse(
        'last-author',
        `the ${role.threshold}-of-${role.keyids.length} threshold would be unmet`,
      )
    }
    const revoked = withTargets(
      state,
      replaceRole(state.targets.signed, { ...role, keyids }),
      timing,
    )
    const remaining = { ...authors, keyids }
    const channelKeys = channelAuthority(state, params.channel)
    const targets = {
      ...(state.channels[params.channel] as DelegatedTargetsMetadata).signed.targets,
    }
    const items = { ...state.items }
    for (const path of channelItemPaths(state, params.channel)) {
      const item = yield* decodeItem(state.items[path] ?? new Uint8Array())
      const kept: Item = { ...item, sig: orderedSignatures(item, remaining, channelKeys) }
      const verified = yield* Effect.result(
        verifyItemSignatures(kept, remaining, combined(remaining, channelKeys)),
      )
      if (verified._tag === 'Failure') {
        delete targets[path]
        delete items[path]
        continue
      }
      items[path] = encodeItem(kept)
      targets[path] = fileInfo(items[path])
    }
    return withChannelTargets(revoked, params.channel, targets, items, timing)
  })

/** `pub channel set`: master-signed display metadata (replaces the whole entry). */
export const editChannel = (
  state: RepoState,
  params: {
    readonly channel: string
    readonly displayName?: string
    readonly description?: string
  },
  timing: Timing,
): Effect.Effect<RepoState, Refused> => {
  if (!channelExists(state, params.channel)) {
    return Effect.fail(refuse('unknown-channel', `unknown channel ${params.channel}`))
  }
  const signed = state.targets.signed
  return Effect.succeed(
    withTargets(
      state,
      {
        ...signed,
        custom: {
          ...signed.custom,
          channels: {
            ...signed.custom.channels,
            [params.channel]: display(params.displayName, params.description),
          },
        },
      },
      timing,
    ),
  )
}

/** `pub company set`: company name and/or logo (identity ceremony on targets.json). */
export const editCompany = (
  state: RepoState,
  params: { readonly companyName?: string; readonly logo?: string; readonly logoSha256?: string },
  timing: Timing,
): Effect.Effect<RepoState, Refused> => {
  const problem = logoProblem(params.logo, params.logoSha256)
  if (problem) return Effect.fail(refuse('invalid-logo', problem))
  const { logo: _logo, logo_sha256: _sha, ...rest } = state.targets.signed.custom
  const custom =
    params.logo === undefined
      ? state.targets.signed.custom
      : { ...rest, ...logoFields(params.logo, params.logoSha256) }
  return Effect.succeed(
    withTargets(
      state,
      {
        ...state.targets.signed,
        custom: { ...custom, ...(params.companyName ? { company_name: params.companyName } : {}) },
      },
      timing,
    ),
  )
}

/** Re-sign `targets.json` before it expires (owner ceremony, mvp-spec E3). */
export const renewTargets = (state: RepoState, timing: Timing): RepoState =>
  withTargets(state, state.targets.signed, timing)

/** Re-sign `channels.<c>.json` with a fresh expiry (server, mvp-spec E2). */
export const renewChannel = (
  state: RepoState,
  channel: string,
  timing: Timing,
): Effect.Effect<RepoState, Refused> => {
  const current = state.channels[channel]
  return current
    ? Effect.succeed(
        withChannelTargets(state, channel, current.signed.targets, state.items, timing),
      )
    : Effect.fail(refuse('unknown-channel', `unknown channel ${channel}`))
}

/** Re-sign `channels.<c>.authors.json` (an author, mvp-spec E3 / B5). */
export const renewAuthors = (
  state: RepoState,
  channel: string,
  timing: Timing,
): Effect.Effect<RepoState, Refused> => {
  const current = state.authors[channel]
  if (!current) return Effect.fail(refuse('not-authored', `channel ${channel} has no authors role`))
  return Effect.succeed({
    ...repoState(state),
    authors: {
      ...state.authors,
      [channel]: { signatures: [], signed: bumped(current.signed, timing, 'authors') },
    },
  })
}

/** Snapshot pinning every non-root metadata file, one version past `previous`. */
export const buildSnapshot = (
  state: RepoState,
  previous: SnapshotMetadata | undefined,
  timing: Timing,
): SnapshotMetadata => ({
  signatures: [],
  signed: {
    _type: 'snapshot',
    spec_version: SPEC_VERSION,
    version: (previous?.signed.version ?? 0) + 1,
    expires: expiresAt(timing, 'snapshot'),
    meta: Object.fromEntries(
      pinnedMetadata(state).map(([file, doc]) => [
        file,
        { version: doc.signed.version, ...fileInfo(metadataFileBytes(doc)) },
      ]),
    ),
  },
})

/** Timestamp pinning a signed snapshot, one version past `previous`. */
export const buildTimestamp = (
  snapshot: SnapshotMetadata,
  previous: TimestampMetadata | undefined,
  timing: Timing,
): TimestampMetadata => ({
  signatures: [],
  signed: {
    _type: 'timestamp',
    spec_version: SPEC_VERSION,
    version: (previous?.signed.version ?? 0) + 1,
    expires: expiresAt(timing, 'timestamp'),
    meta: {
      'snapshot.json': {
        version: snapshot.signed.version,
        ...fileInfo(metadataFileBytes(snapshot)),
      },
    },
  },
})

const opsSign = <M extends SnapshotMetadata | TimestampMetadata>(
  state: RepoState,
  doc: M,
  role: 'snapshot' | 'timestamp',
  ops: Signer,
): Effect.Effect<M, Refused | SigningFailed> =>
  signMetadata(doc, ops, authorityOf(state, role) as Authority)

/**
 * Builds and signs snapshot + timestamp with the ops key, bumping both past the
 * published repo (`previous`; none for a fresh repo).
 */
export const withFreshness = (
  state: RepoState,
  previous: Repo | undefined,
  ops: Signer,
  timing: Timing,
): Effect.Effect<Repo, Refused | SigningFailed> =>
  Effect.gen(function* () {
    const snapshot = yield* opsSign(
      state,
      buildSnapshot(state, previous?.snapshot, timing),
      'snapshot',
      ops,
    )
    const timestamp = yield* opsSign(
      state,
      buildTimestamp(snapshot, previous?.timestamp, timing),
      'timestamp',
      ops,
    )
    return { ...repoState(state), snapshot, timestamp }
  })

/** `pub refresh-timestamp` (mvp-spec E1): a new timestamp over the current snapshot. */
export const refreshTimestamp = (
  repo: Repo,
  ops: Signer,
  timing: Timing,
): Effect.Effect<Repo, Refused | SigningFailed> =>
  Effect.map(
    opsSign(repo, buildTimestamp(repo.snapshot, repo.timestamp, timing), 'timestamp', ops),
    (timestamp) => ({
      ...repo,
      timestamp,
    }),
  )
