import { describe, expect, it } from 'vitest'
import { normalize, type PilotRequest, submit, validate } from '../src/pilot-request.ts'

const valid: PilotRequest = {
  company: 'Demo Shop',
  name: 'Jana Nováková',
  email: 'jana@demo.example',
  message: '',
}

const respond =
  (status: number, body: string): typeof fetch =>
  async () =>
    new Response(body, { status, headers: { 'Content-Type': 'application/json' } })

describe('validate', () => {
  it('accepts a complete request with an empty message', () => {
    expect(validate(valid)).toEqual({})
  })

  it('requires company, name and email', () => {
    expect(Object.keys(validate({ company: '', name: '', email: '', message: '' }))).toEqual([
      'company',
      'name',
      'email',
    ])
  })

  it('rejects a malformed email address', () => {
    expect(validate({ ...valid, email: 'jana@demo' }).email).toBeDefined()
  })

  it('rejects an overlong message', () => {
    expect(validate({ ...valid, message: 'x'.repeat(4001) }).message).toBeDefined()
  })

  it('validates trimmed values', () => {
    expect(validate(normalize({ ...valid, company: '   ' })).company).toBeDefined()
  })
})

describe('submit', () => {
  it('POSTs the request as JSON to /api/pilot-requests', async () => {
    let seen: { url: string; init: RequestInit | undefined } | undefined
    const fetchFn: typeof fetch = async (url, init) => {
      seen = { url: String(url), init }
      return new Response(null, { status: 201 })
    }
    expect(await submit(valid, fetchFn)).toEqual({ ok: true })
    expect(seen?.url).toBe('/api/pilot-requests')
    expect(seen?.init?.method).toBe('POST')
    expect(JSON.parse(String(seen?.init?.body))).toEqual(valid)
  })

  it('shows the server error from a 400 response', async () => {
    const result = await submit(valid, respond(400, '{"error":"email is invalid"}'))
    expect(result).toEqual({ ok: false, error: 'email is invalid' })
  })

  it('falls back to a generic error for other failures', async () => {
    const result = await submit(valid, respond(500, 'oops'))
    expect(result.ok).toBe(false)
  })

  it('reports a network failure', async () => {
    const result = await submit(valid, async () => {
      throw new TypeError('Failed to fetch')
    })
    expect(result.ok).toBe(false)
  })
})
