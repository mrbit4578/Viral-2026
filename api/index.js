// Vercel entry for page rewrites — same bundle as [...path].js
// `npm run build` writes the self-contained Hono bundle it forwards to.
// Having both api/index.js and api/[...path].js ensures:
// - /api/* -> api/[...path].js (API routes)
// - / and /studio and SPA fallback -> api/index.js via vercel.json rewrites
import bundle from '../server/function-bundle.cjs'

const handler = typeof bundle === 'function' ? bundle : bundle.default

export default handler
