import { Effect } from 'effect'
import { SqlError } from 'effect/sql/SqlError'

/** Database failures are defects: handlers only declare the contract's errors. */
export const orDieSql = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, Exclude<E, SqlError>, R> =>
  Effect.catchIf(
    effect,
    (error): error is Extract<E, SqlError> => error instanceof SqlError,
    (error) => Effect.die(error),
  ) as Effect.Effect<A, Exclude<E, SqlError>, R>
