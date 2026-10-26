import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { rebuild, repoFilesToText } from '@keryx-kit/api'
import {
  currentRoot,
  fromUtf8,
  initRepo,
  publicKeyFromSeed,
  repoFiles,
  seedSigner,
  signatureFor,
  toBase64url,
} from '@keryx-kit/domain'
import { joinPageHtml } from '@keryx-kit/join-kit'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'
import { unzipSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { refreshTimestampFor, refreshTimestamps, renewServerMetadata } from '../src/jobs.ts'
import { Repos } from '../src/repos.ts'
import {
  type Author,
  ceremony,
  doTasks,
  draftItem,
  memberLogin,
  operatorBrowser,
  ownerLogin,
  registerAuthor,
  signAsOwner,
  signedItem,
  signUp,
  trezor,
} from './support/actors.ts'
import { advance, call, DAY, failure, startServer, type TestServer } from './support/harness.ts'

const SLUG = 'acme'
const ORIGIN = 'https://acme.example'

let server: TestServer
beforeEach(async () => {
  server = await startServer()
})
afterEach(async () => {
  await server.stop()
})

const device = trezor('owner')

const company = () =>
  signUp(server, { slug: SLUG, companyName: 'ACME', joinOrigin: ORIGIN, device })

/** A company with channel `news` authored by Jana. */
const liveChannel = async () => {
  const { owner, operator } = await company()
  const jana = await registerAuthor(server, owner, 'Jana')
  await ceremony(owner, device, SLUG, {
    _tag: 'CreateChannel',
    channel: 'news',
    displayName: 'News',
    description: '',
    authors: [jana.memberId],
  })
  await doTasks(jana)
  return { owner, operator, jana }
}

const publish = async (author: Author, id: string, channel = 'news') => {
  const item = await signedItem(author, draftItem(id, `Post ${id}`, server.clock.current))
  return call(author.browser.client.items.publish({ params: { channel }, payload: { item } }))
}

const publishedRepo = () =>
  server.runWithServices(Effect.flatMap(Repos, (repos) => repos.published(SLUG)))

const get = (url: string) => server.handler(new Request(url), undefined as never)

describe('A1, A2: sign-up', () => {
  it('writes root v1 and targets v1 signed by the master key, ops key from the server', async () => {
    const { owner } = await company()
    const repo = await server.runWithServices(
      Effect.flatMap(Repos, (repos) => repos.published(SLUG)),
    )
    const root = currentRoot(repo).signed
    expect(root.version).toBe(1)
    expect(root.custom.repo_base).toBe('https://repo.keryx.test/acme/')
    expect(root.roles.root.keyids).toEqual(root.roles.targets.keyids)
    expect(root.roles.snapshot.keyids).not.toEqual(root.roles.root.keyids)
    expect(repo.targets.signed.custom.company_name).toBe('ACME')
    const session = await call(owner.client.authOwner.session())
    expect(session.company).toEqual({ slug: SLUG, name: 'ACME' })
  })

  it('refuses a bad invite code, a taken slug and a wrong Trezor login', async () => {
    const browser = await server.browser()
    const badCode = await failure(
      browser.client.authOwner.signup({
        payload: {
          inviteCode: 'nope',
          slug: 'x',
          companyName: 'X',
          joinOrigin: ORIGIN,
          contactEmail: 'a@b.co',
        },
      }),
    )
    expect(badCode._tag).toBe('LoginFailed')
    await company()
    const operator = await operatorBrowser(server)
    const { code } = await call(
      operator.client.operator.createInviteCode({ payload: { note: '' } }),
    )
    const taken = await failure(
      browser.client.authOwner.signup({
        payload: {
          inviteCode: code,
          slug: SLUG,
          companyName: 'X',
          joinOrigin: ORIGIN,
          contactEmail: 'a@b.co',
        },
      }),
    )
    expect(taken._tag).toBe('Conflict')

    const started = await call(
      browser.client.authOwner.signup({
        payload: {
          inviteCode: code,
          slug: 'other',
          companyName: 'O',
          joinOrigin: ORIGIN,
          contactEmail: 'a@b.co',
        },
      }),
    )
    const other = trezor('someone-else')
    const built = await call(
      initRepo(
        { ...started.init.params, masterKey: device.masterPublicKey('other') },
        { now: new Date(started.init.now) },
      ),
    )
    const root = await call(signatureFor(built.roots[0] ?? built.targets, device.master('other')))
    const targets = await call(signatureFor(built.targets, device.master('other')))
    const forged = other.requestLogin({ challengeHidden: '0'.repeat(64), challengeVisual: 'x' })
    const wrongLogin = await failure(
      browser.client.authOwner.completeSignup({
        params: { signupId: started.signupId },
        payload: {
          login: forged,
          masterPublicKey: device.masterPublicKey('other'),
          signatures: { root, targets },
        },
      }),
    )
    expect(wrongLogin._tag).toBe('LoginFailed')
    const wrongKey = await failure(
      browser.client.authOwner.completeSignup({
        params: { signupId: started.signupId },
        payload: {
          login: device.requestLogin(started.challenge),
          masterPublicKey: device.masterPublicKey('other'),
          signatures: { root: targets, targets },
        },
      }),
    )
    expect(wrongKey).toMatchObject({ _tag: 'Refused', code: 'bad-signature' })
  })
})

describe('owner login (§5.3)', () => {
  it('logs in with the identity key from sign-up and refuses any other', async () => {
    await company()
    const owner = await server.browser()
    expect((await ownerLogin(owner, device, SLUG)).company.slug).toBe(SLUG)
    const intruder = await server.browser()
    const challenge = await call(
      intruder.client.authOwner.challenge({ payload: { company: SLUG } }),
    )
    const refused = await failure(
      intruder.client.authOwner.login({
        payload: {
          challengeId: challenge.challengeId,
          ...trezor('intruder').requestLogin(challenge),
        },
      }),
    )
    expect(refused._tag).toBe('LoginFailed')
    await call(owner.client.authOwner.logout())
    expect((await failure(owner.client.authOwner.session()))._tag).toBe('Unauthorized')
  })

  it('rate limits login attempts per address', async () => {
    const browser = await server.browser()
    const results = []
    for (let i = 0; i < 11; i++) {
      results.push(
        await Effect.runPromise(
          Effect.result(browser.client.authOwner.challenge({ payload: { company: SLUG } })),
        ),
      )
    }
    expect(results.at(-1)).toMatchObject({ _tag: 'Failure', failure: { _tag: 'TooManyRequests' } })
    advance(server, 61_000)
    await call(browser.client.authOwner.challenge({ payload: { company: SLUG } }))
  })
})

describe('B1, B2: invite and register', () => {
  it('uses an invite once, stores the wrapped key per passkey and finds it by credential id', async () => {
    const { owner } = await company()
    const invite = await call(owner.client.team.invite({ payload: { label: 'Jana' } }))
    const token = invite.url.split('#')[1] ?? ''
    expect(invite.url.startsWith('https://console.keryx.test/invite#')).toBe(true)
    const member = await server.browser()
    expect((await call(member.client.authMember.invite({ params: { token } }))).companyName).toBe(
      'ACME',
    )
    const options = await call(
      member.client.authMember.registrationOptions({
        payload: { inviteToken: token, name: 'Jana' },
      }),
    )
    expect(options.publicKey.authenticatorSelection.residentKey).toBe('required')
    expect(options.publicKey.extensions).toEqual({ prf: {} })
    const credential = member.authenticator.create(options.publicKey)
    const authorPublicKey = publicKeyFromSeed(new Uint8Array(32).fill(7))
    const wrappedKey = {
      iv: toBase64url(new Uint8Array(12).fill(1)),
      ciphertext: toBase64url(new Uint8Array(48).fill(2)),
    }
    const me = await call(
      member.client.authMember.register({
        payload: {
          registrationId: options.registrationId,
          credential,
          authorPublicKey,
          wrappedKey,
        },
      }),
    )
    expect(me.keyLabel).toBe('author-1')
    expect(me.credentialIds).toEqual([credential.id])
    expect(
      await call(member.client.authMember.wrappedKey({ params: { credentialId: credential.id } })),
    ).toEqual({ credentialId: credential.id, authorPublicKey, wrappedKey })
    const other = await failure(
      member.client.authMember.wrappedKey({ params: { credentialId: 'someone-else' } }),
    )
    expect(other._tag).toBe('NotFound')
    const reused = await failure(
      member.client.authMember.registrationOptions({
        payload: { inviteToken: token, name: 'Eve' },
      }),
    )
    expect(reused._tag).toBe('Expired')

    await call(member.client.authMember.logout())
    const options2 = await call(member.client.authMember.loginOptions())
    const login = await call(
      member.client.authMember.login({
        payload: {
          loginId: options2.loginId,
          credential: member.authenticator.get(options2.publicKey),
        },
      }),
    )
    expect(login.id).toBe(me.id)
  })

  it('refuses a passkey without PRF and an invite older than 7 days', async () => {
    const { owner } = await company()
    const member = await server.browser()
    const first = await call(owner.client.team.invite({ payload: { label: 'A' } }))
    const options = await call(
      member.client.authMember.registrationOptions({
        payload: { inviteToken: first.url.split('#')[1] ?? '', name: 'A' },
      }),
    )
    const credential = member.authenticator.create(options.publicKey)
    const noPrf = await failure(
      member.client.authMember.register({
        payload: {
          registrationId: options.registrationId,
          credential: { ...credential, clientExtensionResults: {} },
          authorPublicKey: publicKeyFromSeed(new Uint8Array(32).fill(3)),
          wrappedKey: { iv: 'a'.repeat(16), ciphertext: 'b'.repeat(64) },
        },
      }),
    )
    expect(noPrf._tag).toBe('LoginFailed')
    const late = await call(owner.client.team.invite({ payload: { label: 'B' } }))
    advance(server, 7 * DAY + 1)
    const expired = await failure(
      member.client.authMember.invite({ params: { token: late.url.split('#')[1] ?? '' } }),
    )
    expect(expired._tag).toBe('Expired')
  })
})

describe('B3 to B6: ceremonies', () => {
  it('refuses a signature by a key the role does not list', async () => {
    const { owner } = await company()
    const started = await call(
      owner.client.ceremonies.start({ payload: { intent: { _tag: 'RenewTargets' } } }),
    )
    const rebuilt = await call(rebuild(started.base, started.operation))
    const signature = await call(
      signatureFor(rebuilt.targets, seedSigner(new Uint8Array(32).fill(9))),
    )
    const refused = await failure(
      owner.client.ceremonies.sign({
        params: { ceremonyId: started.id },
        payload: { signatures: [{ role: 'targets', signature }] },
      }),
    )
    expect(refused).toMatchObject({ _tag: 'Refused', code: 'unauthorized-signer' })
    await call(owner.client.ceremonies.discard({ params: { ceremonyId: started.id } }))
    expect(await call(owner.client.ceremonies.list())).toEqual([])
  })

  it('edits a channel and the logo, and refuses to remove the last author', async () => {
    const { owner, jana } = await liveChannel()
    await ceremony(owner, device, SLUG, {
      _tag: 'EditChannel',
      channel: 'news',
      displayName: 'Company news',
      description: 'What we do',
    })
    await ceremony(owner, device, SLUG, {
      _tag: 'ChangeLogo',
      logo: 'data:image/png;base64,iVBORw0KGgo=',
    })
    const [channel] = await call(owner.client.channels.list())
    expect(channel).toMatchObject({ displayName: 'Company news', description: 'What we do' })
    expect((await call(owner.client.company.get())).logo).toBe('data:image/png;base64,iVBORw0KGgo=')
    const last = await failure(
      owner.client.ceremonies.start({
        payload: { intent: { _tag: 'RemoveAuthor', channel: 'news', memberId: jana.memberId } },
      }),
    )
    expect(last).toMatchObject({ _tag: 'Refused', code: 'last-author' })
  })

  it('keeps a ceremony awaiting the owner when the owner signatures leave the repo invalid', async () => {
    const { owner } = await company()
    const started = await call(
      owner.client.ceremonies.start({ payload: { intent: { _tag: 'RenewTargets' } } }),
    )
    const rootOnly = await call(
      signatureFor(currentRoot(await publishedRepo()), device.master(SLUG)),
    )
    const refused = await failure(
      owner.client.ceremonies.sign({
        params: { ceremonyId: started.id },
        payload: { signatures: [{ role: 'root', signature: rootOnly }] },
      }),
    )
    expect(refused._tag).toBe('RepoInvalid')
    const again = await call(owner.client.ceremonies.get({ params: { ceremonyId: started.id } }))
    expect(again.status).toBe('awaiting-owner')
    expect((await signAsOwner(owner, again, device, SLUG)).status).toBe('applied')
  })

  it('labels author keys in targets.json without personal names', async () => {
    await liveChannel()
    const repo = await server.runWithServices(
      Effect.flatMap(Repos, (repos) => repos.published(SLUG)),
    )
    const labels = Object.values(repo.targets.signed.delegations.keys).map((key) => key.name)
    expect(labels).toEqual(expect.arrayContaining(['news', 'author-1']))
    expect(JSON.stringify(repo.targets)).not.toContain('Jana')
  })
})

describe('C1 to C5: publishing', () => {
  it('keeps drafts per author and enforces who may publish what', async () => {
    const { owner, jana } = await liveChannel()
    const petr = await registerAuthor(server, owner, 'Petr')
    const content = { itemId: 'hello', title: 'Hello', markdown: '# Hi', tags: [] }
    const draft = await call(
      jana.browser.client.items.createDraft({ payload: { channel: 'news', content } }),
    )
    await call(
      jana.browser.client.items.saveDraft({
        params: { draftId: draft.id },
        payload: { channel: 'news', content: { ...content, title: 'Hello!' } },
      }),
    )
    expect((await call(jana.browser.client.items.drafts()))[0]?.content.title).toBe('Hello!')
    expect(await call(petr.browser.client.items.drafts())).toEqual([])
    const notAuthor = await failure(
      petr.browser.client.items.createDraft({ payload: { channel: 'news', content } }),
    )
    expect(notAuthor._tag).toBe('Forbidden')

    await publish(jana, 'hello')
    const again = await Effect.runPromise(
      Effect.result(
        jana.browser.client.items.publish({
          params: { channel: 'news' },
          payload: {
            item: await signedItem(jana, draftItem('hello', 'Again', server.clock.current)),
          },
        }),
      ),
    )
    expect(again).toMatchObject({ _tag: 'Failure', failure: { _tag: 'Conflict' } })
    const byPetr = await failure(
      petr.browser.client.items.publish({
        params: { channel: 'news' },
        payload: { item: await signedItem(petr, draftItem('petr', 'Petr', server.clock.current)) },
      }),
    )
    expect(byPetr._tag).toBe('Forbidden')
    const missing = await failure(
      jana.browser.client.items.edit({
        params: { channel: 'news', itemId: 'nope' },
        payload: { item: await signedItem(jana, draftItem('nope', 'Nope', server.clock.current)) },
      }),
    )
    expect(missing._tag).toBe('NotFound')

    const list = await call(owner.client.items.list({ params: { channel: 'news' } }))
    expect(list.map((item) => item.id)).toEqual(['hello'])
    expect(list[0]?.signedBy.map((a) => a.name)).toEqual(['Jana'])
    await call(
      jana.browser.client.items.unpublish({ params: { channel: 'news', itemId: 'hello' } }),
    )
    expect(await call(owner.client.items.list({ params: { channel: 'news' } }))).toEqual([])
  })
})

describe('A3, A4: join kit and domain check', () => {
  it('zips every root, the join page and the README', async () => {
    const { owner } = await company()
    const zip = unzipSync(await call(owner.client.join.kit()))
    expect(Object.keys(zip).sort()).toEqual([
      '.well-known/keryx/1.root.json',
      '.well-known/keryx/root.json',
      'README.md',
      'join/index.html',
    ])
    expect(fromUtf8(zip['join/index.html'] ?? new Uint8Array())).toBe(joinPageHtml)
    expect(fromUtf8(zip['README.md'] ?? new Uint8Array())).toContain('Access-Control-Allow-Origin')
  })

  it('reports not set up, then mismatch, then live', async () => {
    const { owner } = await company()
    expect((await call(owner.client.join.checkDomain())).status).toBe('not-set-up')
    const zip = unzipSync(await call(owner.client.join.kit()))
    for (const name of ['root.json', '1.root.json']) {
      server.web.set(`${ORIGIN}/.well-known/keryx/${name}`, {
        body: zip[`.well-known/keryx/${name}`] ?? new Uint8Array(),
      })
    }
    server.web.set(`${ORIGIN}/join`, { body: joinPageHtml })
    const noCors = await call(owner.client.join.checkDomain())
    expect(noCors).toMatchObject({ status: 'mismatch' })
    expect(noCors.reason).toContain('Access-Control-Allow-Origin')
    server.web.set(`${ORIGIN}/.well-known/keryx/root.json`, {
      headers: { 'access-control-allow-origin': '*' },
      body: zip['.well-known/keryx/root.json'] ?? new Uint8Array(),
    })
    expect((await call(owner.client.join.checkDomain())).status).toBe('live')
    expect((await call(owner.client.company.get())).domain.status).toBe('live')
  })
})

describe('F1, F2, G2: operator and pilot requests', () => {
  it('lists companies with expiries, used invite codes and pilot requests', async () => {
    await company()
    const site = await server.browser()
    await call(
      site.client.public.requestPilot({
        payload: { company: 'Shop', name: 'Ann', email: 'ann@shop.example', message: '' },
      }),
    )
    const bad = await failure(
      site.client.public.requestPilot({
        payload: { company: '', name: 'Ann', email: 'x', message: '' },
      }),
    )
    expect(bad).toMatchObject({ _tag: 'InvalidRequest', error: 'Enter your company name.' })
    const operator = await operatorBrowser(server)
    const dashboard = await call(operator.client.operator.dashboard())
    expect(dashboard.companies[0]).toMatchObject({ slug: SLUG, contactEmail: 'owner@example.com' })
    expect(dashboard.companies[0]?.expires.targets).toMatch(/^2027-/)
    expect((await call(operator.client.operator.inviteCodes()))[0]?.usedBy).toBe(SLUG)
    expect((await call(operator.client.operator.pilotRequests()))[0]?.company).toBe('Shop')
    const wrong = await server.browser()
    expect((await failure(wrong.client.operator.login({ payload: { token: 'guess' } })))._tag).toBe(
      'LoginFailed',
    )
    expect((await failure(wrong.client.operator.dashboard()))._tag).toBe('Unauthorized')
  })
})

describe('hosting (§5.2, §5.9)', () => {
  it('routes by host and sets the console and repo headers', async () => {
    await company()
    const landing = await get('https://keryx.test/')
    expect(await landing.text()).toBe('<h1>landing</h1>')
    expect(await (await get('https://keryx.test/subscribers')).text()).toBe('<h1>subscribers</h1>')
    expect((await get('https://keryx.test/api/company')).status).toBe(404)

    const spa = await get('https://console.keryx.test/invite')
    expect(await spa.text()).toBe('<h1>console</h1>')
    expect(spa.headers.get('content-security-policy')).toContain("script-src 'self'")
    expect(spa.headers.get('content-security-policy')).toContain(
      'frame-src https://suite.trezor.io',
    )
    expect(spa.headers.get('cross-origin-opener-policy')).toBe('same-origin-allow-popups')
    expect((await get('https://console.keryx.test/assets/missing.js')).status).toBe(404)
    const release = await (await get('https://console.keryx.test/api/release')).json()
    expect(release).toEqual({ gitSha: 'abc123', consoleBundleSha256: 'f'.repeat(64) })

    const timestamp = await get('https://repo.keryx.test/acme/timestamp.json')
    expect(timestamp.status).toBe(200)
    expect(timestamp.headers.get('access-control-allow-origin')).toBe('*')
    expect(timestamp.headers.get('cache-control')).toBe('no-cache')
    expect(timestamp.headers.get('content-type')).toBe('application/json')
    expect((await get('https://repo.keryx.test/acme/1.root.json')).status).toBe(404)
    expect((await get('https://repo.keryx.test/acme/../../kek')).status).toBe(404)
    expect((await get('https://unknown.test/')).status).toBe(404)
    expect((await get('http://127.0.0.1:3000/healthz')).status).toBe(200)
    const counts = await server.runWithServices(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        return yield* sql<{
          count: number
        }>`SELECT count FROM fetch_counts WHERE company_slug = 'acme'`
      }),
    )
    expect(counts[0]?.count).toBe(1)
  })
})

describe('E1: scheduled timestamp', () => {
  it('re-signs timestamp.json with a higher version', async () => {
    await company()
    const version = async () =>
      (await server.runWithServices(Effect.flatMap(Repos, (repos) => repos.published(SLUG))))
        .timestamp.signed.version
    const before = await version()
    advance(server, 12 * 60 * 60 * 1000)
    await server.runWithServices(refreshTimestamps)
    expect(await version()).toBe(before + 1)
  })
})

describe('expired authors metadata', () => {
  it('does not block writes that leave the expired file untouched', async () => {
    const { owner } = await liveChannel()
    const petr = await registerAuthor(server, owner, 'Petr')
    await ceremony(owner, device, SLUG, {
      _tag: 'CreateChannel',
      channel: 'offers',
      displayName: 'Offers',
      description: '',
      authors: [petr.memberId],
    })
    await doTasks(petr)
    advance(server, 150 * DAY)
    await memberLogin(petr)
    expect((await doTasks(petr)).map((task) => task._tag)).toEqual(['SignAuthorsMetadata'])
    advance(server, 25 * DAY)
    await server.runWithServices(renewServerMetadata)
    advance(server, 6 * DAY)
    const expired = (await publishedRepo()).authors.news?.signed.expires ?? ''
    expect(Date.parse(expired)).toBeLessThan(server.clock.current.getTime())

    await server.runWithServices(refreshTimestampFor(SLUG))
    await memberLogin(petr)
    await publish(petr, 'still-live', 'offers')
    await ownerLogin(owner, device, SLUG)
    const assigned = await ceremony(owner, device, SLUG, {
      _tag: 'AssignAuthor',
      channel: 'news',
      memberId: petr.memberId,
    })
    expect(assigned.status).toBe('applied')
    const removed = await ceremony(owner, device, SLUG, {
      _tag: 'RemoveAuthor',
      channel: 'news',
      memberId: petr.memberId,
    })
    expect(removed.status).toBe('applied')
    expect((await publishedRepo()).authors.news?.signed.expires).toBe(expired)
  })
})

/** Every file under a repo directory, as `repoFiles` names them. */
const filesOn = async (root: string) => {
  const files: Record<string, Uint8Array> = {}
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue
    const path = join(entry.parentPath, entry.name)
    files[path.slice(root.length + 1)] = new Uint8Array(await readFile(path))
  }
  return files
}

describe('repo writes', () => {
  it('finishes a publish the client aborted mid-write, so cache, disk and database agree', async () => {
    const { jana } = await liveChannel()
    const item = await signedItem(jana, draftItem('aborted', 'Aborted', server.clock.current))
    const source = { itemId: 'aborted', title: 'Aborted', markdown: 'Hi', tags: [] }
    server.delays.unsealMs = 20
    const abort = new AbortController()
    const response = jana.browser.fetch(
      new Request(`${server.config.consoleOrigin}/api/channels/news/items`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ item, source }),
        signal: abort.signal,
      }),
    )
    await new Promise((resolve) => setTimeout(resolve, 30))
    abort.abort()
    await response.catch(() => undefined)
    server.delays.unsealMs = 0

    const cached = await publishedRepo()
    expect(cached.items['channels/news/aborted.json']).toBeDefined()
    const dirs = await server.runWithServices(Effect.map(Repos, (repos) => repos.directory(SLUG)))
    const disk = { anchor: await filesOn(dirs.anchor), base: await filesOn(dirs.base) }
    expect(repoFilesToText(disk)).toEqual(repoFilesToText(repoFiles(cached)))
    const audited = await server.runWithServices(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        return yield* sql<{ action: string }>`SELECT action FROM audit_log
          WHERE company_slug = ${SLUG} ORDER BY id DESC LIMIT 1`
      }),
    )
    expect(audited[0]?.action).toBe('item-published')
    const stored = await call(
      jana.browser.client.items.get({ params: { channel: 'news', itemId: 'aborted' } }),
    )
    expect(stored.source).toEqual(source)

    const version = cached.channels.news?.signed.version ?? 0
    await publish(jana, 'after')
    expect((await publishedRepo()).channels.news?.signed.version).toBe(version + 1)
  })
})
