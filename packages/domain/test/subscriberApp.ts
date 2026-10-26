/**
 * Syncs repo states with the subscriber app's own verifier (vendor/keryx/app/src/lib
 * tuf.ts + item.ts), keeping its pinned root and version memory across steps, the way a
 * subscriber's phone does.
 */
import { join } from 'node:path'
import { expect, vi } from '@effect/vitest'
import { Effect } from 'effect'

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

export interface AppStep {
  readonly name: string
  readonly now: Date
  readonly anchorUrl: string
  readonly fetch: typeof fetch
}

/** Verifies every step and every item in it; returns how many items verified. */
export const syncWithApp = (steps: ReadonlyArray<AppStep>) =>
  Effect.gen(function* () {
    let pinnedRoot: Doc | null = null
    let seen: Seen | null = null
    let verified = 0
    try {
      for (const step of steps) {
        vi.useFakeTimers({ now: step.now, toFake: ['Date'] })
        const fetchFn = step.fetch
        const meta = yield* Effect.promise(() =>
          tuf.loadAndVerifyMetadata(fetchFn, step.anchorUrl, pinnedRoot, seen),
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
    } finally {
      vi.useRealTimers()
    }
    return verified
  })
