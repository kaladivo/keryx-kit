import { describe, expect, it } from '@effect/vitest'
import { Effect, FileSystem, Layer, Path, Redacted } from 'effect'
import { Etag, HttpClient, HttpPlatform, HttpRouter } from 'effect/http'
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiClient,
  type HttpApiGroup,
  HttpApiMiddleware,
  HttpApiTest,
} from 'effect/http-api'
import {
  CeremonyInProgress,
  CurrentMember,
  CurrentOperator,
  CurrentOwner,
  CurrentTeamUser,
  InvalidRequest,
  KeryxKitApi,
  MemberSession,
  OperatorSession,
  OwnerSession,
  Public,
  RequestValidation,
  TeamSession,
  Unauthorized,
} from '../src/index.ts'

const endpoints = <Id extends string, Groups extends HttpApiGroup.Constraint>(
  api: HttpApi.HttpApi<Id, Groups>,
) => {
  const listed: Array<string> = []
  HttpApi.reflect(api, {
    onGroup: () => {},
    onEndpoint: ({ group, endpoint }) => {
      listed.push(`${group.identifier}.${endpoint.identifier} ${endpoint.method} ${endpoint.path}`)
    },
  })
  return listed
}

describe('KeryxKitApi', () => {
  it('declares every endpoint under /api with a unique route', () => {
    const listed = endpoints(KeryxKitApi)
    expect(listed).toMatchInlineSnapshot(`
      [
        "authOwner.signup POST /api/signups",
        "authOwner.completeSignup POST /api/signups/:signupId",
        "authOwner.challenge POST /api/auth/owner/challenge",
        "authOwner.login POST /api/auth/owner/login",
        "authOwner.session GET /api/auth/owner/session",
        "authOwner.logout POST /api/auth/owner/logout",
        "authMember.invite GET /api/invites/:token",
        "authMember.registrationOptions POST /api/auth/member/registration/options",
        "authMember.register POST /api/auth/member/registration",
        "authMember.loginOptions POST /api/auth/member/login/options",
        "authMember.login POST /api/auth/member/login",
        "authMember.me GET /api/me",
        "authMember.logout POST /api/auth/member/logout",
        "company.get GET /api/company",
        "company.auditLog GET /api/company/audit-log",
        "team.get GET /api/team",
        "team.invite POST /api/team/invites",
        "channels.list GET /api/channels",
        "ceremonies.start POST /api/ceremonies",
        "ceremonies.list GET /api/ceremonies",
        "ceremonies.get GET /api/ceremonies/:ceremonyId",
        "ceremonies.sign POST /api/ceremonies/:ceremonyId/signatures",
        "ceremonies.discard DELETE /api/ceremonies/:ceremonyId",
        "ceremonies.tasks GET /api/me/tasks",
        "ceremonies.completeTask POST /api/me/tasks/:taskId",
        "items.list GET /api/channels/:channel/items",
        "items.get GET /api/channels/:channel/items/:itemId",
        "items.publish POST /api/channels/:channel/items",
        "items.edit PUT /api/channels/:channel/items/:itemId",
        "items.unpublish DELETE /api/channels/:channel/items/:itemId",
        "items.drafts GET /api/me/drafts",
        "items.createDraft POST /api/me/drafts",
        "items.saveDraft PUT /api/me/drafts/:draftId",
        "items.deleteDraft DELETE /api/me/drafts/:draftId",
        "join.kit GET /api/join-kit",
        "join.checkDomain POST /api/domain-check",
        "operator.login POST /api/operator/login",
        "operator.logout POST /api/operator/logout",
        "operator.dashboard GET /api/operator/dashboard",
        "operator.inviteCodes GET /api/operator/invite-codes",
        "operator.createInviteCode POST /api/operator/invite-codes",
        "operator.pilotRequests GET /api/operator/pilot-requests",
        "public.requestPilot POST /api/pilot-requests",
      ]
    `)
    const routes = listed.map((line) => line.split(' ').slice(1).join(' '))
    expect(new Set(routes).size).toBe(routes.length)
  })

  it.effect('derives a client with one method per endpoint', () =>
    Effect.gen(function* () {
      const client = yield* HttpApiClient.make(KeryxKitApi, { baseUrl: 'https://console.test' })
      const derived = Object.entries(client).flatMap(([group, methods]) =>
        Object.keys(methods).map((method) => `${group}.${method}`),
      )
      expect(derived).toEqual(endpoints(KeryxKitApi).map((line) => line.split(' ')[0]))
    }).pipe(
      Effect.provideService(
        HttpClient.HttpClient,
        HttpClient.make(() => Effect.die('no requests in this test')),
      ),
    ),
  )
})

/** The owner is always logged in; the member never is (no cookie in the in-memory client). */
const requireCookie = <A>(credential: Redacted.Redacted, provide: () => A) =>
  Redacted.value(credential) === 'valid'
    ? Effect.succeed(provide())
    : Effect.fail(new Unauthorized())

const Sessions = Layer.mergeAll(
  Layer.succeed(OwnerSession, {
    owner: (effect) => Effect.provideService(effect, CurrentOwner, { companySlug: 'acme' }),
  }),
  Layer.succeed(MemberSession, {
    member: (effect, { credential }) =>
      Effect.flatMap(
        requireCookie(credential, () => ({ companySlug: 'acme', memberId: 'm1' })),
        (member) => Effect.provideService(effect, CurrentMember, member),
      ),
  }),
  Layer.succeed(TeamSession, {
    owner: (effect) =>
      Effect.provideService(effect, CurrentTeamUser, { _tag: 'Owner', companySlug: 'acme' }),
    member: (effect) =>
      Effect.provideService(effect, CurrentTeamUser, {
        _tag: 'Member',
        companySlug: 'acme',
        memberId: 'm1',
      }),
  }),
  Layer.succeed(OperatorSession, {
    operator: (effect) => Effect.provideService(effect, CurrentOperator, { sessionId: 'o1' }),
  }),
  HttpApiMiddleware.layerSchemaErrorTransform(RequestValidation, () =>
    Effect.fail(new InvalidRequest({ error: 'The request is not in the expected format.' })),
  ),
)

const Platform = Layer.mergeAll(HttpPlatform.layer, Etag.layer, Path.layer).pipe(
  Layer.provideMerge(FileSystem.layerNoop({})),
)

const PublicHandlers = HttpApiBuilder.group(KeryxKitApi, 'public', (handlers) =>
  handlers.handle('requestPilot', ({ payload }) =>
    payload.email.includes('@')
      ? Effect.void
      : Effect.fail(new InvalidRequest({ error: 'Enter an email address like jana@example.com.' })),
  ),
)

const CeremonyHandlers = HttpApiBuilder.group(KeryxKitApi, 'ceremonies', (handlers) =>
  handlers
    .handle('start', () =>
      Effect.fail(
        new CeremonyInProgress({ error: 'Finish the open change first.', ceremonyId: 'c1' }),
      ),
    )
    .handle('list', () => Effect.succeed([]))
    .handle('get', () => Effect.die('unused'))
    .handle('sign', () => Effect.die('unused'))
    .handle('discard', () => Effect.die('unused'))
    .handle('tasks', () => Effect.succeed([]))
    .handle('completeTask', () => Effect.die('unused')),
)

describe('typed errors through a derived client', () => {
  it.effect('decodes InvalidRequest, CeremonyInProgress and a missing session', () =>
    Effect.gen(function* () {
      const client = yield* HttpApiTest.groups(KeryxKitApi, ['public', 'ceremonies'])
      yield* client.public.requestPilot({
        payload: { company: 'ACME', name: 'Jana', email: 'jana@acme.test', message: '' },
      })
      const invalid = yield* Effect.flip(
        client.public.requestPilot({
          payload: { company: 'ACME', name: 'Jana', email: 'jana', message: '' },
        }),
      )
      expect(invalid).toMatchObject({
        _tag: 'InvalidRequest',
        error: 'Enter an email address like jana@example.com.',
      })
      const inProgress = yield* Effect.flip(
        client.ceremonies.start({ payload: { intent: { _tag: 'RenewTargets' } } }),
      )
      expect(inProgress).toMatchObject({ _tag: 'CeremonyInProgress', ceremonyId: 'c1' })
      const noSession = yield* Effect.flip(client.ceremonies.tasks())
      expect(noSession._tag).toBe('Unauthorized')
    }).pipe(
      Effect.provide(
        Layer.mergeAll(PublicHandlers, CeremonyHandlers).pipe(
          Layer.provideMerge(Sessions),
          Layer.provideMerge(Platform),
        ),
      ),
    ),
  )
})

describe('POST /api/pilot-requests as the landing page calls it', () => {
  const PilotApi = HttpApi.make('pilot').add(Public).middleware(RequestValidation)
  const handler = () =>
    HttpRouter.toWebHandler(
      HttpApiBuilder.layer(PilotApi).pipe(
        Layer.provide(
          HttpApiBuilder.group(PilotApi, 'public', (handlers) =>
            handlers.handle('requestPilot', () => Effect.void),
          ).pipe(Layer.provide(Sessions)),
        ),
        Layer.provide(Platform),
      ),
      { disableLogger: true },
    )

  const post = (body: string) =>
    new Request('http://console.test/api/pilot-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })

  it('answers 201 on success and 400 with a readable error on a malformed body', async () => {
    const { handler: handle, dispose } = handler()
    try {
      const ok = await handle(
        post(JSON.stringify({ company: 'ACME', name: 'Jana', email: 'j@a.test', message: '' })),
      )
      expect(ok.status).toBe(201)
      const bad = await handle(post(JSON.stringify({ company: 'ACME' })))
      expect(bad.status).toBe(400)
      expect(await bad.json()).toMatchObject({
        error: 'The request is not in the expected format.',
      })
    } finally {
      await dispose()
    }
  })
})
