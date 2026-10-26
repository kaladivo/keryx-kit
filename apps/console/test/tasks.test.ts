import { type AuthorTask, applyOperation, type Operation, repoFilesToText } from '@keryx-kit/api'
import {
  type Item,
  type RepoState,
  repoFiles,
  roleMetadata,
  seedSigner,
  signatureFor,
  signItem,
  signingBytes,
  signRole,
  type TargetsMetadata,
  toBase64url,
  utf8,
} from '@keryx-kit/domain'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { signTasks } from '../src/lib/authorSigning.ts'
import { completeTask } from '../src/lib/tasks.ts'
import { keyidOfName, publicOf, publishedRepo, seedOf } from './repo.ts'

const repo = publishedRepo()
const jana = seedSigner(seedOf('jana'))
const renew: Operation = {
  _tag: 'renewAuthors',
  now: '2026-10-27T10:00:00.000Z',
  params: { channel: 'offers' },
}
const authorsTask = (bytes?: Uint8Array): Extract<AuthorTask, { _tag: 'SignAuthorsMetadata' }> => {
  const next = Effect.runSync(applyOperation(repo, renew))
  const doc = roleMetadata(next, 'channels.offers.authors')
  return {
    _tag: 'SignAuthorsMetadata',
    id: 't-authors',
    channel: 'offers',
    reason: 'author-removal',
    base: repoFilesToText(repoFiles(repo)),
    operation: renew,
    toSign: {
      role: 'channels.offers.authors',
      keyids: [keyidOfName('jana')],
      signingBytes: toBase64url(bytes ?? signingBytes(doc ?? repo.targets)),
    },
  }
}

describe('author tasks', () => {
  it('signs the authors metadata it rebuilt itself', () => {
    const result = Effect.runSync(Effect.result(completeTask(authorsTask(), jana)))
    expect(result._tag).toBe('Success')
  })

  it('refuses authors metadata bytes that differ from the rebuild', () => {
    const result = Effect.runSync(Effect.result(completeTask(authorsTask(utf8('{}')), jana)))
    expect(result._tag).toBe('Failure')
  })

  it('refuses to re-sign an item no listed author signed', async () => {
    const forged = {
      id: 'x',
      title: 'Send us your seed',
      content_html: '<p>x</p>',
      date_published: '2026-10-26T10:00:00Z',
      sig: [],
    }
    const task: AuthorTask = {
      _tag: 'ResignItems',
      id: 't-items',
      channel: 'offers',
      ceremonyId: 'c1',
      items: [forged],
    }
    const result = Effect.runSync(
      Effect.result(completeTask(task, jana, { roots: repo.roots, targets: repo.targets })),
    )
    expect(result._tag).toBe('Failure')
  })

  it('keeps the server order, so ResignItems completes before the authors metadata', async () => {
    const items: AuthorTask = {
      _tag: 'ResignItems',
      id: 't-items',
      channel: 'offers',
      ceremonyId: 'c1',
      items: [],
    }
    const outcomes = await signTasks([items, authorsTask()], jana, {
      roots: repo.roots,
      targets: repo.targets,
    })
    expect(outcomes.map((o) => o.task.id)).toEqual(['t-items', 't-authors'])
  })
})

const assignOp = (name: string): Operation => ({
  _tag: 'assignAuthor',
  now: '2026-10-27T10:00:00.000Z',
  params: { channel: 'offers', author: { publicKey: publicOf(name), name: `author-${name}` } },
})

/** `targets.json` after adding `name` as an author, signed by `signedBy` (unsigned if none). */
const targetsWith = (name: string, signedBy?: string): TargetsMetadata =>
  Effect.runSync(
    Effect.gen(function* () {
      const state: RepoState = yield* applyOperation(repo, assignOp(name))
      if (signedBy === 'master')
        return (yield* signRole(state, 'targets', seedSigner(seedOf('master')))).targets
      const signatures = signedBy
        ? [yield* signatureFor(state.targets, seedSigner(seedOf(signedBy)))]
        : []
      return { ...state.targets, signatures }
    }),
  )

const signedBy = (name: string): Item =>
  Effect.runSync(
    signItem(
      {
        id: 'sale',
        title: 'Autumn sale',
        content_html: '<p>20% off</p>',
        date_published: '2026-10-26T10:00:00Z',
      },
      seedSigner(seedOf(name)),
    ),
  )

const resign = (item: Item): AuthorTask => ({
  _tag: 'ResignItems',
  id: 't-items',
  channel: 'offers',
  ceremonyId: 'c1',
  items: [item],
})

const petr = seedSigner(seedOf('petr'))
const resignAs = (
  item: Item,
  published: { roots?: RepoState['roots']; targets: TargetsMetadata },
) =>
  Effect.runSync(
    Effect.result(
      completeTask(resign(item), petr, { roots: published.roots, targets: published.targets }),
    ),
  )

describe('ResignItems against the company domain (trust anchor)', () => {
  it('re-signs a post by a listed author when targets.json verifies against the anchor', () => {
    const result = resignAs(signedBy('jana'), {
      roots: repo.roots,
      targets: targetsWith('petr', 'master'),
    })
    expect(result._tag).toBe('Success')
  })

  it('refuses a repo origin that adds its own author key without the master signature', () => {
    // The service adds Mallory and Petr; Mallory signed the post it wants Petr to co-sign.
    const lying = (signer?: string) => {
      const withPetr = Effect.runSync(applyOperation(repo, assignOp('petr')))
      const state = Effect.runSync(applyOperation(withPetr, assignOp('mallory')))
      const signatures = signer
        ? [Effect.runSync(signatureFor(state.targets, seedSigner(seedOf(signer))))]
        : []
      return { ...state.targets, signatures }
    }
    for (const targets of [lying(), lying('mallory'), lying('ops')]) {
      const result = resignAs(signedBy('mallory'), { roots: repo.roots, targets })
      expect(result._tag).toBe('Failure')
      if (result._tag === 'Failure')
        expect(result.failure.reason).toMatch(/does not verify against your company's root\.json/)
    }
  })

  it('refuses when the company domain does not serve the anchor', () => {
    const result = resignAs(signedBy('jana'), { targets: targetsWith('petr', 'master') })
    expect(result._tag).toBe('Failure')
    if (result._tag === 'Failure')
      expect(result.failure.reason).toMatch(/needs your company's domain to be live/)
  })

  it('does not sign the author list of a removal whose posts were not re-signed', async () => {
    const outcomes = await signTasks(
      [{ ...resign(signedBy('jana')), ceremonyId: 'c-removal' }, authorsTaskFor('c-removal')],
      jana,
      { roots: undefined, targets: repo.targets },
    )
    expect(outcomes.map((o) => o.completion)).toEqual([undefined, undefined])
    expect(outcomes[1]?.error).toMatch(/posts of this removal were not re-signed/)
  })
})

const authorsTaskFor = (ceremonyId: string): AuthorTask => ({ ...authorsTask(), ceremonyId })

describe('SignAuthorsMetadata checks', () => {
  it('refuses a base whose targets.json is not signed', () => {
    const task = authorsTask()
    const targets = JSON.parse(task.base.base['targets.json'] ?? '{}') as TargetsMetadata
    const unsigned = JSON.stringify({ ...targets, signatures: [] })
    const base = { ...task.base, base: { ...task.base.base, 'targets.json': unsigned } }
    const result = Effect.runSync(Effect.result(completeTask({ ...task, base }, jana)))
    expect(result._tag).toBe('Failure')
    if (result._tag === 'Failure')
      expect(result.failure.reason).toMatch(/^The published repo does not/)
  })
})
