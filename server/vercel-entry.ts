import app, { createBindings } from '../src/index.js'

const runtimeEnv =
  ((globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env || {})

type NodeRequest = AsyncIterable<Uint8Array> & {
  method?: string
  url?: string
  headers: Record<string, string | string[] | undefined>
}

type NodeResponse = {
  statusCode: number
  setHeader(name: string, value: string): void
  end(body?: Uint8Array): void
}

async function readBody(request: NodeRequest): Promise<Uint8Array | undefined> {
  if (request.method === 'GET' || request.method === 'HEAD') return undefined
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of request) {
    chunks.push(chunk)
    size += chunk.byteLength
  }
  if (!size) return undefined
  const body = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

async function toWebRequest(request: NodeRequest): Promise<Request> {
  const headers = new Headers()
  for (const [name, value] of Object.entries(request.headers)) {
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value)
  }
  const protocol = headers.get('x-forwarded-proto') || 'https'
  const host = headers.get('x-forwarded-host') || headers.get('host') || 'localhost'
  const rawBody = await readBody(request)
  // Copying produces an ArrayBuffer-backed view, which satisfies the DOM
  // Request BodyInit type and works in Vercel's Node runtime.
  const body = rawBody ? (new Uint8Array(rawBody) as unknown as BodyInit) : undefined
  return new Request(new URL(request.url || '/', `${protocol}://${host}`), {
    method: request.method || 'GET',
    headers,
    body,
  })
}

function restorePagePath(request: Request): Request {
  const url = new URL(request.url)
  const pagePath = url.searchParams.get('__hono_path')
  url.searchParams.delete('[...path]')
  if (!pagePath) return new Request(url, request)

  // / and /studio are rewritten to /api/page by vercel.json. Restore the
  // original pathname before Hono matches the application route.
  url.pathname = pagePath
  url.searchParams.delete('__hono_path')
  return new Request(url, request)
}

/** Bundled into server/function-bundle.cjs during `npm run build`. */
export default async function handler(request: NodeRequest, response: NodeResponse): Promise<void> {
  const result = await app.fetch(restorePagePath(await toWebRequest(request)), createBindings(runtimeEnv))
  response.statusCode = result.status
  result.headers.forEach((value, name) => response.setHeader(name, value))
  response.end(result.body ? new Uint8Array(await result.arrayBuffer()) : undefined)
}
