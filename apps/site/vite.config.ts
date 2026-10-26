import { resolve } from 'node:path'
import { type Connect, defineConfig, type Plugin } from 'vite'

/** The server answers `/subscribers` without the slash; vite dev and preview need the same. */
const subscribersWithoutSlash = (): Plugin => {
  const rewrite: Connect.NextHandleFunction = (request, _response, next) => {
    if (request.url === '/subscribers' || request.url?.startsWith('/subscribers?')) {
      request.url = request.url.replace('/subscribers', '/subscribers/')
    }
    next()
  }
  return {
    name: 'subscribers-without-slash',
    configureServer: (server) => {
      server.middlewares.use(rewrite)
    },
    configurePreviewServer: (server) => {
      server.middlewares.use(rewrite)
    },
  }
}

export default defineConfig({
  plugins: [subscribersWithoutSlash()],
  build: {
    rolldownOptions: {
      input: {
        landing: resolve(import.meta.dirname, 'index.html'),
        subscribers: resolve(import.meta.dirname, 'subscribers/index.html'),
      },
    },
  },
})
