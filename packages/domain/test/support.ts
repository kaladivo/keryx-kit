import { Effect } from 'effect'
import {
  createChannel,
  ed25519Key,
  type ItemDraft,
  initRepo,
  keyidOf,
  type Repo,
  type RepoState,
  signRole,
  type Timing,
  withFreshness,
} from '../src/index.ts'
import { authorKey, publicOf, signerOf } from './keys.ts'

export const at = (hour: number): Timing => ({ now: new Date(Date.UTC(2026, 9, 26, hour)) })
export const keyid = (name: string) => keyidOf(ed25519Key(publicOf(name)))

type Role = Parameters<typeof signRole>[1]

export const signAll = (state: RepoState, ...roles: ReadonlyArray<readonly [Role, string]>) =>
  Effect.reduce(
    roles,
    () => state,
    (acc, [role, name]) => signRole(acc, role, signerOf(name)),
  )

export const publish = (state: RepoState, previous: Repo | undefined, timing: Timing) =>
  withFreshness(state, previous, signerOf('ops'), timing)

export const draft = (id: string, extra: Partial<ItemDraft> = {}): ItemDraft => ({
  id,
  title: `Item ${id}`,
  content_html: '<p>hi</p>',
  date_published: '2026-10-26T12:00:00Z',
  ...extra,
})

/** A published repo with channel `offers` authored by alice and bob. */
export const companyRepo: Effect.Effect<Repo, unknown> = Effect.gen(function* () {
  const init = yield* initRepo(
    {
      repoBase: 'https://repo.test/acme/',
      companyName: 'ACME',
      masterKey: publicOf('master'),
      opsKey: publicOf('ops'),
    },
    at(10),
  )
  const v1 = yield* publish(
    yield* signAll(init, ['root', 'master'], ['targets', 'master']),
    undefined,
    at(10),
  )
  const channel = yield* createChannel(
    v1,
    {
      channel: 'offers',
      displayName: 'Offers',
      channelKey: publicOf('offers'),
      authors: [authorKey('alice'), authorKey('bob')],
    },
    at(11),
  )
  const signed = yield* signAll(
    channel,
    ['targets', 'master'],
    ['channels.offers', 'offers'],
    ['channels.offers.authors', 'alice'],
  )
  return yield* publish(signed, v1, at(11))
})
