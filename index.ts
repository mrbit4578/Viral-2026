import app, { createBindings } from './src/index'

const runtimeEnv = ((globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env || {})

/**
 * Vercel detects this Web Standard handler and sends every application route
 * through Hono. Static files in public/ remain on Vercel's CDN.
 */
export default {
  fetch(request: Request) {
    return app.fetch(request, createBindings(runtimeEnv))
  },
}
