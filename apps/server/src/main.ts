import { BunHttpServer, BunRuntime } from '@effect/platform-bun'
import { Effect, Layer } from 'effect'
import { HttpRouter, HttpServerResponse } from 'effect/http'

const pageForHost = (host: string): string => {
  if (host.startsWith('console.')) return 'keryx-kit console'
  if (host.startsWith('repo.')) return 'keryx-kit repo'
  return 'keryx-kit'
}

const Routes = Layer.mergeAll(
  HttpRouter.add('GET', '/healthz', HttpServerResponse.text('ok')),
  HttpRouter.add('GET', '/*', (request) =>
    Effect.succeed(HttpServerResponse.text(pageForHost(request.headers.host ?? ''))),
  ),
)

const Server = HttpRouter.serve(Routes).pipe(Layer.provide(BunHttpServer.layer({ port: 3000 })))

BunRuntime.runMain(Layer.launch(Server))
