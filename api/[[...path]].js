// Kept in api/ so Vercel always discovers this as a Serverless Function.
// `npm run build` writes the self-contained Hono bundle it forwards to.
import bundle from '../server/function-bundle.cjs'

export default bundle.default
