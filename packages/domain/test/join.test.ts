import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { fromUtf8, joinPayload, joinUrl, parseJoinUrl, toBase64url, utf8 } from '../src/index.ts'

interface JoinCase {
  readonly origin: string
  readonly channels: ReadonlyArray<string> | null
  readonly private_feeds: ReadonlyArray<string> | null
  readonly payload: string
  readonly url: string
}

const cases = JSON.parse(
  readFileSync(join(import.meta.dirname, 'fixtures/go/join.json'), 'utf8'),
) as ReadonlyArray<JoinCase>

const refusalCode = <A>(effect: Effect.Effect<A, { readonly code: string }>) =>
  Effect.map(Effect.flip(effect), (error) => error.code)

describe('join payload and URL', () => {
  it.effect.each(cases)('matches the Go SDK for $url', (fixture) =>
    Effect.gen(function* () {
      const payload = yield* joinPayload({
        channels: fixture.channels ?? [],
        privateFeeds: fixture.private_feeds ?? [],
      })
      expect(fromUtf8(payload)).toBe(fixture.payload)
      expect(yield* joinUrl(fixture.origin, payload)).toBe(fixture.url)
      const parsed = yield* parseJoinUrl(fixture.url)
      expect(parsed.origin).toBe(new URL(fixture.origin).origin)
      expect(parsed.payload).toEqual({
        v: 1,
        channels: fixture.channels ?? [],
        private_feeds: fixture.private_feeds ?? [],
      })
    }),
  )

  it.effect('accepts payload-less joins only from / and /join', () =>
    Effect.gen(function* () {
      const empty = { v: 1, channels: [], private_feeds: [] }
      expect((yield* parseJoinUrl('https://acme.example/join')).payload).toEqual(empty)
      expect((yield* parseJoinUrl('https://acme.example/')).payload).toEqual(empty)
      expect(yield* refusalCode(parseJoinUrl('https://acme.example/other'))).toBe('invalid-join')
    }),
  )

  it.effect('ignores unknown members and drops invalid entries, refuses unknown versions', () =>
    Effect.gen(function* () {
      const p = (value: unknown) =>
        `https://acme.example/join?p=${toBase64url(utf8(JSON.stringify(value)))}`
      const parsed = yield* parseJoinUrl(
        p({
          v: 1,
          channels: ['ok', 'Bad'],
          private_feeds: ['http://x/feed', 'https://x/feed'],
          name: 'Evil',
        }),
      )
      expect(parsed.payload).toEqual({ v: 1, channels: ['ok'], private_feeds: ['https://x/feed'] })
      expect(yield* refusalCode(parseJoinUrl(p({ v: 2, channels: [] })))).toBe('invalid-join')
      expect(yield* refusalCode(parseJoinUrl('https://acme.example/join?p=%%%'))).toBe(
        'invalid-join',
      )
      expect(yield* refusalCode(parseJoinUrl('http://acme.example/join'))).toBe('invalid-join')
    }),
  )

  it.effect('refuses what the Go SDK refuses', () =>
    Effect.gen(function* () {
      expect(yield* refusalCode(joinPayload({ channels: ['Bad'] }))).toBe('invalid-channel-name')
      const feeds = ['https://a/1', 'https://a/2', 'https://a/3']
      expect(yield* refusalCode(joinPayload({ privateFeeds: feeds }))).toBe('invalid-join')
      expect(yield* refusalCode(joinPayload({ privateFeeds: ['http://a/feed'] }))).toBe(
        'invalid-join',
      )
      expect(
        yield* refusalCode(
          joinPayload({ channels: Array.from({ length: 60 }, (_, i) => `channel-${i}`) }),
        ),
      ).toBe('invalid-join')
      expect(yield* refusalCode(joinUrl('http://acme.example', utf8('{}')))).toBe('invalid-join')
    }),
  )
})
