import { Effect, Schema } from 'effect'
import { bytesEqual, fromUtf8 } from './bytes.ts'
import type { Signer } from './crypto.ts'
import { type Refused, refuse, type SigningFailed } from './errors.ts'
import { type Authority, attachSignature, metadataFileBytes, signatureFor } from './metadata.ts'
import {
  type AnyMetadata,
  DelegatedTargetsMetadata,
  RootMetadata,
  type Signature,
  SnapshotMetadata,
  strict,
  TargetsMetadata,
  TimestampMetadata,
} from './schema.ts'

/** Everything a change touches. Snapshot and timestamp are rebuilt after every change. */
export interface RepoState {
  /** Every released root, `roots[i]` is version `i + 1`. */
  readonly roots: ReadonlyArray<RootMetadata>
  readonly targets: TargetsMetadata
  /** `channels.<c>.json` by channel name. */
  readonly channels: Readonly<Record<string, DelegatedTargetsMetadata>>
  /** `channels.<c>.authors.json` by channel name. */
  readonly authors: Readonly<Record<string, DelegatedTargetsMetadata>>
  /** Item file bytes by target path (`channels/<c>/<id>.json`). */
  readonly items: Readonly<Record<string, Uint8Array>>
}

export interface Repo extends RepoState {
  readonly snapshot: SnapshotMetadata
  readonly timestamp: TimestampMetadata
}

export const repoState = (repo: RepoState): RepoState => ({
  roots: repo.roots,
  targets: repo.targets,
  channels: repo.channels,
  authors: repo.authors,
  items: repo.items,
})

export const currentRoot = (state: Pick<RepoState, 'roots'>): RootMetadata => {
  const root = state.roots.at(-1)
  if (root === undefined) throw new Error('repo has no root')
  return root
}

export const channelRoleName = (channel: string): string => `channels.${channel}`
export const authorsRoleName = (channel: string): string => `channels.${channel}.authors`

const topLevelRoles = ['root', 'targets', 'snapshot', 'timestamp'] as const
type TopLevelRole = (typeof topLevelRoles)[number]
const isTopLevel = (role: string): role is TopLevelRole =>
  (topLevelRoles as ReadonlyArray<string>).includes(role)

/** Keys and threshold that may sign `role`, as the given state authorizes them. */
export const authorityOf = (state: RepoState, role: string): Authority | undefined => {
  if (isTopLevel(role)) {
    const root = currentRoot(state).signed
    return { keys: root.keys, ...root.roles[role] }
  }
  const delegations = state.targets.signed.delegations
  const delegation = delegations.roles.find((r) => r.name === role)
  return (
    delegation && {
      keys: delegations.keys,
      keyids: delegation.keyids,
      threshold: delegation.threshold,
    }
  )
}

/** Splits `channels.<c>` / `channels.<c>.authors` into channel and kind. */
export const parseRoleName = (
  role: string,
): { readonly channel: string; readonly kind: 'channel' | 'authors' } | undefined => {
  if (!role.startsWith('channels.')) return undefined
  const rest = role.slice('channels.'.length)
  return rest.endsWith('.authors')
    ? { channel: rest.slice(0, -'.authors'.length), kind: 'authors' }
    : { channel: rest, kind: 'channel' }
}

type SignableRole = 'root' | 'targets' | `channels.${string}`

const roleDocument = (state: RepoState, role: SignableRole): AnyMetadata | undefined => {
  if (role === 'root') return currentRoot(state)
  if (role === 'targets') return state.targets
  const parsed = parseRoleName(role)
  if (!parsed) return undefined
  return (parsed.kind === 'channel' ? state.channels : state.authors)[parsed.channel]
}

const withRoleDocument = (state: RepoState, role: SignableRole, doc: AnyMetadata): RepoState => {
  if (role === 'root')
    return { ...state, roots: [...state.roots.slice(0, -1), doc as RootMetadata] }
  if (role === 'targets') return { ...state, targets: doc as TargetsMetadata }
  const parsed = parseRoleName(role)
  if (parsed?.kind === 'channel') {
    return {
      ...state,
      channels: { ...state.channels, [parsed.channel]: doc as DelegatedTargetsMetadata },
    }
  }
  if (parsed?.kind === 'authors') {
    return {
      ...state,
      authors: { ...state.authors, [parsed.channel]: doc as DelegatedTargetsMetadata },
    }
  }
  return state
}

/** The metadata of a role in the state, for showing or signing it. */
export const roleMetadata = (state: RepoState, role: SignableRole): AnyMetadata | undefined =>
  roleDocument(state, role)

/** Attach a signature for `role`, verified against the keys the state authorizes for it. */
export const attachRoleSignature = (
  state: RepoState,
  role: SignableRole,
  signature: Signature,
): Effect.Effect<RepoState, Refused> => {
  const doc = roleDocument(state, role)
  const authority = authorityOf(state, role)
  if (!doc || !authority) return Effect.fail(refuse('invalid-metadata', `no role ${role} in repo`))
  return Effect.map(attachSignature(doc, signature, authority), (signed) =>
    withRoleDocument(state, role, signed),
  )
}

export const signRole = (
  state: RepoState,
  role: SignableRole,
  signer: Signer,
): Effect.Effect<RepoState, Refused | SigningFailed> => {
  const doc = roleDocument(state, role)
  if (!doc) return Effect.fail(refuse('invalid-metadata', `no role ${role} in repo`))
  return Effect.flatMap(signatureFor(doc, signer), (signature) =>
    attachRoleSignature(state, role, signature),
  )
}

/** File name of a role's metadata in the repo base (or the anchor, for root). */
export const roleFile = (role: string): string => `${role}.json`

/** The repo as written by `pub`: the well-known anchor and the repo base (no root files). */
export interface RepoFiles {
  readonly anchor: Readonly<Record<string, Uint8Array>>
  readonly base: Readonly<Record<string, Uint8Array>>
}

/** Every non-root metadata file of the base with its document, as snapshot pins them. */
export const pinnedMetadata = (state: RepoState): ReadonlyArray<readonly [string, AnyMetadata]> => [
  ['targets.json', state.targets],
  ...Object.entries(state.channels).map(
    ([channel, doc]) => [roleFile(channelRoleName(channel)), doc] as const,
  ),
  ...Object.entries(state.authors).map(
    ([channel, doc]) => [roleFile(authorsRoleName(channel)), doc] as const,
  ),
]

export const repoFiles = (repo: Repo): RepoFiles => {
  const anchor: Record<string, Uint8Array> = {}
  for (const root of repo.roots)
    anchor[`${root.signed.version}.root.json`] = metadataFileBytes(root)
  anchor['root.json'] = metadataFileBytes(currentRoot(repo))
  const base: Record<string, Uint8Array> = {}
  for (const [file, doc] of pinnedMetadata(repo)) base[file] = metadataFileBytes(doc)
  base['snapshot.json'] = metadataFileBytes(repo.snapshot)
  base['timestamp.json'] = metadataFileBytes(repo.timestamp)
  for (const [path, bytes] of Object.entries(repo.items)) base[path] = bytes
  return { anchor, base }
}

const decodeFile = <S extends Schema.Codec<AnyMetadata, unknown>>(
  schema: S,
  files: Readonly<Record<string, Uint8Array>>,
  file: string,
): Effect.Effect<S['Type'], Refused> => {
  const bytes = files[file]
  if (bytes === undefined) return Effect.fail(refuse('invalid-repo', `${file} missing`))
  return Effect.try({
    try: () => JSON.parse(fromUtf8(bytes)) as unknown,
    catch: () => refuse('invalid-repo', `${file}: not JSON`),
  }).pipe(
    Effect.flatMap((json) => Schema.decodeUnknownEffect(schema)(json, strict)),
    Effect.mapError((error) =>
      error._tag === 'Refused' ? error : refuse('invalid-repo', `${file}: ${error.message}`),
    ),
    Effect.filterOrFail(
      (doc) => bytesEqual(metadataFileBytes(doc), bytes),
      () => refuse('invalid-repo', `${file}: not in go-tuf file encoding`),
    ),
  )
}

/** Load a repo from its files, as the Go SDK's `tufrepo.Load` does. Does not verify. */
export const parseRepoFiles = (files: RepoFiles): Effect.Effect<Repo, Refused> =>
  Effect.gen(function* () {
    const latest = yield* decodeFile(RootMetadata, files.anchor, 'root.json')
    const roots: Array<RootMetadata> = []
    for (let version = 1; version <= latest.signed.version; version++) {
      roots.push(yield* decodeFile(RootMetadata, files.anchor, `${version}.root.json`))
    }
    const versioned = files.anchor[`${latest.signed.version}.root.json`]
    if (!versioned || !bytesEqual(versioned, files.anchor['root.json'] as Uint8Array)) {
      return yield* refuse(
        'invalid-repo',
        `root.json differs from ${latest.signed.version}.root.json`,
      )
    }
    const targets = yield* decodeFile(TargetsMetadata, files.base, 'targets.json')
    const snapshot = yield* decodeFile(SnapshotMetadata, files.base, 'snapshot.json')
    const timestamp = yield* decodeFile(TimestampMetadata, files.base, 'timestamp.json')
    const channels: Record<string, DelegatedTargetsMetadata> = {}
    const authors: Record<string, DelegatedTargetsMetadata> = {}
    for (const role of targets.signed.delegations.roles) {
      const parsed = parseRoleName(role.name)
      if (!parsed) continue
      const doc = yield* decodeFile(DelegatedTargetsMetadata, files.base, roleFile(role.name))
      ;(parsed.kind === 'channel' ? channels : authors)[parsed.channel] = doc
    }
    const items: Record<string, Uint8Array> = {}
    for (const channel of Object.values(channels)) {
      for (const path of Object.keys(channel.signed.targets)) {
        const bytes = files.base[path]
        if (bytes === undefined) return yield* refuse('invalid-repo', `item ${path} missing`)
        items[path] = bytes
      }
    }
    return { roots, targets, snapshot, timestamp, channels, authors, items }
  })
