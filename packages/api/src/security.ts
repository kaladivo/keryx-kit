/**
 * Sessions are opaque tokens in `HttpOnly; Secure; SameSite=Strict` cookies on the
 * console origin (mvp-spec §5.9). The server sets them with
 * `HttpApiBuilder.securitySetCookie(<cookie>, token, { sameSite: 'strict', path: '/api' })`.
 * Browsers send them by themselves, so the client needs no middleware.
 */
import { Context } from 'effect'
import { HttpApiMiddleware, HttpApiSecurity } from 'effect/http-api'
import { InvalidRequest, Unauthorized } from './errors.ts'

export const OwnerCookie = HttpApiSecurity.apiKey({ key: 'keryx_owner', in: 'cookie' })
export const MemberCookie = HttpApiSecurity.apiKey({ key: 'keryx_member', in: 'cookie' })
export const OperatorCookie = HttpApiSecurity.apiKey({ key: 'keryx_operator', in: 'cookie' })

export class CurrentOwner extends Context.Service<CurrentOwner, { readonly companySlug: string }>()(
  '@keryx-kit/api/CurrentOwner',
) {}

export class CurrentMember extends Context.Service<
  CurrentMember,
  { readonly companySlug: string; readonly memberId: string }
>()('@keryx-kit/api/CurrentMember') {}

/** Endpoints both the owner and the company's members use. */
export class CurrentTeamUser extends Context.Service<
  CurrentTeamUser,
  | { readonly _tag: 'Owner'; readonly companySlug: string }
  | { readonly _tag: 'Member'; readonly companySlug: string; readonly memberId: string }
>()('@keryx-kit/api/CurrentTeamUser') {}

export class CurrentOperator extends Context.Service<
  CurrentOperator,
  { readonly sessionId: string }
>()('@keryx-kit/api/CurrentOperator') {}

export class OwnerSession extends HttpApiMiddleware.Service<
  OwnerSession,
  { provides: CurrentOwner }
>()('@keryx-kit/api/OwnerSession', { error: Unauthorized, security: { owner: OwnerCookie } }) {}

export class MemberSession extends HttpApiMiddleware.Service<
  MemberSession,
  { provides: CurrentMember }
>()('@keryx-kit/api/MemberSession', { error: Unauthorized, security: { member: MemberCookie } }) {}

/** Tries the owner cookie first, then the member cookie. */
export class TeamSession extends HttpApiMiddleware.Service<
  TeamSession,
  { provides: CurrentTeamUser }
>()('@keryx-kit/api/TeamSession', {
  error: Unauthorized,
  security: { owner: OwnerCookie, member: MemberCookie },
}) {}

export class OperatorSession extends HttpApiMiddleware.Service<
  OperatorSession,
  { provides: CurrentOperator }
>()('@keryx-kit/api/OperatorSession', {
  error: Unauthorized,
  security: { operator: OperatorCookie },
}) {}

/**
 * On every endpoint: the server provides it with
 * `HttpApiMiddleware.layerSchemaErrorTransform`, so a request that fails to decode
 * answers `400 InvalidRequest` with a readable `error` instead of an empty 400.
 */
export class RequestValidation extends HttpApiMiddleware.Service<RequestValidation>()(
  '@keryx-kit/api/RequestValidation',
  { error: InvalidRequest },
) {}
