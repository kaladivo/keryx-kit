/**
 * Every error body is `{ _tag, error, ... }` where `error` is a sentence the console
 * can show as is. Request bodies that fail to decode come back as `InvalidRequest`.
 */
import { Schema } from 'effect'
import { HttpApiError } from 'effect/http-api'
import { Id, IssueSchema, RefusalCodeSchema } from './values.ts'

const error = Schema.String

export class InvalidRequest extends Schema.TaggedError<InvalidRequest>()(
  'InvalidRequest',
  { error },
  { httpApiStatus: 400 },
) {}

/** No session, or the session does not grant this endpoint. Body `{ "_tag": "Unauthorized" }`. */
export const Unauthorized = HttpApiError.Unauthorized

/** A login, challenge or invite code did not verify. Never says which part was wrong. */
export class LoginFailed extends Schema.TaggedError<LoginFailed>()(
  'LoginFailed',
  { error },
  { httpApiStatus: 401 },
) {}

/** Logged in, but not allowed (e.g. a member who is not an author of the channel). */
export class Forbidden extends Schema.TaggedError<Forbidden>()(
  'Forbidden',
  { error },
  { httpApiStatus: 403 },
) {}

export class NotFound extends Schema.TaggedError<NotFound>()(
  'NotFound',
  { error },
  { httpApiStatus: 404 },
) {}

/** The request contradicts current state (slug taken, item id exists, channel not live, ...). */
export class Conflict extends Schema.TaggedError<Conflict>()(
  'Conflict',
  { error },
  { httpApiStatus: 409 },
) {}

/** Another ceremony is open for the company: finish or discard it first. */
export class CeremonyInProgress extends Schema.TaggedError<CeremonyInProgress>()(
  'CeremonyInProgress',
  { error, ceremonyId: Id },
  { httpApiStatus: 409 },
) {}

/** The invite link or sign-up was used or has expired. */
export class Expired extends Schema.TaggedError<Expired>()(
  'Expired',
  { error },
  { httpApiStatus: 410 },
) {}

/** A domain operation refused (`Refused` in `@keryx-kit/domain`), with its code. */
export class Refused extends Schema.TaggedError<Refused>()(
  'Refused',
  { error, code: RefusalCodeSchema },
  { httpApiStatus: 422 },
) {}

/** The repo with the change applied fails `validateRepo` for a reason other than a missing signature. */
export class RepoInvalid extends Schema.TaggedError<RepoInvalid>()(
  'RepoInvalid',
  { error, issues: Schema.Array(IssueSchema) },
  { httpApiStatus: 422 },
) {}

/** Login endpoints are rate limited (mvp-spec §5.9). */
export class TooManyRequests extends Schema.TaggedError<TooManyRequests>()(
  'TooManyRequests',
  { error },
  { httpApiStatus: 429 },
) {}
