import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { call, startServer, type TestServer } from './support/harness.ts'
import { runDemo, SLUG } from './support/scenario.ts'

let server: TestServer
beforeEach(async () => {
  server = await startServer()
})
afterEach(async () => {
  await server.stop()
})

describe('demo path (mvp-spec §7, B4, B5, E1 to E3)', () => {
  it('runs end to end and writes a repo state per step', async () => {
    const result = await runDemo(server, mkdtempSync(join(tmpdir(), 'keryx-kit-demo-')))
    expect(result.snapshots.map((s) => s.dir.slice(3))).toEqual([
      'signup',
      'channel-live',
      'published',
      'edited',
      'unpublished',
      'assigned',
      'resigned',
      'removed',
      'timestamp',
      'server-renewal',
      'authors-renewal',
      'targets-renewal',
    ])
    const log = await call(result.owner.client.company.auditLog())
    expect(log.map((entry) => entry.action)).toContain('item-unpublished')
    expect(log.at(-1)?.action).toBe('signup')
    const company = await call(result.owner.client.company.get())
    expect(company.slug).toBe(SLUG)
  })
})
