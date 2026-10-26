import { bytesEqual, type Repo, repoFiles } from '@keryx-kit/domain'
import { Duration, Effect } from 'effect'
import { HttpClient } from 'effect/http'

export type DomainStatus =
  | { readonly status: 'live' }
  | { readonly status: 'not-set-up' | 'mismatch'; readonly reason: string }

/** Present in the kit's `join/index.html`; CDNs may rewrite the rest of the page. */
export const JOIN_PAGE_MARKER = '<title>Subscribe with Keryx</title>'

const TIMEOUT = Duration.seconds(10)

const fetchBytes = (url: string) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient
    const response = yield* client.get(url)
    const body = new Uint8Array(yield* response.arrayBuffer)
    return { status: response.status, headers: response.headers, body }
  }).pipe(
    Effect.timeout(TIMEOUT),
    Effect.orElseSucceed(() => undefined),
  )

/**
 * mvp-spec A4: every root file byte for byte, the CORS header on the anchor, and a
 * `/join` that serves the kit page.
 */
export const checkDomain = (origin: string, repo: Repo) =>
  Effect.gen(function* (): Effect.fn.Return<DomainStatus, never, HttpClient.HttpClient> {
    const anchor = repoFiles(repo).anchor
    const rootUrl = `${origin}/.well-known/keryx/root.json`
    const root = yield* fetchBytes(rootUrl)
    if (root?.status !== 200) {
      return { status: 'not-set-up', reason: `${rootUrl} is not reachable.` }
    }
    for (const [name, bytes] of Object.entries(anchor)) {
      const file =
        name === 'root.json' ? root : yield* fetchBytes(`${origin}/.well-known/keryx/${name}`)
      if (file?.status !== 200) {
        return { status: 'mismatch', reason: `/.well-known/keryx/${name} is missing.` }
      }
      if (!bytesEqual(file.body, bytes)) {
        return {
          status: 'mismatch',
          reason: `/.well-known/keryx/${name} differs from the current kit. Upload the kit again.`,
        }
      }
    }
    if (root.headers['access-control-allow-origin'] !== '*') {
      return {
        status: 'mismatch',
        reason: '/.well-known/keryx/ does not send Access-Control-Allow-Origin: *.',
      }
    }
    const join = yield* fetchBytes(`${origin}/join`)
    if (join?.status !== 200 || !new TextDecoder().decode(join.body).includes(JOIN_PAGE_MARKER)) {
      return { status: 'mismatch', reason: `${origin}/join does not serve the kit's join page.` }
    }
    return { status: 'live' }
  })
