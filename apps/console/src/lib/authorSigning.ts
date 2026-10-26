/**
 * One passkey prompt unlocks the author key for exactly one batch of signatures
 * (mvp-spec C2): assertion with PRF, wrapped key by the returned credential id, unwrap,
 * check the public key, sign, wipe. Network calls happen before or after, never while
 * the key is open.
 */
import type { AuthorTask, Company, Me, TaskCompletion } from '@keryx-kit/api'
import { RootMetadata, type Signer, seedSigner, TargetsMetadata } from '@keryx-kit/domain'
import { Effect, Schema } from 'effect'
import { ApiError, call } from './api.ts'
import { AuthorKeyError, unwrapAuthorKey, wrappedFromWire } from './authorKey.ts'
import { wipe } from './bytes.ts'
import { companyPin } from './companyPin.ts'
import { runEffect } from './effect.ts'
import { type PrfAssertion, PrfUnsupported, prfAssertion } from './passkey.ts'
import { seenTargetsVersion } from './seenVersions.ts'
import { completeTask, describeTask, type PublishedAuthors } from './tasks.ts'

type MeData = typeof Me.Type

/** Unlocks the key from an assertion that already happened (login, or a signing prompt). */
export const unlockFromAssertion = async <A>(
  me: MeData,
  assertion: PrfAssertion,
  use: (signer: Signer) => Promise<A>,
): Promise<A> => {
  let seed: Uint8Array | undefined
  try {
    if (assertion.prf === undefined) throw new PrfUnsupported()
    const wrapped = await call((api) =>
      api.authMember.wrappedKey({ params: { credentialId: assertion.credentialId } }),
    ).catch((error: unknown) => {
      if (error instanceof ApiError && error.tag === 'NotFound')
        throw new AuthorKeyError(
          'That passkey does not belong to your author account. Try again and pick the passkey you registered for this company.',
        )
      throw error
    })
    if (wrapped.authorPublicKey !== me.authorPublicKey)
      throw new AuthorKeyError('The server returned a key for a different author.')
    seed = await unwrapAuthorKey(
      assertion.prf,
      wrappedFromWire(wrapped.wrappedKey),
      me.authorPublicKey,
    )
    return await use(seedSigner(seed))
  } finally {
    wipe(seed, assertion.prf)
  }
}

/** Prompts for the passkey, then signs with the author key. */
export const withAuthorKey = async <A>(
  me: MeData,
  use: (signer: Signer) => Promise<A>,
): Promise<A> =>
  unlockFromAssertion(me, await prfAssertion({ allowCredentials: me.credentialIds }), use)

const fetchJson = async (url: URL): Promise<unknown> => {
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) throw new Error(`${url} answered ${response.status}`)
  return response.json()
}

const decodeRoot = Schema.decodeUnknownSync(RootMetadata)

/** `targets.json` as the repo origin publishes it. */
const publishedTargets = (repoBase: string): Promise<TargetsMetadata | undefined> =>
  fetchJson(new URL('targets.json', repoBase))
    .then(Schema.decodeUnknownSync(TargetsMetadata))
    .catch(() => undefined)

/** Root versions a company plausibly reaches; more is refused rather than fetched. */
const MAX_ROOT_VERSION = 32

/** Every root the company's domain serves, `1.root.json` up to the current `root.json`. */
export const anchorRoots = async (
  joinOrigin: string,
): Promise<ReadonlyArray<RootMetadata> | undefined> => {
  const file = (name: string) => fetchJson(new URL(`/.well-known/keryx/${name}`, joinOrigin))
  try {
    const current = decodeRoot(await file('root.json'))
    if (current.signed.version > MAX_ROOT_VERSION) return undefined
    const versions = Array.from({ length: current.signed.version - 1 }, (_, i) => i + 1)
    const older = await Promise.all(
      versions.map(async (v) => decodeRoot(await file(`${v}.root.json`))),
    )
    return [...older, current]
  } catch {
    return undefined
  }
}

export interface TaskOutcome {
  readonly task: AuthorTask
  readonly description: string
  readonly completion?: typeof TaskCompletion.Type
  readonly error?: string
}

/** What signing pending tasks needs from the network, fetched before the key is opened. */
export const prepareTasks = async (
  tasks: ReadonlyArray<AuthorTask>,
  company: Pick<typeof Company.Type, 'slug' | 'joinOrigin' | 'repoBase'>,
): Promise<PublishedAuthors | undefined> => {
  if (!tasks.some((task) => task._tag === 'ResignItems')) return undefined
  const pin = companyPin(company.slug)
  const [roots, targets] = await Promise.all([
    pin ? anchorRoots(pin.joinOrigin) : undefined,
    publishedTargets(company.repoBase),
  ])
  return {
    joinOrigin: company.joinOrigin,
    pin,
    roots,
    targets,
    targetsFloor: seenTargetsVersion(company.slug),
    now: new Date(),
  }
}

/**
 * The author list a removal needs re-signed applies the removal, which unpublishes every
 * post nobody re-signed. So it waits while the same removal's `ResignItems` is not done.
 */
const removalBlocked = (task: AuthorTask, unfinished: ReadonlySet<string>) =>
  task._tag === 'SignAuthorsMetadata' &&
  task.ceremonyId !== undefined &&
  unfinished.has(task.ceremonyId)

const BLOCKED =
  'Not signed because the posts of this removal were not re-signed: signing the author list now would unpublish them.'

const sign = async (
  task: AuthorTask,
  signer: Signer,
  published: PublishedAuthors | undefined,
): Promise<Pick<TaskOutcome, 'completion' | 'error'>> => {
  try {
    const completion = await runEffect(
      Effect.mapError(completeTask(task, signer, published), (e) => new Error(e.reason)),
    )
    return { completion }
  } catch (error) {
    return { error: (error as Error).message }
  }
}

/** Signs every task it can; one refusal does not stop the rest. No network. */
export const signTasks = async (
  tasks: ReadonlyArray<AuthorTask>,
  signer: Signer,
  published: PublishedAuthors | undefined,
): Promise<ReadonlyArray<TaskOutcome>> => {
  const outcomes: Array<TaskOutcome> = []
  const unfinished = new Set<string>()
  for (const task of tasks) {
    const description = describeTask(task)
    const result = removalBlocked(task, unfinished)
      ? { error: BLOCKED }
      : await sign(task, signer, published)
    if (result.error !== undefined && task._tag === 'ResignItems') unfinished.add(task.ceremonyId)
    outcomes.push({ task, description, ...result })
  }
  return outcomes
}

const send = async (
  task: AuthorTask,
  completion: typeof TaskCompletion.Type,
): Promise<string | undefined> => {
  try {
    await call((api) =>
      api.ceremonies.completeTask({ params: { taskId: task.id }, payload: completion }),
    )
    return undefined
  } catch (error) {
    return (error as Error).message
  }
}

/**
 * Completes tasks one by one in the server's order: `ResignItems` must land before the
 * `SignAuthorsMetadata` that applies an author removal, or the removal unpublishes the
 * posts being re-signed.
 */
export const submitTasks = async (
  signed: ReadonlyArray<TaskOutcome>,
): Promise<ReadonlyArray<TaskOutcome>> => {
  const outcomes: Array<TaskOutcome> = []
  const unfinished = new Set<string>()
  for (const outcome of signed) {
    const { task, completion } = outcome
    const failure = removalBlocked(task, unfinished)
      ? BLOCKED
      : completion
        ? await send(task, completion)
        : outcome.error
    if (failure !== undefined && task._tag === 'ResignItems') unfinished.add(task.ceremonyId)
    outcomes.push(
      failure === undefined ? outcome : { task, description: outcome.description, error: failure },
    )
  }
  return outcomes
}
