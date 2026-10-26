/** What the real server does to a company repo, reduced to the mock's needs. */
import { Refused as ApiRefused, RepoInvalid } from '@keryx-kit/api'
import {
  authorsRoleName,
  currentRoot,
  decodeItem,
  type Item,
  type Refused,
  type RepoState,
  type SigningFailed,
  seedSigner,
  signRole,
  validateRepo,
  withFreshness,
} from '@keryx-kit/domain'
import { Effect } from 'effect'
import type { MockCompany } from './state.ts'

export const nowIso = () => new Date().toISOString()

export const toApiError = (error: Refused | SigningFailed): ApiRefused =>
  error._tag === 'Refused'
    ? new ApiRefused({ error: error.message, code: error.code })
    : new ApiRefused({ error: 'A server key failed to sign.', code: 'invalid-metadata' })

export const domain = <A>(effect: Effect.Effect<A, Refused | SigningFailed>) =>
  Effect.mapError(effect, toApiError)

export const masterKeyid = (company: MockCompany): string =>
  currentRoot(company.repo).signed.roles.targets.keyids[0] ?? ''

export const authorKeyids = (state: RepoState, channel: string): ReadonlyArray<string> =>
  state.targets.signed.delegations.roles.find((r) => r.name === authorsRoleName(channel))?.keyids ??
  []

/** Channel role metadata the operation left unsigned, signed with the server-held channel key. */
export const signChannelRoles = (company: MockCompany, state: RepoState) =>
  Effect.gen(function* () {
    let next = state
    for (const [channel, doc] of Object.entries(state.channels)) {
      const seed = company.channelSeeds[channel]
      if (doc.signatures.length === 0 && seed)
        next = yield* signRole(next, `channels.${channel}`, seedSigner(seed))
    }
    return next
  })

/** Ops-signs snapshot and timestamp over `state` and returns the full repo plus its issues. */
export const candidate = (company: MockCompany, state: RepoState) =>
  Effect.gen(function* () {
    const signed = yield* signChannelRoles(company, state)
    const repo = yield* withFreshness(signed, company.repo, seedSigner(company.opsSeed), {
      now: new Date(),
    })
    return { repo, issues: validateRepo(repo, { previous: company.repo }) }
  })

/** Publishes `state` atomically, or fails with the validation issues. */
export const publish = (company: MockCompany, state: RepoState) =>
  Effect.gen(function* () {
    const { repo, issues } = yield* domain(candidate(company, state))
    const [first] = issues
    if (first) return yield* new RepoInvalid({ error: first.message, issues })
    company.repo = repo
    company.lastTimestampAt = nowIso()
  })

export const channelItems = (state: RepoState, channel: string): ReadonlyArray<Item> =>
  Object.keys(state.channels[channel]?.signed.targets ?? {}).flatMap((path) => {
    const bytes = state.items[path]
    if (!bytes) return []
    const decoded = Effect.runSync(Effect.option(decodeItem(bytes)))
    return decoded._tag === 'Some' ? [decoded.value] : []
  })

/** Metadata versions that differ between two repos, for the audit log. */
export const changedVersions = (before: RepoState, after: RepoState): Record<string, number> => {
  const versions = (state: RepoState): Record<string, number> => ({
    'root.json': currentRoot(state).signed.version,
    'targets.json': state.targets.signed.version,
    ...Object.fromEntries(
      Object.entries(state.channels).map(([c, doc]) => [`channels.${c}.json`, doc.signed.version]),
    ),
    ...Object.fromEntries(
      Object.entries(state.authors).map(([c, doc]) => [
        `channels.${c}.authors.json`,
        doc.signed.version,
      ]),
    ),
  })
  const was = versions(before)
  return Object.fromEntries(Object.entries(versions(after)).filter(([file, v]) => was[file] !== v))
}
