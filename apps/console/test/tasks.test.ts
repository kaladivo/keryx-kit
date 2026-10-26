import { type AuthorTask, applyOperation, type Operation, repoFilesToText } from '@keryx-kit/api'
import {
  repoFiles,
  roleMetadata,
  seedSigner,
  signingBytes,
  toBase64url,
  utf8,
} from '@keryx-kit/domain'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { signTasks } from '../src/lib/authorSigning.ts'
import { completeTask } from '../src/lib/tasks.ts'
import { keyidOfName, publishedRepo, seedOf } from './repo.ts'

const repo = publishedRepo()
const jana = seedSigner(seedOf('jana'))
const renew: Operation = {
  _tag: 'renewAuthors',
  now: '2026-10-27T10:00:00.000Z',
  params: { channel: 'offers' },
}
const authorsTask = (bytes?: Uint8Array): AuthorTask => {
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
    const result = Effect.runSync(Effect.result(completeTask(task, jana, repo.targets)))
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
    const outcomes = await signTasks([items, authorsTask()], jana, repo.targets)
    expect(outcomes.map((o) => o.task.id)).toEqual(['t-items', 't-authors'])
  })
})
