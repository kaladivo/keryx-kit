import { resolve, sep } from 'node:path'
import { BunHttpServer, BunRuntime } from '@effect/platform-bun'
import { Effect, Layer } from 'effect'
import { HttpRouter, HttpServerResponse } from 'effect/http'

const siteRoot = resolve(import.meta.dir, '../../site/dist')

const pageForHost = (host: string): string => {
  if (host.startsWith('console.')) return 'keryx-kit console'
  if (host.startsWith('repo.')) return 'keryx-kit repo'
  return 'keryx-kit'
}

const isSiteHost = (host: string) => !host.startsWith('console.') && !host.startsWith('repo.')

const sitePath = (urlPath: string): string | undefined => {
  const relative = urlPath.endsWith('/') ? `${urlPath}index.html` : urlPath
  const withIndex = relative.includes('.') ? relative : `${relative}/index.html`
  const path = resolve(siteRoot, `.${decodeURIComponent(withIndex)}`)
  return path.startsWith(siteRoot + sep) ? path : undefined
}

const notFound = HttpServerResponse.text('Not found', { status: 404 })

const serveSite = (urlPath: string) => {
  const path = sitePath(urlPath)
  if (!path) return Effect.succeed(notFound)
  return HttpServerResponse.file(path).pipe(Effect.catch(() => Effect.succeed(notFound)))
}

const Routes = Layer.mergeAll(
  HttpRouter.add('GET', '/healthz', HttpServerResponse.text('ok')),
  HttpRouter.add('GET', '*', (request) => {
    const host = request.headers.host ?? ''
    if (isSiteHost(host)) return serveSite(new URL(request.url, 'http://site').pathname)
    return Effect.succeed(HttpServerResponse.text(pageForHost(host)))
  }),
)

const Server = HttpRouter.serve(Routes).pipe(
  Layer.provide(BunHttpServer.layer({ port: Number(process.env.PORT ?? 3000) })),
)

BunRuntime.runMain(Layer.launch(Server))
