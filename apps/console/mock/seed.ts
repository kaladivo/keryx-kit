/**
 * Demo data: "Demo Shop" with two live channels and one author who has no passkey on
 * this machine. The master key is the dev Trezor stub's, so owner ceremonies work.
 * `targets.json` and the offers author list are seeded with short lifetimes so the
 * expiry banner (E3) and an author renewal task show up.
 */
import {
  attachRoleSignature,
  createChannel,
  DefaultExpiries,
  ed25519Key,
  fromHex,
  initRepo,
  keyidOf,
  publicKeyFromSeed,
  publishItem,
  type RepoState,
  seedSigner,
  sha256Hex,
  signatureFor,
  signItem,
  signRole,
  type Timing,
  utf8,
  withFreshness,
} from '@keryx-kit/domain'
import { Effect } from 'effect'
import { STUB_IDENTITY_KEY, stubMasterSeedHex } from '../src/dev/trezorStub.ts'
import { masterKeyLabel } from '../src/lib/masterKey.ts'
import type { MockCompany, MockState } from './state.ts'

const DAY = 24 * 60 * 60 * 1000
const seedOf = (name: string) => fromHex(sha256Hex(utf8(`keryx-kit mock/${name}`)))

const LOGO = `data:image/svg+xml;base64,${btoa(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#c2410c"/><path d="M18 24h28l-3 22H21z" fill="#fff"/><path d="M25 24a7 7 0 0 1 14 0" stroke="#fff" stroke-width="4" fill="none"/></svg>',
)}`

const posts = [
  {
    id: 'autumn-sale',
    title: 'Autumn sale: 20% off all rain gear',
    html: '<p>From Monday to Sunday every jacket, boot and umbrella in the shop is 20% off. No code needed: the discount is applied at checkout.</p><p>Remember: we never ask for your password or card details in a message.</p>',
    tags: ['sale'],
  },
  {
    id: 'new-opening-hours',
    title: 'New opening hours from November',
    html: '<p>Our Prague store now opens at <strong>9:00</strong> on weekdays and stays open until <strong>20:00</strong> on Thursdays.</p>',
    tags: ['store'],
  },
]

export const seedDemo = (state: MockState, origin: string): void => {
  const slug = 'demo-shop'
  const now = new Date()
  const iso = (offsetDays: number) => new Date(now.getTime() + offsetDays * DAY).toISOString()
  const timing: Timing = {
    now,
    expiries: { ...DefaultExpiries, targets: 41 * DAY, authors: 45 * DAY },
  }
  const master = seedSigner(fromHex(stubMasterSeedHex(masterKeyLabel(slug))))
  const opsSeed = seedOf('ops')
  const channelSeeds = { offers: seedOf('channel offers'), news: seedOf('channel news') }
  const petrSeed = seedOf('author petr')
  const petr = publicKeyFromSeed(petrSeed)
  const petrKeyid = keyidOf(ed25519Key(petr))

  const repo = Effect.runSync(
    Effect.gen(function* () {
      let s: RepoState = yield* initRepo(
        {
          repoBase: `${origin}/repo/${slug}/`,
          companyName: 'Demo Shop',
          logo: LOGO,
          masterKey: publicKeyFromSeed(fromHex(stubMasterSeedHex(masterKeyLabel(slug)))),
          opsKey: publicKeyFromSeed(opsSeed),
        },
        timing,
      )
      s = yield* attachRoleSignature(
        s,
        'root',
        yield* signatureFor(s.roots[0] ?? s.targets, master),
      )
      for (const [channel, displayName, description] of [
        ['offers', 'Offers', 'Sales and discount codes, at most once a week.'],
        ['news', 'Store news', 'Opening hours, new branches and service changes.'],
      ] as const) {
        s = yield* createChannel(
          s,
          {
            channel,
            displayName,
            description,
            channelKey: publicKeyFromSeed(channelSeeds[channel]),
            authors: [{ publicKey: petr, name: 'author-1' }],
          },
          timing,
        )
        s = yield* signRole(s, `channels.${channel}`, seedSigner(channelSeeds[channel]))
        s = yield* signRole(s, `channels.${channel}.authors`, seedSigner(petrSeed))
      }
      s = yield* signRole(s, 'targets', master)
      for (const [i, post] of posts.entries()) {
        const item = yield* signItem(
          {
            id: post.id,
            title: post.title,
            content_html: post.html,
            date_published: iso(-12 + i * 5).replace(/\.\d{3}Z$/, 'Z'),
            tags: post.tags,
            language: 'en',
          },
          seedSigner(petrSeed),
        )
        s = yield* publishItem(
          s,
          { channel: 'offers', item: yield* signItem(item, seedSigner(channelSeeds.offers)) },
          timing,
        )
        s = yield* signRole(s, 'channels.offers', seedSigner(channelSeeds.offers))
      }
      return yield* withFreshness(s, undefined, seedSigner(opsSeed), { now })
    }),
  )

  const company: MockCompany = {
    slug,
    joinOrigin: 'https://shop.example.com',
    contactEmail: 'owner@shop.example.com',
    createdAt: iso(-30),
    identityKey: STUB_IDENTITY_KEY,
    opsSeed,
    channelSeeds,
    repo,
    domain: {
      status: 'mismatch',
      reason:
        'https://shop.example.com/.well-known/keryx/root.json is missing the Access-Control-Allow-Origin: * header.',
      checkedAt: iso(-0.3),
    },
    lastTimestampAt: now.toISOString(),
    members: [
      {
        id: 'm-petr',
        name: 'Petr Novák',
        keyLabel: 'author-1',
        keyid: petrKeyid,
        authorPublicKey: petr,
        registeredAt: iso(-29),
        passkeys: [],
      },
    ],
    invites: [
      {
        id: 'i-lucie',
        token: 'seeded-invite-lucie',
        label: 'Lucie (marketing)',
        createdAt: iso(-2),
        expiresAt: iso(5),
        used: false,
      },
    ],
    ceremonies: [],
    drafts: [],
    audit: [
      {
        at: iso(-30),
        actor: { kind: 'owner' },
        action: 'signup',
        summary: 'Signed up Demo Shop and signed root.json and targets.json v1',
        versions: { 'root.json': 1, 'targets.json': 1 },
      },
      {
        at: iso(-29),
        actor: { kind: 'member', memberId: 'm-petr', name: 'Petr Novák' },
        action: 'member-registered',
        summary: 'Petr Novák registered a passkey (author-1)',
        versions: {},
      },
      {
        at: iso(-28),
        actor: { kind: 'owner' },
        action: 'ceremony-applied',
        summary: 'Created channels Offers and Store news with author Petr Novák',
        versions: { 'targets.json': 2, 'channels.offers.authors.json': 1 },
      },
      ...posts.map((post, i) => ({
        at: iso(-12 + i * 5),
        actor: { kind: 'member' as const, memberId: 'm-petr', name: 'Petr Novák' },
        action: 'item-published' as const,
        summary: `Published “${post.title}” in Offers`,
        versions: { 'channels.offers.json': i + 2 },
      })),
    ],
    sources: {},
  }
  state.companies.set(slug, company)
  state.inviteCodes.push({
    code: 'PILOT-DEMO-SHOP',
    note: 'Demo Shop pilot',
    createdAt: iso(-31),
    usedAt: iso(-30),
    usedBy: slug,
  })
  state.pilotRequests.push(
    {
      id: 'p1',
      company: 'Northwind Bank',
      name: 'Eva Svobodová',
      email: 'eva@northwind.example',
      message:
        'We want to stop sending security notices by email. Could we try Keryx for card alerts?',
      createdAt: iso(-3),
    },
    {
      id: 'p2',
      company: 'Kavárna U Mostu',
      name: 'Tomáš Dvořák',
      email: 'tomas@umostu.example',
      message: '',
      createdAt: iso(-1),
    },
  )
}

export const seedInviteCodes = (state: MockState): void => {
  state.inviteCodes.push({
    code: 'PILOT-2026',
    note: 'Open pilot code for local development',
    createdAt: new Date().toISOString(),
  })
}
