import {
  Conflict,
  CurrentTeamUser,
  type DraftContent,
  DraftContent as DraftContentSchema,
  Forbidden,
  InvalidRequest,
  KeryxKitApi,
  NotFound,
  type PublishItem,
  Refused,
} from '@keryx-kit/api'
import {
  authorityOf,
  channelRoleName,
  type Item,
  publishItem,
  type Repo,
  signItem,
  unpublishItem,
} from '@keryx-kit/domain'
import { Effect, Schema } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { SqlClient } from 'effect/sql'
import { domain } from '../ceremonies.ts'
import { randomToken } from '../crypto.ts'
import { changedVersions, commit, Repos } from '../repos.ts'
import { serverSigner } from '../serverKeys.ts'
import { orDieSql } from '../sql.ts'
import { type Actor, audit, authorKeyids, type MemberRow, membersOf } from '../store.ts'
import { iso, now } from '../time.ts'
import { publishedItem, publishedItems, signedBy } from '../views.ts'
import { currentMember } from './auth.ts'

const decodeSource = Schema.decodeUnknownSync(DraftContentSchema)

const requireLiveChannel = (published: Repo, channel: string) =>
  published.channels[channel]
    ? Effect.void
    : Effect.fail(new NotFound({ error: `Channel ${channel} is not live.` }))

const requireAuthor = (published: Repo, channel: string, member: MemberRow) =>
  authorKeyids(published, channel).includes(member.keyid)
    ? Effect.void
    : Effect.fail(new Forbidden({ error: `You are not an author of ${channel}.` }))

const findSource = (slug: string, channel: string, itemId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{ source: string }>`SELECT source FROM item_sources
      WHERE company_slug = ${slug} AND channel = ${channel} AND item_id = ${itemId}`
    return rows[0] ? decodeSource(JSON.parse(rows[0].source)) : undefined
  }).pipe(orDieSql)

/** Adds the channel key's portability signature, as the Go SDK's publisher does. */
const withChannelSignature = (slug: string, published: Repo, channel: string, item: Item) =>
  Effect.gen(function* () {
    const keyid = authorityOf(published, channelRoleName(channel))?.keyids[0] ?? ''
    const signer = yield* serverSigner(slug, keyid)
    return signer ? yield* Effect.orDie(signItem(item, signer)) : item
  })

const publish = (
  member: MemberRow,
  channel: string,
  payload: typeof PublishItem.Type,
  mode: 'create' | 'edit',
) =>
  Effect.gen(function* () {
    const repos = yield* Repos
    const sql = yield* SqlClient.SqlClient
    const slug = member.company_slug
    const published = yield* repos.published(slug)
    yield* requireLiveChannel(published, channel)
    yield* requireAuthor(published, channel, member)
    if (!payload.item.sig.some((s) => s.keyid === member.keyid)) {
      return yield* new Forbidden({ error: 'The item must carry your own signature.' })
    }
    const existing = yield* publishedItem(published, channel, payload.item.id)
    if (mode === 'create' && existing) {
      return yield* new Conflict({ error: `An item with id ${payload.item.id} is published.` })
    }
    if (mode === 'edit' && !existing) {
      return yield* new NotFound({ error: `Item ${payload.item.id} is not published.` })
    }
    const item = yield* withChannelSignature(slug, published, channel, payload.item)
    const state = yield* domain(publishItem(published, { channel, item }, { now: yield* now }))
    const next = yield* commit(slug, published, state)
    if (payload.source) {
      yield* sql`INSERT OR REPLACE INTO item_sources ${sql.insert({
        company_slug: slug,
        channel,
        item_id: item.id,
        source: JSON.stringify(payload.source),
      })}`
    }
    if (payload.draftId) {
      yield* sql`DELETE FROM drafts WHERE id = ${payload.draftId} AND member_id = ${member.id}`
    }
    yield* audit(
      slug,
      { kind: 'member', member },
      mode === 'create' ? 'item-published' : 'item-edited',
      `${mode === 'create' ? 'Published' : 'Edited'} "${item.title}" on ${channel}`,
      changedVersions(published, next),
    )
    const members = yield* membersOf(slug)
    const final = (yield* publishedItem(next, channel, item.id)) ?? item
    return {
      channel,
      item: final,
      ...(payload.source ? { source: payload.source } : {}),
      signedBy: signedBy(final, members),
    }
  }).pipe(
    orDieSql,
    Effect.catchTag('RepoInvalid', (error) =>
      Effect.fail(new Refused({ error: error.error, code: 'invalid-repo' })),
    ),
  )

const draftView = (row: { id: string; channel: string; content: string; updated_at: string }) => ({
  id: row.id,
  channel: row.channel,
  content: decodeSource(JSON.parse(row.content)) satisfies typeof DraftContent.Type,
  updatedAt: row.updated_at,
})

const requireDraftChannel = (member: MemberRow, channel: string) =>
  Effect.gen(function* () {
    const repos = yield* Repos
    const published = yield* repos.published(member.company_slug)
    yield* requireAuthor(published, channel, member)
  })

export const ItemsLive = HttpApiBuilder.group(KeryxKitApi, 'items', (handlers) =>
  handlers
    .handle('list', ({ params }) =>
      Effect.gen(function* () {
        const user = yield* CurrentTeamUser
        const repos = yield* Repos
        const published = yield* repos.published(user.companySlug)
        yield* requireLiveChannel(published, params.channel)
        const members = yield* membersOf(user.companySlug)
        const items = yield* publishedItems(published, params.channel)
        return items
          .map((item) => ({
            id: item.id,
            title: item.title,
            datePublished: item.date_published,
            ...(item.date_modified ? { dateModified: item.date_modified } : {}),
            signedBy: signedBy(item, members),
          }))
          .sort((a, b) => b.datePublished.localeCompare(a.datePublished))
      }),
    )
    .handle('get', ({ params }) =>
      Effect.gen(function* () {
        const user = yield* CurrentTeamUser
        const repos = yield* Repos
        const published = yield* repos.published(user.companySlug)
        const item = yield* publishedItem(published, params.channel, params.itemId)
        if (!item) return yield* new NotFound({ error: `Item ${params.itemId} is not published.` })
        const source = yield* findSource(user.companySlug, params.channel, params.itemId)
        return {
          channel: params.channel,
          item,
          ...(source ? { source } : {}),
          signedBy: signedBy(item, yield* membersOf(user.companySlug)),
        }
      }),
    )
    .handle('publish', ({ params, payload }) =>
      Effect.gen(function* () {
        const member = yield* currentMember
        const repos = yield* Repos
        return yield* repos.locked(publish(member, params.channel, payload, 'create'))
      }),
    )
    .handle('edit', ({ params, payload }) =>
      Effect.gen(function* () {
        if (payload.item.id !== params.itemId) {
          return yield* new InvalidRequest({ error: 'The item id does not match the URL.' })
        }
        const member = yield* currentMember
        const repos = yield* Repos
        return yield* repos.locked(publish(member, params.channel, payload, 'edit'))
      }),
    )
    .handle('unpublish', ({ params }) =>
      Effect.gen(function* () {
        const user = yield* CurrentTeamUser
        const repos = yield* Repos
        const slug = user.companySlug
        yield* repos.locked(
          Effect.gen(function* () {
            const published = yield* repos.published(slug)
            let actor: Actor = { kind: 'owner' }
            if (user._tag === 'Member') {
              const member = yield* currentMemberOf(user.memberId)
              yield* requireAuthor(published, params.channel, member)
              actor = { kind: 'member', member }
            }
            const item = yield* publishedItem(published, params.channel, params.itemId)
            if (!item) {
              return yield* new NotFound({ error: `Item ${params.itemId} is not published.` })
            }
            const state = yield* domain(
              unpublishItem(
                published,
                { channel: params.channel, id: params.itemId },
                {
                  now: yield* now,
                },
              ),
            ).pipe(Effect.catchTag('Refused', () => new NotFound({ error: 'Not published.' })))
            const next = yield* commit(slug, published, state)
            yield* audit(
              slug,
              actor,
              'item-unpublished',
              `Unpublished "${item.title}" from ${params.channel}`,
              changedVersions(published, next),
            )
          }),
        )
      }).pipe(
        orDieSql,
        Effect.catchTag('RepoInvalid', (error) => Effect.die(error)),
      ),
    )
    .handle('drafts', () =>
      Effect.gen(function* () {
        const member = yield* currentMember
        const sql = yield* SqlClient.SqlClient
        const rows = yield* sql<{
          id: string
          channel: string
          content: string
          updated_at: string
        }>`SELECT * FROM drafts WHERE member_id = ${member.id} ORDER BY updated_at DESC`
        return rows.map(draftView)
      }).pipe(orDieSql),
    )
    .handle('createDraft', ({ payload }) =>
      Effect.gen(function* () {
        const member = yield* currentMember
        yield* requireDraftChannel(member, payload.channel)
        const sql = yield* SqlClient.SqlClient
        const row = {
          id: randomToken(12),
          channel: payload.channel,
          content: JSON.stringify(payload.content),
          updated_at: iso(yield* now),
        }
        yield* sql`INSERT INTO drafts ${sql.insert({ ...row, member_id: member.id })}`
        return draftView(row)
      }).pipe(orDieSql),
    )
    .handle('saveDraft', ({ params, payload }) =>
      Effect.gen(function* () {
        const member = yield* currentMember
        yield* requireDraftChannel(member, payload.channel)
        const sql = yield* SqlClient.SqlClient
        const row = {
          id: params.draftId,
          channel: payload.channel,
          content: JSON.stringify(payload.content),
          updated_at: iso(yield* now),
        }
        const updated = yield* sql<{ id: string }>`UPDATE drafts SET channel = ${row.channel},
          content = ${row.content}, updated_at = ${row.updated_at}
          WHERE id = ${row.id} AND member_id = ${member.id} RETURNING id`
        if (updated.length === 0) return yield* new NotFound({ error: 'No such draft.' })
        return draftView(row)
      }).pipe(orDieSql),
    )
    .handle('deleteDraft', ({ params }) =>
      Effect.gen(function* () {
        const member = yield* currentMember
        const sql = yield* SqlClient.SqlClient
        const deleted = yield* sql<{ id: string }>`DELETE FROM drafts
          WHERE id = ${params.draftId} AND member_id = ${member.id} RETURNING id`
        if (deleted.length === 0) return yield* new NotFound({ error: 'No such draft.' })
      }).pipe(orDieSql),
    ),
)

const currentMemberOf = (memberId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<MemberRow>`SELECT * FROM members WHERE id = ${memberId}`
    return rows[0] ?? (yield* Effect.die(new Error(`unknown member ${memberId}`)))
  }).pipe(orDieSql)
