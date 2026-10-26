/** Join URL and QR payload (spec/core.md §3), ported from the Go SDK's `join` package. */
import { Effect, Schema } from 'effect'
import { fromBase64url, fromUtf8, toBase64url, utf8 } from './bytes.ts'
import { type Refused, refuse } from './errors.ts'
import { goString } from './json.ts'
import { CHANNEL_NAME, JoinPayload } from './schema.ts'

/** Encoded payload cap and private feeds per QR (spec/core.md §3 size policy). */
export const MAX_PAYLOAD_BYTES = 512
export const MAX_PRIVATE_FEEDS = 2

const isHttpsUrl = (value: string): boolean => {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

const jsonList = (values: ReadonlyArray<string>): string =>
  `[${values.map((value) => goString(value, true)).join(',')}]`

/** The payload JSON bytes, identical to Go's `join.BuildPayload`. */
export const joinPayload = (params: {
  readonly channels?: ReadonlyArray<string>
  readonly privateFeeds?: ReadonlyArray<string>
}): Effect.Effect<Uint8Array, Refused> => {
  const channels = params.channels ?? []
  const privateFeeds = params.privateFeeds ?? []
  if (privateFeeds.length > MAX_PRIVATE_FEEDS) {
    return Effect.fail(refuse('invalid-join', `at most ${MAX_PRIVATE_FEEDS} private feeds per QR`))
  }
  const badChannel = channels.find((channel) => !CHANNEL_NAME.test(channel))
  if (badChannel !== undefined)
    return Effect.fail(refuse('invalid-channel-name', `invalid channel name ${badChannel}`))
  const badFeed = privateFeeds.find((feed) => !isHttpsUrl(feed))
  if (badFeed !== undefined)
    return Effect.fail(refuse('invalid-join', `private feed ${badFeed} must be HTTPS`))
  const bytes = utf8(
    `{"v":1,"channels":${jsonList(channels)},"private_feeds":${jsonList(privateFeeds)}}`,
  )
  if (bytes.length > MAX_PAYLOAD_BYTES) {
    return Effect.fail(
      refuse('invalid-join', `payload is ${bytes.length} bytes, cap is ${MAX_PAYLOAD_BYTES}`),
    )
  }
  return Effect.succeed(bytes)
}

/** `https://<origin>/join?p=<base64url(payload)>` (Go `join.JoinURL`). */
export const joinUrl = (origin: string, payload: Uint8Array): Effect.Effect<string, Refused> => {
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return Effect.fail(refuse('invalid-join', `invalid origin ${origin}`))
  }
  if (url.protocol !== 'https:')
    return Effect.fail(refuse('invalid-join', 'join origin must be HTTPS'))
  url.pathname = `${url.pathname.replace(/\/$/, '')}/join`
  url.search = `p=${toBase64url(payload)}`
  return Effect.succeed(url.toString())
}

export interface ParsedJoin {
  readonly origin: string
  readonly payload: JoinPayload
}

const emptyPayload: JoinPayload = { v: 1, channels: [], private_feeds: [] }

/**
 * Parses a join URL the way the subscriber app does (`payload.ts`): payload-less joins
 * only from `/` or `/join`, an unknown `v` is refused, unknown members are ignored and
 * invalid channels or non-HTTPS feeds are dropped.
 */
export const parseJoinUrl = (input: string): Effect.Effect<ParsedJoin, Refused> =>
  Effect.gen(function* () {
    const url = yield* Effect.try({
      try: () => new URL(input.trim()),
      catch: () => refuse('invalid-join', 'not a URL'),
    })
    if (url.protocol !== 'https:') return yield* refuse('invalid-join', 'join URL must be HTTPS')
    const p = url.searchParams.get('p')
    if (p === null) {
      const path = url.pathname.replace(/\/+$/, '') || '/'
      if (path !== '/' && path !== '/join')
        return yield* refuse('invalid-join', 'join URL is missing its payload')
      return { origin: url.origin, payload: emptyPayload }
    }
    const raw = yield* Effect.try({
      try: () => JSON.parse(fromUtf8(fromBase64url(p))) as unknown,
      catch: () => refuse('invalid-join', 'payload is not base64url JSON'),
    })
    const record =
      typeof raw === 'object' && raw !== null && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : {}
    if (record.v !== 1)
      return yield* refuse('invalid-join', `unsupported payload version ${String(record.v)}`)
    const strings = (value: unknown): ReadonlyArray<string> =>
      Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
    const payload = yield* Schema.decodeUnknownEffect(JoinPayload)({
      v: 1,
      channels: strings(record.channels).filter((c) => CHANNEL_NAME.test(c)),
      private_feeds: strings(record.private_feeds).filter(isHttpsUrl),
    }).pipe(Effect.mapError((error) => refuse('invalid-join', error.message)))
    return { origin: url.origin, payload }
  })
