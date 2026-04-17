# Implementation Plan: Per-IP Rate Limiting Middleware (Approach 2)

## Summary

Add a sliding-window, per-IP rate limiting middleware to `dummy-gateway` using a factory-function pattern for clean test isolation. Limit: 100 requests/minute/IP. Exceeding the limit → HTTP 429 with `Retry-After` header.

---

## File Changes

### 1. `src/config.js` (modify)
Add two new config keys sourced from environment variables:
- `rateLimitMax` — max requests per window, defaults to 100
- `rateLimitWindowMs` — window size in ms, defaults to 60 000 (1 minute)

### 2. `src/middleware/rateLimiter.js` (new)
Export `createRateLimiter(options?)` factory:
- `options.limit` — overrides `config.rateLimitMax`
- `options.windowMs` — overrides `config.rateLimitWindowMs`
- `options.store` — optional injectable `Map`; defaults to a new internal `Map<string, number[]>`
- Returns an Express middleware function that:
  1. Looks up `req.ip` in the store
  2. Filters timestamps to keep only those within the current window
  3. Pushes `Date.now()` to the list
  4. If `timestamps.length > limit` → respond 429 with `{"error": "Rate limit exceeded"}` and `Retry-After` header (seconds until oldest in-window timestamp expires)
  5. Otherwise calls `next()`
- Attaches a `setInterval` cleanup (every 5 min, evicts empty IPs) as `middleware.cleanup` so tests can `clearInterval` it

### 3. `src/index.js` (modify)
- Import `createRateLimiter`
- Insert `app.use(createRateLimiter())` between `app.use(express.json())` and `app.use(auth)`

### 4. `tests/rateLimiter.test.js` (new)
Three test cases, each with its own Express app + `createRateLimiter({ limit: 5, windowMs: 1000 })` instance for isolation:
1. **Under limit** — 5 requests all return 200
2. **Over limit** — 6th request returns 429 with `{"error": "Rate limit exceeded"}` body and a positive integer `Retry-After` header
3. **Window reset** — fill to limit, reject, advance fake time past window, verify next request passes

Lifecycle: `beforeEach` creates fresh app + server, `afterEach` clears cleanup interval, closes server, restores real timers.

### 5. `.env.example` (modify)
Add:
```
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW_MS=60000
```

### 6. `README.md` (new)
Document: prerequisites, installation, `.env` setup, running (`npm start`), testing (`npm test`), rate limiting behavior (limit, window, 429 response shape, `Retry-After` header, per-IP scope).

---

## Order of Operations

1. Update `src/config.js`
2. Create `src/middleware/rateLimiter.js`
3. Update `src/index.js`
4. Create `tests/rateLimiter.test.js`
5. Update `.env.example`
6. Create `README.md`
7. Run tests locally to verify
8. Commit and push
9. Open PR
