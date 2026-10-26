/**
 * Full repo check as a client sees it (Go `tufrepo.Verify` + `Expired`, the subscriber
 * app's `tuf.ts` rules) plus what a server must check before applying a change:
 * versions monotonic against the published repo and authored channels only.
 */
import { Effect } from 'effect'
import { bytesEqual, sha256Hex } from './bytes.ts'
import { keyidOf } from './crypto.ts'
import { decodeItem, itemContentProblem, itemPath, verifyItemSignatures } from './item.ts'
import { type Authority, meetsThreshold, metadataFileBytes } from './metadata.ts'
import {
  authorityOf,
  authorsRoleName,
  channelRoleName,
  currentRoot,
  parseRoleName,
  pinnedMetadata,
  type Repo,
  type RepoState,
} from './repo.ts'
import {
  type AnyMetadata,
  CHANNEL_NAME,
  type Key,
  type MetaFile,
  type RootMetadata,
} from './schema.ts'

export type IssueCode =
  | 'root-chain'
  | 'structure'
  | 'keyid-mismatch'
  | 'signature-threshold'
  | 'pin-mismatch'
  | 'key-overlap'
  | 'not-authored'
  | 'item-invalid'
  | 'expired'
  | 'version-rollback'
  | 'version-not-bumped'
  | 'metadata-removed'

export interface Issue {
  readonly code: IssueCode
  readonly file: string
  readonly message: string
}

export interface ValidateOptions {
  /** The currently published repo: versions must move forward from it. */
  readonly previous?: Repo | undefined
  /** Reject expired metadata (as `pub validate --strict`). */
  readonly now?: Date | undefined
}

type Report = (code: IssueCode, file: string, message: string) => void

const checkThreshold = (
  report: Report,
  file: string,
  doc: AnyMetadata,
  authority: Authority | undefined,
) => {
  if (!authority) return report('structure', file, 'no role authorizes this metadata')
  if (!meetsThreshold(doc, authority)) {
    report(
      'signature-threshold',
      file,
      `fewer than ${authority.threshold} valid signatures by ${authority.keyids.join(', ')}`,
    )
  }
}

const checkKeyids = (report: Report, file: string, keys: Readonly<Record<string, Key>>) => {
  for (const [keyid, key] of Object.entries(keys)) {
    if (keyidOf(key) !== keyid)
      report('keyid-mismatch', file, `key object does not match keyid ${keyid}`)
  }
}

const checkPin = (report: Report, file: string, pin: MetaFile | undefined, doc: AnyMetadata) => {
  if (!pin) return report('pin-mismatch', file, 'not pinned')
  const bytes = metadataFileBytes(doc)
  if (pin.version !== doc.signed.version) {
    report('pin-mismatch', file, `pinned v${pin.version}, have v${doc.signed.version}`)
  }
  if (pin.length !== bytes.length || pin.hashes.sha256 !== sha256Hex(bytes)) {
    report('pin-mismatch', file, 'length or sha256 differs from the pin')
  }
}

const checkRootChain = (report: Report, roots: ReadonlyArray<RootMetadata>) => {
  for (const [i, root] of roots.entries()) {
    const file = `${i + 1}.root.json`
    if (root.signed.version !== i + 1) {
      report('root-chain', file, `declares version ${root.signed.version}`)
      continue
    }
    const own = { keys: root.signed.keys, ...root.signed.roles.root }
    if (!meetsThreshold(root, own)) report('root-chain', file, 'not signed by its own root role')
    const prev = roots[i - 1]
    if (prev && !meetsThreshold(root, { keys: prev.signed.keys, ...prev.signed.roles.root })) {
      report('root-chain', file, `not signed by the root role of v${i}`)
    }
    checkKeyids(report, file, root.signed.keys)
  }
  const root = roots.at(-1)?.signed
  if (!root) return report('root-chain', 'root.json', 'no root')
  if (root.consistent_snapshot)
    report('structure', 'root.json', 'consistent_snapshot must be false')
  if (root.custom.repo_base === '') report('structure', 'root.json', 'custom.repo_base missing')
  if (root.custom.mode !== 'full')
    report('structure', 'root.json', `custom.mode ${root.custom.mode} not supported`)
}

const checkTargetsCustom = (report: Report, state: RepoState) => {
  const custom = state.targets.signed.custom
  const { logo, logo_sha256 } = custom
  if (logo !== undefined && logo !== '') {
    const ok = logo.startsWith('data:')
      ? logo.includes(';base64,')
      : logo.startsWith('https://') && logo_sha256 !== undefined
    if (!ok)
      report(
        'structure',
        'targets.json',
        'custom.logo must be a base64 data URL or HTTPS URL with logo_sha256',
      )
  }
  for (const [i, entry] of custom.private_feed_patterns.entries()) {
    for (const keyid of entry.keyids) {
      if (!entry.keys[keyid])
        report('structure', 'targets.json', `private_feed_patterns[${i}]: key ${keyid} missing`)
    }
    checkKeyids(report, 'targets.json', entry.keys)
  }
}

const checkDelegations = (report: Report, state: RepoState) => {
  const { keys, roles } = state.targets.signed.delegations
  checkKeyids(report, 'targets.json', keys)
  const channelKeyids = new Set<string>()
  for (const role of roles) {
    const parsed = parseRoleName(role.name)
    if (!parsed || !CHANNEL_NAME.test(parsed.channel)) {
      report(
        'structure',
        'targets.json',
        `delegation ${role.name}: role name must be channels.<channel>`,
      )
      continue
    }
    const wantTerminating = parsed.kind === 'channel'
    if (role.terminating !== wantTerminating) {
      report(
        'structure',
        'targets.json',
        `delegation ${role.name}: terminating must be ${wantTerminating}`,
      )
    }
    const want = `channels/${parsed.channel}/*`
    if (role.paths.length !== 1 || role.paths[0] !== want) {
      report('structure', 'targets.json', `delegation ${role.name}: paths must be [${want}]`)
    }
    if (role.keyids.length === 0 || role.threshold > role.keyids.length) {
      report('structure', 'targets.json', `delegation ${role.name}: threshold cannot be met`)
    }
    for (const keyid of role.keyids) {
      if (!keys[keyid])
        report('structure', 'targets.json', `delegation ${role.name}: key ${keyid} missing`)
      if (parsed.kind === 'channel') channelKeyids.add(keyid)
    }
    const doc = (parsed.kind === 'channel' ? state.channels : state.authors)[parsed.channel]
    if (!doc) report('structure', `${role.name}.json`, 'role metadata missing')
  }
  for (const role of roles) {
    const parsed = parseRoleName(role.name)
    if (parsed?.kind !== 'authors') continue
    if (!roles.some((r) => r.name === channelRoleName(parsed.channel))) {
      report('structure', 'targets.json', `${role.name}: channel role missing`)
    }
    for (const keyid of role.keyids) {
      if (channelKeyids.has(keyid))
        report('key-overlap', 'targets.json', `${role.name}: ${keyid} is a channel key`)
    }
  }
  for (const channel of Object.keys(state.channels)) {
    if (!roles.some((r) => r.name === authorsRoleName(channel))) {
      report('not-authored', 'targets.json', `channel ${channel} has no authors role`)
    }
  }
}

const checkRoleMetadata = (report: Report, state: RepoState) => {
  for (const [kind, docs] of [
    ['channel', state.channels],
    ['authors', state.authors],
  ] as const) {
    for (const [channel, doc] of Object.entries(docs)) {
      const role = kind === 'channel' ? channelRoleName(channel) : authorsRoleName(channel)
      const file = `${role}.json`
      checkThreshold(report, file, doc, authorityOf(state, role))
      const { keys, roles } = doc.signed.delegations
      if (Object.keys(keys).length > 0 || roles.length > 0)
        report('structure', file, 'must not delegate')
      if (kind === 'authors' && Object.keys(doc.signed.targets).length > 0) {
        report('structure', file, 'authors role must pin no targets')
      }
    }
  }
}

const checkItems = (report: Report, state: RepoState) =>
  Effect.gen(function* () {
    const indexed = new Set<string>()
    for (const [channel, doc] of Object.entries(state.channels)) {
      const authors = authorityOf(state, authorsRoleName(channel))
      const channelKeys = authorityOf(state, channelRoleName(channel))
      for (const [path, info] of Object.entries(doc.signed.targets)) {
        indexed.add(path)
        const bytes = state.items[path]
        if (
          !path.startsWith(`channels/${channel}/`) ||
          path.slice(`channels/${channel}/`.length).includes('/')
        ) {
          report('structure', path, `outside the ${channel} namespace`)
          continue
        }
        if (!bytes) {
          report('item-invalid', path, 'item file missing')
          continue
        }
        if (info.length !== bytes.length || info.hashes.sha256 !== sha256Hex(bytes)) {
          report('pin-mismatch', path, 'length or sha256 differs from the index')
        }
        const decoded = yield* Effect.result(decodeItem(bytes))
        if (decoded._tag === 'Failure') {
          report('item-invalid', path, decoded.failure.message)
          continue
        }
        const item = decoded.success
        if (itemPath(channel, item.id) !== path)
          report('item-invalid', path, `item id ${item.id} != path`)
        const problem = itemContentProblem(item)
        if (problem) report('item-invalid', path, problem)
        if (!authors || !channelKeys) continue
        const known = {
          keys: authors.keys,
          keyids: [...authors.keyids, ...channelKeys.keyids],
          threshold: 1,
        }
        const verified = yield* Effect.result(verifyItemSignatures(item, authors, known))
        if (verified._tag === 'Failure') report('item-invalid', path, verified.failure.message)
      }
    }
    for (const path of Object.keys(state.items)) {
      if (!indexed.has(path)) report('structure', path, 'item file is not in any channel index')
    }
  })

const checkFreshness = (report: Report, repo: Repo) => {
  checkThreshold(report, 'timestamp.json', repo.timestamp, authorityOf(repo, 'timestamp'))
  checkThreshold(report, 'snapshot.json', repo.snapshot, authorityOf(repo, 'snapshot'))
  checkPin(report, 'snapshot.json', repo.timestamp.signed.meta['snapshot.json'], repo.snapshot)
  const pinned = pinnedMetadata(repo)
  for (const [file, doc] of pinned) checkPin(report, file, repo.snapshot.signed.meta[file], doc)
  for (const file of Object.keys(repo.snapshot.signed.meta)) {
    if (!pinned.some(([name]) => name === file))
      report('structure', 'snapshot.json', `pins unknown ${file}`)
  }
}

const allMetadata = (
  repo: RepoState & Partial<Repo>,
): ReadonlyArray<readonly [string, AnyMetadata]> => [
  ...repo.roots.map((root) => [`${root.signed.version}.root.json`, root] as const),
  ...pinnedMetadata(repo),
  ...(repo.snapshot ? [['snapshot.json', repo.snapshot] as const] : []),
  ...(repo.timestamp ? [['timestamp.json', repo.timestamp] as const] : []),
]

const checkExpiry = (report: Report, repo: RepoState & Partial<Repo>, now: Date) => {
  for (const [file, doc] of allMetadata(repo).filter(([file]) => !/^\d+\.root\.json$/.test(file))) {
    if (Date.parse(doc.signed.expires) < now.getTime())
      report('expired', file, `expired ${doc.signed.expires}`)
  }
  const root = currentRoot(repo)
  if (Date.parse(root.signed.expires) < now.getTime())
    report('expired', 'root.json', `expired ${root.signed.expires}`)
}

const checkMonotonic = (report: Report, repo: RepoState & Partial<Repo>, previous: Repo) => {
  const current = new Map(allMetadata(repo))
  for (const [file, before] of allMetadata(previous)) {
    const after = current.get(file)
    if (!after) {
      report('metadata-removed', file, 'published metadata disappeared')
      continue
    }
    if (after.signed.version < before.signed.version) {
      report(
        'version-rollback',
        file,
        `v${after.signed.version} is older than published v${before.signed.version}`,
      )
    } else if (
      after.signed.version === before.signed.version &&
      !bytesEqual(metadataFileBytes(after), metadataFileBytes(before))
    ) {
      report(
        'version-not-bumped',
        file,
        `changed without a version bump (v${after.signed.version})`,
      )
    }
  }
}

/**
 * Every problem a client (or the server's own rules) would reject. Empty means valid.
 * Snapshot and timestamp are checked when present, so a staged change without
 * freshness yet lists only its missing pieces (e.g. an authors signature).
 */
export const validateRepo = (
  repo: RepoState & Partial<Repo>,
  options: ValidateOptions = {},
): ReadonlyArray<Issue> => {
  const issues: Array<Issue> = []
  const report: Report = (code, file, message) => {
    issues.push({ code, file, message })
  }
  checkRootChain(report, repo.roots)
  checkThreshold(report, 'targets.json', repo.targets, authorityOf(repo, 'targets'))
  checkTargetsCustom(report, repo)
  checkDelegations(report, repo)
  checkRoleMetadata(report, repo)
  Effect.runSync(checkItems(report, repo))
  if (repo.snapshot && repo.timestamp)
    checkFreshness(report, { ...repo, snapshot: repo.snapshot, timestamp: repo.timestamp })
  if (options.now) checkExpiry(report, repo, options.now)
  if (options.previous) checkMonotonic(report, repo, options.previous)
  return issues
}
