/**
 * Serves the mock API on the Vite dev server (`KERYX_MOCK=demo|empty vite`). The mock
 * is loaded through Vite's SSR loader, so it runs in Node and never enters the browser
 * bundle. `vite build` does not load this plugin at all (see vite.config.ts).
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin, ViteDevServer } from 'vite'

type Mock = {
  readonly handler: (request: Request) => Promise<Response>
  readonly repoFile: (slug: string, path: string) => Uint8Array | undefined
  readonly operatorToken: string
}

const readBody = async (req: IncomingMessage): Promise<Uint8Array<ArrayBuffer> | undefined> => {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined
  const chunks: Array<Uint8Array> = []
  for await (const chunk of req) chunks.push(chunk as Uint8Array)
  return new Uint8Array(Buffer.concat(chunks))
}

const toRequest = async (req: IncomingMessage, origin: string): Promise<Request> => {
  const headers = new Headers()
  for (const [name, value] of Object.entries(req.headers))
    if (typeof value === 'string') headers.set(name, value)
    else if (Array.isArray(value)) for (const v of value) headers.append(name, v)
  const body = await readBody(req)
  return new Request(new URL(req.url ?? '/', origin), {
    method: req.method ?? 'GET',
    headers,
    ...(body ? { body } : {}),
  })
}

const send = async (res: ServerResponse, response: Response) => {
  res.statusCode = response.status
  for (const [name, value] of response.headers)
    if (name !== 'set-cookie') res.setHeader(name, value)
  const cookies = response.headers.getSetCookie()
  if (cookies.length > 0) res.setHeader('set-cookie', cookies)
  res.end(Buffer.from(await response.arrayBuffer()))
}

export const mockApi = (mode: string): Plugin => {
  let mock: Promise<Mock> | undefined
  const load = (server: ViteDevServer, origin: string) => {
    mock ??= server.ssrLoadModule('/mock/server.ts').then((module) => {
      const created = (module.createMock as (mode: string, origin: string) => Mock)(mode, origin)
      server.config.logger.info(
        `  keryx mock API (${mode}): operator token ${created.operatorToken}, invite code PILOT-2026`,
      )
      return created
    })
    return mock
  }
  return {
    name: 'keryx-mock-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? '/'
        if (!url.startsWith('/api/') && !url.startsWith('/repo/')) return next()
        try {
          const origin = `http://${req.headers.host ?? 'localhost'}`
          const api = await load(server, origin)
          if (url.startsWith('/repo/')) {
            const [, , slug = '', ...rest] = new URL(url, origin).pathname.split('/')
            const bytes = api.repoFile(slug, rest.join('/'))
            res.statusCode = bytes ? 200 : 404
            res.setHeader('Access-Control-Allow-Origin', '*')
            res.setHeader('Content-Type', 'application/json')
            res.end(bytes ? Buffer.from(bytes) : 'not found')
            return
          }
          await send(res, await api.handler(await toRequest(req, origin)))
        } catch (error) {
          server.config.logger.error(String((error as Error).stack ?? error))
          res.statusCode = 500
          res.end('mock API failed')
        }
      })
    },
  }
}
