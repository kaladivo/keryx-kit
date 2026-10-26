/**
 * An in-process server for tests and the conformance scenario: in-memory SQLite, a
 * temp data directory, a clock moved by hand, a fake outside web for domain checks, and
 * browsers with their own cookie jars talking to it through the generated client.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { KeryxKitApi } from '@keryx-kit/api'
import { Effect, Exit, FileSystem, Layer, Path, Scope } from 'effect'
import {
  Etag,
  FetchHttpClient,
  HttpClient,
  HttpClientResponse,
  HttpPlatform,
  HttpRouter,
} from 'effect/http'
import { HttpApiClient } from 'effect/http-api'
import { AppRoutes, appServices } from '../../src/app.ts'
import type { ServerConfigShape } from '../../src/config.ts'
import { randomBytes, Vault, vaultFromKey } from '../../src/crypto.ts'
import { Time } from '../../src/time.ts'
import { Authenticator } from './authenticator.ts'

export const START = new Date(Date.UTC(2026, 9, 26, 12))
export const OPERATOR_TOKEN = 'operator-secret-for-tests'

export interface FakeResponse {
  readonly status?: number
  readonly headers?: Record<string, string>
  readonly body: Uint8Array | string
}

const testConfig = (dir: string): ServerConfigShape => ({
  port: 0,
  siteHost: 'keryx.test',
  consoleHost: 'console.keryx.test',
  repoHost: 'repo.keryx.test',
  consoleOrigin: 'https://console.keryx.test',
  rpId: 'console.keryx.test',
  repoOrigin: 'https://repo.keryx.test',
  dataDir: join(dir, 'data'),
  siteDir: join(dir, 'site'),
  consoleDir: join(dir, 'console'),
  kekFile: join(dir, 'kek'),
  operatorTokenFile: join(dir, 'operator-token'),
  releaseFile: join(dir, 'release.json'),
})

const writeFixtures = (config: ServerConfigShape) => {
  mkdirSync(join(config.siteDir, 'subscribers'), { recursive: true })
  mkdirSync(join(config.consoleDir, 'assets'), { recursive: true })
  writeFileSync(join(config.siteDir, 'index.html'), '<h1>landing</h1>')
  writeFileSync(join(config.siteDir, 'subscribers', 'index.html'), '<h1>subscribers</h1>')
  writeFileSync(join(config.consoleDir, 'index.html'), '<h1>console</h1>')
  writeFileSync(join(config.consoleDir, 'assets', 'app.js'), 'console.log(1)')
  writeFileSync(config.operatorTokenFile, `${OPERATOR_TOKEN}\n`)
  writeFileSync(
    config.releaseFile,
    JSON.stringify({ gitSha: 'abc123', consoleBundleSha256: 'f'.repeat(64) }),
  )
}

const Platform = Layer.mergeAll(HttpPlatform.layer, Etag.layer, Path.layer).pipe(
  Layer.provideMerge(FileSystem.layerNoop({})),
)

export type Client = HttpApiClient.ForApi<typeof KeryxKitApi>

export interface Browser {
  readonly client: Client
  readonly authenticator: Authenticator
  readonly cookies: Map<string, string>
  readonly fetch: (request: Request) => Promise<Response>
}

export const startServer = async () => {
  const dir = mkdtempSync(join(tmpdir(), 'keryx-kit-server-'))
  const config = testConfig(dir)
  writeFixtures(config)
  const clock = { current: START }
  /** Slows down unsealing server keys, so a test can abort a request in the middle of a write. */
  const delays = { unsealMs: 0 }
  /** The company websites the domain check fetches, by URL. */
  const web = new Map<string, FakeResponse>()
  const fakeWeb = HttpClient.make((request, url) =>
    Effect.sync(() => {
      const found = web.get(url.toString())
      const response = found
        ? new Response(found.body, { status: found.status ?? 200, headers: found.headers ?? {} })
        : new Response('not found', { status: 404 })
      return HttpClientResponse.fromWeb(request, response)
    }),
  )
  const outside = Layer.mergeAll(
    Layer.succeed(Time, { now: Effect.sync(() => new Date(clock.current)) }),
    Layer.effect(Vault)(
      Effect.map(vaultFromKey(randomBytes(32)), (vault) =>
        Vault.of({
          seal: vault.seal,
          open: (sealed, aad) =>
            Effect.andThen(
              Effect.suspend(() => Effect.sleep(delays.unsealMs)),
              vault.open(sealed, aad),
            ),
        }),
      ),
    ),
    Layer.succeed(HttpClient.HttpClient, fakeWeb),
  )
  const scope = Effect.runSync(Scope.make())
  const context = await Effect.runPromise(
    Layer.buildWithScope(
      appServices(config, ':memory:', outside).pipe(Layer.provideMerge(Platform)),
      scope,
    ),
  )
  const { handler, dispose } = HttpRouter.toWebHandler(
    AppRoutes.pipe(Layer.provide(Layer.succeedContext(context))),
    { disableLogger: true },
  )

  /** Runs a server-side effect (a scheduled job) against the same services. */
  const run = <A, E>(effect: Effect.Effect<A, E, never>) => Effect.runPromise(effect)
  const runWithServices = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.runPromise(Effect.provideContext(effect, context as never) as Effect.Effect<A, E>)

  const browser = async (): Promise<Browser> => {
    const cookies = new Map<string, string>()
    const fetchRequest = async (request: Request) => {
      if (cookies.size > 0) {
        request.headers.set(
          'cookie',
          [...cookies].map(([name, value]) => `${name}=${value}`).join('; '),
        )
      }
      const response = await handler(request, context)
      for (const header of response.headers.getSetCookie()) {
        const [pair = '', ...attributes] = header.split(';')
        const [name = '', value = ''] = pair.split('=')
        const expired = attributes.some((a) => a.trim().toLowerCase() === 'max-age=0')
        if (expired || value === '') cookies.delete(name.trim())
        else cookies.set(name.trim(), value)
      }
      return response
    }
    const fetchFn = ((input: string | URL | Request, init?: RequestInit) =>
      fetchRequest(new Request(input as string, init))) as typeof globalThis.fetch
    const client = await Effect.runPromise(
      HttpApiClient.make(KeryxKitApi, { baseUrl: config.consoleOrigin }).pipe(
        Effect.provide(
          FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetchFn))),
        ),
      ),
    )
    return {
      client,
      authenticator: new Authenticator(config.consoleOrigin),
      cookies,
      fetch: fetchRequest,
    }
  }

  const stop = async () => {
    await dispose()
    await Effect.runPromise(Scope.close(scope, Exit.void))
  }

  return { config, clock, delays, web, browser, run, runWithServices, stop, handler }
}

export type TestServer = Awaited<ReturnType<typeof startServer>>

/** Resolves with the typed error a call fails with. */
export const failure = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(Effect.flip(effect))

export const call = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect)

export const advance = (server: TestServer, ms: number) => {
  server.clock.current = new Date(server.clock.current.getTime() + ms)
}

export const DAY = 24 * 60 * 60 * 1000
