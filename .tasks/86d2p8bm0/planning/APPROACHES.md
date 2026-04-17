# Proposed approaches

## Approach 1: Simple timestamp array with module-level store

A single middleware file `src/middleware/rateLimiter.js` that maintains a module-level `Map<string, number[]>` mapping each IP to its array of request timestamps. On each request, it prunes timestamps older than the window, counts the remainder, and either calls `next()` or responds with 429. A `setInterval` sweep runs every 5 minutes to evict IPs with no recent activity, preventing unbounded memory growth.

- **dummy-gateway**:
  - **New: `src/middleware/rateLimiter.js`** — Exports a single middleware function. Uses `req.ip` for client identification. Reads `rateLimitMax` (default 100) and `rateLimitWindowMs` (default 60000) from `../config`. On each request: filter the IP's timestamp array to keep only entries within the window, push `Date.now()`, compare length against limit. If over limit, respond `res.status(429).json({ error: "Rate limit exceeded" })` with `Retry-After` header set to `Math.ceil((oldestTimestampInWindow + windowMs - Date.now()) / 1000)`. Includes a cleanup interval and an exported `_resetStore()` for tests.
  - **Modified: `src/config.js`** — Add `rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX, 10) || 100` and `rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60000`.
  - **Modified: `src/index.js`** — Import `rateLimiter` and add `app.use(rateLimiter)` between `app.use(express.json())` and `app.use(auth)`.
  - **New: `tests/rateLimiter.test.js`** — Separate test file following existing supertest pattern. Tests: (1) request under limit returns 200, (2) 101st request returns 429 with `Retry-After` header and `{"error": "..."}` body, (3) window reset after 1 minute (use `jest.useFakeTimers()` to advance time). Calls `_resetStore()` in `beforeEach` for isolation.
  - **Modified: `.env.example`** — Add `RATE_LIMIT_MAX=100` and `RATE_LIMIT_WINDOW_MS=60000`.
  - **New: `README.md`** — Create a root README documenting setup, usage, and rate limiting behavior (429 response, Retry-After header, limits, per-IP scope).

**Tradeoffs:** Simplest to implement and understand. The `_resetStore()` escape hatch is slightly inelegant but pragmatic for test isolation. The timestamp array is O(n) per request where n is the request count for that IP within the window — at 100 requests/minute this is trivial. Module-level state means the store is a singleton, which is fine for this service but makes it harder to swap to Redis later.

## Approach 2: Factory function with injectable store (recommended)

`src/middleware/rateLimiter.js` exports a `createRateLimiter(options?)` factory that returns an Express middleware. The factory accepts optional overrides for `limit`, `windowMs`, and `store` (defaults to an internal `Map`). This lets tests create isolated middleware instances with fresh stores and custom limits, avoiding shared state between test suites. The app wires it up as `app.use(createRateLimiter())`, which reads defaults from `config.js`.

- **dummy-gateway**:
  - **New: `src/middleware/rateLimiter.js`** — Exports `createRateLimiter({ limit?, windowMs?, store? })`. Internally creates a `Map<string, number[]>` if no store is provided. The returned middleware function is identical to Approach 1's logic (prune, count, accept/reject). Defaults come from `require('../config').rateLimitMax` and `rateLimitWindowMs`. Includes periodic cleanup `setInterval` (attached to the returned middleware as `middleware.cleanup` so it can be cleared in tests).
  - **Modified: `src/config.js`** — Same as Approach 1: add `rateLimitMax` and `rateLimitWindowMs`.
  - **Modified: `src/index.js`** — `const rateLimiter = require('./middleware/rateLimiter'); app.use(rateLimiter());` inserted before `app.use(auth)`. The factory call with no args uses config defaults.
  - **New: `tests/rateLimiter.test.js`** — Each test creates its own middleware instance via `createRateLimiter({ limit: 5, windowMs: 1000 })` on a minimal Express app, giving full isolation without `_resetStore()` hacks. Tests: (1) request under limit passes, (2) request over limit returns 429 with correct error shape and `Retry-After` header, (3) window reset via `jest.useFakeTimers()`. Can also add a test that verifies the factory reads config defaults.
  - **Modified: `.env.example`** — Same as Approach 1.
  - **New: `README.md`** — Same as Approach 1.

**Tradeoffs:** Slightly more code (~10 extra lines for the factory wrapper), but significantly better testability — no shared mutable state between tests, no need for reset helpers. The injectable store also provides a natural extension point if Redis is ever needed (pass a Redis-backed store object with the same `get`/`set`/`delete` interface). The factory pattern is idiomatic in Express middleware (e.g., `cors()`, `helmet()`). Marginally more complex to read for a newcomer, but the pattern is well-known.

## Approach 3: Sliding window counter approximation (two fixed windows)

Instead of storing individual timestamps, track two fixed-window counters per IP: the current window's count and the previous window's count. Estimate the sliding window count as `prevCount * overlapFraction + currCount`. This gives O(1) time and constant memory per IP, at the cost of being an approximation (up to ~15% variance at window boundaries). Used in production by Cloudflare and others.

- **dummy-gateway**:
  - **New: `src/middleware/rateLimiter.js`** — Each IP maps to `{ prevCount, currCount, windowStart }`. On request: if current time is past `windowStart + windowMs`, rotate (`prevCount = currCount`, `currCount = 0`, advance `windowStart`). Compute `weight = (windowStart + windowMs - now) / windowMs`, then `estimate = prevCount * weight + currCount`. Compare estimate against limit. `Retry-After` is calculated from the current window boundary.
  - All other file changes identical to Approach 2 (factory pattern recommended here too).

**Tradeoffs:** Best performance characteristics — O(1) time, ~48 bytes per IP vs. unbounded array. However, the approximation makes tests non-deterministic at edge cases, and the task explicitly says "sliding window" which most naturally reads as exact. The algorithmic complexity is harder to reason about and debug. Overkill for an in-memory gateway handling modest traffic; the timestamp array (Approaches 1/2) won't hit performance issues at 100 req/min/IP.

## Recommendation

**Approach 2** (factory with injectable store). It follows Express middleware conventions (`cors()`, `morgan()`, etc.), provides clean test isolation without test-only escape hatches, and positions the codebase for a future Redis migration at near-zero additional complexity over Approach 1. The exact sliding window algorithm (timestamp array) is the right choice given the stated requirements and traffic scale. Approach 3's approximation adds complexity without meaningful benefit at this scale.
