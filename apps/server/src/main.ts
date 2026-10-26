import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { BunHttpServer, BunRuntime } from '@effect/platform-bun'
import { Effect, Layer } from 'effect'
import { FetchHttpClient, HttpRouter } from 'effect/http'
import { AppRoutes, appServices } from './app.ts'
import { configFromEnv, ServerConfig } from './config.ts'
import { VaultLive } from './crypto.ts'
import { scheduledJobs } from './jobs.ts'
import { TimeLive } from './time.ts'

const config = configFromEnv(process.env)
mkdirSync(config.dataDir, { recursive: true })

const Outside = Layer.mergeAll(
  TimeLive,
  FetchHttpClient.layer,
  VaultLive.pipe(Layer.provide(Layer.succeed(ServerConfig, config))),
)

const Services = appServices(config, join(config.dataDir, 'keryx-kit.db'), Outside)

const Jobs = Layer.effectDiscard(Effect.forkScoped(scheduledJobs))

const Server = HttpRouter.serve(AppRoutes).pipe(
  Layer.provide(BunHttpServer.layer({ port: config.port })),
)

BunRuntime.runMain(Layer.launch(Layer.mergeAll(Server, Jobs).pipe(Layer.provide(Services))))
