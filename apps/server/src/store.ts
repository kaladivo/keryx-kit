/** Row access shared by several handlers. Rows use snake_case like the schema. */
import { NotFound } from '@keryx-kit/api'
import { authorityOf, authorsRoleName, type Repo } from '@keryx-kit/domain'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'
import { orDieSql } from './sql.ts'
import { iso, now } from './time.ts'

export interface CompanyRow {
  readonly slug: string
  readonly name: string
  readonly join_origin: string
  readonly contact_email: string
  readonly identity_key: string
  readonly created_at: string
  readonly domain_status: 'not-set-up' | 'mismatch' | 'live'
  readonly domain_reason: string | null
  readonly domain_checked_at: string | null
  readonly last_timestamp_at: string | null
}

export const findCompany = (slug: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<CompanyRow>`SELECT * FROM companies WHERE slug = ${slug}`
    return rows[0]
  }).pipe(orDieSql)

export const allCompanies = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  return yield* sql<CompanyRow>`SELECT * FROM companies ORDER BY created_at`
}).pipe(orDieSql)

export interface MemberRow {
  readonly id: string
  readonly company_slug: string
  readonly name: string
  readonly key_label: string
  readonly author_public_key: string
  readonly keyid: string
  readonly registered_at: string
}

export const membersOf = (slug: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<MemberRow>`SELECT * FROM members WHERE company_slug = ${slug}
      ORDER BY registered_at`
  }).pipe(orDieSql)

export const findMember = (slug: string, memberId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<MemberRow>`SELECT * FROM members
      WHERE id = ${memberId} AND company_slug = ${slug}`
    const row = rows[0]
    return row ?? (yield* new NotFound({ error: 'No such team member.' }))
  }).pipe(orDieSql)

export const authorRef = (member: MemberRow) => ({
  memberId: member.id,
  name: member.name,
  keyLabel: member.key_label,
  keyid: member.keyid,
})

/** Keyids the published repo lists as authors of `channel` (empty if it is not live). */
export const authorKeyids = (repo: Repo, channel: string): ReadonlyArray<string> =>
  repo.channels[channel] ? (authorityOf(repo, authorsRoleName(channel))?.keyids ?? []) : []

export const channelsAuthoredBy = (repo: Repo, keyid: string): ReadonlyArray<string> =>
  Object.keys(repo.channels).filter((channel) => authorKeyids(repo, channel).includes(keyid))

export type AuditAction =
  | 'signup'
  | 'ceremony-started'
  | 'ceremony-staged'
  | 'ceremony-applied'
  | 'ceremony-discarded'
  | 'authors-signed'
  | 'items-resigned'
  | 'item-published'
  | 'item-edited'
  | 'item-unpublished'
  | 'invite-created'
  | 'member-registered'

export type Actor =
  | { readonly kind: 'owner' }
  | { readonly kind: 'member'; readonly member: MemberRow }
  | { readonly kind: 'server' }

export const audit = (
  slug: string,
  actor: Actor,
  action: AuditAction,
  summary: string,
  versions: Readonly<Record<string, number>> = {},
) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`INSERT INTO audit_log ${sql.insert({
      company_slug: slug,
      at: iso(yield* now),
      actor_kind: actor.kind,
      member_id: actor.kind === 'member' ? actor.member.id : null,
      actor_name: actor.kind === 'member' ? actor.member.name : null,
      action,
      summary,
      versions: JSON.stringify(versions),
    })}`
  }).pipe(orDieSql)
