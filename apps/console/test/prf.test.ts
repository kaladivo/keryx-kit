import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { prfBytes, prfEnabled, prfFirst } from '../src/lib/prf.ts'

const output = Array.from({ length: 32 }, (_, i) => i * 7)

describe('PRF output normalization', () => {
  it('accepts an ArrayBuffer', () => {
    expect(Array.from(prfBytes(Uint8Array.from(output).buffer) ?? [])).toEqual(output)
  })

  it('accepts a typed array view, honouring its offset', () => {
    const backing = new Uint8Array(40)
    backing.set(output, 4)
    expect(Array.from(prfBytes(new Uint8Array(backing.buffer, 4, 32)) ?? [])).toEqual(output)
  })

  it('accepts buffers and views from another realm, which fail instanceof', () => {
    const realm = runInNewContext(`({
      buffer: new Uint8Array(${JSON.stringify(output)}).buffer,
      view: new Uint8Array(${JSON.stringify(output)}),
    })`) as { buffer: unknown; view: unknown }
    expect(realm.buffer instanceof ArrayBuffer).toBe(false)
    expect(Array.from(prfBytes(realm.buffer) ?? [])).toEqual(output)
    expect(Array.from(prfBytes(realm.view) ?? [])).toEqual(output)
  })

  it('accepts a plain byte array (1Password)', () => {
    expect(prfFirst({ prf: { results: { first: output } } })).toEqual(Uint8Array.from(output))
  })

  it('rejects values that are not bytes', () => {
    expect(prfBytes([1, 2, 300])).toBeUndefined()
    expect(prfBytes([])).toBeUndefined()
    expect(prfBytes('abc')).toBeUndefined()
    expect(prfFirst({ prf: {} })).toBeUndefined()
    expect(prfFirst(undefined)).toBeUndefined()
  })

  it('copies, so wiping the result leaves the source alone and vice versa', () => {
    const source = Uint8Array.from(output)
    const copy = prfBytes(source)
    copy?.fill(0)
    expect(Array.from(source)).toEqual(output)
  })

  it('reads prf.enabled from registration results', () => {
    expect(prfEnabled({ prf: { enabled: true } })).toBe(true)
    expect(prfEnabled({ prf: {} })).toBe(false)
    expect(prfEnabled({})).toBe(false)
  })
})
