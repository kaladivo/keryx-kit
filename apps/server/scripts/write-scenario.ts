/** `bun scripts/write-scenario.ts <dir>`: runs the demo path and keeps every repo state for tools/conformance. */
import { resolve } from 'node:path'
import { startServer } from '../test/support/harness.ts'
import { runDemo } from '../test/support/scenario.ts'

const out = process.argv[2]
if (!out) throw new Error('usage: write-scenario.ts <dir>')

const server = await startServer()
try {
  const { snapshots } = await runDemo(server, resolve(out))
  console.log(`wrote ${snapshots.length} server-written repo states to ${out}`)
} finally {
  await server.stop()
}
