# Spec: Request Rate Limiting Middleware

**Task ID:** 86d2p8bm0
**Repo:** dummy-gateway
**Date:** 2026-04-17

---

## 1. Context & Current State

`dummy-gateway` is a lightweight Express 4 API gateway (Node.js 20, CommonJS) that validates an `X-API-Key` header and proxies requests to `dummy-users` and `dummy-notifications` services.

**Current middleware pipeline** (`src/index.js`):
```
express.json() → auth → routes (/health, /users, /notifications)
```

**Conventions observed:**
- One file per middleware (`src/middleware/auth.js`)
- All env config centralized in `src/config.js` (never read `process.env` directly in routes)
- Error shape: `{"error": "<message>"}`
- Tests use Jest + Supertest; one test file per middleware/route group
- Async/await throughout, no callbacks

**Key constraint:** Rate limiting must be applied **globally before auth**, so an attacker brute-forcing API keys is rate-limited before the auth middleware even runs.

---

## 2. Requirements (from task)

| # | Requirement |
|---|-------------|
| R1 | Per-IP rate limiting on all routes |
| R2 | Sliding window algorithm, in-memory (no Redis/external deps) |
| R3 | Limit: 100 requests per minute per IP |
| R4 | HTTP 429 response with `Retry-After` header (seconds until window resets) when exceeded |
| R5 | Middleware applied globally before auth |
| R6 | Jest tests: normal pass, 101st rejected, window resets after 1 minute |
| R7 | Update README (CLAUDE.md) with rate limiting behaviour |

---

## 3. Technical Decisions (common to all approaches)

### Sliding window implementation
Use a **timestamp array** per IP: `Map<string, number[]>`. On each request, filter out entries older than 60 seconds, push the current timestamp, and check array length against the limit. This is a true sliding window (not an approximation) and trivial to reason about at the 100 req/min scale this service operates at.

### IP extraction
Use `req.ip` (Express built-in, respects `trust proxy` setting). Falls back to `req.socket.remoteAddress` in degenerate cases.

### Memory management
Stale entries (IPs with no requests in >60s) accumulate in the Map. A periodic cleanup interval (every 60s) scans the Map and deletes expired entries. The cleanup interval must be clearable in tests and on process shutdown to avoid Jest open-handle warnings.

### Retry-After calculation
When a request is rejected, `Retry-After` = ceiling of seconds remaining until the oldest timestamp in the current window expires (i.e., `Math.ceil((oldestTimestamp + 60000 - Date.now()) / 1000)`). This tells the client the earliest moment the window will have room.

### Response format
Follows existing convention: `{ "error": "Rate limit exceeded" }` with status 429.

---

## 4. Approaches

### Approach A: Monolithic Middleware File

**What:** Everything in a single `src/middleware/rateLimit.js` file — the Map, the sliding-window logic, the cleanup timer, and the Express middleware function — mirroring the structure of `auth.js`.

**Changes:**
| File | Change |
|------|--------|
| `src/middleware/rateLimit.js` | **New.** Exports Express middleware. Contains the `Map<string, number[]>`, sliding window check, cleanup `setInterval`, and a `_reset()` helper exported for tests. |
| `src/config.js` | Add `rateLimitWindowMs` (default `60000`) and `rateLimitMax` (default `100`). |
| `src/index.js` | Add `const rateLimit = require('./middleware/rateLimit');` and insert `app.use(rateLimit);` **before** `app.use(auth);`. |
| `tests/rateLimit.test.js` | **New.** Jest + Supertest tests. Uses `jest.useFakeTimers()` for window-reset test. Calls `_reset()` in `beforeEach` to clear state between tests. |
| `CLAUDE.md` | Add "Rate Limiting" section documenting 100 req/min per-IP, 429 behavior, `Retry-After` header. |

**Tradeoffs:**
- **Pro:** Minimal file count; follows the existing auth.js pattern exactly; lowest cognitive overhead for someone reading the codebase.
- **Pro:** No new architectural patterns to learn — anyone who understands `auth.js` understands this.
- **Con:** The sliding window logic, cleanup timer, and middleware function are all tangled together. Unit-testing the windowing algorithm in isolation requires reaching into module internals (the exported `_reset()` helper is a code smell).
- **Con:** If a second rate-limiting tier is needed later (e.g., per-API-key limits), the file would need significant refactoring.
- **Performance:** The timestamp array filter is O(n) per request where n = requests in window. At 100 req/min/IP this is negligible. The cleanup timer adds one Map scan per minute — also negligible.
- **Blast radius:** Small. Two lines added to `index.js`, one new middleware file, config additions are additive.

---

### Approach B: Separate RateLimiter Class + Thin Middleware

**What:** Extract the sliding-window algorithm into a standalone `SlidingWindowCounter` class in its own module. The middleware file becomes a thin wrapper that instantiates the class and calls it.

**Changes:**
| File | Change |
|------|--------|
| `src/rateLimiter.js` | **New.** Exports `SlidingWindowCounter` class with methods: `constructor({ windowMs, max })`, `hit(key): { allowed: boolean, retryAfterSecs: number }`, `reset()`, `destroy()` (clears cleanup interval). No Express dependency. |
| `src/middleware/rateLimit.js` | **New.** 10-15 line file. Imports `SlidingWindowCounter` and `config`. Creates instance. Exports middleware that calls `limiter.hit(req.ip)` and either calls `next()` or sends 429. |
| `src/config.js` | Add `rateLimitWindowMs` (default `60000`) and `rateLimitMax` (default `100`). |
| `src/index.js` | Same as Approach A: `app.use(rateLimit)` before `app.use(auth)`. |
| `tests/rateLimiter.test.js` | **New.** Pure unit tests for `SlidingWindowCounter` — no HTTP, no Supertest. Tests `hit()` returns, window expiry with fake timers, memory cleanup. |
| `tests/rateLimit.test.js` | **New.** Integration tests via Supertest: 429 status code, `Retry-After` header, interaction with auth middleware ordering. |
| `CLAUDE.md` | Same as Approach A. |

**Tradeoffs:**
- **Pro:** Clean separation of concerns. The windowing algorithm is independently testable without HTTP overhead. Pure unit tests for `SlidingWindowCounter` run faster and cover edge cases more precisely.
- **Pro:** The `SlidingWindowCounter` class is reusable — if per-API-key rate limiting is needed later, create a second instance keyed on `req.headers['x-api-key']`.
- **Con:** More files (4 new vs 2 new). Slightly more architectural overhead for what is currently a simple gateway.
- **Con:** Introduces a class-based pattern that doesn't exist anywhere else in this codebase (everything is functional/module-level). This is a minor style inconsistency.
- **Performance:** Identical to Approach A at runtime. Test suite runs slightly faster due to pure unit tests avoiding HTTP setup.
- **Blast radius:** Same production blast radius as A. Test surface is larger (two test files), but each file is focused and easier to maintain.

---

### Approach C: Configurable Middleware Factory

**What:** Export a factory function `createRateLimiter(options)` from the middleware file, similar to how `express-rate-limit` works. The factory returns a configured Express middleware. `src/index.js` calls the factory with config values.

**Changes:**
| File | Change |
|------|--------|
| `src/middleware/rateLimit.js` | **New.** Exports `createRateLimiter({ windowMs, max })` factory function. Each call creates its own `Map` and cleanup interval. Returns an Express middleware function. Also attaches a `destroy()` method to the returned function for cleanup. |
| `src/config.js` | Add `rateLimitWindowMs` (default `60000`) and `rateLimitMax` (default `100`). |
| `src/index.js` | `const createRateLimiter = require('./middleware/rateLimit');` then `app.use(createRateLimiter({ windowMs: config.rateLimitWindowMs, max: config.rateLimitMax }));` before auth. |
| `tests/rateLimit.test.js` | **New.** Tests create their own limiter instance via the factory with a small window (e.g., `{ windowMs: 1000, max: 2 }`) for fast tests. No shared state between tests. Uses fake timers for window-reset test. |
| `CLAUDE.md` | Same as Approach A. |

**Tradeoffs:**
- **Pro:** Each test creates an independent limiter instance — no `_reset()` hacks, no shared mutable state. Tests are fully isolated by design.
- **Pro:** The factory pattern is well-known in the Express ecosystem (cors, helmet, express-rate-limit all work this way). Developers expect this shape.
- **Pro:** Easily supports future needs: different limits per route group, or a stricter limiter on auth endpoints.
- **Con:** Slightly more complex wiring in `index.js` (factory call with config object vs. a simple `require`).
- **Con:** The `destroy()` method hanging off the middleware function is idiomatic Express but looks odd to developers unfamiliar with the pattern.
- **Performance:** Identical runtime performance. Test performance is good — isolated instances mean no inter-test state leakage.
- **Blast radius:** Same as A/B for production. The factory pattern is slightly more future-proof, reducing blast radius of future rate-limiting changes.

---

## 5. Recommendation

**Approach C (Configurable Middleware Factory)** is the strongest choice. It matches Express ecosystem conventions, gives tests full isolation without hacks, and costs only marginally more complexity than Approach A. The factory pattern makes the middleware naturally extensible without requiring the class-based overhead of Approach B.

If simplicity is the top priority and no future rate-limiting tiers are anticipated, **Approach A** is also perfectly acceptable — it's the smallest diff and matches the existing code style exactly.

---

## 6. Open Questions (non-blocking)

These are observations, not blockers. The task requirements are clear enough to proceed with any approach.

1. **`trust proxy` setting:** The app does not currently call `app.set('trust proxy', ...)`. If the gateway runs behind a load balancer/reverse proxy, `req.ip` will return the proxy's IP, not the client's. This is an existing concern (not introduced by this task) but worth noting. Should we add a `trust proxy` config? *(Suggestion: out of scope — document as a known limitation in the README section.)*

2. **Health endpoint exemption:** Should `/health` be exempt from rate limiting? Kubernetes liveness/readiness probes hitting `/health` would consume rate-limit quota. *(Suggestion: not exempt per task requirements "all routes", but flag for product review.)*

3. **Rate limit headers on success:** Some APIs include `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset` headers on every response (not just 429s). The task only specifies `Retry-After` on 429. Should we add informational headers on 200s too? *(Suggestion: out of scope per task wording.)*
