import {
  CurrentMember,
  CurrentOperator,
  CurrentOwner,
  CurrentTeamUser,
  MemberCookie,
  MemberSession,
  OperatorCookie,
  OperatorSession,
  OwnerCookie,
  OwnerSession,
  TeamSession,
  TooManyRequests,
  Unauthorized,
} from '@keryx-kit/api'
import { Context, Duration, Effect, Layer, Option, Redacted } from 'effect'
import { HttpServerRequest } from 'effect/http'
import { HttpApiBuilder, type HttpApiSecurity } from 'effect/http-api'
import { SqlClient } from 'effect/sql'
import { randomToken, sha256Hex } from './crypto.ts'
import { orDieSql } from './sql.ts'
import { addMs, iso, now, Time } from './time.ts'

type Kind = 'owner' | 'member' | 'operator'

const cookies: Record<Kind, HttpApiSecurity.ApiKey> = {
  owner: OwnerCookie,
  member: MemberCookie,
  operator: OperatorCookie,
}

const lifetime: Record<Kind, Duration.Duration> = {
  owner: Duration.hours(12),
  member: Duration.days(7),
  operator: Duration.hours(12),
}

const cookieOptions = { sameSite: 'strict', path: '/api' } as const

export const startSession = (
  kind: Kind,
  scope: { readonly companySlug?: string; readonly memberId?: string } = {},
) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const token = randomToken(32)
    const expiresAt = addMs(yield* now, Duration.toMillis(lifetime[kind]))
    yield* sql`INSERT INTO sessions ${sql.insert({
      token_hash: sha256Hex(token),
      kind,
      company_slug: scope.companySlug ?? null,
      member_id: scope.memberId ?? null,
      expires_at: iso(expiresAt),
    })}`
    yield* HttpApiBuilder.securitySetCookie(cookies[kind], token, {
      ...cookieOptions,
      maxAge: lifetime[kind],
    })
  }).pipe(orDieSql)

export const endSession = (kind: Kind) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const request = yield* HttpServerRequest.HttpServerRequest
    const token = request.cookies[cookies[kind].key]
    if (token) yield* sql`DELETE FROM sessions WHERE token_hash = ${sha256Hex(token)}`
    yield* HttpApiBuilder.securitySetCookie(cookies[kind], '', { ...cookieOptions, maxAge: 0 })
  }).pipe(orDieSql)

interface SessionRow {
  readonly company_slug: string | null
  readonly member_id: string | null
}

const findSession = (kind: Kind, credential: Redacted.Redacted<string>) =>
  Effect.gen(function* () {
    const token = Redacted.value(credential)
    if (token === '') return yield* new Unauthorized()
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<SessionRow>`SELECT company_slug, member_id FROM sessions
      WHERE token_hash = ${sha256Hex(token)} AND kind = ${kind}
      AND expires_at > ${iso(yield* now)}`
    const row = rows[0]
    return row ?? (yield* new Unauthorized())
  }).pipe(orDieSql)

const required = (value: string | null) => value ?? ''

export const SessionMiddlewareLive = Layer.mergeAll(
  Layer.effect(OwnerSession)(
    Effect.map(Effect.context<SqlClient.SqlClient | Time>(), (context) =>
      OwnerSession.of({
        owner: (effect, { credential }) =>
          findSession('owner', credential).pipe(
            Effect.provideContext(context),
            Effect.flatMap((row) =>
              Effect.provideService(effect, CurrentOwner, {
                companySlug: required(row.company_slug),
              }),
            ),
          ),
      }),
    ),
  ),
  Layer.effect(MemberSession)(
    Effect.map(Effect.context<SqlClient.SqlClient | Time>(), (context) =>
      MemberSession.of({
        member: (effect, { credential }) =>
          findSession('member', credential).pipe(
            Effect.provideContext(context),
            Effect.flatMap((row) =>
              Effect.provideService(effect, CurrentMember, {
                companySlug: required(row.company_slug),
                memberId: required(row.member_id),
              }),
            ),
          ),
      }),
    ),
  ),
  Layer.effect(TeamSession)(
    Effect.map(Effect.context<SqlClient.SqlClient | Time>(), (context) =>
      TeamSession.of({
        owner: (effect, { credential }) =>
          findSession('owner', credential).pipe(
            Effect.provideContext(context),
            Effect.flatMap((row) =>
              Effect.provideService(effect, CurrentTeamUser, {
                _tag: 'Owner',
                companySlug: required(row.company_slug),
              }),
            ),
          ),
        member: (effect, { credential }) =>
          findSession('member', credential).pipe(
            Effect.provideContext(context),
            Effect.flatMap((row) =>
              Effect.provideService(effect, CurrentTeamUser, {
                _tag: 'Member',
                companySlug: required(row.company_slug),
                memberId: required(row.member_id),
              }),
            ),
          ),
      }),
    ),
  ),
  Layer.effect(OperatorSession)(
    Effect.map(Effect.context<SqlClient.SqlClient | Time>(), (context) =>
      OperatorSession.of({
        operator: (effect, { credential }) =>
          findSession('operator', credential).pipe(
            Effect.provideContext(context),
            Effect.flatMap(() =>
              Effect.provideService(effect, CurrentOperator, {
                sessionId: sha256Hex(Redacted.value(credential)).slice(0, 16),
              }),
            ),
          ),
      }),
    ),
  ),
)

/** Fixed-window limiter per client address, in memory only (no IPs are stored). */
export class RateLimiter extends Context.Service<
  RateLimiter,
  { readonly check: (bucket: string) => Effect.Effect<void, TooManyRequests> }
>()('keryx-kit/RateLimiter') {}

const WINDOW_MS = 60_000

export const RateLimiterLive = (limitPerMinute: number) =>
  Layer.effect(RateLimiter)(
    Effect.gen(function* () {
      const time = yield* Time
      const windows = new Map<string, { start: number; count: number }>()
      return RateLimiter.of({
        check: (bucket) =>
          Effect.gen(function* () {
            const request = yield* Effect.serviceOption(HttpServerRequest.HttpServerRequest)
            const address = Option.match(request, {
              onNone: () => 'local',
              onSome: (req) =>
                req.headers['x-forwarded-for']?.split(',')[0]?.trim() ??
                Option.getOrElse(req.remoteAddress, () => 'local'),
            })
            const at = (yield* time.now).getTime()
            const key = `${bucket}:${address}`
            const window = windows.get(key)
            if (!window || at - window.start >= WINDOW_MS) {
              if (windows.size > 10_000) windows.clear()
              windows.set(key, { start: at, count: 1 })
              return
            }
            window.count += 1
            if (window.count > limitPerMinute) {
              return yield* new TooManyRequests({
                error: 'Too many attempts. Wait a minute and try again.',
              })
            }
          }),
      })
    }),
  )

export const rateLimit = (bucket: string) =>
  Effect.flatMap(RateLimiter, (limiter) => limiter.check(bucket))
