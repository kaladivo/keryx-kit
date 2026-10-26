/**
 * `GET /api/release` (`{ gitSha, consoleBundleSha256 }`), so anyone can compare the
 * served bundle with the published hash (mvp-spec §5.9). The endpoint is newer than the
 * `@keryx-kit/api` contract on this branch, so it is fetched directly.
 */
import { Schema } from 'effect'

export const Release = Schema.Struct({ gitSha: Schema.String, consoleBundleSha256: Schema.String })
export type Release = typeof Release.Type

let release: Promise<Release | undefined> | undefined

export const loadRelease = (): Promise<Release | undefined> => {
  release ??= fetch('/api/release')
    .then(async (response) =>
      response.ok ? Schema.decodeUnknownSync(Release)(await response.json()) : undefined,
    )
    .catch(() => undefined)
  return release
}
