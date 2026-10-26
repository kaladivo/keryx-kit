/** The browser side of every flow, signing with `@keryx-kit/domain` as the console will. */

import type { Ceremony } from '@keryx-kit/api'
import { rebuild } from '@keryx-kit/api'
import {
  bytesEqual,
  fromBase64url,
  type ItemDraft,
  initRepo,
  itemSignatureFor,
  publicKeyFromSeed,
  seedSigner,
  signatureFor,
  signItem,
  signingBytes,
  toBase64url,
  toHex,
  utf8,
} from '@keryx-kit/domain'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { Effect } from 'effect'
import { loginDigest } from '../../src/crypto.ts'
import { type Browser, call, OPERATOR_TOKEN, type TestServer } from './harness.ts'

const seed = (label: string) => sha256(utf8(`keryx-kit-server-test/${label}`))

/** Stands in for Trezor `requestLogin` and `cipherKeyValue`. */
export const trezor = (name: string) => {
  const identity = seed(`identity/${name}`)
  return {
    requestLogin: (challenge: { challengeHidden: string; challengeVisual: string }) => {
      const digest = loginDigest(challenge.challengeHidden, challenge.challengeVisual)
      const recovered = secp256k1.sign(digest, identity, { prehash: false, format: 'recovered' })
      const header = 31 + (recovered[0] ?? 0)
      return {
        publicKey: toHex(secp256k1.getPublicKey(identity, true)),
        signature: toHex(Uint8Array.of(header, ...recovered.subarray(1))),
      }
    },
    master: (slug: string) => seedSigner(seed(`master/${name}/${slug}`)),
    masterPublicKey: (slug: string) => publicKeyFromSeed(seed(`master/${name}/${slug}`)),
  }
}

export type Trezor = ReturnType<typeof trezor>

export const operatorBrowser = async (server: TestServer) => {
  const browser = await server.browser()
  await call(browser.client.operator.login({ payload: { token: OPERATOR_TOKEN } }))
  return browser
}

export const signUp = async (
  server: TestServer,
  options: { slug: string; companyName: string; joinOrigin: string; device: Trezor },
) => {
  const operator = await operatorBrowser(server)
  const { code } = await call(
    operator.client.operator.createInviteCode({ payload: { note: options.companyName } }),
  )
  const owner = await server.browser()
  const started = await call(
    owner.client.authOwner.signup({
      payload: {
        inviteCode: code,
        slug: options.slug,
        companyName: options.companyName,
        joinOrigin: options.joinOrigin,
        contactEmail: 'owner@example.com',
      },
    }),
  )
  const login = options.device.requestLogin(started.challenge)
  const master = options.device.master(options.slug)
  const built = await call(
    initRepo(
      { ...started.init.params, masterKey: options.device.masterPublicKey(options.slug) },
      { now: new Date(started.init.now) },
    ),
  )
  const root = await call(signatureFor(built.roots[0] ?? built.targets, master))
  const targets = await call(signatureFor(built.targets, master))
  await call(
    owner.client.authOwner.completeSignup({
      params: { signupId: started.signupId },
      payload: {
        login,
        masterPublicKey: options.device.masterPublicKey(options.slug),
        signatures: { root, targets },
      },
    }),
  )
  return { owner, operator }
}

/** Step 3 of mvp-spec §5.5: rebuild, compare byte for byte, then sign the own copy. */
export const signAsOwner = async (
  owner: Browser,
  ceremony: typeof Ceremony.Type,
  device: Trezor,
  slug: string,
) => {
  const rebuilt = await call(rebuild(ceremony.base, ceremony.operation))
  const request = ceremony.toSign[0]
  if (!request || !bytesEqual(signingBytes(rebuilt.targets), fromBase64url(request.signingBytes))) {
    throw new Error('the server asked to sign bytes the browser did not rebuild')
  }
  const signature = await call(signatureFor(rebuilt.targets, device.master(slug)))
  return call(
    owner.client.ceremonies.sign({
      params: { ceremonyId: ceremony.id },
      payload: { signatures: [{ role: 'targets', signature }] },
    }),
  )
}

export const ceremony = async (
  owner: Browser,
  device: Trezor,
  slug: string,
  intent: Parameters<Browser['client']['ceremonies']['start']>[0]['payload']['intent'],
) => {
  const started = await call(owner.client.ceremonies.start({ payload: { intent } }))
  return signAsOwner(owner, started, device, slug)
}

export interface Author {
  readonly browser: Browser
  readonly seed: Uint8Array
  readonly memberId: string
  readonly keyid: string
}

export const registerAuthor = async (server: TestServer, owner: Browser, name: string) => {
  const invite = await call(owner.client.team.invite({ payload: { label: name } }))
  const token = invite.url.split('#')[1] ?? ''
  const browser = await server.browser()
  const options = await call(
    browser.client.authMember.registrationOptions({ payload: { inviteToken: token, name } }),
  )
  const authorSeed = seed(`author/${name}`)
  const credential = browser.authenticator.create(options.publicKey)
  const me = await call(
    browser.client.authMember.register({
      payload: {
        registrationId: options.registrationId,
        credential,
        authorPublicKey: publicKeyFromSeed(authorSeed),
        wrappedKey: {
          iv: toBase64url(crypto.getRandomValues(new Uint8Array(12))),
          ciphertext: toBase64url(crypto.getRandomValues(new Uint8Array(48))),
        },
      },
    }),
  )
  return { browser, seed: authorSeed, memberId: me.id, keyid: me.keyid } satisfies Author
}

/** What an author's console does on every visit: sign every pending task. */
export const doTasks = async (author: Author) => {
  const signer = seedSigner(author.seed)
  const tasks = await call(author.browser.client.ceremonies.tasks())
  for (const task of tasks) {
    if (task._tag === 'SignAuthorsMetadata') {
      const rebuilt = await call(rebuild(task.base, task.operation))
      const doc = rebuilt.authors[task.channel]
      if (!doc || !bytesEqual(signingBytes(doc), fromBase64url(task.toSign.signingBytes))) {
        throw new Error('authors metadata bytes differ from the rebuild')
      }
      const signature = await call(signatureFor(doc, signer))
      await call(
        author.browser.client.ceremonies.completeTask({
          params: { taskId: task.id },
          payload: { _tag: 'AuthorsSignature', signature },
        }),
      )
    } else {
      const signatures = []
      for (const item of task.items) {
        signatures.push({ itemId: item.id, signature: await call(itemSignatureFor(item, signer)) })
      }
      const [first, ...rest] = signatures
      if (!first) continue
      await call(
        author.browser.client.ceremonies.completeTask({
          params: { taskId: task.id },
          payload: { _tag: 'ItemSignatures', signatures: [first, ...rest] },
        }),
      )
    }
  }
  return tasks
}

export const draftItem = (id: string, title: string, at: Date, extra: Partial<ItemDraft> = {}) =>
  ({
    id,
    title,
    content_html: `<p>${title}</p>`,
    date_published: at.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    ...extra,
  }) satisfies ItemDraft

export const signedItem = (author: Author, draft: ItemDraft) =>
  Effect.runPromise(signItem(draft, seedSigner(author.seed)))

export const ownerLogin = async (owner: Browser, device: Trezor, slug: string) => {
  const challenge = await call(owner.client.authOwner.challenge({ payload: { company: slug } }))
  const proof = device.requestLogin(challenge)
  return call(
    owner.client.authOwner.login({ payload: { challengeId: challenge.challengeId, ...proof } }),
  )
}

export const memberLogin = async (author: Author) => {
  const options = await call(author.browser.client.authMember.loginOptions())
  const credential = author.browser.authenticator.get(options.publicKey)
  return call(
    author.browser.client.authMember.login({ payload: { loginId: options.loginId, credential } }),
  )
}
