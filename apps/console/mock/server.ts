/**
 * Dev-only implementation of `KeryxKitApi` over in-memory state, built with the same
 * `HttpApiBuilder` contract as the real server. It skips what the browser cannot
 * observe (WebAuthn attestation and SLIP-0013 signature verification, rate limits) and
 * keeps what the console relies on: real repo operations, signature checks, staged
 * ceremonies and author tasks. Loaded by `mock/plugin.ts` under `vite` only.
 */
import {
  Refused as ApiRefused,
  type AuthorTask,
  applyOperation,
  CeremonyInProgress,
  Conflict,
  CurrentMember,
  CurrentOperator,
  CurrentOwner,
  CurrentTeamUser,
  Expired,
  Forbidden,
  InvalidRequest,
  KeryxKitApi,
  LoginFailed,
  MemberCookie,
  MemberSession,
  NotFound,
  type Operation,
  OperatorCookie,
  OperatorSession,
  OwnerCookie,
  OwnerSession,
  RepoInvalid,
  RequestValidation,
  repoFilesToText,
  TeamSession,
  Unauthorized,
} from '@keryx-kit/api'
import {
  addItemSignature,
  attachRoleSignature,
  authorsRoleName,
  ed25519Key,
  initRepo,
  itemPath,
  itemsSignedOnlyBy,
  keyidOf,
  publicKeyFromSeed,
  publishItem,
  type RepoState,
  repoFiles,
  roleMetadata,
  seedSigner,
  signItem,
  signingBytes,
  toBase64url,
  toHex,
  unpublishItem,
  utf8,
  withFreshness,
} from '@keryx-kit/domain'
import { joinPageHtml } from '@keryx-kit/join-kit'
import { Effect, FileSystem, Layer, Path, Redacted } from 'effect'
import { Etag, HttpPlatform, HttpRouter, HttpServerRequest } from 'effect/http'
import { HttpApiBuilder, HttpApiMiddleware, type HttpApiSecurity } from 'effect/http-api'
import { zipSync } from 'fflate'
import {
  authorKeyids,
  candidate,
  changedVersions,
  channelItems,
  domain,
  masterKeyid,
  nowIso,
  publish,
} from './repo.ts'
import { seedDemo, seedInviteCodes } from './seed.ts'
import {
  emptyState,
  type MockCeremony,
  type MockCompany,
  type MockState,
  type Session,
} from './state.ts'

const DAY = 24 * 60 * 60 * 1000
const randomId = (bytes = 12) => toBase64url(crypto.getRandomValues(new Uint8Array(bytes)))
const randomHex = (bytes: number) => toHex(crypto.getRandomValues(new Uint8Array(bytes)))
const daysFromNow = (days: number) => new Date(Date.now() + days * DAY).toISOString()

export const createMock = (mode: string, origin: string) => {
  const state: MockState = emptyState()
  seedInviteCodes(state)
  if (mode === 'demo') seedDemo(state, origin)

  // Lookups

  const company = (slug: string) =>
    Effect.fromNullishOr(state.companies.get(slug)).pipe(
      Effect.mapError(() => new NotFound({ error: 'This company does not exist.' })),
    )
  const ownerCompany = Effect.gen(function* () {
    const { companySlug } = yield* CurrentOwner
    return yield* company(companySlug)
  })
  const teamCompany = Effect.gen(function* () {
    const { companySlug } = yield* CurrentTeamUser
    return yield* company(companySlug)
  })
  const currentMember = Effect.gen(function* () {
    const { companySlug, memberId } = yield* CurrentMember
    const found = yield* company(companySlug)
    const member = found.members.find((m) => m.id === memberId)
    if (!member) return yield* new NotFound({ error: 'This member no longer exists.' })
    return { company: found, member }
  })
  const requestOrigin = Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    return `http://${request.headers.host ?? 'localhost'}`
  })

  const authorRef = (c: MockCompany, keyid: string) => {
    const member = c.members.find((m) => m.keyid === keyid)
    return member
      ? [{ memberId: member.id, name: member.name, keyLabel: member.keyLabel, keyid }]
      : []
  }

  const audit = (
    c: MockCompany,
    actor: MockCompany['audit'][number]['actor'],
    action: MockCompany['audit'][number]['action'],
    summary: string,
    versions: Record<string, number> = {},
  ) => {
    c.audit.unshift({ at: nowIso(), actor, action, summary, versions })
  }

  const memberActor = (member: { id: string; name: string }) => ({
    kind: 'member' as const,
    memberId: member.id,
    name: member.name,
  })

  const startSession = (cookie: HttpApiSecurity.ApiKey, session: Session) => {
    const token = randomId(24)
    state.sessions.set(token, session)
    return HttpApiBuilder.securitySetCookie(cookie, token, { sameSite: 'strict', path: '/api' })
  }

  const endSession = (cookie: HttpApiSecurity.ApiKey) =>
    HttpApiBuilder.securitySetCookie(cookie, '', { sameSite: 'strict', path: '/api', maxAge: 0 })

  // Ceremonies

  const openCeremony = (c: MockCompany) =>
    c.ceremonies.find((x) => x.status === 'awaiting-owner' || x.status === 'staged')

  const removedKeyid = (cer: MockCeremony) =>
    cer.operation._tag === 'removeAuthor' ? cer.operation.params.keyid : undefined

  const removalImpact = (c: MockCompany, cer: MockCeremony) =>
    Effect.gen(function* () {
      if (cer.operation._tag !== 'removeAuthor') return undefined
      const { channel, keyid } = cer.operation.params
      const ids = yield* domain(itemsSignedOnlyBy(c.repo, { channel, keyid }))
      const titles = new Map(channelItems(c.repo, channel).map((item) => [item.id, item.title]))
      const authorsDoc = c.repo.authors[channel]
      const signers = authorsDoc ? authorsDoc.signatures.map((s) => s.keyid) : []
      return {
        itemsSignedOnlyByAuthor: ids.map((id) => ({ id, title: titles.get(id) ?? id })),
        authorsMetadataNeedsResign: signers.length > 0 && signers.every((k) => k === keyid),
      }
    })

  const missingFor = (c: MockCompany, cer: MockCeremony) =>
    cer.missingFiles.map((file) => {
      const channel = file.replace(/^channels\./, '').replace(/\.authors\.json$/, '')
      const signers = authorKeyids(c.repo, channel).filter((k) => k !== removedKeyid(cer))
      return {
        role: authorsRoleName(channel),
        file,
        signers: signers.flatMap((k) => authorRef(c, k)),
      }
    })

  const ceremonySummary = (c: MockCompany, cer: MockCeremony) =>
    Effect.gen(function* () {
      const removal = yield* removalImpact(c, cer)
      return {
        id: cer.id,
        intent: cer.intent,
        summary: cer.summary,
        status: cer.status,
        missing: cer.status === 'staged' ? missingFor(c, cer) : [],
        ...(removal ? { removal } : {}),
        createdAt: cer.createdAt,
        updatedAt: cer.updatedAt,
      }
    })

  /** The ceremony as the owner sees it: always rebuilt against the published repo. */
  const ceremonyView = (c: MockCompany, cer: MockCeremony) =>
    Effect.gen(function* () {
      const summary = yield* ceremonySummary(c, cer)
      const awaiting = cer.status === 'awaiting-owner'
      const next = awaiting ? yield* domain(applyOperation(c.repo, cer.operation)) : undefined
      return {
        ...summary,
        base: repoFilesToText(repoFiles(c.repo)),
        operation: cer.operation,
        toSign: next
          ? [
              {
                role: 'targets',
                keyids: [masterKeyid(c)],
                signingBytes: toBase64url(signingBytes(next.targets)),
              },
            ]
          : [],
      }
    })

  /** Applies a signed ceremony when every signature it needs is there; else keeps it staged. */
  const tryApply = (c: MockCompany, cer: MockCeremony) =>
    Effect.gen(function* () {
      let next: RepoState = yield* domain(applyOperation(c.repo, cer.operation))
      for (const { role, signature } of cer.ownerSignatures)
        next = yield* domain(attachRoleSignature(next, role, signature))
      if (cer.authorsSignature && cer.operation._tag === 'createChannel')
        next = yield* domain(
          attachRoleSignature(
            next,
            `channels.${cer.operation.params.channel}.authors`,
            cer.authorsSignature,
          ),
        )
      const { repo, issues } = yield* domain(candidate(c, next))
      const missing = issues.filter(
        (i) => i.code === 'signature-threshold' && i.file.endsWith('.authors.json'),
      )
      cer.updatedAt = nowIso()
      if (issues.length === 0) {
        const versions = changedVersions(c.repo, repo)
        c.repo = repo
        c.lastTimestampAt = nowIso()
        cer.status = 'applied'
        cer.missingFiles = []
        audit(c, { kind: 'owner' }, 'ceremony-applied', cer.summary, versions)
        return
      }
      if (missing.length === issues.length) {
        if (cer.status !== 'staged') audit(c, { kind: 'owner' }, 'ceremony-staged', cer.summary)
        cer.status = 'staged'
        cer.missingFiles = missing.map((i) => i.file)
        return
      }
      const [first] = issues
      return yield* new RepoInvalid({ error: first?.message ?? 'invalid repo', issues })
    })

  const retryStaged = (c: MockCompany) =>
    Effect.forEach(
      c.ceremonies.filter((cer) => cer.status === 'staged'),
      (cer) => Effect.ignore(tryApply(c, cer)),
    )

  const memberById = (c: MockCompany, id: string) =>
    Effect.fromNullishOr(c.members.find((m) => m.id === id)).pipe(
      Effect.mapError(() => new NotFound({ error: 'That member is not registered.' })),
    )

  const toOperation = (c: MockCompany, intent: MockCeremony['intent']) =>
    Effect.gen(function* () {
      const now = nowIso()
      switch (intent._tag) {
        case 'CreateChannel': {
          const members = yield* Effect.forEach(intent.authors, (id) => memberById(c, id))
          const seed = crypto.getRandomValues(new Uint8Array(32))
          c.channelSeeds[intent.channel] = seed
          const operation: Operation = {
            _tag: 'createChannel',
            now,
            params: {
              channel: intent.channel,
              ...(intent.displayName ? { displayName: intent.displayName } : {}),
              ...(intent.description ? { description: intent.description } : {}),
              channelKey: publicKeyFromSeed(seed),
              authors: members.map((m) => ({ publicKey: m.authorPublicKey, name: m.keyLabel })),
            },
          }
          return {
            operation,
            summary: `Create channel ${intent.displayName || intent.channel} with ${members.map((m) => m.name).join(', ')}`,
          }
        }
        case 'AssignAuthor': {
          const m = yield* memberById(c, intent.memberId)
          return {
            operation: {
              _tag: 'assignAuthor',
              now,
              params: {
                channel: intent.channel,
                author: { publicKey: m.authorPublicKey, name: m.keyLabel },
              },
            } as const,
            summary: `Add ${m.name} as author of ${intent.channel}`,
          }
        }
        case 'RemoveAuthor': {
          const m = yield* memberById(c, intent.memberId)
          return {
            operation: {
              _tag: 'removeAuthor',
              now,
              params: { channel: intent.channel, keyid: m.keyid },
            } as const,
            summary: `Remove ${m.name} from ${intent.channel}`,
          }
        }
        case 'EditChannel':
          return {
            operation: {
              _tag: 'editChannel',
              now,
              params: {
                channel: intent.channel,
                ...(intent.displayName ? { displayName: intent.displayName } : {}),
                ...(intent.description ? { description: intent.description } : {}),
              },
            } as const,
            summary: `Edit channel ${intent.channel}`,
          }
        case 'ChangeLogo':
          return {
            operation: { _tag: 'editCompany', now, params: { logo: intent.logo } } as const,
            summary: 'Change the company logo',
          }
        case 'RenewTargets':
          return {
            operation: { _tag: 'renewTargets', now } as const,
            summary: 'Renew targets.json',
          }
      }
    })

  // Author tasks

  const authorsTask = (
    id: string,
    c: MockCompany,
    channel: string,
    reason: 'new-channel' | 'renewal' | 'author-removal',
    operation: Operation,
    ceremonyId?: string,
  ) =>
    Effect.gen(function* () {
      const handedOut = state.taskOperations.get(id) ?? operation
      const next = yield* domain(applyOperation(c.repo, handedOut))
      const doc = roleMetadata(next, `channels.${channel}.authors`)
      if (!doc) return []
      state.taskOperations.set(id, handedOut)
      return [
        {
          _tag: 'SignAuthorsMetadata' as const,
          id,
          channel,
          reason,
          ...(ceremonyId ? { ceremonyId } : {}),
          base: repoFilesToText(repoFiles(c.repo)),
          operation: handedOut,
          toSign: {
            role: authorsRoleName(channel),
            keyids: authorKeyids(next, channel),
            signingBytes: toBase64url(signingBytes(doc)),
          },
        },
      ]
    })

  const tasksFor = (c: MockCompany, keyid: string) =>
    Effect.gen(function* () {
      const tasks: Array<typeof AuthorTask.Type> = []
      for (const cer of c.ceremonies) {
        const op = cer.operation
        if (cer.status === 'staged' && op._tag === 'createChannel' && !cer.authorsSignature) {
          const listed = op.params.authors.some((a) => keyidOf(ed25519Key(a.publicKey)) === keyid)
          if (listed)
            tasks.push(
              ...(yield* authorsTask(
                `${cer.id}-a`,
                c,
                op.params.channel,
                'new-channel',
                op,
                cer.id,
              )),
            )
        }
        const open = cer.status === 'awaiting-owner' || cer.status === 'staged'
        if (open && op._tag === 'removeAuthor' && op.params.keyid !== keyid) {
          const { channel } = op.params
          if (!authorKeyids(c.repo, channel).includes(keyid)) continue
          const impact = yield* removalImpact(c, cer)
          const ids = new Set(impact?.itemsSignedOnlyByAuthor.map((i) => i.id))
          const items = channelItems(c.repo, channel).filter((item) => ids.has(item.id))
          if (items.length > 0)
            tasks.push({
              _tag: 'ResignItems',
              id: `${cer.id}-i`,
              channel,
              ceremonyId: cer.id,
              items,
            })
          if (impact?.authorsMetadataNeedsResign)
            tasks.push(
              ...(yield* authorsTask(
                `${cer.id}-r`,
                c,
                channel,
                'author-removal',
                { _tag: 'renewAuthors', now: nowIso(), params: { channel } },
                cer.id,
              )),
            )
        }
      }
      for (const [channel, doc] of Object.entries(c.repo.authors)) {
        const due = Date.parse(doc.signed.expires) - Date.now() < 60 * DAY
        if (
          due &&
          authorKeyids(c.repo, channel).includes(keyid) &&
          !tasks.some((t) => t.channel === channel && t._tag === 'SignAuthorsMetadata')
        )
          tasks.push(
            ...(yield* authorsTask(`renew-${channel}`, c, channel, 'renewal', {
              _tag: 'renewAuthors',
              now: nowIso(),
              params: { channel },
            })),
          )
      }
      return tasks
    })

  // Groups

  const AuthOwner = HttpApiBuilder.group(KeryxKitApi, 'authOwner', (h) =>
    h
      .handle('signup', ({ payload }) =>
        Effect.gen(function* () {
          const code = state.inviteCodes.find((x) => x.code === payload.inviteCode && !x.usedAt)
          if (!code) return yield* new LoginFailed({ error: 'This invite code is not valid.' })
          if (state.companies.has(payload.slug))
            return yield* new Conflict({ error: `The slug ${payload.slug} is taken.` })
          const signupId = randomId()
          const opsSeed = crypto.getRandomValues(new Uint8Array(32))
          const now = nowIso()
          const repoBase = `${yield* requestOrigin}/repo/${payload.slug}/`
          state.signups.set(signupId, { request: payload, opsSeed, now, repoBase })
          state.ownerChallenges.set(signupId, randomHex(32))
          return {
            signupId,
            challenge: {
              challengeHidden: state.ownerChallenges.get(signupId) ?? '',
              challengeVisual: now.slice(0, 19).replace('T', ' '),
            },
            init: {
              now,
              params: {
                repoBase,
                companyName: payload.companyName,
                ...(payload.logo ? { logo: payload.logo } : {}),
                opsKey: publicKeyFromSeed(opsSeed),
              },
            },
            expiresAt: new Date(Date.now() + 3600_000).toISOString(),
          }
        }),
      )
      .handle('completeSignup', ({ params, payload }) =>
        Effect.gen(function* () {
          const signup = state.signups.get(params.signupId)
          if (!signup)
            return yield* new NotFound({ error: 'This sign-up has expired. Start again.' })
          const { request } = signup
          const timing = { now: new Date(signup.now) }
          let s: RepoState = yield* domain(
            initRepo(
              {
                repoBase: signup.repoBase,
                companyName: request.companyName,
                ...(request.logo ? { logo: request.logo } : {}),
                masterKey: payload.masterPublicKey,
                opsKey: publicKeyFromSeed(signup.opsSeed),
              },
              timing,
            ),
          )
          s = yield* domain(attachRoleSignature(s, 'root', payload.signatures.root))
          s = yield* domain(attachRoleSignature(s, 'targets', payload.signatures.targets))
          const repo = yield* domain(
            withFreshness(s, undefined, seedSigner(signup.opsSeed), timing),
          )
          const created: MockCompany = {
            slug: request.slug,
            joinOrigin: request.joinOrigin,
            contactEmail: request.contactEmail,
            createdAt: nowIso(),
            identityKey: payload.login.publicKey,
            opsSeed: signup.opsSeed,
            channelSeeds: {},
            repo,
            domain: { status: 'not-set-up' },
            lastTimestampAt: nowIso(),
            members: [],
            invites: [],
            ceremonies: [],
            drafts: [],
            audit: [],
            sources: {},
          }
          state.companies.set(request.slug, created)
          state.signups.delete(params.signupId)
          const code = state.inviteCodes.find((x) => x.code === request.inviteCode)
          if (code) Object.assign(code, { usedAt: nowIso(), usedBy: request.slug })
          audit(created, { kind: 'owner' }, 'signup', `Signed up ${request.companyName}`, {
            'root.json': 1,
            'targets.json': 1,
          })
          yield* startSession(OwnerCookie, { kind: 'owner', slug: request.slug })
          return { company: { slug: request.slug, name: request.companyName } }
        }),
      )
      .handle('challenge', ({ payload }) =>
        Effect.sync(() => {
          const challengeId = randomId()
          const challengeHidden = randomHex(32)
          state.ownerChallenges.set(challengeId, `${payload.company}:${challengeHidden}`)
          return {
            challengeId,
            challengeHidden,
            challengeVisual: nowIso().slice(0, 19).replace('T', ' '),
          }
        }),
      )
      .handle('login', ({ payload }) =>
        Effect.gen(function* () {
          const entry = state.ownerChallenges.get(payload.challengeId)
          state.ownerChallenges.delete(payload.challengeId)
          const slug = entry?.split(':')[0] ?? ''
          const found = state.companies.get(slug)
          if (!found || found.identityKey !== payload.publicKey)
            return yield* new LoginFailed({
              error: 'This Trezor is not the owner of that company.',
            })
          yield* startSession(OwnerCookie, { kind: 'owner', slug })
          return { company: { slug, name: found.repo.targets.signed.custom.company_name } }
        }),
      )
      .handle('session', () =>
        Effect.map(ownerCompany, (c) => ({
          company: { slug: c.slug, name: c.repo.targets.signed.custom.company_name },
        })).pipe(Effect.orDie),
      )
      .handle('logout', () => endSession(OwnerCookie)),
  )

  const meOf = (c: MockCompany, member: MockCompany['members'][number]) => ({
    id: member.id,
    name: member.name,
    keyLabel: member.keyLabel,
    keyid: member.keyid,
    authorPublicKey: member.authorPublicKey,
    registeredAt: member.registeredAt,
    channels: Object.keys(c.repo.channels).filter((ch) =>
      authorKeyids(c.repo, ch).includes(member.keyid),
    ),
    company: { slug: c.slug, name: c.repo.targets.signed.custom.company_name },
    credentialIds: member.passkeys.map((p) => p.credentialId),
  })

  const findInvite = (token: string) => {
    for (const c of state.companies.values()) {
      const invite = c.invites.find((i) => i.token === token)
      if (invite) return { company: c, invite }
    }
    return undefined
  }

  const usableInvite = (token: string) =>
    Effect.gen(function* () {
      const found = findInvite(token)
      if (!found) return yield* new NotFound({ error: 'This invite link is not valid.' })
      if (found.invite.used || Date.parse(found.invite.expiresAt) < Date.now())
        return yield* new Expired({
          error: 'This invite link was used or has expired. Ask for a new one.',
        })
      return found
    })

  const AuthMember = HttpApiBuilder.group(KeryxKitApi, 'authMember', (h) =>
    h
      .handle('invite', ({ params }) =>
        Effect.map(usableInvite(params.token), ({ company: c, invite }) => ({
          companyName: c.repo.targets.signed.custom.company_name,
          expiresAt: invite.expiresAt,
        })),
      )
      .handle('registrationOptions', ({ payload }) =>
        Effect.gen(function* () {
          const { company: c } = yield* usableInvite(payload.inviteToken)
          const host = new URL(yield* requestOrigin).hostname
          const registrationId = randomId()
          state.registrations.set(registrationId, {
            slug: c.slug,
            inviteToken: payload.inviteToken,
            name: payload.name,
          })
          return {
            registrationId,
            publicKey: {
              challenge: randomId(32),
              rp: { id: host, name: 'Keryx console' },
              user: { id: randomId(16), name: payload.name, displayName: payload.name },
              pubKeyCredParams: [
                { type: 'public-key' as const, alg: -7 },
                { type: 'public-key' as const, alg: -257 },
              ],
              timeout: 120_000,
              authenticatorSelection: {
                residentKey: 'required' as const,
                requireResidentKey: true,
                userVerification: 'required' as const,
              },
              attestation: 'none' as const,
              extensions: { prf: {} },
            },
          }
        }),
      )
      .handle('register', ({ payload }) =>
        Effect.gen(function* () {
          const registration = state.registrations.get(payload.registrationId)
          if (!registration)
            return yield* new Expired({ error: 'Registration expired. Start again.' })
          const { company: c, invite } = yield* usableInvite(registration.inviteToken).pipe(
            Effect.mapError((e) => new Expired({ error: e.error })),
          )
          const keyid = keyidOf(ed25519Key(payload.authorPublicKey))
          if (c.members.some((m) => m.keyid === keyid))
            return yield* new Conflict({ error: 'This author key is already registered.' })
          const n = c.members.length + 1
          const member = {
            id: `m-${randomId(6)}`,
            name: registration.name,
            keyLabel: `author-${n}`,
            keyid,
            authorPublicKey: payload.authorPublicKey,
            registeredAt: nowIso(),
            passkeys: [{ credentialId: payload.credential.id, ...payload.wrappedKey }],
          }
          c.members.push(member)
          invite.used = true
          state.registrations.delete(payload.registrationId)
          audit(
            c,
            memberActor(member),
            'member-registered',
            `${member.name} registered a passkey (${member.keyLabel})`,
          )
          yield* startSession(MemberCookie, { kind: 'member', slug: c.slug, memberId: member.id })
          return meOf(c, member)
        }),
      )
      .handle('loginOptions', () =>
        Effect.gen(function* () {
          const host = new URL(yield* requestOrigin).hostname
          return {
            loginId: randomId(),
            publicKey: {
              challenge: randomId(32),
              rpId: host,
              timeout: 120_000,
              allowCredentials: [],
              userVerification: 'required' as const,
            },
          }
        }),
      )
      .handle('login', ({ payload }) =>
        Effect.gen(function* () {
          for (const c of state.companies.values())
            for (const member of c.members)
              if (member.passkeys.some((p) => p.credentialId === payload.credential.id)) {
                yield* startSession(MemberCookie, {
                  kind: 'member',
                  slug: c.slug,
                  memberId: member.id,
                })
                return meOf(c, member)
              }
          return yield* new LoginFailed({
            error: 'This passkey is not registered with any company.',
          })
        }),
      )
      .handle('me', () =>
        Effect.map(currentMember, ({ company: c, member }) => meOf(c, member)).pipe(Effect.orDie),
      )
      .handle('wrappedKey', ({ params }) =>
        Effect.gen(function* () {
          const { member } = yield* currentMember
          const passkey = member.passkeys.find((p) => p.credentialId === params.credentialId)
          if (!passkey) return yield* new NotFound({ error: 'This passkey is not yours.' })
          return {
            credentialId: passkey.credentialId,
            authorPublicKey: member.authorPublicKey,
            wrappedKey: { iv: passkey.iv, ciphertext: passkey.ciphertext },
          }
        }),
      )
      .handle('logout', () => endSession(MemberCookie)),
  )

  const CompanyGroup = HttpApiBuilder.group(KeryxKitApi, 'company', (h) =>
    h
      .handle('get', () =>
        Effect.map(teamCompany, (c) => {
          const custom = c.repo.targets.signed.custom
          return {
            slug: c.slug,
            name: custom.company_name,
            ...(custom.logo ? { logo: custom.logo } : {}),
            joinOrigin: c.joinOrigin,
            repoBase: c.repo.roots.at(-1)?.signed.custom.repo_base ?? '',
            domain: c.domain,
            targetsExpires: c.repo.targets.signed.expires,
          }
        }).pipe(Effect.orDie),
      )
      .handle('auditLog', () => Effect.map(ownerCompany, (c) => c.audit).pipe(Effect.orDie)),
  )

  const TeamGroup = HttpApiBuilder.group(KeryxKitApi, 'team', (h) =>
    h
      .handle('get', () =>
        Effect.map(ownerCompany, (c) => ({
          members: c.members.map(({ passkeys: _, ...m }) => ({
            ...m,
            channels: Object.keys(c.repo.channels).filter((ch) =>
              authorKeyids(c.repo, ch).includes(m.keyid),
            ),
          })),
          invites: c.invites
            .filter((i) => !i.used && Date.parse(i.expiresAt) > Date.now())
            .map(({ token: _, used: __, ...i }) => i),
        })).pipe(Effect.orDie),
      )
      .handle('invite', ({ payload }) =>
        Effect.gen(function* () {
          const c = yield* Effect.orDie(ownerCompany)
          const invite = {
            id: `i-${randomId(6)}`,
            token: randomId(24),
            label: payload.label,
            createdAt: nowIso(),
            expiresAt: daysFromNow(7),
            used: false,
          }
          c.invites.push(invite)
          audit(
            c,
            { kind: 'owner' },
            'invite-created',
            `Invited ${payload.label || 'a team member'}`,
          )
          const { token, used: _, ...rest } = invite
          return { ...rest, url: `${yield* requestOrigin}/invite#${token}` }
        }),
      ),
  )

  const Channels = HttpApiBuilder.group(KeryxKitApi, 'channels', (h) =>
    h.handle('list', () =>
      Effect.map(teamCompany, (c) => {
        const custom = c.repo.targets.signed.custom
        const live = Object.keys(c.repo.channels).map((name) => ({
          name,
          displayName: custom.channels[name]?.display_name ?? name,
          description: custom.channels[name]?.description ?? '',
          status: 'live' as const,
          authors: authorKeyids(c.repo, name).flatMap((k) => authorRef(c, k)),
          ...(c.repo.authors[name] ? { authorsExpires: c.repo.authors[name].signed.expires } : {}),
          itemCount: Object.keys(c.repo.channels[name]?.signed.targets ?? {}).length,
        }))
        const waiting = c.ceremonies.flatMap((cer) =>
          cer.status === 'staged' && cer.operation._tag === 'createChannel'
            ? [
                {
                  name: cer.operation.params.channel,
                  displayName: cer.operation.params.displayName ?? cer.operation.params.channel,
                  description: cer.operation.params.description ?? '',
                  status: 'waiting-for-author' as const,
                  authors: cer.operation.params.authors.flatMap((a) =>
                    authorRef(c, keyidOf(ed25519Key(a.publicKey))),
                  ),
                  itemCount: 0,
                },
              ]
            : [],
        )
        return [...live, ...waiting]
      }).pipe(Effect.orDie),
    ),
  )

  const findCeremony = (c: MockCompany, id: string) =>
    Effect.fromNullishOr(c.ceremonies.find((x) => x.id === id)).pipe(
      Effect.mapError(() => new NotFound({ error: 'This change does not exist.' })),
    )

  const Ceremonies = HttpApiBuilder.group(KeryxKitApi, 'ceremonies', (h) =>
    h
      .handle('start', ({ payload }) =>
        Effect.gen(function* () {
          const c = yield* Effect.orDie(ownerCompany)
          const open = openCeremony(c)
          if (open)
            return yield* new CeremonyInProgress({
              error: 'Another change is open. Finish or discard it first.',
              ceremonyId: open.id,
            })
          const { operation, summary } = yield* toOperation(c, payload.intent)
          yield* domain(applyOperation(c.repo, operation))
          const now = nowIso()
          const cer: MockCeremony = {
            id: `c-${randomId(6)}`,
            intent: payload.intent,
            operation,
            summary,
            status: 'awaiting-owner',
            ownerSignatures: [],
            missingFiles: [],
            createdAt: now,
            updatedAt: now,
          }
          c.ceremonies.push(cer)
          audit(c, { kind: 'owner' }, 'ceremony-started', summary)
          return yield* ceremonyView(c, cer)
        }),
      )
      .handle('list', () =>
        Effect.gen(function* () {
          const c = yield* Effect.orDie(ownerCompany)
          return yield* Effect.orDie(
            Effect.forEach(
              c.ceremonies.filter((x) => x.status === 'awaiting-owner' || x.status === 'staged'),
              (cer) => ceremonySummary(c, cer),
            ),
          )
        }),
      )
      .handle('get', ({ params }) =>
        Effect.gen(function* () {
          const c = yield* Effect.orDie(ownerCompany)
          const cer = yield* findCeremony(c, params.ceremonyId)
          return yield* Effect.orDie(ceremonyView(c, cer))
        }),
      )
      .handle('sign', ({ params, payload }) =>
        Effect.gen(function* () {
          const c = yield* Effect.orDie(ownerCompany)
          const cer = yield* findCeremony(c, params.ceremonyId)
          if (cer.status !== 'awaiting-owner')
            return yield* new Conflict({ error: 'This change is already signed.' })
          let next = yield* domain(applyOperation(c.repo, cer.operation))
          for (const { role, signature } of payload.signatures)
            next = yield* domain(attachRoleSignature(next, role, signature))
          cer.ownerSignatures = payload.signatures
          yield* tryApply(c, cer)
          return yield* Effect.orDie(ceremonySummary(c, cer))
        }),
      )
      .handle('discard', ({ params }) =>
        Effect.gen(function* () {
          const c = yield* Effect.orDie(ownerCompany)
          const cer = yield* findCeremony(c, params.ceremonyId)
          if (cer.status === 'applied')
            return yield* new Conflict({ error: 'This change is already live.' })
          cer.status = 'discarded'
          audit(c, { kind: 'owner' }, 'ceremony-discarded', cer.summary)
        }),
      )
      .handle('tasks', () =>
        Effect.gen(function* () {
          const { company: c, member } = yield* Effect.orDie(currentMember)
          return yield* Effect.orDie(tasksFor(c, member.keyid))
        }),
      )
      .handle('completeTask', ({ params, payload }) =>
        Effect.gen(function* () {
          const { company: c, member } = yield* Effect.orDie(currentMember)
          const tasks = yield* Effect.orDie(tasksFor(c, member.keyid))
          const task = tasks.find((t) => t.id === params.taskId)
          if (!task) return yield* new NotFound({ error: 'This task is already done.' })
          const before = c.repo
          if (task._tag === 'SignAuthorsMetadata' && payload._tag === 'AuthorsSignature') {
            const operation = state.taskOperations.get(task.id) ?? task.operation
            const next = yield* domain(applyOperation(c.repo, operation))
            const signed = yield* domain(
              attachRoleSignature(next, `channels.${task.channel}.authors`, payload.signature),
            )
            const cer = c.ceremonies.find((x) => x.id === task.ceremonyId)
            if (task.reason === 'new-channel' && cer) {
              cer.authorsSignature = payload.signature
              yield* tryApply(c, cer)
            } else yield* publish(c, signed)
          } else if (task._tag === 'ResignItems' && payload._tag === 'ItemSignatures') {
            let next: RepoState = c.repo
            for (const { itemId, signature } of payload.signatures)
              next = yield* domain(
                addItemSignature(
                  next,
                  { channel: task.channel, id: itemId, signature },
                  { now: new Date() },
                ),
              )
            yield* publish(c, next)
          } else
            return yield* new InvalidRequest({ error: 'This completion does not fit the task.' })
          audit(
            c,
            memberActor(member),
            task._tag === 'ResignItems' ? 'items-resigned' : 'authors-signed',
            task._tag === 'ResignItems'
              ? `${member.name} re-signed ${task.items.length} posts in ${task.channel}`
              : `${member.name} signed the author list of ${task.channel} (${task.reason})`,
            changedVersions(before, c.repo),
          )
          yield* retryStaged(c)
        }).pipe(
          Effect.catchTag('InvalidRequest', (e) =>
            Effect.fail(new RepoInvalid({ error: e.error, issues: [] })),
          ),
        ),
      ),
  )

  const channelLive = (c: MockCompany, channel: string) =>
    c.repo.channels[channel] === undefined
      ? Effect.fail(new NotFound({ error: `There is no live channel ${channel}.` }))
      : Effect.void

  const publishedItem = (c: MockCompany, channel: string, itemId: string) =>
    Effect.gen(function* () {
      const item = channelItems(c.repo, channel).find((i) => i.id === itemId)
      if (!item) return yield* new NotFound({ error: 'This post is not published.' })
      const source = c.sources[itemPath(channel, itemId)]
      return {
        channel,
        item,
        ...(source ? { source } : {}),
        signedBy: item.sig.flatMap((s) => authorRef(c, s.keyid)),
      }
    })

  const writeItem = (
    channel: string,
    payload: {
      item: Parameters<typeof publishItem>[1]['item']
      source?: MockCompany['sources'][string]
      draftId?: string
    },
    mode: 'publish' | 'edit',
  ) =>
    Effect.gen(function* () {
      const { company: c, member } = yield* Effect.orDie(currentMember)
      yield* channelLive(c, channel)
      if (!authorKeyids(c.repo, channel).includes(member.keyid))
        return yield* new Forbidden({ error: `You are not an author of ${channel}.` })
      const exists = channelItems(c.repo, channel).some((i) => i.id === payload.item.id)
      if (mode === 'publish' && exists)
        return yield* new Conflict({
          error: `A post with the id ${payload.item.id} already exists.`,
        })
      if (mode === 'edit' && !exists)
        return yield* new NotFound({ error: 'This post is not published.' })
      const seed = c.channelSeeds[channel]
      const item = seed ? yield* domain(signItem(payload.item, seedSigner(seed))) : payload.item
      const before = c.repo
      yield* publish(c, yield* domain(publishItem(c.repo, { channel, item }, { now: new Date() })))
      if (payload.source) c.sources[itemPath(channel, item.id)] = payload.source
      c.drafts = c.drafts.filter((d) => d.id !== payload.draftId)
      audit(
        c,
        memberActor(member),
        mode === 'publish' ? 'item-published' : 'item-edited',
        `${mode === 'publish' ? 'Published' : 'Edited'} “${item.title}” in ${channel}`,
        changedVersions(before, c.repo),
      )
      return yield* publishedItem(c, channel, item.id)
    }).pipe(
      Effect.catchTag('RepoInvalid', (e) =>
        Effect.fail(new ApiRefused({ error: e.error, code: 'invalid-repo' })),
      ),
    )

  const memberDrafts = Effect.map(currentMember, ({ company: c, member }) => ({ c, member }))

  const Items = HttpApiBuilder.group(KeryxKitApi, 'items', (h) =>
    h
      .handle('list', ({ params }) =>
        Effect.gen(function* () {
          const c = yield* Effect.orDie(teamCompany)
          yield* channelLive(c, params.channel)
          return channelItems(c.repo, params.channel)
            .map((item) => ({
              id: item.id,
              title: item.title,
              datePublished: item.date_published,
              ...(item.date_modified ? { dateModified: item.date_modified } : {}),
              signedBy: item.sig.flatMap((s) => authorRef(c, s.keyid)),
            }))
            .sort((a, b) => b.datePublished.localeCompare(a.datePublished))
        }),
      )
      .handle('get', ({ params }) =>
        Effect.flatMap(Effect.orDie(teamCompany), (c) =>
          publishedItem(c, params.channel, params.itemId),
        ),
      )
      .handle('publish', ({ params, payload }) => writeItem(params.channel, payload, 'publish'))
      .handle('edit', ({ params, payload }) =>
        payload.item.id === params.itemId
          ? writeItem(params.channel, payload, 'edit')
          : Effect.fail(new Conflict({ error: 'The post id cannot change.' })),
      )
      .handle('unpublish', ({ params }) =>
        Effect.gen(function* () {
          const user = yield* CurrentTeamUser
          const c = yield* Effect.orDie(company(user.companySlug))
          const member =
            user._tag === 'Member' ? c.members.find((m) => m.id === user.memberId) : undefined
          if (
            user._tag === 'Member' &&
            (!member || !authorKeyids(c.repo, params.channel).includes(member.keyid))
          )
            return yield* new Forbidden({ error: `You are not an author of ${params.channel}.` })
          const item = channelItems(c.repo, params.channel).find((i) => i.id === params.itemId)
          if (!item) return yield* new NotFound({ error: 'This post is not published.' })
          const before = c.repo
          const next = yield* domain(
            unpublishItem(
              c.repo,
              { channel: params.channel, id: params.itemId },
              { now: new Date() },
            ),
          ).pipe(Effect.mapError((e) => new NotFound({ error: e.error })))
          yield* Effect.orDie(publish(c, next))
          audit(
            c,
            member ? memberActor(member) : { kind: 'owner' },
            'item-unpublished',
            `Unpublished “${item.title}” from ${params.channel}`,
            changedVersions(before, c.repo),
          )
        }),
      )
      .handle('drafts', () =>
        Effect.map(Effect.orDie(memberDrafts), ({ c, member }) =>
          c.drafts
            .filter((d) => d.memberId === member.id)
            .map(({ memberId: _, ...d }) => d)
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
        ),
      )
      .handle('createDraft', ({ payload }) =>
        Effect.gen(function* () {
          const { c, member } = yield* Effect.orDie(memberDrafts)
          const draft = {
            id: `d-${randomId(6)}`,
            memberId: member.id,
            ...payload,
            updatedAt: nowIso(),
          }
          c.drafts.push(draft)
          const { memberId: _, ...rest } = draft
          return rest
        }),
      )
      .handle('saveDraft', ({ params, payload }) =>
        Effect.gen(function* () {
          const { c, member } = yield* Effect.orDie(memberDrafts)
          const draft = c.drafts.find((d) => d.id === params.draftId && d.memberId === member.id)
          if (!draft) return yield* new NotFound({ error: 'This draft no longer exists.' })
          draft.channel = payload.channel
          draft.content = payload.content
          draft.updatedAt = nowIso()
          const { memberId: _, ...rest } = draft
          return rest
        }),
      )
      .handle('deleteDraft', ({ params }) =>
        Effect.gen(function* () {
          const { c, member } = yield* Effect.orDie(memberDrafts)
          const before = c.drafts.length
          c.drafts = c.drafts.filter((d) => !(d.id === params.draftId && d.memberId === member.id))
          if (c.drafts.length === before)
            return yield* new NotFound({ error: 'This draft no longer exists.' })
        }),
      ),
  )

  const kitReadme = (c: MockCompany) =>
    `# Keryx join kit for ${c.joinOrigin}\n\nUpload \`.well-known/keryx/\` and \`join/\` to the web root of ${c.joinOrigin}.\n\nHeaders:\n\n- \`/.well-known/keryx/*\`: \`Access-Control-Allow-Origin: *\`, \`Content-Type: application/json\`\n- \`/join\`: \`Referrer-Policy: no-referrer\`\n\nRedact the \`p\` query parameter from access logs.\n`

  const Join = HttpApiBuilder.group(KeryxKitApi, 'join', (h) =>
    h
      .handle('kit', () =>
        Effect.map(Effect.orDie(ownerCompany), (c) => {
          const files = repoFiles(c.repo)
          return zipSync({
            '.well-known/keryx/root.json': files.anchor['root.json'] ?? new Uint8Array(),
            ...Object.fromEntries(
              Object.entries(files.anchor)
                .filter(([name]) => name !== 'root.json')
                .map(([name, bytes]) => [`.well-known/keryx/${name}`, bytes]),
            ),
            'join/index.html': utf8(joinPageHtml),
            'README.md': utf8(kitReadme(c)),
          })
        }),
      )
      .handle('checkDomain', () =>
        Effect.map(Effect.orDie(ownerCompany), (c) => {
          c.domain = { status: 'live', checkedAt: nowIso() }
          return c.domain
        }),
      ),
  )

  const Operator = HttpApiBuilder.group(KeryxKitApi, 'operator', (h) =>
    h
      .handle('login', ({ payload }) =>
        payload.token === state.operatorToken
          ? startSession(OperatorCookie, { kind: 'operator' })
          : Effect.fail(new LoginFailed({ error: 'This operator token is not valid.' })),
      )
      .handle('logout', () => endSession(OperatorCookie))
      .handle('dashboard', () =>
        Effect.succeed({
          companies: [...state.companies.values()].map((c) => ({
            slug: c.slug,
            name: c.repo.targets.signed.custom.company_name,
            joinOrigin: c.joinOrigin,
            contactEmail: c.contactEmail,
            createdAt: c.createdAt,
            domain: c.domain,
            lastTimestampAt: c.lastTimestampAt,
            expires: {
              root: c.repo.roots.at(-1)?.signed.expires ?? c.repo.targets.signed.expires,
              targets: c.repo.targets.signed.expires,
              snapshot: c.repo.snapshot.signed.expires,
              timestamp: c.repo.timestamp.signed.expires,
              channels: Object.keys(c.repo.channels).map((channel) => ({
                channel,
                channelMetadata: c.repo.channels[channel]?.signed.expires ?? '',
                authorsMetadata: c.repo.authors[channel]?.signed.expires ?? '',
              })),
            },
          })),
        }),
      )
      .handle('inviteCodes', () => Effect.succeed([...state.inviteCodes].reverse()))
      .handle('createInviteCode', ({ payload }) =>
        Effect.sync(() => {
          const code = {
            code: `PILOT-${randomHex(3).toUpperCase()}`,
            note: payload.note,
            createdAt: nowIso(),
          }
          state.inviteCodes.push(code)
          return code
        }),
      )
      .handle('pilotRequests', () => Effect.succeed([...state.pilotRequests].reverse())),
  )

  const Public = HttpApiBuilder.group(KeryxKitApi, 'public', (h) =>
    h
      .handle('requestPilot', ({ payload }) =>
        Effect.sync(() => {
          state.pilotRequests.push({ id: randomId(), ...payload, createdAt: nowIso() })
        }),
      )
      .handle('release', () =>
        Effect.succeed({ gitSha: 'dev', consoleBundleSha256: 'dev-server-no-bundle' }),
      ),
  )

  // Sessions

  const session = (credential: Redacted.Redacted<string>) =>
    state.sessions.get(Redacted.value(credential))

  const Sessions = Layer.mergeAll(
    Layer.succeed(OwnerSession, {
      owner: (effect, { credential }) => {
        const s = session(credential)
        return s?.kind === 'owner'
          ? Effect.provideService(effect, CurrentOwner, { companySlug: s.slug })
          : Effect.fail(new Unauthorized())
      },
    }),
    Layer.succeed(MemberSession, {
      member: (effect, { credential }) => {
        const s = session(credential)
        return s?.kind === 'member'
          ? Effect.provideService(effect, CurrentMember, {
              companySlug: s.slug,
              memberId: s.memberId,
            })
          : Effect.fail(new Unauthorized())
      },
    }),
    Layer.succeed(TeamSession, {
      owner: (effect, { credential }) => {
        const s = session(credential)
        return s?.kind === 'owner'
          ? Effect.provideService(effect, CurrentTeamUser, { _tag: 'Owner', companySlug: s.slug })
          : Effect.fail(new Unauthorized())
      },
      member: (effect, { credential }) => {
        const s = session(credential)
        return s?.kind === 'member'
          ? Effect.provideService(effect, CurrentTeamUser, {
              _tag: 'Member',
              companySlug: s.slug,
              memberId: s.memberId,
            })
          : Effect.fail(new Unauthorized())
      },
    }),
    Layer.succeed(OperatorSession, {
      operator: (effect, { credential }) =>
        session(credential)?.kind === 'operator'
          ? Effect.provideService(effect, CurrentOperator, { sessionId: 'mock' })
          : Effect.fail(new Unauthorized()),
    }),
    HttpApiMiddleware.layerSchemaErrorTransform(RequestValidation, (error) =>
      Effect.fail(
        new InvalidRequest({
          error: `The request is not in the expected format: ${String(error)}`,
        }),
      ),
    ),
  )

  const Platform = Layer.mergeAll(HttpPlatform.layer, Etag.layer, Path.layer).pipe(
    Layer.provideMerge(FileSystem.layerNoop({})),
  )

  const { handler } = HttpRouter.toWebHandler(
    HttpApiBuilder.layer(KeryxKitApi).pipe(
      Layer.provide(
        Layer.mergeAll(
          AuthOwner,
          AuthMember,
          CompanyGroup,
          TeamGroup,
          Channels,
          Ceremonies,
          Items,
          Join,
          Operator,
          Public,
        ).pipe(Layer.provide(Sessions)),
      ),
      Layer.provide(Platform),
    ),
    { disableLogger: true },
  )

  /** Static repo files under `/repo/<slug>/`, as `repo.<service>` serves them. */
  const repoFile = (slug: string, path: string): Uint8Array | undefined => {
    const found = state.companies.get(slug)
    return found ? repoFiles(found.repo).base[path] : undefined
  }

  return { handler, repoFile, operatorToken: state.operatorToken }
}
