# Implementation Plan: Rate Limiting Middleware (Task 86d2p8bm0)

## Approved Approach
Approach 1: Sliding Window Rate Limiter — in-memory Map of IP → timestamp[], zero external dependencies.

## Steps

### 1. `src/config.js`
Add two new config entries sourced from env vars:
- `rateLimitWindowMs` (default 60000) from `RATE_LIMIT_WINDOW_MS`
- `rateLimitMax` (default 100) from `RATE_LIMIT_MAX`

### 2. `src/middleware/rateLimit.js` (new file)
Sliding window algorithm:
- Module-level `Map<ip, number[]>` (timestamps).
- Each request: prune timestamps older than `now - windowMs`, check count >= max.
- Over limit: respond HTTP 429 JSON `{"error":"Too Many Requests"}` + `Retry-After` header (seconds until oldest ts + windowMs).
- Under limit: push `Date.now()`, set `X-RateLimit-Limit` and `X-RateLimit-Remaining` headers, call `next()`.
- Export `{ rateLimit, _resetStore }` — `_resetStore` clears the Map for test isolation.
- Client IP resolved via `req.ip` (Express uses `X-Forwarded-For` when trust proxy set, or falls back to socket address).

### 3. `src/index.js`
- Import `rateLimit` from `./middleware/rateLimit`.
- Wire `app.use(rateLimit)` BEFORE `app.use(auth)`.

### 4. `tests/rateLimit.test.js` (new file)
Jest + supertest tests using fake timers:
- `beforeEach`: call `_resetStore()` to reset state between tests.
- **Test 1**: Single request with valid API key → 200.
- **Test 2**: Send 101 requests in the same window → 101st returns 429 with `Retry-After` header.
- **Test 3**: Send 100 requests, advance fake timer by 60001ms, send one more → 200 (window reset).

### 5. `README.md` (new file)
Document: project overview, setup, run, test, and rate limiting behaviour (limits, headers, env var config).

### 6. `.env.example`
Add `RATE_LIMIT_WINDOW_MS=60000` and `RATE_LIMIT_MAX=100`.

## Commit & PR
- Single commit: `feat(middleware): add sliding window rate limiting middleware`
- Branch already exists: `claude/86d2p8bm0`
- Open PR against `main`.
