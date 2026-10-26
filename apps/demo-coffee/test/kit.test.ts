import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { checkFile, checkStatus, type Served } from '../scripts/check.ts'
import { JOIN_PAGE, kitCompany, kitFromZip, ROOT_FILE } from '../scripts/kit.ts'

const root = strToU8(
  JSON.stringify({ signed: { custom: { repo_base: 'https://repo.example/coffee-r1/' } } }),
)
const joinPage = strToU8('<title>Subscribe with Keryx</title>')

const kitZip = (extra: Record<string, Uint8Array> = {}) =>
  zipSync({
    [ROOT_FILE]: root,
    '.well-known/keryx/1.root.json': root,
    [JOIN_PAGE]: joinPage,
    'README.md': strToU8('# Keryx join kit'),
    ...extra,
  })

const served = (status: number, headers: Record<string, string>, body: Uint8Array): Served => ({
  status,
  headers: new Headers(headers),
  body,
})

const anchorHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
}

describe('kitFromZip', () => {
  it('keeps the root files and the join page, not the README', () => {
    expect(Object.keys(kitFromZip(kitZip())).sort()).toEqual([
      '.well-known/keryx/1.root.json',
      ROOT_FILE,
      JOIN_PAGE,
    ])
  })

  it('ignores files outside the kit layout', () => {
    const kit = kitFromZip(kitZip({ 'index.html': joinPage, 'join/other.html': joinPage }))
    expect(Object.keys(kit)).not.toContain('index.html')
    expect(Object.keys(kit)).not.toContain('join/other.html')
  })

  it('refuses a zip without root.json', () => {
    expect(() => kitFromZip(zipSync({ [JOIN_PAGE]: joinPage }))).toThrow(/Not a Keryx join kit/)
  })
})

describe('kitCompany', () => {
  it('reads the slug from the repo base', () => {
    expect(kitCompany(kitFromZip(kitZip()))).toBe('coffee-r1')
  })

  it('is undefined when root.json is not JSON', () => {
    expect(kitCompany({ [ROOT_FILE]: strToU8('nope') })).toBeUndefined()
  })
})

describe('checkFile', () => {
  it('passes a root file with the right headers and bytes', () => {
    expect(checkFile(ROOT_FILE, served(200, anchorHeaders, root), root).problems).toEqual([])
  })

  it('reports missing CORS, a wrong content type and different bytes', () => {
    const check = checkFile(
      ROOT_FILE,
      served(200, { 'content-type': 'text/plain' }, strToU8('{}')),
      root,
    )
    expect(check.path).toBe('/.well-known/keryx/root.json')
    expect(check.problems).toEqual([
      'Content-Type: text/plain',
      'Access-Control-Allow-Origin: missing',
      'bytes differ from the local file',
    ])
  })

  it('checks /join for Referrer-Policy', () => {
    const ok = checkFile(
      JOIN_PAGE,
      served(200, { 'referrer-policy': 'no-referrer' }, joinPage),
      joinPage,
    )
    expect(ok).toMatchObject({ path: '/join', problems: [] })
    const leaky = checkFile(JOIN_PAGE, served(200, {}, joinPage), joinPage)
    expect(leaky.problems).toEqual(['Referrer-Policy: missing'])
  })

  it('reports the status when a file is not served', () => {
    expect(checkFile(ROOT_FILE, served(404, {}, new Uint8Array()), root).problems).toEqual([
      'status 404',
    ])
  })
})

describe('checkStatus', () => {
  it('compares the status only', () => {
    expect(checkStatus('/', served(200, {}, new Uint8Array()), 200).problems).toEqual([])
    expect(checkStatus('/x', served(200, {}, new Uint8Array()), 404).problems).toEqual([
      'status 200, expected 404',
    ])
  })
})
