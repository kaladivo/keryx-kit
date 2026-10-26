/**
 * Author tasks (mvp-spec B3, B5, E3): signatures the console performs on its own the
 * next time an author unlocks their key. Each task is checked before anything is signed.
 */
import { type AuthorTask, rebuild, type TaskCompletion } from '@keryx-kit/api'
import {
  type Authority,
  authorityOf,
  authorsRoleName,
  bytesEqual,
  type DelegatedTargetsMetadata,
  fromBase64url,
  type Item,
  itemSignatureFor,
  type RootMetadata,
  type Signer,
  signatureFor,
  signingBytes,
  type TargetsMetadata,
  validateTargets,
  verifyItemSignatures,
} from '@keryx-kit/domain'
import { Data, Effect } from 'effect'
import { verifiedBase } from './ceremony.ts'

export class TaskRefused extends Data.TaggedError('TaskRefused')<{ readonly reason: string }> {}

const refused = (reason: string) => new TaskRefused({ reason })

type Completion = typeof TaskCompletion.Type

export const describeTask = (task: AuthorTask): string => {
  if (task._tag === 'ResignItems')
    return `Re-sign ${task.items.length} ${task.items.length === 1 ? 'post' : 'posts'} in ${task.channel} so they stay published after an author leaves`
  switch (task.reason) {
    case 'new-channel':
      return `Sign the author list of the new channel ${task.channel} so it goes live`
    case 'renewal':
      return `Renew the author list of ${task.channel} before it expires`
    case 'author-removal':
      return `Re-sign the author list of ${task.channel} before an author is removed`
  }
}

const expectedOperation = {
  'new-channel': 'createChannel',
  renewal: 'renewAuthors',
  'author-removal': 'renewAuthors',
} as const

/** An authors role only authorizes item signers (spec feeds §2); it lists nothing itself. */
const pinsOrDelegates = ({ signed }: DelegatedTargetsMetadata) =>
  Object.keys(signed.targets).length > 0 ||
  Object.keys(signed.delegations.keys).length > 0 ||
  signed.delegations.roles.length > 0

const signAuthorsMetadata = (
  task: Extract<AuthorTask, { _tag: 'SignAuthorsMetadata' }>,
  signer: Signer,
): Effect.Effect<Completion, TaskRefused> =>
  Effect.gen(function* () {
    const role = authorsRoleName(task.channel)
    if (task.toSign.role !== role || task.operation._tag !== expectedOperation[task.reason])
      return yield* refused('The task does not match the signature it asks for.')
    if (task.operation.params.channel !== task.channel)
      return yield* refused('The task names a different channel than its change.')
    yield* verifiedBase(task.base).pipe(Effect.mapError(refused))
    const state = yield* rebuild(task.base, task.operation).pipe(
      Effect.mapError((e) => refused(`The change cannot be built: ${e.message}`)),
    )
    const doc = state.authors[task.channel]
    const authority = authorityOf(state, role)
    if (doc === undefined || authority === undefined)
      return yield* refused(`The rebuilt repo has no ${role}.`)
    if (pinsOrDelegates(doc))
      return yield* refused('The author list would pin files or delegate. Nothing was signed.')
    if (!authority.keyids.includes(signer.keyid) || !task.toSign.keyids.includes(signer.keyid))
      return yield* refused(`You are not an author of ${task.channel} in this change.`)
    const theirs = yield* Effect.try({
      try: () => fromBase64url(task.toSign.signingBytes),
      catch: () => refused('The task carries bytes that are not base64url.'),
    })
    if (!bytesEqual(signingBytes(doc), theirs))
      return yield* refused(
        'The server asked to sign different bytes than this browser rebuilt. Nothing was signed.',
      )
    const signature = yield* signatureFor(doc, signer).pipe(
      Effect.mapError(() => refused('Signing failed.')),
    )
    return { _tag: 'AuthorsSignature', signature } as const
  })

/**
 * What `ResignItems` is checked against. The task carries no repo and the repo origin
 * belongs to the service, so `targets.json` only counts once it verifies against the root
 * chain from the company's own domain (`/.well-known/keryx/`), which the service cannot
 * change. `roots` is undefined when the domain did not serve it.
 */
export interface PublishedAuthors {
  readonly roots: ReadonlyArray<RootMetadata> | undefined
  readonly targets: TargetsMetadata | undefined
}

const trustedTargets = (
  published: PublishedAuthors | undefined,
): Effect.Effect<TargetsMetadata, TaskRefused> =>
  Effect.gen(function* () {
    if (published?.roots === undefined)
      return yield* refused(
        "Re-signing needs your company's domain to be live: this browser could not load root.json from its /.well-known/keryx/. Nothing was signed.",
      )
    if (published.targets === undefined)
      return yield* refused('Cannot load the published targets.json. Nothing was signed.')
    const [issue] = validateTargets({ roots: published.roots, targets: published.targets })
    if (issue)
      return yield* refused(
        `The published targets.json does not verify against your company's root.json (${issue.message}). Nothing was signed.`,
      )
    return published.targets
  })

/**
 * Each item must already carry a valid signature by an author the verified
 * `targets.json` lists, which keeps the console from signing content nobody on the team
 * wrote.
 */
const resignItems = (
  task: Extract<AuthorTask, { _tag: 'ResignItems' }>,
  signer: Signer,
  published: PublishedAuthors | undefined,
): Effect.Effect<Completion, TaskRefused> =>
  Effect.gen(function* () {
    const [first, ...rest] = task.items
    if (first === undefined) return yield* refused('The task has no posts.')
    const { delegations } = (yield* trustedTargets(published)).signed
    const role = delegations.roles.find((r) => r.name === authorsRoleName(task.channel))
    if (role === undefined)
      return yield* refused(`The published targets.json has no author list for ${task.channel}.`)
    if (!role.keyids.includes(signer.keyid))
      return yield* refused(`You are not an author of ${task.channel}.`)
    const authors: Authority = { keys: delegations.keys, keyids: role.keyids, threshold: 1 }
    const sign = (item: Item) =>
      verifyItemSignatures(item, authors).pipe(
        Effect.mapError(() =>
          refused(`“${item.title}” is not signed by an author of the channel.`),
        ),
        Effect.flatMap(() => itemSignatureFor(item, signer)),
        Effect.mapError((e) => (e._tag === 'TaskRefused' ? e : refused('Signing failed.'))),
        Effect.map((signature) => ({ itemId: item.id, signature })),
      )
    const head = yield* sign(first)
    const tail = yield* Effect.forEach(rest, sign)
    return { _tag: 'ItemSignatures', signatures: [head, ...tail] } as const
  })

export const completeTask = (
  task: AuthorTask,
  signer: Signer,
  published?: PublishedAuthors,
): Effect.Effect<Completion, TaskRefused> =>
  task._tag === 'SignAuthorsMetadata'
    ? signAuthorsMetadata(task, signer)
    : resignItems(task, signer, published)
