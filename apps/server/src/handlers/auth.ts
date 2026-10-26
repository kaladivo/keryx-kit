import {
  Conflict,
  CurrentMember,
  CurrentOwner,
  Expired,
  KeryxKitApi,
  LoginFailed,
  NotFound,
  Refused,
} from '@keryx-kit/api'
import {
  attachRoleSignature,
  ed25519Key,
  initRepo,
  keyidOf,
  toBase64url,
  toHex,
} from '@keryx-kit/domain'
import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { SqlClient } from 'effect/sql'
import { domain } from '../ceremonies.ts'
import { repoBaseFor, ServerConfig } from '../config.ts'
import { randomBytes, randomToken, sha256Hex, verifyTrezorLogin } from '../crypto.ts'
import { changedVersions, commit, markTimestamp, Repos } from '../repos.ts'
import { generateServerKey } from '../serverKeys.ts'
import { endSession, rateLimit, startSession } from '../sessions.ts'
import { orDieSql } from '../sql.ts'
import { audit, findCompany, type MemberRow } from '../store.ts'
import { addMs, iso, now } from '../time.ts'
import { meView } from '../views.ts'
import { SUPPORTED_ALGORITHMS, verifyAuthentication, verifyRegistration } from '../webauthn.ts'

const MINUTE = 60_000

const trezorChallenge = (at: Date) => ({
  challengeHidden: toHex(randomBytes(32)),
  challengeVisual: iso(at).slice(0, 19).replace('T', ' '),
})

const loginFailed = (error = 'The Trezor login did not verify.') => new LoginFailed({ error })

export const AuthOwnerLive = HttpApiBuilder.group(KeryxKitApi, 'authOwner', (handlers) =>
  handlers
    .handle('signup', ({ payload }) =>
      Effect.gen(function* () {
        yield* rateLimit('signup')
        const sql = yield* SqlClient.SqlClient
        const config = yield* ServerConfig
        const codes = yield* sql`SELECT code FROM invite_codes
          WHERE code = ${payload.inviteCode} AND used_at IS NULL`
        if (codes.length === 0) {
          return yield* new LoginFailed({ error: 'This invite code is not valid.' })
        }
        if (yield* findCompany(payload.slug)) {
          return yield* new Conflict({ error: `The company id ${payload.slug} is taken.` })
        }
        const at = yield* now
        const ops = yield* generateServerKey(payload.slug, 'ops')
        const challenge = trezorChallenge(at)
        const signupId = randomToken(12)
        const expiresAt = iso(addMs(at, 60 * MINUTE))
        yield* sql`INSERT INTO signups ${sql.insert({
          id: signupId,
          invite_code: payload.inviteCode,
          slug: payload.slug,
          company_name: payload.companyName,
          join_origin: payload.joinOrigin,
          logo: payload.logo ?? null,
          contact_email: payload.contactEmail,
          ops_public_key: ops.publicKey,
          challenge_hidden: challenge.challengeHidden,
          challenge_visual: challenge.challengeVisual,
          now: iso(at),
          expires_at: expiresAt,
        })}`
        return {
          signupId,
          challenge,
          init: {
            now: iso(at),
            params: {
              repoBase: repoBaseFor(config, payload.slug),
              companyName: payload.companyName,
              ...(payload.logo ? { logo: payload.logo } : {}),
              opsKey: ops.publicKey,
            },
          },
          expiresAt,
        }
      }).pipe(orDieSql),
    )
    .handle('completeSignup', ({ params, payload }) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const config = yield* ServerConfig
        const rows = yield* sql<{
          invite_code: string
          slug: string
          company_name: string
          join_origin: string
          logo: string | null
          contact_email: string
          ops_public_key: string
          challenge_hidden: string
          challenge_visual: string
          now: string
          expires_at: string
        }>`SELECT * FROM signups WHERE id = ${params.signupId}`
        const signup = rows[0]
        if (!signup) return yield* new NotFound({ error: 'No such sign-up.' })
        const at = yield* now
        if (signup.expires_at < iso(at)) {
          return yield* new Expired({ error: 'This sign-up expired. Start again.' })
        }
        const unused = yield* sql`SELECT code FROM invite_codes
          WHERE code = ${signup.invite_code} AND used_at IS NULL`
        if (unused.length === 0) {
          return yield* new Expired({ error: 'This invite code was already used.' })
        }
        if (yield* findCompany(signup.slug)) {
          return yield* new Refused({
            error: `The company id ${signup.slug} is taken.`,
            code: 'invalid-company',
          })
        }
        const proof = {
          challengeHidden: signup.challenge_hidden,
          challengeVisual: signup.challenge_visual,
          ...payload.login,
        }
        if (!verifyTrezorLogin(proof)) return yield* loginFailed()
        const init = yield* domain(
          initRepo(
            {
              repoBase: repoBaseFor(config, signup.slug),
              companyName: signup.company_name,
              ...(signup.logo ? { logo: signup.logo } : {}),
              masterKey: payload.masterPublicKey,
              opsKey: signup.ops_public_key,
            },
            { now: new Date(signup.now) },
          ),
        )
        const signed = yield* domain(
          Effect.flatMap(attachRoleSignature(init, 'root', payload.signatures.root), (state) =>
            attachRoleSignature(state, 'targets', payload.signatures.targets),
          ),
        )
        const repos = yield* Repos
        const next = yield* repos.locked(commit(signup.slug, undefined, signed))
        yield* sql`INSERT INTO companies ${sql.insert({
          slug: signup.slug,
          name: signup.company_name,
          join_origin: signup.join_origin,
          contact_email: signup.contact_email,
          identity_key: payload.login.publicKey,
          created_at: iso(at),
        })}`
        yield* markTimestamp(signup.slug)
        yield* sql`UPDATE invite_codes SET used_at = ${iso(at)}, used_by = ${signup.slug}
          WHERE code = ${signup.invite_code}`
        yield* sql`DELETE FROM signups WHERE id = ${params.signupId}`
        yield* startSession('owner', { companySlug: signup.slug })
        yield* audit(
          signup.slug,
          { kind: 'owner' },
          'signup',
          `Created ${signup.company_name}`,
          changedVersions(undefined, next),
        )
        return { company: { slug: signup.slug, name: signup.company_name } }
      }).pipe(orDieSql),
    )
    .handle('challenge', ({ payload }) =>
      Effect.gen(function* () {
        yield* rateLimit('owner-login')
        const sql = yield* SqlClient.SqlClient
        const at = yield* now
        const challenge = trezorChallenge(at)
        const challengeId = randomToken(12)
        yield* sql`INSERT INTO owner_challenges ${sql.insert({
          id: challengeId,
          company_slug: payload.company,
          challenge_hidden: challenge.challengeHidden,
          challenge_visual: challenge.challengeVisual,
          expires_at: iso(addMs(at, 5 * MINUTE)),
        })}`
        return { challengeId, ...challenge }
      }).pipe(orDieSql),
    )
    .handle('login', ({ payload }) =>
      Effect.gen(function* () {
        yield* rateLimit('owner-login')
        const sql = yield* SqlClient.SqlClient
        const rows = yield* sql<{
          company_slug: string
          challenge_hidden: string
          challenge_visual: string
          expires_at: string
        }>`SELECT * FROM owner_challenges WHERE id = ${payload.challengeId}`
        yield* sql`DELETE FROM owner_challenges WHERE id = ${payload.challengeId}`
        const challenge = rows[0]
        if (!challenge || challenge.expires_at < iso(yield* now)) return yield* loginFailed()
        const company = yield* findCompany(challenge.company_slug)
        const verified =
          company?.identity_key === payload.publicKey &&
          verifyTrezorLogin({
            challengeHidden: challenge.challenge_hidden,
            challengeVisual: challenge.challenge_visual,
            publicKey: payload.publicKey,
            signature: payload.signature,
          })
        if (!company || !verified) return yield* loginFailed()
        yield* startSession('owner', { companySlug: company.slug })
        return { company: { slug: company.slug, name: company.name } }
      }).pipe(orDieSql),
    )
    .handle('session', () =>
      Effect.gen(function* () {
        const owner = yield* CurrentOwner
        const company = yield* findCompany(owner.companySlug)
        return { company: { slug: owner.companySlug, name: company?.name ?? owner.companySlug } }
      }),
    )
    .handle('logout', () => endSession('owner')),
)

interface InviteRow {
  readonly id: string
  readonly company_slug: string
  readonly label: string
  readonly expires_at: string
  readonly used_at: string | null
}

const usableInvite = (inviteId: string | undefined, by: { tokenHash?: string }) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = by.tokenHash
      ? yield* sql<InviteRow>`SELECT * FROM invites WHERE token_hash = ${by.tokenHash}`
      : yield* sql<InviteRow>`SELECT * FROM invites WHERE id = ${inviteId ?? ''}`
    const invite = rows[0]
    if (!invite) return yield* new NotFound({ error: 'This invite link is not valid.' })
    if (invite.used_at !== null || invite.expires_at < iso(yield* now)) {
      return yield* new Expired({
        error: 'This invite link was used or has expired. Ask for a new one.',
      })
    }
    return invite
  }).pipe(orDieSql)

const findMemberById = (memberId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<MemberRow>`SELECT * FROM members WHERE id = ${memberId}`
    const member = rows[0]
    return member ?? (yield* Effect.die(new Error(`session for unknown member ${memberId}`)))
  }).pipe(orDieSql)

export const currentMember = Effect.flatMap(CurrentMember, (session) =>
  findMemberById(session.memberId),
)

interface ChallengeRow {
  readonly challenge: string
  readonly invite_id: string | null
  readonly name: string | null
  readonly expires_at: string
}

const takeChallenge = (id: string, kind: 'register' | 'login') =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<ChallengeRow>`SELECT * FROM webauthn_challenges
      WHERE id = ${id} AND kind = ${kind}`
    yield* sql`DELETE FROM webauthn_challenges WHERE id = ${id}`
    const row = rows[0]
    return row && row.expires_at >= iso(yield* now) ? row : undefined
  }).pipe(orDieSql)

const passkeyFailed = () =>
  new LoginFailed({ error: 'The passkey could not be verified. Try again.' })

export const AuthMemberLive = HttpApiBuilder.group(KeryxKitApi, 'authMember', (handlers) =>
  handlers
    .handle('invite', ({ params }) =>
      Effect.gen(function* () {
        const invite = yield* usableInvite(undefined, { tokenHash: sha256Hex(params.token) })
        const company = yield* findCompany(invite.company_slug)
        return { companyName: company?.name ?? invite.company_slug, expiresAt: invite.expires_at }
      }),
    )
    .handle('registrationOptions', ({ payload }) =>
      Effect.gen(function* () {
        yield* rateLimit('member-register')
        const sql = yield* SqlClient.SqlClient
        const config = yield* ServerConfig
        const invite = yield* usableInvite(undefined, {
          tokenHash: sha256Hex(payload.inviteToken),
        })
        const company = yield* findCompany(invite.company_slug)
        const at = yield* now
        const registrationId = randomToken(12)
        const challenge = toBase64url(randomBytes(32))
        const userId = toBase64url(randomBytes(16))
        yield* sql`INSERT INTO webauthn_challenges ${sql.insert({
          id: registrationId,
          kind: 'register',
          challenge,
          invite_id: invite.id,
          name: payload.name,
          user_id: userId,
          expires_at: iso(addMs(at, 10 * MINUTE)),
        })}`
        // The company name tells passkeys apart when one person authors for several companies.
        const label = `${payload.name} (${company?.name ?? invite.company_slug})`
        return {
          registrationId,
          publicKey: {
            challenge,
            rp: { id: config.rpId, name: 'Keryx' },
            user: { id: userId, name: label, displayName: label },
            pubKeyCredParams: SUPPORTED_ALGORITHMS.map((alg) => ({
              type: 'public-key' as const,
              alg,
            })),
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
      }).pipe(orDieSql),
    )
    .handle('register', ({ payload }) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const config = yield* ServerConfig
        const challenge = yield* takeChallenge(payload.registrationId, 'register')
        if (!challenge?.invite_id || challenge.name === null) {
          return yield* new Expired({ error: 'This registration expired. Start again.' })
        }
        const invite = yield* usableInvite(challenge.invite_id, {}).pipe(
          Effect.catchTag('NotFound', () =>
            Effect.fail(new Expired({ error: 'This invite link is no longer valid.' })),
          ),
        )
        if (payload.credential.clientExtensionResults.prf?.enabled !== true) {
          return yield* new LoginFailed({
            error:
              'This passkey does not support the PRF extension, so it cannot hold an author key.',
          })
        }
        const passkey = yield* verifyRegistration(payload.credential, {
          challenge: challenge.challenge,
          origin: config.consoleOrigin,
          rpId: config.rpId,
        })
        if (!passkey) return yield* passkeyFailed()
        const keyid = keyidOf(ed25519Key(payload.authorPublicKey))
        const taken = yield* sql`SELECT id FROM members WHERE keyid = ${keyid}`
        if (taken.length > 0) {
          return yield* new Conflict({ error: 'This author key is already registered.' })
        }
        const at = iso(yield* now)
        const count = yield* sql<{ n: number }>`SELECT COUNT(*) AS n FROM members
          WHERE company_slug = ${invite.company_slug}`
        const member: MemberRow = {
          id: randomToken(12),
          company_slug: invite.company_slug,
          name: challenge.name,
          key_label: `author-${(count[0]?.n ?? 0) + 1}`,
          author_public_key: payload.authorPublicKey,
          keyid,
          registered_at: at,
        }
        yield* sql`INSERT INTO members ${sql.insert({ ...member })}`
        yield* sql`INSERT INTO passkeys ${sql.insert({
          credential_id: passkey.credentialId,
          member_id: member.id,
          public_key: passkey.publicKey,
          counter: passkey.counter,
          transports: JSON.stringify(passkey.transports),
          iv: payload.wrappedKey.iv,
          ciphertext: payload.wrappedKey.ciphertext,
          created_at: at,
        })}`
        yield* sql`UPDATE invites SET used_at = ${at} WHERE id = ${invite.id}`
        yield* startSession('member', { companySlug: member.company_slug, memberId: member.id })
        yield* audit(
          member.company_slug,
          { kind: 'member', member },
          'member-registered',
          `${member.name} registered as ${member.key_label}`,
        )
        return yield* meView(member)
      }).pipe(orDieSql),
    )
    .handle('loginOptions', () =>
      Effect.gen(function* () {
        yield* rateLimit('member-login')
        const sql = yield* SqlClient.SqlClient
        const config = yield* ServerConfig
        const loginId = randomToken(12)
        const challenge = toBase64url(randomBytes(32))
        yield* sql`INSERT INTO webauthn_challenges ${sql.insert({
          id: loginId,
          kind: 'login',
          challenge,
          expires_at: iso(addMs(yield* now, 5 * MINUTE)),
        })}`
        return {
          loginId,
          publicKey: {
            challenge,
            rpId: config.rpId,
            timeout: 120_000,
            allowCredentials: [],
            userVerification: 'required' as const,
          },
        }
      }).pipe(orDieSql),
    )
    .handle('login', ({ payload }) =>
      Effect.gen(function* () {
        yield* rateLimit('member-login')
        const sql = yield* SqlClient.SqlClient
        const config = yield* ServerConfig
        const challenge = yield* takeChallenge(payload.loginId, 'login')
        if (!challenge) return yield* passkeyFailed()
        const rows = yield* sql<{
          member_id: string
          public_key: Uint8Array
          counter: number
          transports: string
        }>`SELECT * FROM passkeys WHERE credential_id = ${payload.credential.id}`
        const stored = rows[0]
        if (!stored) return yield* passkeyFailed()
        const counter = yield* verifyAuthentication(
          payload.credential,
          {
            credentialId: payload.credential.id,
            publicKey: stored.public_key,
            counter: stored.counter,
            transports: JSON.parse(stored.transports) as ReadonlyArray<string>,
          },
          { challenge: challenge.challenge, origin: config.consoleOrigin, rpId: config.rpId },
        )
        if (counter === undefined) return yield* passkeyFailed()
        yield* sql`UPDATE passkeys SET counter = ${counter}
          WHERE credential_id = ${payload.credential.id}`
        const member = yield* findMemberById(stored.member_id)
        yield* startSession('member', { companySlug: member.company_slug, memberId: member.id })
        return yield* meView(member)
      }).pipe(orDieSql),
    )
    .handle('me', () => Effect.flatMap(currentMember, meView))
    .handle('wrappedKey', ({ params }) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const member = yield* currentMember
        const rows = yield* sql<{ iv: string; ciphertext: string }>`SELECT iv, ciphertext
          FROM passkeys WHERE credential_id = ${params.credentialId} AND member_id = ${member.id}`
        const row = rows[0]
        if (!row) {
          return yield* new NotFound({
            error: 'That passkey belongs to another account. Pick the passkey for this company.',
          })
        }
        return {
          credentialId: params.credentialId,
          authorPublicKey: member.author_public_key,
          wrappedKey: { iv: row.iv, ciphertext: row.ciphertext },
        }
      }).pipe(orDieSql),
    )
    .handle('logout', () => endSession('member')),
)
