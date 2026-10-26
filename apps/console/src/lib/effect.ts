import { Cause, Effect, Exit } from 'effect'

/** Runs an effect and rejects with its error itself (not a wrapper), for UI handlers. */
export const runEffect = async <A, E>(effect: Effect.Effect<A, E>): Promise<A> => {
  const exit = await Effect.runPromiseExit(effect)
  if (Exit.isSuccess(exit)) return exit.value
  throw Cause.squash(exit.cause)
}
