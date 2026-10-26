/** The subscriber app's verifier accepts every in-memory conformance step and item. */
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { buildScenario } from '../scripts/scenario.ts'
import { repoFiles } from '../src/index.ts'
import { syncWithApp } from './subscriberApp.ts'

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

describe('subscriber app verifier (vendor/keryx/app tuf.ts)', () => {
  it.effect('accepts every conformance step and every item', () =>
    Effect.gen(function* () {
      const steps = yield* buildScenario
      const verified = yield* syncWithApp(
        steps.map((step) => ({
          name: step.name,
          now: step.now,
          anchorUrl: `${ORIGIN}/.well-known/keryx/root.json`,
          fetch: fetchFrom(repoFiles(step.repo)),
        })),
      )
      expect(steps.length).toBeGreaterThan(10)
      expect(verified).toBeGreaterThan(30)
    }),
  )
})
