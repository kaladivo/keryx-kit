import {
  type AuthorTask,
  applyOperation,
  CurrentOwner,
  CurrentTeamUser,
  KeryxKitApi,
  NotFound,
  Refused,
  type TaskCompletion,
} from '@keryx-kit/api'
import { addItemSignature, attachRoleSignature, type RepoState } from '@keryx-kit/domain'
import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { SqlClient } from 'effect/sql'
import {
  assemble,
  type CeremonyRecord,
  ceremonyDetail,
  ceremonySummary,
  discardCeremony,
  domain,
  findCeremony,
  openCeremony,
  signCeremony,
  startCeremony,
  tasksFor,
  tryApply,
} from '../ceremonies.ts'
import { ServerConfig } from '../config.ts'
import { randomToken, sha256Hex } from '../crypto.ts'
import { changedVersions, commit, Repos } from '../repos.ts'
import { orDieSql } from '../sql.ts'
import { audit, type MemberRow, membersOf } from '../store.ts'
import { addDays, iso, now } from '../time.ts'
import { channelViews, companyView, memberView, requireCompany } from '../views.ts'
import { currentMember } from './auth.ts'

export const CompanyLive = HttpApiBuilder.group(KeryxKitApi, 'company', (handlers) =>
  handlers
    .handle('get', () =>
      Effect.gen(function* () {
        const user = yield* CurrentTeamUser
        return yield* companyView(yield* requireCompany(user.companySlug))
      }),
    )
    .handle('auditLog', () =>
      Effect.gen(function* () {
        const owner = yield* CurrentOwner
        const sql = yield* SqlClient.SqlClient
        const rows = yield* sql<{
          at: string
          actor_kind: 'owner' | 'member' | 'server'
          member_id: string | null
          actor_name: string | null
          action: string
          summary: string
          versions: string
        }>`SELECT * FROM audit_log WHERE company_slug = ${owner.companySlug}
          ORDER BY id DESC LIMIT 500`
        return rows.map((row) => ({
          at: row.at,
          actor: {
            kind: row.actor_kind,
            ...(row.member_id ? { memberId: row.member_id } : {}),
            ...(row.actor_name ? { name: row.actor_name } : {}),
          },
          action: row.action as Parameters<typeof audit>[2],
          summary: row.summary,
          versions: JSON.parse(row.versions) as Record<string, number>,
        }))
      }).pipe(orDieSql),
    ),
)

const INVITE_DAYS = 7

export const TeamLive = HttpApiBuilder.group(KeryxKitApi, 'team', (handlers) =>
  handlers
    .handle('get', () =>
      Effect.gen(function* () {
        const owner = yield* CurrentOwner
        const sql = yield* SqlClient.SqlClient
        const repos = yield* Repos
        const published = yield* repos.published(owner.companySlug)
        const members = yield* membersOf(owner.companySlug)
        const invites = yield* sql<{
          id: string
          label: string
          created_at: string
          expires_at: string
        }>`SELECT id, label, created_at, expires_at FROM invites
          WHERE company_slug = ${owner.companySlug} AND used_at IS NULL
          AND expires_at > ${iso(yield* now)} ORDER BY created_at`
        return {
          members: members.map((member) => memberView(member, published)),
          invites: invites.map((row) => ({
            id: row.id,
            label: row.label,
            createdAt: row.created_at,
            expiresAt: row.expires_at,
          })),
        }
      }).pipe(orDieSql),
    )
    .handle('invite', ({ payload }) =>
      Effect.gen(function* () {
        const owner = yield* CurrentOwner
        const sql = yield* SqlClient.SqlClient
        const config = yield* ServerConfig
        const token = randomToken(24)
        const at = yield* now
        const invite = {
          id: randomToken(12),
          label: payload.label,
          createdAt: iso(at),
          expiresAt: iso(addDays(at, INVITE_DAYS)),
        }
        yield* sql`INSERT INTO invites ${sql.insert({
          id: invite.id,
          company_slug: owner.companySlug,
          label: invite.label,
          token_hash: sha256Hex(token),
          created_at: invite.createdAt,
          expires_at: invite.expiresAt,
        })}`
        yield* audit(
          owner.companySlug,
          { kind: 'owner' },
          'invite-created',
          `Invited ${payload.label}`,
        )
        return { ...invite, url: `${config.consoleOrigin}/invite#${token}` }
      }).pipe(orDieSql),
    ),
)

export const ChannelsLive = HttpApiBuilder.group(KeryxKitApi, 'channels', (handlers) =>
  handlers.handle('list', () =>
    Effect.flatMap(CurrentTeamUser, (user) => channelViews(user.companySlug)),
  ),
)

const wrongTask = () =>
  new Refused({ error: 'This task needs a different kind of signature.', code: 'invalid-metadata' })

const completeAuthorsTask = (
  member: MemberRow,
  task: Extract<AuthorTask, { _tag: 'SignAuthorsMetadata' }>,
  completion: typeof TaskCompletion.Type,
) =>
  Effect.gen(function* () {
    if (completion._tag !== 'AuthorsSignature') return yield* wrongTask()
    const repos = yield* Repos
    const slug = member.company_slug
    const actor = { kind: 'member' as const, member }
    const role = `channels.${task.channel}.authors` as const
    const published = yield* repos.published(slug)
    if (task.ceremonyId && task.reason === 'new-channel') {
      const ceremony = yield* findCeremony(slug, task.ceremonyId)
      const state = yield* assemble(published, ceremony)
      yield* domain(attachRoleSignature(state, role, completion.signature))
      const signed: CeremonyRecord = {
        ...ceremony,
        signatures: {
          ...ceremony.signatures,
          authors: { ...ceremony.signatures.authors, [task.channel]: completion.signature },
        },
      }
      yield* orDieSql(
        Effect.flatMap(
          SqlClient.SqlClient,
          (sql) =>
            sql`UPDATE ceremonies SET signatures = ${JSON.stringify(signed.signatures)}
            WHERE id = ${ceremony.id}`,
        ),
      )
      yield* audit(slug, actor, 'authors-signed', `Signed channels.${task.channel}.authors.json`)
      yield* tryApply(signed, actor)
      return
    }
    const renewed: RepoState = yield* domain(applyOperation(published, task.operation))
    const state = yield* domain(attachRoleSignature(renewed, role, completion.signature))
    const next = yield* commit(slug, published, state)
    yield* audit(
      slug,
      actor,
      'authors-signed',
      `Re-signed channels.${task.channel}.authors.json`,
      changedVersions(published, next),
    )
    const open = yield* openCeremony(slug)
    if (open) yield* tryApply(open, actor)
  })

const completeResignTask = (
  member: MemberRow,
  task: Extract<AuthorTask, { _tag: 'ResignItems' }>,
  completion: typeof TaskCompletion.Type,
) =>
  Effect.gen(function* () {
    if (completion._tag !== 'ItemSignatures') return yield* wrongTask()
    const repos = yield* Repos
    const slug = member.company_slug
    const published = yield* repos.published(slug)
    const timing = { now: yield* now }
    let state: RepoState = published
    for (const { itemId, signature } of completion.signatures) {
      if (signature.keyid !== member.keyid || !task.items.some((item) => item.id === itemId)) {
        return yield* new Refused({
          error: `Sign ${itemId} with your own author key.`,
          code: 'unauthorized-signer',
        })
      }
      state = yield* domain(
        addItemSignature(state, { channel: task.channel, id: itemId, signature }, timing),
      )
    }
    const next = yield* commit(slug, published, state)
    yield* audit(
      slug,
      { kind: 'member', member },
      'items-resigned',
      `Re-signed ${completion.signatures.length} items on ${task.channel}`,
      changedVersions(published, next),
    )
  })

export const CeremoniesLive = HttpApiBuilder.group(KeryxKitApi, 'ceremonies', (handlers) =>
  handlers
    .handle('start', ({ payload }) =>
      Effect.gen(function* () {
        const owner = yield* CurrentOwner
        const repos = yield* Repos
        const record = yield* repos.locked(startCeremony(owner.companySlug, payload.intent))
        return yield* ceremonyDetail(record)
      }).pipe(orDieSql),
    )
    .handle('list', () =>
      Effect.gen(function* () {
        const owner = yield* CurrentOwner
        const open = yield* openCeremony(owner.companySlug)
        return open ? [yield* ceremonySummary(open)] : []
      }),
    )
    .handle('get', ({ params }) =>
      Effect.gen(function* () {
        const owner = yield* CurrentOwner
        return yield* ceremonyDetail(yield* findCeremony(owner.companySlug, params.ceremonyId))
      }),
    )
    .handle('sign', ({ params, payload }) =>
      Effect.gen(function* () {
        const owner = yield* CurrentOwner
        const repos = yield* Repos
        const result = yield* repos.locked(
          signCeremony(owner.companySlug, params.ceremonyId, payload.signatures),
        )
        return yield* ceremonySummary(result)
      }).pipe(orDieSql),
    )
    .handle('discard', ({ params }) =>
      Effect.gen(function* () {
        const owner = yield* CurrentOwner
        const repos = yield* Repos
        yield* repos.locked(discardCeremony(owner.companySlug, params.ceremonyId))
      }).pipe(orDieSql),
    )
    .handle('tasks', () => Effect.flatMap(currentMember, tasksFor))
    .handle('completeTask', ({ params, payload }) =>
      Effect.gen(function* () {
        const member = yield* currentMember
        const repos = yield* Repos
        yield* repos.locked(
          Effect.gen(function* () {
            const task = (yield* tasksFor(member)).find((t) => t.id === params.taskId)
            if (!task) {
              return yield* new NotFound({ error: 'This task is done or has changed. Reload.' })
            }
            if (task._tag === 'ResignItems') return yield* completeResignTask(member, task, payload)
            return yield* completeAuthorsTask(member, task, payload)
          }),
        )
      }).pipe(orDieSql),
    ),
)
