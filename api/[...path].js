// Kept in api/ so Vercel always discovers this as a Serverless Function.
// `npm run build` writes the self-contained Hono bundle it forwards to.
import bundle from '../server/function-bundle.cjs'

// esbuild CJS output interop: the module itself IS the export table
// ({ default: handler }), but a plain `module.exports = handler` bundle
// would arrive here as the function directly. Accept both shapes.
const handler = typeof bundle === 'function' ? bundle : bundle.default

export default handler
