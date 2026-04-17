# Context: Rate Limiting Middleware

## Repo: dummy-gateway

### Key files

- **`src/index.js`** (lines 1-18): Express app. Middleware is mounted at line 9 (`app.use(auth)`) before routes. The rate limiter must be inserted *before* `app.use(auth)` — i.e., between `app.use(express.json())` (line 8) and `app.use(auth)` (line 9). The app is exported for supertest use.

- **`src/config.js`** (lines 1-8): Centralized env config using `dotenv`. Exports `port`, `usersServiceUrl`, `notificationsServiceUrl`, `apiKey`. Rate limit settings (`rateLimitMax`, `rateLimitWindowMs`) must be added here per repo conventions (never read `process.env` directly in middleware).

- **`src/middleware/auth.js`** (lines 1-11): Existing middleware pattern to follow. Synchronous function, reads config from `../config`, returns 401 JSON `{"error": "..."}` on failure, calls `next()` on success. Convention: one file per middleware.

- **`tests/middleware.test.js`** (lines 1-25): Existing test pattern. Uses `supertest` against the app, sets `process.env.API_KEY` before requiring app, manages server lifecycle with `beforeAll`/`afterAll`. New rate limiter tests can follow this pattern or go in a separate file.

- **`.env.example`** (lines 1-4): Lists all env vars. Must be updated with `RATE_LIMIT_MAX` and `RATE_LIMIT_WINDOW_MS`.

- **`package.json`**: Dependencies are `express`, `axios`, `dotenv`. Dev deps are `jest`, `supertest`. No additional dependencies needed for in-memory rate limiting.

### Missing file

- **No `README.md`** at repo root. Task says "update README" but none exists. A new `README.md` must be created (or the task interpreted as updating `CLAUDE.md`, though creating a proper README is more conventional).

### Conventions (from CLAUDE.md)

- Async/await, no callbacks
- All env config via `src/config.js`
- Error shape: `{"error": "<message>"}`
- One file per middleware, one file per route group

### IP extraction

Express `req.ip` returns the client IP. In production behind a proxy, `app.set('trust proxy', ...)` may be needed, but the task doesn't mention proxy support — `req.ip` is sufficient.
