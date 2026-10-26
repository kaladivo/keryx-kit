import { JOIN_PAGE, ROOT_FILE, type SiteFiles } from './kit.ts'

export const ORIGIN = 'https://coffee.roguedave.codes'

/** The subscriber app's origin, as the console's domain check sends it. */
const PROBE_ORIGIN = 'https://v1b3coder.github.io'

export interface Served {
  readonly status: number
  readonly headers: Headers
  readonly body: Uint8Array
}

export interface Check {
  readonly path: string
  /** What was verified; empty when something failed. */
  readonly passed: string
  readonly problems: ReadonlyArray<string>
}

export const urlPath = (file: string): string => (file === JOIN_PAGE ? '/join' : `/${file}`)

const sameBytes = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((byte, i) => byte === b[i])

/** Requirements of mvp-spec A3 for one kit file, plus its bytes. */
export const checkFile = (file: string, served: Served, expected: Uint8Array): Check => {
  const path = urlPath(file)
  if (served.status !== 200) return { path, passed: '', problems: [`status ${served.status}`] }
  const problems: Array<string> = []
  const header = (name: string) => served.headers.get(name) ?? 'missing'
  if (file === JOIN_PAGE) {
    if (header('referrer-policy') !== 'no-referrer') {
      problems.push(`Referrer-Policy: ${header('referrer-policy')}`)
    }
  } else {
    if (!header('content-type').startsWith('application/json')) {
      problems.push(`Content-Type: ${header('content-type')}`)
    }
    if (header('access-control-allow-origin') !== '*') {
      problems.push(`Access-Control-Allow-Origin: ${header('access-control-allow-origin')}`)
    }
  }
  if (!sameBytes(served.body, expected)) problems.push('bytes differ from the local file')
  const headers = file === JOIN_PAGE ? 'Referrer-Policy: no-referrer' : 'application/json · CORS *'
  return { path, passed: `200 · ${headers} · same bytes`, problems }
}

export const checkStatus = (path: string, served: Served, status: number): Check =>
  served.status === status
    ? { path, passed: String(status), problems: [] }
    : { path, passed: '', problems: [`status ${served.status}, expected ${status}`] }

const fetchServed = async (path: string): Promise<Served> => {
  const response = await fetch(`${ORIGIN}${path}`, {
    headers: { origin: PROBE_ORIGIN },
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
  })
  return {
    status: response.status,
    headers: response.headers,
    body: new Uint8Array(await response.arrayBuffer()),
  }
}

const unreachable = (path: string) => (error: unknown) => ({
  path,
  passed: '',
  problems: [error instanceof Error ? error.message : String(error)],
})

/** Checks the live site serves `files` (and no root.json when they hold none). */
export const checkSite = (files: SiteFiles): Promise<ReadonlyArray<Check>> => {
  const checks: Array<Promise<Check>> = [
    fetchServed('/')
      .then((served) => checkStatus('/', served, 200))
      .catch(unreachable('/')),
    ...Object.entries(files).map(([file, bytes]) =>
      fetchServed(urlPath(file))
        .then((served) => checkFile(file, served, bytes))
        .catch(unreachable(urlPath(file))),
    ),
  ]
  if (!files[ROOT_FILE]) {
    const path = urlPath(ROOT_FILE)
    checks.push(
      fetchServed(path)
        .then((served) => checkStatus(path, served, 404))
        .catch(unreachable(path)),
    )
  }
  return Promise.all(checks)
}

export const passed = (check: Check): boolean => check.problems.length === 0

/** Retries for a while: the domain can take seconds to switch to a new deployment. */
export const checkSiteUntilLive = async (
  files: SiteFiles,
  timeoutMs = 30_000,
): Promise<ReadonlyArray<Check>> => {
  const deadline = performance.now() + timeoutMs
  for (;;) {
    const checks = await checkSite(files)
    if (checks.every(passed) || performance.now() > deadline) return checks
    await new Promise((resolve) => setTimeout(resolve, 2_000))
  }
}
