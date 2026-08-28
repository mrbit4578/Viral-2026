import app, { createBindings } from '../src/index.js'

const runtimeEnv =
  ((globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env || {})

function restorePagePath(request: Request): Request {
  const url = new URL(request.url)
  const pagePath = url.searchParams.get('__hono_path')
  if (!pagePath) return request

  // The two page rewrites enter this Function as /api/page. Restore their original
  // pathname so the same Hono application can render / and /studio.
  url.pathname = pagePath
  url.searchParams.delete('__hono_path')
  return new Request(url, request)
}

/**
 * Vercel Serverless Function catch-all. /api/* reaches it directly; / and
 * /studio are rewritten here by vercel.json and then restored above.
 */
export default {
  fetch(request: Request) {
    return app.fetch(restorePagePath(request), createBindings(runtimeEnv))
  },
}
