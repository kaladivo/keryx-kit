/**
 * The browser side of an owner ceremony (mvp-spec §5.5, docs/api.md "The signing
 * model"): rebuild the change from the published repo, compare the bytes the server
 * wants signed with our own, describe our own copy, then sign our own copy.
 */
import {
  type Ceremony,
  type Intent,
  type Member,
  type Operation,
  type OwnerSignature,
  rebuild,
  repoFilesFromText,
} from '@keryx-kit/api'
import {
  bytesEqual,
  decodeItem,
  fromBase64url,
  parseRepoFiles,
  type RepoState,
  roleMetadata,
  seedSigner,
  sha256Hex,
  signatureFor,
  signingBytes,
  validateRepo,
} from '@keryx-kit/domain'
import { Data, Effect } from 'effect'
import { keyidFingerprint, keyidOfPublicKey } from './fingerprint.ts'
import { masterKeyidOf, publishedMasterKeyid, WrongWallet } from './masterKey.ts'

export type CeremonyData = typeof Ceremony.Type
type MemberData = typeof Member.Type
type SignatureData = typeof OwnerSignature.Type

export class CeremonyRefused extends Data.TaggedError('CeremonyRefused')<{
  readonly reason: string
}> {}

const refused = (reason: string) => new CeremonyRefused({ reason })

export interface KeyLine {
  readonly kind: 'author' | 'channel'
  readonly label: string
  readonly name?: string
  readonly fingerprint: string
}

export interface ChangeLine {
  readonly kind: 'add' | 'edit' | 'remove' | 'note'
  readonly text: string
  readonly detail?: string
  readonly keys?: ReadonlyArray<KeyLine>
  readonly logo?: string
  readonly items?: ReadonlyArray<string>
}

/** One role whose server bytes equal the browser's rebuild. */
export interface ByteCheck {
  readonly role: 'root' | 'targets'
  readonly file: string
  readonly version: number
  readonly length: number
  readonly sha256: string
}

export interface CeremonyReview {
  readonly lines: ReadonlyArray<ChangeLine>
  readonly checks: ReadonlyArray<ByteCheck>
  readonly masterKeyid: string
  readonly state: RepoState
}

// What the owner clicked must be what the server turned into an operation.

const sameText = (a: string | undefined, b: string | undefined) => (a ?? '') === (b ?? '')

const memberKey = (members: ReadonlyArray<MemberData>, id: string) =>
  members.find((member) => member.id === id)?.authorPublicKey

const intentProblem = (
  intent: Intent,
  operation: Operation,
  members: ReadonlyArray<MemberData>,
): string | undefined => {
  const mismatch = 'The server turned your request into a different change.'
  switch (intent._tag) {
    case 'CreateChannel': {
      if (operation._tag !== 'createChannel') return mismatch
      const { params } = operation
      const wanted = intent.authors.map((id) => memberKey(members, id)).sort()
      const got = params.authors.map((author) => author.publicKey).sort()
      return params.channel === intent.channel &&
        sameText(params.displayName, intent.displayName) &&
        sameText(params.description, intent.description) &&
        wanted.join() === got.join()
        ? undefined
        : mismatch
    }
    case 'AssignAuthor':
      return operation._tag === 'assignAuthor' &&
        operation.params.channel === intent.channel &&
        operation.params.author.publicKey === memberKey(members, intent.memberId)
        ? undefined
        : mismatch
    case 'RemoveAuthor': {
      const key = memberKey(members, intent.memberId)
      return operation._tag === 'removeAuthor' &&
        operation.params.channel === intent.channel &&
        key !== undefined &&
        operation.params.keyid === keyidOfPublicKey(key)
        ? undefined
        : mismatch
    }
    case 'EditChannel':
      return operation._tag === 'editChannel' &&
        operation.params.channel === intent.channel &&
        sameText(operation.params.displayName, intent.displayName) &&
        sameText(operation.params.description, intent.description)
        ? undefined
        : mismatch
    case 'ChangeLogo':
      return operation._tag === 'editCompany' && operation.params.logo === intent.logo
        ? undefined
        : mismatch
    case 'RenewTargets':
      return operation._tag === 'renewTargets' ? undefined : mismatch
  }
}

// The summary, generated from the browser's own copy.

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

const describeChange = (
  before: RepoState,
  after: RepoState,
  names: ReadonlyMap<string, string>,
): ReadonlyArray<ChangeLine> => {
  const b = before.targets.signed
  const a = after.targets.signed
  const keyLine = (keyid: string, kind: KeyLine['kind']): KeyLine => {
    const name = names.get(keyid)
    return {
      kind,
      label: a.delegations.keys[keyid]?.name ?? b.delegations.keys[keyid]?.name ?? 'key',
      ...(name === undefined ? {} : { name }),
      fingerprint: keyidFingerprint(keyid),
    }
  }
  const who = (keyid: string) => names.get(keyid) ?? keyLine(keyid, 'author').label
  const roleKeyids = (state: RepoState, role: string) =>
    state.targets.signed.delegations.roles.find((r) => r.name === role)?.keyids ?? []
  const lines: Array<ChangeLine> = []

  if (a.custom.company_name !== b.custom.company_name)
    lines.push({
      kind: 'edit',
      text: `Rename the company from “${b.custom.company_name}” to “${a.custom.company_name}”`,
    })
  if (a.custom.logo !== b.custom.logo)
    lines.push({
      kind: 'edit',
      text: 'Replace the company logo',
      detail: 'Subscribers see a one-tap acknowledgement of the new logo.',
      ...(a.custom.logo === undefined ? {} : { logo: a.custom.logo }),
    })

  for (const [channel, display] of Object.entries(a.custom.channels)) {
    const old = b.custom.channels[channel]
    const title = display.display_name ?? channel
    if (old === undefined) {
      lines.push({
        kind: 'add',
        text: `Create channel ${title} (${channel})`,
        ...(display.description ? { detail: display.description } : {}),
        keys: [
          ...roleKeyids(after, `channels.${channel}`).map((k) => keyLine(k, 'channel')),
          ...roleKeyids(after, `channels.${channel}.authors`).map((k) => keyLine(k, 'author')),
        ],
      })
      continue
    }
    if (!sameText(old.display_name, display.display_name))
      lines.push({
        kind: 'edit',
        text: `Rename channel ${channel} from “${old.display_name ?? channel}” to “${title}”`,
      })
    if (!sameText(old.description, display.description))
      lines.push({
        kind: 'edit',
        text: `Change the description of ${title}`,
        detail: display.description ?? '(no description)',
      })
    const was = roleKeyids(before, `channels.${channel}.authors`)
    const now = roleKeyids(after, `channels.${channel}.authors`)
    const added = now.filter((k) => !was.includes(k))
    const removed = was.filter((k) => !now.includes(k))
    if (added.length > 0)
      lines.push({
        kind: 'add',
        text: `Add ${added.map(who).join(', ')} as author of ${title}`,
        keys: added.map((k) => keyLine(k, 'author')),
      })
    if (removed.length > 0)
      lines.push({
        kind: 'remove',
        text: `Remove ${removed.map(who).join(', ')} from ${title}`,
        detail: 'Their key stops working on this channel.',
        keys: removed.map((k) => keyLine(k, 'author')),
      })
    const kept = after.channels[channel]?.signed.targets ?? {}
    const dropped = Object.keys(before.channels[channel]?.signed.targets ?? {}).filter(
      (path) => kept[path] === undefined,
    )
    if (dropped.length > 0)
      lines.push({
        kind: 'remove',
        text: `Unpublish ${dropped.length} ${dropped.length === 1 ? 'post' : 'posts'} from ${title} that no remaining author signed`,
        items: dropped.map((path) => {
          const bytes = before.items[path]
          const item = bytes && Effect.runSync(Effect.option(decodeItem(bytes)))
          return item?._tag === 'Some' ? item.value.title : path
        }),
      })
  }
  for (const channel of Object.keys(b.custom.channels))
    if (a.custom.channels[channel] === undefined)
      lines.push({
        kind: 'remove',
        text: `Delete channel ${b.custom.channels[channel]?.display_name ?? channel}`,
      })

  lines.push({
    kind: 'note',
    text:
      lines.length === 0
        ? `Renew targets.json until ${formatDate(a.expires)}`
        : `targets.json becomes version ${a.version}, valid until ${formatDate(a.expires)}`,
  })
  return lines
}

const signableRole = (role: string): role is ByteCheck['role'] =>
  role === 'root' || role === 'targets'

const roleFile = (role: ByteCheck['role'], state: RepoState) =>
  role === 'root' ? `${state.roots.length}.root.json` : 'targets.json'

const decodeBase64url = (text: string) =>
  Effect.try({
    try: () => fromBase64url(text),
    catch: () => refused('The server sent signing bytes that are not base64url.'),
  })

/**
 * Rebuilds the change and refuses on any difference with what the server sent. The
 * review carries the browser's own state; only that state is ever signed.
 */
export const reviewCeremony = (
  ceremony: CeremonyData,
  members: ReadonlyArray<MemberData>,
): Effect.Effect<CeremonyReview, CeremonyRefused> =>
  Effect.gen(function* () {
    const base = yield* parseRepoFiles(repoFilesFromText(ceremony.base)).pipe(
      Effect.mapError((e) => refused(`The published repo does not load: ${e.message}`)),
    )
    const [issue] = validateRepo(base)
    if (issue) return yield* refused(`The published repo does not verify: ${issue.message}`)
    const masterKeyid = publishedMasterKeyid(base)
    if (masterKeyid === undefined)
      return yield* refused('The published root.json has no single master key.')
    const problem = intentProblem(ceremony.intent, ceremony.operation, members)
    if (problem) return yield* refused(problem)
    const state = yield* rebuild(ceremony.base, ceremony.operation).pipe(
      Effect.mapError((e) => refused(`This change cannot be built: ${e.message}`)),
    )

    const checks: Array<ByteCheck> = []
    for (const request of ceremony.toSign) {
      const role = request.role
      if (!signableRole(role)) return yield* refused(`The owner never signs ${role}.`)
      if (!request.keyids.includes(masterKeyid))
        return yield* refused(`The server asks a key other than the master key to sign ${role}.`)
      const doc = roleMetadata(state, role)
      if (doc === undefined) return yield* refused(`The rebuilt repo has no ${role}.`)
      const mine = signingBytes(doc)
      const theirs = yield* decodeBase64url(request.signingBytes)
      if (!bytesEqual(mine, theirs))
        return yield* refused(
          `The server asked to sign different ${roleFile(role, state)} bytes than this browser built from the published repo and your change. Nothing was signed.`,
        )
      checks.push({
        role,
        file: roleFile(role, state),
        version: doc.signed.version,
        length: mine.length,
        sha256: sha256Hex(mine),
      })
    }

    const names = new Map(members.map((member) => [member.keyid, member.name]))
    return { lines: describeChange(base, state, names), checks, masterKeyid, state }
  })

/**
 * Signs the browser's own copy with a Trezor-derived seed. Refuses before signing when
 * the seed is not the published master key (another Suite wallet). The caller wipes it.
 */
export const signCeremony = (
  review: CeremonyReview,
  seed: Uint8Array,
): Effect.Effect<ReadonlyArray<SignatureData>, WrongWallet | CeremonyRefused> =>
  Effect.gen(function* () {
    if (masterKeyidOf(seed) !== review.masterKeyid) return yield* Effect.fail(new WrongWallet())
    const signer = seedSigner(seed)
    const signatures: Array<SignatureData> = []
    for (const check of review.checks) {
      const doc = roleMetadata(review.state, check.role)
      if (doc === undefined) return yield* refused(`The rebuilt repo has no ${check.role}.`)
      const signature = yield* signatureFor(doc, signer).pipe(
        Effect.mapError(() => refused('Signing failed.')),
      )
      signatures.push({ role: check.role, signature })
    }
    return signatures
  })
