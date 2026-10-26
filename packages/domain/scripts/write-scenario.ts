/** `bun scripts/write-scenario.ts <dir>`: writes every scenario step for tools/conformance. */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Effect } from 'effect'
import { repoFiles } from '../src/index.ts'
import { buildScenario } from './scenario.ts'

const out = process.argv[2]
if (!out) throw new Error('usage: write-scenario.ts <dir>')

const writeTree = (root: string, files: Readonly<Record<string, Uint8Array>>) => {
  for (const [path, bytes] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), bytes)
  }
}

const steps = await Effect.runPromise(buildScenario)
rmSync(out, { recursive: true, force: true })
const index = steps.map((step, i) => {
  const dir = `${String(i + 1).padStart(2, '0')}-${step.name}`
  const files = repoFiles(step.repo)
  writeTree(join(out, dir, 'anchor'), files.anchor)
  writeTree(join(out, dir, 'base'), files.base)
  return { dir, now: step.now.toISOString() }
})
writeFileSync(join(out, 'scenario.json'), `${JSON.stringify({ steps: index }, null, 2)}\n`)
console.log(`wrote ${steps.length} repo states to ${out}`)
