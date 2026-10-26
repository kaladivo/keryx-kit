/**
 * Ceremonies and author tasks (mvp-spec §5.5, B3, B5, E3). A ceremony stores the
 * intent, the domain operation and the signatures collected so far. Its state is always
 * rebuilt from the published repo, so publishes made while it is staged stay in it.
 */
import {
  type AuthorTask,
  applyOperation,
  CeremonyInProgress,
  Conflict,
  type Intent,
  Intent as IntentSchema,
  NotFound,
  type Operation,
  Operation as OperationSchema,
  Refused,
  repoFilesToText,
} from '@keryx-kit/api'
import {
  attachRoleSignature,
  authorityOf,
  authorsRoleName,
  type Refused as DomainRefused,
  decodeItem,
  itemPath,
  itemsSignedOnlyBy,
  meetsThreshold,
  type Repo,
  type RepoState,
  repoFiles,
  type Signature,
  signingBytes,
  toBase64url,
  validateRepo,
} from '@keryx-kit/domain'
import { Effect, Schema } from 'effect'
import { SqlClient } from 'effect/sql'
import { randomToken, sha256Hex } from './crypto.ts'
import {
  changedVersions,
  commit,
  issuesError,
  Repos,
  signServerRoles,
  withoutUntouchedExpiry,
} from './repos.ts'
import { generateServerKey } from './serverKeys.ts'
import { orDieSql } from './sql.ts'
import {
  type Actor,
  audit,
  authorKeyids,
  authorRef,
  findMember,
  type MemberRow,
  membersOf,
} from './store.ts'
import { addDays, iso, now, startOfDay } from './time.ts'

export const refused = (error: DomainRefused) =>
  new Refused({ error: error.message, code: error.code })

export const domain = <A, R>(effect: Effect.Effect<A, DomainRefused, R>) =>
  Effect.mapError(effect, refused)

type Status = 'awaiting-owner' | 'staged' | 'applied' | 'discarded'
type OwnerRole = 'root' | 'targets'

interface Signatures {
  readonly owner: ReadonlyArray<{ readonly role: OwnerRole; readonly signature: Signature }>
  /** Authors metadata signatures by channel. */
  readonly authors: Readonly<Record<string, Signature>>
}

export interface CeremonyRecord {
  readonly id: string
  readonly slug: string
  readonly intent: Intent
  readonly operation: Operation
  readonly summary: string
  readonly status: Status
  readonly signatures: Signatures
  readonly createdAt: string
  readonly updatedAt: string
}

interface CeremonyRow {
  readonly id: string
  readonly company_slug: string
  readonly intent: string
  readonly operation: string
  readonly summary: string
  readonly status: Status
  readonly signatures: string
  readonly created_at: string
  readonly updated_at: string
}

const decodeIntent = Schema.decodeUnknownSync(IntentSchema)
const decodeOperation = Schema.decodeUnknownSync(OperationSchema)

const fromRow = (row: CeremonyRow): CeremonyRecord => ({
  id: row.id,
  slug: row.company_slug,
  intent: decodeIntent(JSON.parse(row.intent)),
  operation: decodeOperation(JSON.parse(row.operation)),
  summary: row.summary,
  status: row.status,
  signatures: JSON.parse(row.signatures) as Signatures,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

export const findCeremony = (slug: string, id: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<CeremonyRow>`SELECT * FROM ceremonies
      WHERE id = ${id} AND company_slug = ${slug}`
    const row = rows[0]
    return row ? fromRow(row) : yield* new NotFound({ error: 'No such ceremony.' })
  }).pipe(orDieSql)

export const openCeremony = (slug: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<CeremonyRow>`SELECT * FROM ceremonies WHERE company_slug = ${slug}
      AND status IN ('awaiting-owner', 'staged') ORDER BY created_at LIMIT 1`
    return rows[0] ? fromRow(rows[0]) : undefined
  }).pipe(orDieSql)

const saveCeremony = (record: CeremonyRecord) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`UPDATE ceremonies SET status = ${record.status},
      signatures = ${JSON.stringify(record.signatures)}, updated_at = ${record.updatedAt}
      WHERE id = ${record.id}`
  }).pipe(orDieSql)

// Intent to operation

const names = (members: ReadonlyArray<MemberRow>) => members.map((m) => m.name).join(', ')

const plan = (slug: string, published: Repo, intent: Intent, at: string) =>
  Effect.gen(function* () {
    switch (intent._tag) {
      case 'CreateChannel': {
        if (published.channels[intent.channel]) {
          return yield* new Refused({
            error: `Channel ${intent.channel} already exists.`,
            code: 'channel-exists',
          })
        }
        const members: Array<MemberRow> = []
        for (const id of intent.authors) members.push(yield* findMember(slug, id))
        const channelKey = yield* generateServerKey(slug, 'channel')
        return {
          summary: `Create channel ${intent.displayName || intent.channel} with ${names(members)}`,
          operation: {
            _tag: 'createChannel',
            now: at,
            params: {
              channel: intent.channel,
              displayName: intent.displayName,
              description: intent.description,
              channelKey: channelKey.publicKey,
              authors: members.map((m) => ({ publicKey: m.author_public_key, name: m.key_label })),
            },
          },
        } satisfies { summary: string; operation: Operation }
      }
      case 'AssignAuthor': {
        const member = yield* findMember(slug, intent.memberId)
        return {
          summary: `Add author ${member.name} to channel ${intent.channel}`,
          operation: {
            _tag: 'assignAuthor',
            now: at,
            params: {
              channel: intent.channel,
              author: { publicKey: member.author_public_key, name: member.key_label },
            },
          },
        } satisfies { summary: string; operation: Operation }
      }
      case 'RemoveAuthor': {
        const member = yield* findMember(slug, intent.memberId)
        return {
          summary: `Remove author ${member.name} from channel ${intent.channel}`,
          operation: {
            _tag: 'removeAuthor',
            now: at,
            params: { channel: intent.channel, keyid: member.keyid },
          },
        } satisfies { summary: string; operation: Operation }
      }
      case 'EditChannel':
        return {
          summary: `Rename channel ${intent.channel} to ${intent.displayName}`,
          operation: {
            _tag: 'editChannel',
            now: at,
            params: {
              channel: intent.channel,
              displayName: intent.displayName,
              description: intent.description,
            },
          },
        } satisfies { summary: string; operation: Operation }
      case 'ChangeLogo':
        return {
          summary: 'Change the company logo',
          operation: { _tag: 'editCompany', now: at, params: { logo: intent.logo } },
        } satisfies { summary: string; operation: Operation }
      case 'RenewTargets':
        return {
          summary: 'Renew targets.json for another year',
          operation: { _tag: 'renewTargets', now: at },
        } satisfies { summary: string; operation: Operation }
    }
  })

// Rebuilding a ceremony's state

/** The published repo with the ceremony applied and every signature collected so far. */
export const assemble = (published: Repo, ceremony: CeremonyRecord) =>
  Effect.gen(function* () {
    let state: RepoState = yield* domain(applyOperation(published, ceremony.operation))
    for (const { role, signature } of ceremony.signatures.owner) {
      state = yield* domain(attachRoleSignature(state, role, signature))
    }
    for (const [channel, signature] of Object.entries(ceremony.signatures.authors)) {
      const role = `channels.${channel}.authors` as const
      state = yield* attachRoleSignature(state, role, signature).pipe(
        Effect.orElseSucceed(() => state),
      )
    }
    return yield* signServerRoles(ceremony.slug, state)
  })

const isAuthorsFile = (file: string) => /^channels\.[a-z0-9_-]+\.authors\.json$/.test(file)

/** Splits what the change still lacks (authors signatures) from real problems. */
const check = (state: RepoState, published: Repo, at: Date) => {
  const issues = withoutUntouchedExpiry(validateRepo(state, { now: at }), published, state)
  const missing = issues.filter((i) => i.code === 'signature-threshold' && isAuthorsFile(i.file))
  return { missing, invalid: issues.filter((i) => !missing.includes(i)) }
}

const missingSignatures = (slug: string, state: RepoState, files: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const members = yield* membersOf(slug)
    return files.map((file) => {
      const role = file.slice(0, -'.json'.length)
      const keyids = authorityOf(state, role)?.keyids ?? []
      return {
        role,
        file,
        signers: members.filter((m) => keyids.includes(m.keyid)).map(authorRef),
      }
    })
  })

const bytes = (doc: { readonly signed: unknown }) => toBase64url(signingBytes(doc))

/** Applies a staged ceremony if nothing is missing any more. Run inside `Repos.locked`. */
export const tryApply = (ceremony: CeremonyRecord, actor: Actor) =>
  Effect.gen(function* () {
    if (ceremony.status !== 'staged') return ceremony
    const repos = yield* Repos
    const published = yield* repos.published(ceremony.slug)
    const state = yield* assemble(published, ceremony)
    const at = yield* now
    const { missing, invalid } = check(state, published, at)
    if (invalid.length > 0) return yield* issuesError(invalid)
    if (missing.length > 0) return ceremony
    const next = yield* commit(ceremony.slug, published, state)
    const applied = { ...ceremony, status: 'applied' as const, updatedAt: iso(at) }
    yield* saveCeremony(applied)
    yield* audit(
      ceremony.slug,
      actor,
      'ceremony-applied',
      ceremony.summary,
      changedVersions(published, next),
    )
    return applied
  })

export const startCeremony = (slug: string, intent: Intent) =>
  Effect.gen(function* () {
    const repos = yield* Repos
    const open = yield* openCeremony(slug)
    if (open) {
      return yield* new CeremonyInProgress({
        error: `Finish or discard "${open.summary}" first.`,
        ceremonyId: open.id,
      })
    }
    const published = yield* repos.published(slug)
    const at = iso(yield* now)
    const planned = yield* plan(slug, published, intent, at)
    yield* domain(applyOperation(published, planned.operation))
    const record: CeremonyRecord = {
      id: randomToken(12),
      slug,
      intent,
      operation: planned.operation,
      summary: planned.summary,
      status: 'awaiting-owner',
      signatures: { owner: [], authors: {} },
      createdAt: at,
      updatedAt: at,
    }
    const sql = yield* SqlClient.SqlClient
    yield* orDieSql(
      sql`INSERT INTO ceremonies ${sql.insert({
        id: record.id,
        company_slug: slug,
        intent: JSON.stringify(intent),
        operation: JSON.stringify(planned.operation),
        summary: record.summary,
        status: record.status,
        signatures: JSON.stringify(record.signatures),
        created_at: at,
        updated_at: at,
      })}`,
    )
    yield* audit(slug, { kind: 'owner' }, 'ceremony-started', record.summary)
    return record
  })

export const signCeremony = (
  slug: string,
  id: string,
  signatures: ReadonlyArray<{ readonly role: OwnerRole; readonly signature: Signature }>,
) =>
  Effect.gen(function* () {
    const repos = yield* Repos
    const ceremony = yield* findCeremony(slug, id)
    if (ceremony.status !== 'awaiting-owner') {
      return yield* new Conflict({ error: `This ceremony is already ${ceremony.status}.` })
    }
    const published = yield* repos.published(slug)
    const at = yield* now
    const staged: CeremonyRecord = {
      ...ceremony,
      status: 'staged',
      signatures: { ...ceremony.signatures, owner: signatures },
      updatedAt: iso(at),
    }
    const { invalid } = check(yield* assemble(published, staged), published, at)
    if (invalid.length > 0) return yield* issuesError(invalid)
    yield* saveCeremony(staged)
    const result = yield* tryApply(staged, { kind: 'owner' })
    if (result.status === 'staged') {
      yield* audit(slug, { kind: 'owner' }, 'ceremony-staged', ceremony.summary)
    }
    return result
  })

export const discardCeremony = (slug: string, id: string) =>
  Effect.gen(function* () {
    const ceremony = yield* findCeremony(slug, id)
    if (ceremony.status !== 'awaiting-owner' && ceremony.status !== 'staged') {
      return yield* new Conflict({ error: `This ceremony is already ${ceremony.status}.` })
    }
    yield* saveCeremony({ ...ceremony, status: 'discarded', updatedAt: iso(yield* now) })
    yield* audit(slug, { kind: 'owner' }, 'ceremony-discarded', ceremony.summary)
  })

// What the console sees

const removalImpact = (published: Repo, channel: string, keyid: string) =>
  Effect.gen(function* () {
    const ids = yield* domain(itemsSignedOnlyBy(published, { channel, keyid }))
    const items = []
    for (const id of ids) {
      const item = yield* domain(
        decodeItem(published.items[itemPath(channel, id)] ?? new Uint8Array()),
      )
      items.push({ id, title: item.title })
    }
    return {
      itemsSignedOnlyByAuthor: items,
      authorsMetadataNeedsResign: authorsNeedResign(published, channel, keyid),
    }
  })

const authorsNeedResign = (published: Repo, channel: string, removed: string): boolean => {
  const doc = published.authors[channel]
  const authority = authorityOf(published, authorsRoleName(channel))
  if (!doc || !authority) return false
  return !meetsThreshold(doc, {
    ...authority,
    keyids: authority.keyids.filter((k) => k !== removed),
  })
}

const summaryOf = (ceremony: CeremonyRecord) =>
  Effect.gen(function* () {
    const repos = yield* Repos
    const open = ceremony.status === 'awaiting-owner' || ceremony.status === 'staged'
    const published = open ? yield* repos.published(ceremony.slug) : undefined
    let missing: ReadonlyArray<{
      role: string
      file: string
      signers: ReadonlyArray<ReturnType<typeof authorRef>>
    }> = []
    if (ceremony.status === 'staged' && published) {
      const state = yield* assemble(published, ceremony)
      missing = yield* missingSignatures(
        ceremony.slug,
        state,
        check(state, published, yield* now).missing.map((issue) => issue.file),
      )
    }
    const removal =
      open && published && ceremony.operation._tag === 'removeAuthor'
        ? yield* removalImpact(
            published,
            ceremony.operation.params.channel,
            ceremony.operation.params.keyid,
          )
        : undefined
    return {
      id: ceremony.id,
      intent: ceremony.intent,
      summary: ceremony.summary,
      status: ceremony.status,
      missing,
      ...(removal ? { removal } : {}),
      createdAt: ceremony.createdAt,
      updatedAt: ceremony.updatedAt,
    }
  })

const detailOf = (ceremony: CeremonyRecord) =>
  Effect.gen(function* () {
    const repos = yield* Repos
    const published = yield* repos.published(ceremony.slug)
    const summary = yield* summaryOf(ceremony)
    const toSign = []
    if (ceremony.status === 'awaiting-owner') {
      const state = yield* domain(applyOperation(published, ceremony.operation))
      toSign.push({
        role: 'targets',
        keyids: authorityOf(state, 'targets')?.keyids ?? [],
        signingBytes: bytes(state.targets),
      })
    }
    return {
      ...summary,
      base: repoFilesToText(repoFiles(published)),
      operation: ceremony.operation,
      toSign,
    }
  })

// Author tasks

const RENEW_WITHIN_DAYS = 60

const tasksOf = (member: MemberRow) =>
  Effect.gen(function* () {
    const repos = yield* Repos
    const published = yield* repos.published(member.company_slug)
    const base = repoFilesToText(repoFiles(published))
    const at = yield* now
    const open = yield* openCeremony(member.company_slug)
    const tasks: Array<AuthorTask> = []
    const authorsTaskFor = new Set<string>()

    const renewTask = (
      channel: string,
      reason: 'renewal' | 'author-removal',
      ceremonyId?: string,
    ) =>
      Effect.gen(function* () {
        const doc = published.authors[channel]
        if (!doc) return
        const day = iso(startOfDay(at))
        const operation: Operation = { _tag: 'renewAuthors', now: day, params: { channel } }
        const state = yield* domain(applyOperation(published, operation))
        const renewed = state.authors[channel]
        const role = authorsRoleName(channel)
        if (!renewed) return
        authorsTaskFor.add(channel)
        tasks.push({
          _tag: 'SignAuthorsMetadata',
          id: `authors-${sha256Hex(`${channel}/${doc.signed.version}/${day}`).slice(0, 32)}`,
          channel,
          reason,
          ...(ceremonyId ? { ceremonyId } : {}),
          base,
          operation,
          toSign: {
            role,
            keyids: authorityOf(state, role)?.keyids ?? [],
            signingBytes: bytes(renewed),
          },
        })
      })

    if (open?.operation._tag === 'createChannel' && open.status === 'staged') {
      const channel = open.operation.params.channel
      const state = yield* assemble(published, open)
      const role = authorsRoleName(channel)
      const authority = authorityOf(state, role)
      const doc = state.authors[channel]
      if (doc && authority?.keyids.includes(member.keyid) && !meetsThreshold(doc, authority)) {
        authorsTaskFor.add(channel)
        tasks.push({
          _tag: 'SignAuthorsMetadata',
          id: `new-channel-${open.id}`,
          channel,
          reason: 'new-channel',
          ceremonyId: open.id,
          base,
          operation: open.operation,
          toSign: { role, keyids: authority.keyids, signingBytes: bytes(doc) },
        })
      }
    }

    if (open?.operation._tag === 'removeAuthor') {
      const { channel, keyid } = open.operation.params
      if (keyid !== member.keyid && authorKeyids(published, channel).includes(member.keyid)) {
        const ids = yield* domain(itemsSignedOnlyBy(published, { channel, keyid }))
        if (ids.length > 0) {
          const items = []
          for (const id of ids) {
            items.push(
              yield* domain(decodeItem(published.items[itemPath(channel, id)] ?? new Uint8Array())),
            )
          }
          tasks.push({
            _tag: 'ResignItems',
            id: `resign-${open.id}`,
            channel,
            ceremonyId: open.id,
            items,
          })
        }
        if (authorsNeedResign(published, channel, keyid)) {
          yield* renewTask(channel, 'author-removal', open.id)
        }
      }
    }

    for (const [channel, doc] of Object.entries(published.authors)) {
      if (authorsTaskFor.has(channel)) continue
      if (!authorKeyids(published, channel).includes(member.keyid)) continue
      if (Date.parse(doc.signed.expires) < addDays(at, RENEW_WITHIN_DAYS).getTime()) {
        yield* renewTask(channel, 'renewal')
      }
    }
    return tasks
  })

const refusalIsDefect = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  orDieSql(
    Effect.catchIf(
      effect,
      (error): error is Extract<E, Refused> => error instanceof Refused,
      (error) => Effect.die(error),
    ),
  ) as Effect.Effect<A, Exclude<E, Refused | { readonly _tag: 'SqlError' }>, R>

/** Read paths: the stored ceremony applied when it was built, so a refusal here is a bug. */
export const ceremonySummary = (ceremony: CeremonyRecord) => refusalIsDefect(summaryOf(ceremony))
export const ceremonyDetail = (ceremony: CeremonyRecord) => refusalIsDefect(detailOf(ceremony))
export const tasksFor = (member: MemberRow) => refusalIsDefect(tasksOf(member))
