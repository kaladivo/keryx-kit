/**
 * The subscriber app's own verifier (vendor/keryx/app/src/lib/tuf.ts + item.ts) syncs
 * every conformance step, keeping its pinned root and version memory across steps.
 */
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from '@effect/vitest'
import { Effect } from 'effect'
import { buildScenario } from '../scripts/scenario.ts'
import { repoFiles } from '../src/index.ts'

interface Doc {
  readonly signed: {
    readonly version: number
    readonly targets: Record<string, { length: number; hashes: Record<string, string> }>
  }
}
interface Seen {
  timestamp?: number
  snapshot?: number
  targets?: number
  roles?: Record<string, number>
}
interface Meta {
  readonly root: Doc
  readonly timestamp: Doc
  readonly snapshot: Doc
  readonly targets: Doc
  readonly base: string
  readonly stale: boolean
}
interface KeySet {
  readonly keys: ReadonlyArray<{ keyid: string; pub: Uint8Array }>
  readonly threshold: number
}
interface SubscriberTuf {
  loadAndVerifyMetadata(
    fetchFn: typeof fetch,
    anchorUrl: string,
    pinnedRoot: Doc | null,
    seen: Seen | null,
  ): Promise<Meta>
  loadChannelRole(
    fetchFn: typeof fetch,
    meta: Meta,
    roleName: string,
    consistent: boolean,
    seenRole?: number,
  ): Promise<Doc>
  extractAuthorization(targets: Doc): {
    channels: Map<string, KeySet>
    authors: Map<string, KeySet>
  }
  verifyTargetBytes(bytes: Uint8Array, info: unknown, path: string): void
}
interface SubscriberItem {
  verifyItemSignatures(item: unknown, authors: KeySet | undefined, channel: KeySet): void
  verifyImage(item: unknown): void
  itemIdFromPath(path: string): string
}

const appLib = join(import.meta.dirname, '../../../vendor/keryx/app/src/lib')
const tuf = (await import(/* @vite-ignore */ join(appLib, 'tuf.ts'))) as SubscriberTuf
const items = (await import(/* @vite-ignore */ join(appLib, 'item.ts'))) as SubscriberItem

const ORIGIN = 'https://acme.test'
const REPO_BASE = 'https://repo.keryx-kit.test/acme/'

const fetchFrom =
  (files: ReturnType<typeof repoFiles>): typeof fetch =>
  async (input) => {
    const url = new URL(String(input))
    const href = `${url.origin}${url.pathname}`
    const anchorPrefix = `${ORIGIN}/.well-known/keryx/`
    const bytes = href.startsWith(anchorPrefix)
      ? files.anchor[href.slice(anchorPrefix.length)]
      : href.startsWith(REPO_BASE)
        ? files.base[href.slice(REPO_BASE.length)]
        : undefined
    return bytes ? new Response(new Uint8Array(bytes)) : new Response(null, { status: 404 })
  }

afterAll(() => {
  vi.useRealTimers()
})

describe('subscriber app verifier (vendor/keryx/app tuf.ts)', () => {
  it.effect('accepts every conformance step and every item', () =>
    Effect.gen(function* () {
      const steps = yield* buildScenario
      let pinnedRoot: Doc | null = null
      let seen: Seen | null = null
      let verified = 0
      for (const step of steps) {
        vi.useFakeTimers({ now: step.now, toFake: ['Date'] })
        const fetchFn = fetchFrom(repoFiles(step.repo))
        const meta = yield* Effect.promise(() =>
          tuf.loadAndVerifyMetadata(
            fetchFn,
            `${ORIGIN}/.well-known/keryx/root.json`,
            pinnedRoot,
            seen,
          ),
        )
        expect(meta.stale, step.name).toBe(false)
        const auth = tuf.extractAuthorization(meta.targets)
        const roles: Record<string, number> = {}
        for (const [channel, channelKeys] of auth.channels) {
          const roleName = `channels.${channel}`
          const role = yield* Effect.promise(() =>
            tuf.loadChannelRole(fetchFn, meta, roleName, false, seen?.roles?.[roleName]),
          )
          roles[roleName] = role.signed.version
          for (const [path, info] of Object.entries(role.signed.targets)) {
            const response = yield* Effect.promise(() => fetchFn(new URL(path, meta.base)))
            const bytes = new Uint8Array(yield* Effect.promise(() => response.arrayBuffer()))
            tuf.verifyTargetBytes(bytes, info, path)
            const item = JSON.parse(new TextDecoder().decode(bytes)) as { id: string }
            expect(item.id).toBe(items.itemIdFromPath(path))
            items.verifyImage(item)
            items.verifyItemSignatures(item, auth.authors.get(channel), channelKeys)
            verified++
          }
        }
        pinnedRoot = meta.root
        seen = {
          timestamp: meta.timestamp.signed.version,
          snapshot: meta.snapshot.signed.version,
          targets: meta.targets.signed.version,
          roles,
        }
      }
      expect(steps.length).toBeGreaterThan(10)
      expect(verified).toBeGreaterThan(30)
    }),
  )
})
