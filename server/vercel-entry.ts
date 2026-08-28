import app, { createBindings } from '../src/index.js'

const runtimeEnv =
  ((globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env || {})

function restorePagePath(request: Request): Request {
  const url = new URL(request.url)
  const pagePath = url.searchParams.get('__hono_path')
  if (!pagePath) return request

  // / and /studio are rewritten to /api/page by vercel.json. Restore the
  // original pathname before Hono matches the application route.
  url.pathname = pagePath
  url.searchParams.delete('__hono_path')
  return new Request(url, request)
}

/** Bundled into server/function-bundle.cjs during `npm run build`. */
export default function handler(request: Request): Response | Promise<Response> {
  return app.fetch(restorePagePath(request), createBindings(runtimeEnv))
}
