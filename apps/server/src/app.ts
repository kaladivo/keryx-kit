import { Layer } from 'effect'
import type { HttpClient } from 'effect/http'
import { ServerConfig, type ServerConfigShape } from './config.ts'
import type { Vault } from './crypto.ts'
import { DatabaseLive } from './db.ts'
import { ReposLive } from './repos.ts'
import { RateLimiterLive } from './sessions.ts'
import type { Time } from './time.ts'

export { AppRoutes } from './http.ts'

/** Login, sign-up and pilot-request attempts per client address per minute. */
export const LOGIN_ATTEMPTS_PER_MINUTE = 10

/**
 * The routes with their services. The clock, the KEK vault and the outgoing HTTP client
 * (domain checks) come from outside, so tests can replace them.
 */
export const appServices = <E, R>(
  config: ServerConfigShape,
  databaseFile: string,
  outside: Layer.Layer<Time | Vault | HttpClient.HttpClient, E, R>,
) =>
  Layer.mergeAll(ReposLive, RateLimiterLive(LOGIN_ATTEMPTS_PER_MINUTE)).pipe(
    Layer.provideMerge(DatabaseLive(databaseFile)),
    Layer.provideMerge(outside),
    Layer.provideMerge(Layer.succeed(ServerConfig, config)),
  )
