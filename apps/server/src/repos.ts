import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { RepoInvalid } from '@keryx-kit/api'
import {
  authorityOf,
  bytesEqual,
  currentRoot,
  meetsThreshold,
  parseRepoFiles,
  type Repo,
  type RepoFiles,
  type RepoState,
  repoFiles,
  signRole,
  validateRepo,
  withFreshness,
} from '@keryx-kit/domain'
import { Context, Effect, Layer, Semaphore } from 'effect'
import { SqlClient } from 'effect/sql'
import { ServerConfig } from './config.ts'
import { randomToken } from './crypto.ts'
import { serverSigner } from './serverKeys.ts'
import { orDieSql } from './sql.ts'
import { iso, now, Time } from './time.ts'

const listFiles = async (root: string): Promise<Record<string, Uint8Array>> => {
  const out: Record<string, Uint8Array> = {}
  let entries: Array<string>
  try {
    entries = await readdir(root, { recursive: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (entry.includes('.tmp-')) continue
    try {
      out[entry.split('\\').join('/')] = new Uint8Array(await readFile(join(root, entry)))
    } catch {
      // a directory
    }
  }
  return out
}

const writeAtomic = async (path: string, bytes: Uint8Array) => {
  await mkdir(dirname(path), { recursive: true })
  const temp = `${path}.tmp-${randomToken(6)}`
  await writeFile(temp, bytes)
  await rename(temp, path)
}

/** Clients must never see a timestamp that pins files not yet written (mvp-spec task 3). */
const baseWriteRank = (path: string): number => {
  if (path.startsWith('channels/')) return 0
  if (path.startsWith('channels.')) return 1
  if (path === 'targets.json') return 2
  if (path === 'snapshot.json') return 3
  if (path === 'timestamp.json') return 4
  return 0
}

export const issuesError = (
  issues: ReadonlyArray<{ code: string; file: string; message: string }>,
) =>
  new RepoInvalid({
    error: `The repo would not be valid: ${issues.map((i) => `${i.file}: ${i.message}`).join('; ')}`,
    issues: issues as RepoInvalid['issues'],
  })

const versionsOf = (repo: Repo): Record<string, number> => ({
  ...Object.fromEntries(repo.roots.map((root) => [`${root.signed.version}.root.json`, 1])),
  'targets.json': repo.targets.signed.version,
  'snapshot.json': repo.snapshot.signed.version,
  'timestamp.json': repo.timestamp.signed.version,
  ...Object.fromEntries(
    Object.entries(repo.channels).map(([c, doc]) => [`channels.${c}.json`, doc.signed.version]),
  ),
  ...Object.fromEntries(
    Object.entries(repo.authors).map(([c, doc]) => [
      `channels.${c}.authors.json`,
      doc.signed.version,
    ]),
  ),
})

/** Metadata versions a write changed, for the audit log. */
export const changedVersions = (previous: Repo | undefined, next: Repo): Record<string, number> => {
  const before = previous ? versionsOf(previous) : {}
  const after = versionsOf(next)
  const changed: Record<string, number> = {}
  for (const [file, version] of Object.entries(after)) {
    if (file.endsWith('.root.json')) continue
    if (before[file] !== version) changed[file] = version
  }
  const root = currentRoot(next).signed.version
  if (!previous || currentRoot(previous).signed.version !== root) changed['root.json'] = root
  return changed
}

export class Repos extends Context.Service<
  Repos,
  {
    readonly published: (slug: string) => Effect.Effect<Repo>
    readonly directory: (slug: string) => { readonly anchor: string; readonly base: string }
    /** Validates `next` against `previous` and writes it. Run inside `locked`. */
    readonly write: (
      slug: string,
      previous: Repo | undefined,
      next: Repo,
    ) => Effect.Effect<Repo, RepoInvalid>
    /** Serializes every read-modify-write of every repo. */
    readonly locked: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
  }
>()('keryx-kit/Repos') {}

export const ReposLive = Layer.effect(Repos)(
  Effect.gen(function* () {
    const config = yield* ServerConfig
    const time = yield* Time
    const lock = yield* Semaphore.make(1)
    const cache = new Map<string, Repo>()
    const directory = (slug: string) => ({
      anchor: join(config.dataDir, 'repos', slug, 'anchor'),
      base: join(config.dataDir, 'repos', slug, 'base'),
    })

    const load = (slug: string) =>
      Effect.gen(function* () {
        const dir = directory(slug)
        const files: RepoFiles = yield* Effect.promise(async () => ({
          anchor: await listFiles(dir.anchor),
          base: await listFiles(dir.base),
        }))
        return yield* Effect.orDie(parseRepoFiles(files))
      })

    const published = (slug: string) =>
      Effect.suspend(() => {
        const cached = cache.get(slug)
        return cached
          ? Effect.succeed(cached)
          : Effect.tap(load(slug), (repo) => Effect.sync(() => cache.set(slug, repo)))
      })

    const writeFiles = (slug: string, previous: Repo | undefined, next: Repo) =>
      Effect.promise(async () => {
        const dir = directory(slug)
        const before = previous ? repoFiles(previous) : { anchor: {}, base: {} }
        const after = repoFiles(next)
        const changed = (
          old: Readonly<Record<string, Uint8Array>>,
          path: string,
          bytes: Uint8Array,
        ) => old[path] === undefined || !bytesEqual(old[path], bytes)
        for (const [path, bytes] of Object.entries(after.anchor)) {
          if (changed(before.anchor, path, bytes)) await writeAtomic(join(dir.anchor, path), bytes)
        }
        const base = Object.entries(after.base).sort(
          ([a], [b]) => baseWriteRank(a) - baseWriteRank(b),
        )
        for (const [path, bytes] of base) {
          if (changed(before.base, path, bytes)) await writeAtomic(join(dir.base, path), bytes)
        }
        for (const path of Object.keys(before.base)) {
          if (after.base[path] === undefined) await rm(join(dir.base, path), { force: true })
        }
      })

    const write = (slug: string, previous: Repo | undefined, next: Repo) =>
      Effect.gen(function* () {
        const issues = validateRepo(next, { previous, now: yield* time.now })
        if (issues.length > 0) return yield* issuesError(issues)
        yield* writeFiles(slug, previous, next)
        cache.set(slug, next)
        return next
      })

    return Repos.of({
      published,
      directory,
      write,
      // A client abort must not stop a write halfway or skip the bookkeeping after it.
      locked: (effect) => lock.withPermits(1)(Effect.uninterruptible(effect)),
    })
  }),
)

/** Signs every channel role the change left unsigned with its server-held channel key. */
export const signServerRoles = (slug: string, state: RepoState) =>
  Effect.gen(function* () {
    let next = state
    for (const [channel, doc] of Object.entries(state.channels)) {
      const role = `channels.${channel}` as const
      const authority = authorityOf(next, role)
      if (!authority || meetsThreshold(doc, authority)) continue
      for (const keyid of authority.keyids) {
        const signer = yield* serverSigner(slug, keyid)
        if (signer) next = yield* Effect.orDie(signRole(next, role, signer))
      }
    }
    return next
  })

/** Server roles, fresh snapshot and timestamp, validation, atomic write. */
export const commit = (slug: string, previous: Repo | undefined, state: RepoState) =>
  Effect.gen(function* () {
    const repos = yield* Repos
    const signed = yield* signServerRoles(slug, state)
    const root = currentRoot(signed).signed
    const opsKeyid = root.roles.timestamp.keyids[0] ?? ''
    const ops = yield* serverSigner(slug, opsKeyid)
    if (!ops) return yield* Effect.die(new Error(`no ops key for ${slug}`))
    const timing = { now: yield* now }
    const next = yield* Effect.orDie(withFreshness(signed, previous, ops, timing))
    const written = yield* repos.write(slug, previous, next)
    yield* markTimestamp(slug)
    return written
  })

export const markTimestamp = (slug: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`UPDATE companies SET last_timestamp_at = ${iso(yield* now)} WHERE slug = ${slug}`
  }).pipe(orDieSql)
