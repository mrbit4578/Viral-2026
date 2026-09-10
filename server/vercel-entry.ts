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

/** Gọi app theo chuẩn Web API (dùng chung cho cả hai kiểu invocation). */
async function run(request: Request): Promise<Response> {
  return app.fetch(restorePagePath(request), createBindings(runtimeEnv))
}

function errorMessage(err: unknown): string {
  return String((err as { message?: string })?.message || err).slice(0, 300)
}

function toU8(chunk: unknown): Uint8Array {
  if (chunk instanceof Uint8Array) return chunk
  return new TextEncoder().encode(String(chunk))
}

function concatU8(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.byteLength, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const p of parts) {
    out.set(p, off)
    off += p.byteLength
  }
  return out
}

/**
 * Bundled into server/function-bundle.cjs during `npm run build`.
 *
 * Vercel @vercel/node có thể gọi function theo MỘT TRONG HAI kiểu tuỳ version
 * runtime/cấu hình:
 *   1) Web API:   default export (request: Request) => Response
 *   2) Node API:  default export (req: IncomingMessage, res: ServerResponse)
 * Hỗ trợ cả hai để tránh FUNCTION_INVOCATION_FAILED.
 */
export default async function handler(req: unknown, res?: unknown): Promise<unknown> {
  // Kiểu 2 — Node req/res: req.url là đường dẫn tương đối (bắt đầu bằng '/'),
  // có headers dạng object phẳng và res có setHeader/end.
  const nodeRes = res as
    | { statusCode: number; setHeader: (k: string, v: string) => void; end: (b?: unknown) => void }
    | undefined
  const nodeReq = req as {
    url?: string
    method?: string
    headers?: Record<string, string | string[] | undefined>
    [Symbol.asyncIterator]?: () => AsyncIterableIterator<unknown>
  }

  if (
    nodeRes &&
    typeof nodeRes.setHeader === 'function' &&
    typeof nodeReq?.url === 'string' &&
    nodeReq.url.startsWith('/')
  ) {
    try {
      const method = String(nodeReq.method || 'GET').toUpperCase()
      const parts: Uint8Array[] = []
      if (method !== 'GET' && method !== 'HEAD' && typeof nodeReq[Symbol.asyncIterator] === 'function') {
        for await (const chunk of nodeReq as AsyncIterable<unknown>) parts.push(toU8(chunk))
      }
      const hdrs = new Headers()
      for (const [k, v] of Object.entries(nodeReq.headers || {})) {
        if (Array.isArray(v)) v.forEach((x) => hdrs.append(k, String(x)))
        else if (v !== undefined) hdrs.set(k, String(v))
      }
      const proto = String((nodeReq.headers || {})['x-forwarded-proto'] || 'https')
      const host = String((nodeReq.headers || {}).host || 'localhost')
      const request = new Request(`${proto}://${host}${nodeReq.url}`, {
        method,
        headers: hdrs,
        body: parts.length ? (concatU8(parts) as unknown as BodyInit) : undefined,
      })
      const response = await run(request)
      const body = new Uint8Array(await response.arrayBuffer())
      nodeRes.statusCode = response.status
      response.headers.forEach((v, k) => {
        const lk = k.toLowerCase()
        if (lk !== 'content-encoding' && lk !== 'transfer-encoding') nodeRes.setHeader(k, v)
      })
      nodeRes.end(body)
      return undefined
    } catch (err) {
      nodeRes.statusCode = 500
      nodeRes.setHeader('content-type', 'application/json; charset=utf-8')
      nodeRes.end(JSON.stringify({ error: `Lỗi khởi tạo function: ${errorMessage(err)}` }))
      return undefined
    }
  }

  // Kiểu 1 — Web API Request.
  try {
    return await run(req as Request)
  } catch (err) {
    return new Response(JSON.stringify({ error: `Lỗi khởi tạo function: ${errorMessage(err)}` }), {
      status: 500,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    })
  }
}
