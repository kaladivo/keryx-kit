import { ChannelName } from '@keryx-kit/domain'
import { Schema } from 'effect'
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api'
import {
  AuthorTask,
  Ceremony,
  CeremonySummary,
  Intent,
  SignCeremony,
  TaskCompletion,
} from './ceremony.ts'
import {
  CeremonyInProgress,
  Conflict,
  Expired,
  Forbidden,
  LoginFailed,
  NotFound,
  Refused,
  RepoInvalid,
  TooManyRequests,
} from './errors.ts'
import {
  AuditEntry,
  Channel,
  Company,
  CompleteSignup,
  CreateInvite,
  CreateInviteCode,
  Dashboard,
  DomainCheck,
  Draft,
  Invite,
  InviteCode,
  InvitePreview,
  ItemId,
  ItemSummary,
  LoginChallenge,
  Me,
  OperatorLogin,
  OwnerAccount,
  OwnerLogin,
  PilotRequest,
  PilotRequestRecord,
  PublishedItem,
  PublishItem,
  SaveDraft,
  SignupRequest,
  SignupStarted,
  Team,
} from './records.ts'
import {
  MemberSession,
  OperatorSession,
  OwnerSession,
  RequestValidation,
  TeamSession,
} from './security.ts'
import { CompanySlug, Id } from './values.ts'
import {
  AuthenticationCredential,
  CreationOptions,
  RegistrationCredential,
  RequestOptions,
  WrappedKey,
} from './webauthn.ts'

const created = <S extends Schema.Top>(schema: S) => schema.pipe(HttpApiSchema.status(201))
const channelParams = { channel: ChannelName }
const itemParams = { channel: ChannelName, itemId: ItemId }

export const AuthOwner = HttpApiGroup.make('authOwner').add(
  HttpApiEndpoint.post('signup', '/api/signups', {
    payload: SignupRequest,
    success: created(SignupStarted),
    error: [LoginFailed, Conflict, TooManyRequests],
  }),
  HttpApiEndpoint.post('completeSignup', '/api/signups/:signupId', {
    params: { signupId: Id },
    payload: CompleteSignup,
    success: created(OwnerAccount),
    error: [LoginFailed, NotFound, Expired, Refused, RepoInvalid],
  }),
  HttpApiEndpoint.post('challenge', '/api/auth/owner/challenge', {
    payload: Schema.Struct({ company: CompanySlug }),
    success: LoginChallenge,
    error: TooManyRequests,
  }),
  HttpApiEndpoint.post('login', '/api/auth/owner/login', {
    payload: OwnerLogin,
    success: OwnerAccount,
    error: [LoginFailed, TooManyRequests],
  }),
  HttpApiEndpoint.get('session', '/api/auth/owner/session', {
    success: OwnerAccount,
  }).middleware(OwnerSession),
  HttpApiEndpoint.post('logout', '/api/auth/owner/logout'),
)

export const AuthMember = HttpApiGroup.make('authMember').add(
  HttpApiEndpoint.get('invite', '/api/invites/:token', {
    params: { token: Schema.String },
    success: InvitePreview,
    error: [NotFound, Expired],
  }),
  HttpApiEndpoint.post('registrationOptions', '/api/auth/member/registration/options', {
    payload: Schema.Struct({
      inviteToken: Schema.String,
      name: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(200)),
    }),
    success: Schema.Struct({ registrationId: Id, publicKey: CreationOptions }),
    error: [NotFound, Expired, TooManyRequests],
  }),
  HttpApiEndpoint.post('register', '/api/auth/member/registration', {
    payload: Schema.Struct({
      registrationId: Id,
      credential: RegistrationCredential,
      authorPublicKey: Me.fields.authorPublicKey,
      wrappedKey: WrappedKey,
    }),
    success: created(Me),
    error: [LoginFailed, Expired, Conflict],
  }),
  HttpApiEndpoint.post('loginOptions', '/api/auth/member/login/options', {
    success: Schema.Struct({ loginId: Id, publicKey: RequestOptions }),
    error: TooManyRequests,
  }),
  HttpApiEndpoint.post('login', '/api/auth/member/login', {
    payload: Schema.Struct({ loginId: Id, credential: AuthenticationCredential }),
    success: Me,
    error: [LoginFailed, TooManyRequests],
  }),
  HttpApiEndpoint.get('me', '/api/me', { success: Me }).middleware(MemberSession),
  HttpApiEndpoint.post('logout', '/api/auth/member/logout'),
)

export const CompanyGroup = HttpApiGroup.make('company').add(
  HttpApiEndpoint.get('get', '/api/company', { success: Company }).middleware(TeamSession),
  HttpApiEndpoint.get('auditLog', '/api/company/audit-log', {
    success: Schema.Array(AuditEntry),
  }).middleware(OwnerSession),
)

export const TeamGroup = HttpApiGroup.make('team').add(
  HttpApiEndpoint.get('get', '/api/team', { success: Team }).middleware(OwnerSession),
  HttpApiEndpoint.post('invite', '/api/team/invites', {
    payload: CreateInvite,
    success: created(Invite),
  }).middleware(OwnerSession),
)

export const Channels = HttpApiGroup.make('channels').add(
  HttpApiEndpoint.get('list', '/api/channels', {
    success: Schema.Array(Channel),
  }).middleware(TeamSession),
)

export const Ceremonies = HttpApiGroup.make('ceremonies').add(
  HttpApiEndpoint.post('start', '/api/ceremonies', {
    payload: Schema.Struct({ intent: Intent }),
    success: created(Ceremony),
    error: [CeremonyInProgress, NotFound, Refused],
  }).middleware(OwnerSession),
  HttpApiEndpoint.get('list', '/api/ceremonies', {
    success: Schema.Array(CeremonySummary),
  }).middleware(OwnerSession),
  HttpApiEndpoint.get('get', '/api/ceremonies/:ceremonyId', {
    params: { ceremonyId: Id },
    success: Ceremony,
    error: NotFound,
  }).middleware(OwnerSession),
  HttpApiEndpoint.post('sign', '/api/ceremonies/:ceremonyId/signatures', {
    params: { ceremonyId: Id },
    payload: SignCeremony,
    success: CeremonySummary,
    error: [NotFound, Conflict, Refused, RepoInvalid],
  }).middleware(OwnerSession),
  HttpApiEndpoint.delete('discard', '/api/ceremonies/:ceremonyId', {
    params: { ceremonyId: Id },
    error: [NotFound, Conflict],
  }).middleware(OwnerSession),
  HttpApiEndpoint.get('tasks', '/api/me/tasks', {
    success: Schema.Array(AuthorTask),
  }).middleware(MemberSession),
  HttpApiEndpoint.post('completeTask', '/api/me/tasks/:taskId', {
    params: { taskId: Id },
    payload: TaskCompletion,
    error: [NotFound, Refused, RepoInvalid],
  }).middleware(MemberSession),
)

export const Items = HttpApiGroup.make('items').add(
  HttpApiEndpoint.get('list', '/api/channels/:channel/items', {
    params: channelParams,
    success: Schema.Array(ItemSummary),
    error: NotFound,
  }).middleware(TeamSession),
  HttpApiEndpoint.get('get', '/api/channels/:channel/items/:itemId', {
    params: itemParams,
    success: PublishedItem,
    error: NotFound,
  }).middleware(TeamSession),
  HttpApiEndpoint.post('publish', '/api/channels/:channel/items', {
    params: channelParams,
    payload: PublishItem,
    success: created(PublishedItem),
    error: [NotFound, Forbidden, Conflict, Refused],
  }).middleware(MemberSession),
  HttpApiEndpoint.put('edit', '/api/channels/:channel/items/:itemId', {
    params: itemParams,
    payload: PublishItem,
    success: PublishedItem,
    error: [NotFound, Forbidden, Conflict, Refused],
  }).middleware(MemberSession),
  HttpApiEndpoint.delete('unpublish', '/api/channels/:channel/items/:itemId', {
    params: itemParams,
    error: [NotFound, Forbidden],
  }).middleware(TeamSession),
  HttpApiEndpoint.get('drafts', '/api/me/drafts', {
    success: Schema.Array(Draft),
  }).middleware(MemberSession),
  HttpApiEndpoint.post('createDraft', '/api/me/drafts', {
    payload: SaveDraft,
    success: created(Draft),
    error: Forbidden,
  }).middleware(MemberSession),
  HttpApiEndpoint.put('saveDraft', '/api/me/drafts/:draftId', {
    params: { draftId: Id },
    payload: SaveDraft,
    success: Draft,
    error: [NotFound, Forbidden],
  }).middleware(MemberSession),
  HttpApiEndpoint.delete('deleteDraft', '/api/me/drafts/:draftId', {
    params: { draftId: Id },
    error: NotFound,
  }).middleware(MemberSession),
)

export const Join = HttpApiGroup.make('join').add(
  HttpApiEndpoint.get('kit', '/api/join-kit', {
    success: Schema.Uint8Array.pipe(HttpApiSchema.asUint8Array({ contentType: 'application/zip' })),
  }).middleware(OwnerSession),
  HttpApiEndpoint.post('checkDomain', '/api/domain-check', {
    success: DomainCheck,
    error: TooManyRequests,
  }).middleware(OwnerSession),
)

export const Operator = HttpApiGroup.make('operator').add(
  HttpApiEndpoint.post('login', '/api/operator/login', {
    payload: OperatorLogin,
    error: [LoginFailed, TooManyRequests],
  }),
  HttpApiEndpoint.post('logout', '/api/operator/logout'),
  HttpApiEndpoint.get('dashboard', '/api/operator/dashboard', {
    success: Dashboard,
  }).middleware(OperatorSession),
  HttpApiEndpoint.get('inviteCodes', '/api/operator/invite-codes', {
    success: Schema.Array(InviteCode),
  }).middleware(OperatorSession),
  HttpApiEndpoint.post('createInviteCode', '/api/operator/invite-codes', {
    payload: CreateInviteCode,
    success: created(InviteCode),
  }).middleware(OperatorSession),
  HttpApiEndpoint.get('pilotRequests', '/api/operator/pilot-requests', {
    success: Schema.Array(PilotRequestRecord),
  }).middleware(OperatorSession),
)

export const Public = HttpApiGroup.make('public').add(
  HttpApiEndpoint.post('requestPilot', '/api/pilot-requests', {
    payload: PilotRequest,
    success: HttpApiSchema.Created,
    error: TooManyRequests,
  }),
)

export class KeryxKitApi extends HttpApi.make('keryx-kit')
  .add(
    AuthOwner,
    AuthMember,
    CompanyGroup,
    TeamGroup,
    Channels,
    Ceremonies,
    Items,
    Join,
    Operator,
    Public,
  )
  .middleware(RequestValidation) {}
