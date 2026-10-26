/**
 * One passkey prompt unlocks the author key for exactly one batch of signatures
 * (mvp-spec C2): assertion with PRF, wrapped key by the returned credential id, unwrap,
 * check the public key, sign, wipe. Network calls happen before or after, never while
 * the key is open.
 */
import type { AuthorTask, Me, TaskCompletion } from '@keryx-kit/api'
import { type Signer, seedSigner, TargetsMetadata } from '@keryx-kit/domain'
import { Effect, Schema } from 'effect'
import { ApiError, call } from './api.ts'
import { AuthorKeyError, unwrapAuthorKey, wrappedFromWire } from './authorKey.ts'
import { wipe } from './bytes.ts'
import { runEffect } from './effect.ts'
import { type PrfAssertion, PrfUnsupported, prfAssertion } from './passkey.ts'
import { completeTask, describeTask } from './tasks.ts'

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

/** `targets.json` as published, which `ResignItems` tasks are checked against. */
export const publishedTargets = async (repoBase: string): Promise<TargetsMetadata | undefined> => {
  try {
    const response = await fetch(new URL('targets.json', repoBase), { cache: 'no-store' })
    if (!response.ok) return undefined
    return Schema.decodeUnknownSync(TargetsMetadata)(await response.json())
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
export const prepareTasks = async (tasks: ReadonlyArray<AuthorTask>, repoBase: string) =>
  tasks.some((task) => task._tag === 'ResignItems') ? await publishedTargets(repoBase) : undefined

/** Signs every task it can; one refusal does not stop the rest. No network. */
export const signTasks = async (
  tasks: ReadonlyArray<AuthorTask>,
  signer: Signer,
  targets: TargetsMetadata | undefined,
): Promise<ReadonlyArray<TaskOutcome>> => {
  const outcomes: Array<TaskOutcome> = []
  for (const task of tasks) {
    const description = describeTask(task)
    try {
      const completion = await runEffect(
        Effect.mapError(completeTask(task, signer, targets), (e) => new Error(e.reason)),
      )
      outcomes.push({ task, description, completion })
    } catch (error) {
      outcomes.push({ task, description, error: (error as Error).message })
    }
  }
  return outcomes
}

export const submitTasks = async (
  signed: ReadonlyArray<TaskOutcome>,
): Promise<ReadonlyArray<TaskOutcome>> => {
  const outcomes: Array<TaskOutcome> = []
  for (const outcome of signed) {
    const { completion } = outcome
    if (!completion) {
      outcomes.push(outcome)
      continue
    }
    try {
      await call((api) =>
        api.ceremonies.completeTask({ params: { taskId: outcome.task.id }, payload: completion }),
      )
      outcomes.push(outcome)
    } catch (error) {
      outcomes.push({ ...outcome, error: (error as Error).message })
    }
  }
  return outcomes
}
