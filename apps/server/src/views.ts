/** Builds the contract's response records from rows and the published repo. */
import { decodeItem, type Item, itemPath, type Repo } from '@keryx-kit/domain'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'
import { openCeremony } from './ceremonies.ts'
import { repoBaseFor, ServerConfig } from './config.ts'
import { Repos } from './repos.ts'
import { orDieSql } from './sql.ts'
import {
  authorKeyids,
  authorRef,
  type CompanyRow,
  channelsAuthoredBy,
  findCompany,
  type MemberRow,
  membersOf,
} from './store.ts'

export const memberView = (member: MemberRow, published: Repo) => ({
  id: member.id,
  name: member.name,
  keyLabel: member.key_label,
  keyid: member.keyid,
  authorPublicKey: member.author_public_key,
  registeredAt: member.registered_at,
  channels: channelsAuthoredBy(published, member.keyid),
})

export const meView = (member: MemberRow) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const repos = yield* Repos
    const published = yield* repos.published(member.company_slug)
    const credentials = yield* sql<{ credential_id: string }>`SELECT credential_id FROM passkeys
      WHERE member_id = ${member.id} ORDER BY created_at`
    return {
      ...memberView(member, published),
      company: { slug: member.company_slug, name: published.targets.signed.custom.company_name },
      credentialIds: credentials.map((row) => row.credential_id),
    }
  }).pipe(orDieSql)

export const companyView = (company: CompanyRow) =>
  Effect.gen(function* () {
    const config = yield* ServerConfig
    const repos = yield* Repos
    const published = yield* repos.published(company.slug)
    const custom = published.targets.signed.custom
    return {
      slug: company.slug,
      name: custom.company_name,
      ...(custom.logo ? { logo: custom.logo } : {}),
      joinOrigin: company.join_origin,
      repoBase: repoBaseFor(config, company.slug),
      domain: domainView(company),
      targetsExpires: published.targets.signed.expires,
    }
  })

export const domainView = (company: CompanyRow) => ({
  status: company.domain_status,
  ...(company.domain_reason ? { reason: company.domain_reason } : {}),
  ...(company.domain_checked_at ? { checkedAt: company.domain_checked_at } : {}),
})

export const requireCompany = (slug: string) =>
  Effect.flatMap(findCompany(slug), (company) =>
    company
      ? Effect.succeed(company)
      : Effect.die(new Error(`session for unknown company ${slug}`)),
  )

export const channelViews = (slug: string) =>
  Effect.gen(function* () {
    const repos = yield* Repos
    const published = yield* repos.published(slug)
    const members = yield* membersOf(slug)
    const refsFor = (keyids: ReadonlyArray<string>) =>
      members.filter((m) => keyids.includes(m.keyid)).map(authorRef)
    const custom = published.targets.signed.custom.channels
    const live = Object.keys(published.channels).map((name) => ({
      name,
      displayName: custom[name]?.display_name ?? name,
      description: custom[name]?.description ?? '',
      status: 'live' as const,
      authors: refsFor(authorKeyids(published, name)),
      ...(published.authors[name]
        ? { authorsExpires: published.authors[name].signed.expires }
        : {}),
      itemCount: Object.keys(published.channels[name]?.signed.targets ?? {}).length,
    }))
    const open = yield* openCeremony(slug)
    if (open?.status !== 'staged' || open.operation._tag !== 'createChannel') return live
    const params = open.operation.params
    const authorKeys = params.authors.map((a) => a.publicKey)
    const waiting = {
      name: params.channel,
      displayName: params.displayName || params.channel,
      description: params.description ?? '',
      status: 'waiting-for-author' as const,
      authors: members.filter((m) => authorKeys.includes(m.author_public_key)).map(authorRef),
      itemCount: 0,
    }
    return [...live, waiting]
  })

export const publishedItems = (published: Repo, channel: string) =>
  Effect.gen(function* () {
    const items: Array<Item> = []
    for (const path of Object.keys(published.channels[channel]?.signed.targets ?? {})) {
      items.push(yield* Effect.orDie(decodeItem(published.items[path] ?? new Uint8Array())))
    }
    return items
  })

export const signedBy = (item: Item, members: ReadonlyArray<MemberRow>) => {
  const keyids = item.sig.map((s) => s.keyid)
  return members.filter((m) => keyids.includes(m.keyid)).map(authorRef)
}

export const publishedItem = (published: Repo, channel: string, id: string) =>
  published.channels[channel]?.signed.targets[itemPath(channel, id)]
    ? Effect.orDie(decodeItem(published.items[itemPath(channel, id)] ?? new Uint8Array()))
    : Effect.succeed(undefined)
