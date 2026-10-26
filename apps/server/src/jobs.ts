/** Scheduled work (mvp-spec §5.8). Each job is also callable on its own, for tests. */
import { currentRoot, type RepoState, refreshTimestamp, renewChannel } from '@keryx-kit/domain'
import { Duration, Effect, Schedule } from 'effect'
import { SqlClient } from 'effect/sql'
import { checkDomain } from './domainCheck.ts'
import { commit, markTimestamp, Repos } from './repos.ts'
import { serverSigner } from './serverKeys.ts'
import { orDieSql } from './sql.ts'
import { allCompanies, findCompany } from './store.ts'
import { addDays, iso, now } from './time.ts'
import { domainView } from './views.ts'

const SNAPSHOT_RENEW_DAYS = 7
const CHANNEL_RENEW_DAYS = 30

const forEachCompany = <E, R>(job: (slug: string) => Effect.Effect<void, E, R>) =>
  Effect.gen(function* () {
    for (const company of yield* allCompanies) {
      yield* job(company.slug).pipe(
        Effect.catchCause((cause) => Effect.logError(`job failed for ${company.slug}`, cause)),
      )
    }
  })

/** E1: a new timestamp over the current snapshot. */
export const refreshTimestampFor = (slug: string) =>
  Effect.gen(function* () {
    const repos = yield* Repos
    yield* repos.locked(
      Effect.gen(function* () {
        const published = yield* repos.published(slug)
        const opsKeyid = currentRoot(published).signed.roles.timestamp.keyids[0] ?? ''
        const ops = yield* serverSigner(slug, opsKeyid)
        if (!ops) return yield* Effect.die(new Error(`no ops key for ${slug}`))
        const next = yield* Effect.orDie(refreshTimestamp(published, ops, { now: yield* now }))
        yield* repos.write(slug, published, next)
        yield* markTimestamp(slug)
      }),
    )
  })

/** E2: channel metadata under 30 days and snapshot under 7 days get re-signed. */
export const renewServerMetadataFor = (slug: string) =>
  Effect.gen(function* () {
    const repos = yield* Repos
    yield* repos.locked(
      Effect.gen(function* () {
        const published = yield* repos.published(slug)
        const at = yield* now
        const soon = (expires: string, days: number) =>
          Date.parse(expires) < addDays(at, days).getTime()
        let state: RepoState = published
        let renew = soon(published.snapshot.signed.expires, SNAPSHOT_RENEW_DAYS)
        for (const [channel, doc] of Object.entries(published.channels)) {
          if (!soon(doc.signed.expires, CHANNEL_RENEW_DAYS)) continue
          state = yield* Effect.orDie(renewChannel(state, channel, { now: at }))
          renew = true
        }
        if (renew) yield* commit(slug, published, state)
      }),
    )
  })

/** A4: fetch the company's origin and record the result. */
export const refreshDomain = (slug: string) =>
  Effect.gen(function* () {
    const repos = yield* Repos
    const sql = yield* SqlClient.SqlClient
    const company = yield* findCompany(slug)
    if (!company) return yield* Effect.die(new Error(`unknown company ${slug}`))
    const result = yield* checkDomain(company.join_origin, yield* repos.published(slug))
    const checkedAt = iso(yield* now)
    const reason = result.status === 'live' ? null : result.reason
    yield* sql`UPDATE companies SET domain_status = ${result.status}, domain_reason = ${reason},
      domain_checked_at = ${checkedAt} WHERE slug = ${slug}`
    return domainView({
      ...company,
      domain_status: result.status,
      domain_reason: reason,
      domain_checked_at: checkedAt,
    })
  }).pipe(orDieSql)

export const refreshTimestamps = forEachCompany(refreshTimestampFor)
export const renewServerMetadata = forEachCompany(renewServerMetadataFor)
export const checkDomains = forEachCompany((slug) => Effect.asVoid(refreshDomain(slug)))

/**
 * Runs every job now and then on its cadence. Expiry reminders (E3) need no job: the
 * console reads `targetsExpires` and the authors expiry, and the operator dashboard lists
 * every expiry date.
 */
export const scheduledJobs = Effect.all(
  [
    Effect.repeat(refreshTimestamps, Schedule.spaced(Duration.hours(12))),
    Effect.repeat(renewServerMetadata, Schedule.spaced(Duration.hours(24))),
    Effect.repeat(checkDomains, Schedule.spaced(Duration.hours(24))),
  ],
  { concurrency: 'unbounded', discard: true },
)
