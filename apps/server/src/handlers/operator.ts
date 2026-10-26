import { timingSafeEqual } from 'node:crypto'
import { CurrentOwner, InvalidRequest, KeryxKitApi, LoginFailed } from '@keryx-kit/api'
import { currentRoot } from '@keryx-kit/domain'
import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { SqlClient } from 'effect/sql'
import { normalize, validate } from '../../../site/src/pilot-request.ts'
import { ServerConfig } from '../config.ts'
import { randomToken, sha256Hex } from '../crypto.ts'
import { refreshDomain } from '../jobs.ts'
import { buildJoinKit } from '../joinKit.ts'
import { Repos } from '../repos.ts'
import { endSession, rateLimit, startSession } from '../sessions.ts'
import { orDieSql } from '../sql.ts'
import { allCompanies, findCompany } from '../store.ts'
import { iso, now } from '../time.ts'
import { domainView } from '../views.ts'

export const JoinLive = HttpApiBuilder.group(KeryxKitApi, 'join', (handlers) =>
  handlers
    .handle('kit', () =>
      Effect.gen(function* () {
        const owner = yield* CurrentOwner
        const repos = yield* Repos
        const company = yield* findCompany(owner.companySlug)
        const published = yield* repos.published(owner.companySlug)
        return buildJoinKit(published, company?.join_origin ?? '')
      }),
    )
    .handle('checkDomain', () =>
      Effect.gen(function* () {
        yield* rateLimit('domain-check')
        const owner = yield* CurrentOwner
        return yield* refreshDomain(owner.companySlug)
      }),
    ),
)

const sameSecret = (a: string, b: string) =>
  timingSafeEqual(Buffer.from(sha256Hex(a)), Buffer.from(sha256Hex(b)))

export const OperatorLive = HttpApiBuilder.group(KeryxKitApi, 'operator', (handlers) =>
  handlers
    .handle('login', ({ payload }) =>
      Effect.gen(function* () {
        yield* rateLimit('operator-login')
        const config = yield* ServerConfig
        const expected = yield* Effect.promise(() =>
          Bun.file(config.operatorTokenFile)
            .text()
            .then((text) => text.trim())
            .catch(() => ''),
        )
        if (expected === '' || !sameSecret(payload.token.trim(), expected)) {
          return yield* new LoginFailed({ error: 'That operator token is not valid.' })
        }
        yield* startSession('operator')
      }),
    )
    .handle('logout', () => endSession('operator'))
    .handle('dashboard', () =>
      Effect.gen(function* () {
        const repos = yield* Repos
        const companies = []
        for (const company of yield* allCompanies) {
          const repo = yield* repos.published(company.slug)
          companies.push({
            slug: company.slug,
            name: company.name,
            joinOrigin: company.join_origin,
            contactEmail: company.contact_email,
            createdAt: company.created_at,
            domain: domainView(company),
            ...(company.last_timestamp_at ? { lastTimestampAt: company.last_timestamp_at } : {}),
            expires: {
              root: currentRoot(repo).signed.expires,
              targets: repo.targets.signed.expires,
              snapshot: repo.snapshot.signed.expires,
              timestamp: repo.timestamp.signed.expires,
              channels: Object.entries(repo.channels).map(([channel, doc]) => ({
                channel,
                channelMetadata: doc.signed.expires,
                authorsMetadata: repo.authors[channel]?.signed.expires ?? doc.signed.expires,
              })),
            },
          })
        }
        return { companies }
      }),
    )
    .handle('inviteCodes', () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const rows = yield* sql<{
          code: string
          note: string
          created_at: string
          used_at: string | null
          used_by: string | null
        }>`SELECT * FROM invite_codes ORDER BY created_at DESC`
        return rows.map((row) => ({
          code: row.code,
          note: row.note,
          createdAt: row.created_at,
          ...(row.used_at ? { usedAt: row.used_at } : {}),
          ...(row.used_by ? { usedBy: row.used_by } : {}),
        }))
      }).pipe(orDieSql),
    )
    .handle('createInviteCode', ({ payload }) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const code = {
          code: `keryx-${randomToken(9)}`,
          note: payload.note,
          createdAt: iso(yield* now),
        }
        yield* sql`INSERT INTO invite_codes ${sql.insert({
          code: code.code,
          note: code.note,
          created_at: code.createdAt,
        })}`
        return code
      }).pipe(orDieSql),
    )
    .handle('pilotRequests', () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const rows = yield* sql<{
          id: string
          company: string
          name: string
          email: string
          message: string
          created_at: string
        }>`SELECT * FROM pilot_requests ORDER BY created_at DESC`
        return rows.map(({ created_at, ...row }) => ({ ...row, createdAt: created_at }))
      }).pipe(orDieSql),
    ),
)

const unknownRelease = { gitSha: process.env.GIT_SHA ?? 'dev', consoleBundleSha256: 'unknown' }

export const PublicLive = HttpApiBuilder.group(KeryxKitApi, 'public', (handlers) =>
  Effect.gen(function* () {
    const config = yield* ServerConfig
    const release = yield* Effect.promise(() =>
      Bun.file(config.releaseFile)
        .json()
        .then((json: { gitSha?: unknown; consoleBundleSha256?: unknown }) => ({
          gitSha: String(json.gitSha ?? unknownRelease.gitSha),
          consoleBundleSha256: String(json.consoleBundleSha256 ?? 'unknown'),
        }))
        .catch(() => unknownRelease),
    )
    return handlers
      .handle('requestPilot', ({ payload }) =>
        Effect.gen(function* () {
          yield* rateLimit('pilot-request')
          const request = normalize(payload)
          const problem = Object.values(validate(request))[0]
          if (problem) return yield* new InvalidRequest({ error: problem })
          const sql = yield* SqlClient.SqlClient
          yield* sql`INSERT INTO pilot_requests ${sql.insert({
            id: randomToken(12),
            ...request,
            created_at: iso(yield* now),
          })}`
        }).pipe(orDieSql),
      )
      .handle('release', () => Effect.succeed(release))
  }),
)
