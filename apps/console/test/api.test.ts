import { describe, expect, it, vi } from 'vitest'

// The fetch client captures `fetch` when it loads, so the stub must exist before the import.
const fetchMock = vi.hoisted(() => {
  const mock = vi.fn<typeof fetch>()
  globalThis.fetch = mock
  return mock
})

const { call, isUnauthorized } = await import('../src/lib/api.ts')

const answer = (status: number, body: string) =>
  fetchMock.mockResolvedValue(
    new Response(body, { status, headers: { 'content-type': 'application/json' } }),
  )

const failure = (request: Promise<unknown>) =>
  request.then(
    () => undefined,
    (error: unknown) => error,
  )

describe('API errors', () => {
  it('treats a 401 as a missing session, with or without a body', async () => {
    for (const body of ['{"_tag":"Unauthorized"}', '']) {
      answer(401, body)
      const error = await failure(call((api) => api.company.get()))
      expect(isUnauthorized(error)).toBe(true)
    }
  })

  it('shows the server sentence of a tagged error', async () => {
    answer(404, '{"_tag":"NotFound","error":"There is no such channel."}')
    const error = await failure(call((api) => api.items.list({ params: { channel: 'offers' } })))
    expect(error).toMatchObject({ tag: 'NotFound', message: 'There is no such channel.' })
  })
})
