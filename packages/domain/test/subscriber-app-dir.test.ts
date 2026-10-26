/**
 * `KERYX_SCENARIO_DIR=<dir> vitest run test/subscriber-app-dir.test.ts`: the subscriber
 * app's verifier over repo states on disk, in the `scenario.json` layout tools/conformance
 * reads (e.g. the repo the console e2e run made the real server write).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { syncWithApp } from './subscriberApp.ts'

const dir = process.env.KERYX_SCENARIO_DIR
const ORIGIN = 'https://company.test'

interface Scenario {
  readonly steps: ReadonlyArray<{ readonly dir: string; readonly now: string }>
}

const read = (path: string): Uint8Array | undefined => {
  try {
    return readFileSync(path)
  } catch {
    return undefined
  }
}

/** The anchor from the company origin, everything else from the root's `repo_base`. */
const fetchFrom = (stepDir: string): typeof fetch => {
  const root = JSON.parse(readFileSync(join(stepDir, 'anchor', 'root.json'), 'utf8')) as {
    signed: { custom: { repo_base: string } }
  }
  const repoBase = root.signed.custom.repo_base
  const anchorPrefix = `${ORIGIN}/.well-known/keryx/`
  return async (input) => {
    const url = new URL(String(input))
    const href = `${url.origin}${url.pathname}`
    const bytes = href.startsWith(anchorPrefix)
      ? read(join(stepDir, 'anchor', href.slice(anchorPrefix.length)))
      : href.startsWith(repoBase)
        ? read(join(stepDir, 'base', href.slice(repoBase.length)))
        : undefined
    return bytes ? new Response(new Uint8Array(bytes)) : new Response(null, { status: 404 })
  }
}

describe.skipIf(dir === undefined)(`subscriber app verifier on ${dir}`, () => {
  it.effect('accepts every repo state and every item', () =>
    Effect.gen(function* () {
      const scenarioDir = dir ?? ''
      const scenario = JSON.parse(
        readFileSync(join(scenarioDir, 'scenario.json'), 'utf8'),
      ) as Scenario
      const verified = yield* syncWithApp(
        scenario.steps.map((step) => ({
          name: step.dir,
          now: new Date(step.now),
          anchorUrl: `${ORIGIN}/.well-known/keryx/root.json`,
          fetch: fetchFrom(join(scenarioDir, step.dir)),
        })),
      )
      expect(scenario.steps.length).toBeGreaterThan(0)
      console.log(`subscriber app ok: ${scenario.steps.length} repo states, ${verified} items`)
    }),
  )
})
