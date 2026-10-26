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
  fromBase64url,
  type Item,
  itemSignatureFor,
  type Signer,
  signatureFor,
  signingBytes,
  type TargetsMetadata,
  verifyItemSignatures,
} from '@keryx-kit/domain'
import { Data, Effect } from 'effect'

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
    const state = yield* rebuild(task.base, task.operation).pipe(
      Effect.mapError((e) => refused(`The change cannot be built: ${e.message}`)),
    )
    const doc = state.authors[task.channel]
    const authority = authorityOf(state, role)
    if (doc === undefined || authority === undefined)
      return yield* refused(`The rebuilt repo has no ${role}.`)
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
 * `ResignItems` carries no repo, so the items are checked against the published
 * `targets.json`: each must already carry a valid signature by a listed author, which
 * keeps the console from signing content nobody on the team wrote.
 */
const resignItems = (
  task: Extract<AuthorTask, { _tag: 'ResignItems' }>,
  signer: Signer,
  published: TargetsMetadata | undefined,
): Effect.Effect<Completion, TaskRefused> =>
  Effect.gen(function* () {
    const [first, ...rest] = task.items
    if (first === undefined) return yield* refused('The task has no posts.')
    const delegations = published?.signed.delegations
    const role = delegations?.roles.find((r) => r.name === authorsRoleName(task.channel))
    if (delegations === undefined || role === undefined)
      return yield* refused(`Cannot load the published author list of ${task.channel}.`)
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
  published?: TargetsMetadata,
): Effect.Effect<Completion, TaskRefused> =>
  task._tag === 'SignAuthorsMetadata'
    ? signAuthorsMetadata(task, signer)
    : resignItems(task, signer, published)
