import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { InvalidRequest, KeryxKitApi, RequestValidation } from '@keryx-kit/api'
import { Effect, Layer } from 'effect'
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/http'
import { HttpApiBuilder, HttpApiMiddleware } from 'effect/http-api'
import { SqlClient } from 'effect/sql'
import { ServerConfig, type ServerConfigShape } from './config.ts'
import { AuthMemberLive, AuthOwnerLive } from './handlers/auth.ts'
import { ItemsLive } from './handlers/items.ts'
import { JoinLive, OperatorLive, PublicLive } from './handlers/operator.ts'
import { CeremoniesLive, ChannelsLive, CompanyLive, TeamLive } from './handlers/team.ts'
import { Repos } from './repos.ts'
import { SessionMiddlewareLive } from './sessions.ts'
import { Time } from './time.ts'

const RequestValidationLive = HttpApiMiddleware.layerSchemaErrorTransform(
  RequestValidation,
  (error) =>
    Effect.fail(
      new InvalidRequest({
        error: `The request is not in the expected format (${error.kind.toLowerCase()}): ${
          error.cause.message.split('\n')[0] ?? ''
        }`,
      }),
    ),
)

const Groups = Layer.mergeAll(
  AuthOwnerLive,
  AuthMemberLive,
  CompanyLive,
  TeamLive,
  ChannelsLive,
  CeremoniesLive,
  ItemsLive,
  JoinLive,
  OperatorLive,
  PublicLive,
).pipe(Layer.provide(Layer.mergeAll(SessionMiddlewareLive, RequestValidationLive)))

const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
}

const contentType = (path: string) => contentTypes[extname(path)] ?? 'application/octet-stream'

/** A path under `root`, or undefined for anything that tries to leave it. */
const safeJoin = (root: string, pathname: string): string | undefined => {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return undefined
  }
  if (decoded.includes('\0') || decoded.split('/').includes('..')) return undefined
  return join(root, normalize(decoded))
}

const readBytes = (path: string | undefined) =>
  path === undefined
    ? Effect.succeed(undefined)
    : Effect.promise(() =>
        readFile(path).then(
          (buffer) => new Uint8Array(buffer),
          () => undefined,
        ),
      )

const notFound = HttpServerResponse.text('Not found', { status: 404 })

const fileResponse = (path: string, bytes: Uint8Array, headers: Record<string, string> = {}) =>
  HttpServerResponse.uint8Array(bytes, {
    contentType: contentType(path),
    headers: {
      'cache-control': path.includes('/assets/')
        ? 'public, max-age=31536000, immutable'
        : 'no-cache',
      ...headers,
    },
  })

/** `/subscribers` serves `subscribers/index.html`; any extensionless path likewise. */
const serveSite = (config: ServerConfigShape, pathname: string) =>
  Effect.gen(function* () {
    const withIndex = pathname.endsWith('/')
      ? `${pathname}index.html`
      : extname(pathname) === ''
        ? `${pathname}/index.html`
        : pathname
    const path = safeJoin(config.siteDir, withIndex)
    const bytes = yield* readBytes(path)
    return bytes && path ? fileResponse(path, bytes) : notFound
  })

/** The console is a single-page app: unknown paths without an extension get index.html. */
const serveConsole = (config: ServerConfigShape, pathname: string) =>
  Effect.gen(function* () {
    const path = safeJoin(config.consoleDir, pathname === '/' ? 'index.html' : pathname)
    const bytes = yield* readBytes(path)
    if (bytes && path) return fileResponse(path, bytes)
    if (extname(pathname) !== '') return notFound
    const index = join(config.consoleDir, 'index.html')
    const html = yield* readBytes(index)
    return html ? fileResponse(index, html) : notFound
  })

/**
 * mvp-spec §5.9. Trezor Connect talks to Suite Web and to Suite desktop on the loopback;
 * author tasks read the published `targets.json` from the repo origin.
 */
export const consoleHeaders = (config: ServerConfigShape): Record<string, string> => ({
  'content-security-policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    `connect-src 'self' ${config.repoOrigin} https://suite.trezor.io ws://127.0.0.1:21335`,
    'frame-src https://suite.trezor.io',
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
  'cross-origin-opener-policy': 'same-origin-allow-popups',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
})

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD, OPTIONS',
}

const SLUG = /^[a-z0-9-]+$/
const REPO_PATH = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/

const countTimestampFetch = (slug: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const time = yield* Time
    const day = (yield* time.now).toISOString().slice(0, 10)
    yield* sql`INSERT INTO fetch_counts (company_slug, day, count) VALUES (${slug}, ${day}, 1)
      ON CONFLICT (company_slug, day) DO UPDATE SET count = count + 1`
  }).pipe(Effect.ignore)

/** `repo.<service>/<slug>/<file>`: the company's repo base (mvp-spec §5.2). */
const serveRepo = (method: string, pathname: string) =>
  Effect.gen(function* () {
    if (method === 'OPTIONS') return HttpServerResponse.empty({ status: 204, headers: corsHeaders })
    if (method !== 'GET' && method !== 'HEAD') {
      return HttpServerResponse.text('Method not allowed', { status: 405, headers: corsHeaders })
    }
    const [, slug = '', ...rest] = pathname.split('/')
    const file = rest.join('/')
    if (!SLUG.test(slug) || !REPO_PATH.test(file) || file.split('/').includes('..')) {
      return HttpServerResponse.text('Not found', { status: 404, headers: corsHeaders })
    }
    const repos = yield* Repos
    const path = join(repos.directory(slug).base, file)
    const bytes = yield* readBytes(path)
    if (!bytes) return HttpServerResponse.text('Not found', { status: 404, headers: corsHeaders })
    if (file === 'timestamp.json' && method === 'GET') yield* countTimestampFetch(slug)
    return HttpServerResponse.uint8Array(bytes, {
      contentType: contentType(path),
      headers: { ...corsHeaders, 'cache-control': 'no-cache' },
    })
  })

/** Requests built in-process (tests) have no Host header; their URL carries the host. */
const sourceHost = (source: object): string =>
  source instanceof Request ? new URL(source.url).host : ''

const HostRouting = HttpRouter.middleware(
  Effect.gen(function* () {
    const config = yield* ServerConfig
    const services = yield* Effect.context<Repos | SqlClient.SqlClient | Time>()
    return (httpEffect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const pathname = new URL(request.url, 'http://local').pathname
        const host = request.headers.host || sourceHost(request.source)
        if (pathname === '/healthz') return HttpServerResponse.text('ok')
        if (host === config.repoHost) {
          return yield* Effect.provideContext(serveRepo(request.method, pathname), services)
        }
        if (host === config.siteHost) {
          return pathname === '/api/pilot-requests'
            ? yield* httpEffect
            : yield* serveSite(config, pathname)
        }
        if (host === config.consoleHost) {
          const response = pathname.startsWith('/api/')
            ? yield* httpEffect
            : yield* serveConsole(config, pathname)
          return HttpServerResponse.setHeaders(response, consoleHeaders(config))
        }
        return HttpServerResponse.text('Unknown host', { status: 404 })
      })
  }),
  { global: true },
)

/** Every route and the host routing; needs the services `main.ts` or a test provides. */
export const AppRoutes = Layer.mergeAll(
  HttpApiBuilder.layer(KeryxKitApi).pipe(Layer.provide(Groups)),
  HostRouting,
)
