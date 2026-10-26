import { KeryxKitApi } from '@keryx-kit/api'
import { Cause, Effect } from 'effect'
import { FetchHttpClient } from 'effect/http'
import { HttpApiClient } from 'effect/http-api'

const makeClient = HttpApiClient.make(KeryxKitApi, { baseUrl: globalThis.location?.origin }).pipe(
  Effect.provide(FetchHttpClient.layer),
)

export type ApiClient = Effect.Success<typeof makeClient>

let client: Promise<ApiClient> | undefined

/** A failed call: `tag` is the error's `_tag` (e.g. `Unauthorized`), `message` is for people. */
export class ApiError extends Error {
  constructor(
    readonly tag: string,
    message: string,
    readonly detail: Readonly<Record<string, unknown>> = {},
  ) {
    super(message)
  }
}

const fallbackMessages: Readonly<Record<string, string>> = {
  Unauthorized: 'Your session has ended. Sign in again.',
  HttpClientError: 'The console cannot reach the server. Check your connection and try again.',
}

const field = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined

/** A 401 is a missing session whether its body is `{"_tag":"Unauthorized"}` or empty. */
const tagOf = (error: unknown): string => {
  if (field(field(error, 'response'), 'status') === 401) return 'Unauthorized'
  const tag = field(error, '_tag')
  return typeof tag === 'string' ? tag : 'Unknown'
}

const toApiError = (error: unknown): ApiError => {
  if (error instanceof ApiError) return error
  const record =
    typeof error === 'object' && error !== null ? (error as Record<string, unknown>) : {}
  const tag = tagOf(error)
  const message =
    typeof record.error === 'string'
      ? record.error
      : (fallbackMessages[tag] ?? 'Something went wrong. Try again.')
  return new ApiError(tag, message, record)
}

/** Runs one API call and turns every failure into an `ApiError`. */
export const call = async <A, E>(request: (api: ApiClient) => Effect.Effect<A, E>): Promise<A> => {
  client ??= Effect.runPromise(makeClient)
  const api = await client
  const exit = await Effect.runPromiseExit(request(api))
  if (exit._tag === 'Success') return exit.value
  const failure = exit.cause.reasons.find(Cause.isFailReason)
  if (failure === undefined) console.error(exit.cause)
  throw toApiError(failure?.error)
}

export const isUnauthorized = (error: unknown): boolean =>
  error instanceof ApiError && error.tag === 'Unauthorized'
