import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context, Effect, Layer } from 'effect'

/** The monorepo root, so defaults do not depend on the working directory. */
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))

export interface ServerConfigShape {
  readonly port: number
  /** Host headers (with port in local dev, e.g. `console.localhost:3000`). */
  readonly siteHost: string
  readonly consoleHost: string
  readonly repoHost: string
  /** Where WebAuthn and the Trezor identity key are bound. */
  readonly consoleOrigin: string
  readonly rpId: string
  readonly repoOrigin: string
  readonly dataDir: string
  readonly siteDir: string
  readonly consoleDir: string
  readonly kekFile: string
  readonly operatorTokenFile: string
  readonly releaseFile: string
}

export class ServerConfig extends Context.Service<ServerConfig, ServerConfigShape>()(
  'keryx-kit/ServerConfig',
) {}

export const repoBaseFor = (config: ServerConfigShape, slug: string): string =>
  `${config.repoOrigin}/${slug}/`

/**
 * `KERYX_SERVICE_HOST` names the landing page host; the console and repo hosts are its
 * `console.` and `repo.` subdomains. Local dev: `KERYX_SERVICE_HOST=localhost:3000
 * KERYX_SCHEME=http` serves `console.localhost:3000` and `repo.localhost:3000`.
 */
export const configFromEnv = (env: Record<string, string | undefined>): ServerConfigShape => {
  const serviceHost = env.KERYX_SERVICE_HOST ?? 'keryx-kit.roguedave.codes'
  const scheme = env.KERYX_SCHEME ?? 'https'
  const consoleHost = `console.${serviceHost}`
  const repoHost = `repo.${serviceHost}`
  const dataDir = env.KERYX_DATA_DIR ?? '/data'
  return {
    port: Number(env.PORT ?? 3000),
    siteHost: serviceHost,
    consoleHost,
    repoHost,
    consoleOrigin: `${scheme}://${consoleHost}`,
    rpId: consoleHost.replace(/:\d+$/, ''),
    repoOrigin: `${scheme}://${repoHost}`,
    dataDir,
    siteDir: env.KERYX_SITE_DIR ?? resolve(repoRoot, 'apps/site/dist'),
    consoleDir: env.KERYX_CONSOLE_DIR ?? resolve(repoRoot, 'apps/console/dist'),
    kekFile: env.KERYX_KEK_FILE ?? `${dataDir}/kek`,
    operatorTokenFile: env.KERYX_OPERATOR_TOKEN_FILE ?? `${dataDir}/operator-token`,
    releaseFile: env.KERYX_RELEASE_FILE ?? resolve(repoRoot, 'release.json'),
  }
}

export const ServerConfigLive = Layer.effect(ServerConfig)(
  Effect.sync(() => configFromEnv(process.env)),
)
