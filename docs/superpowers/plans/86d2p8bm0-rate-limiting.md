# Implementation Plan: Rate Limiting Middleware (Approach C — Configurable Middleware Factory)

**Task ID:** 86d2p8bm0
**Spec:** `docs/superpowers/specs/86d2p8bm0-rate-limiting.md`
**Approved approach:** C (Configurable Middleware Factory)
**Repo:** `dummy-gateway`

---

## Overview

Five files touched (2 new, 3 modified). No new dependencies. Steps are ordered so the codebase compiles and tests pass after each step.

| # | File | Action | Lines changed (approx) |
|---|------|--------|----------------------|
| 1 | `src/config.js` | Modify | +2 |
| 2 | `src/middleware/rateLimit.js` | **Create** | ~55 |
| 3 | `src/index.js` | Modify | +3 |
| 4 | `tests/rateLimit.test.js` | **Create** | ~90 |
| 5 | `CLAUDE.md` | Modify | +12 |

---

## Step 1: Add rate-limit config values to `src/config.js`

**File:** `src/config.js`
**Why first:** Other files depend on these config values. Adding them first means no forward references.

**Change:** Add two new properties to the exported object, after `apiKey`:

```js
// After line 7 (apiKey line), add:
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60000,
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX, 10) || 100,
```

**Full file after edit:**
```js
require('dotenv').config();

module.exports = {
  port: process.env.PORT || 3000,
  usersServiceUrl: process.env.USERS_SERVICE_URL || 'http://localhost:3001',
  notificationsServiceUrl: process.env.NOTIFICATIONS_SERVICE_URL || 'http://localhost:3002',
  apiKey: process.env.API_KEY || 'dev-secret',
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60000,
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX, 10) || 100,
};
```

**Validation:** Existing tests still pass (`npm test`) — additive change only.

---

## Step 2: Create `src/middleware/rateLimit.js`

**File:** `src/middleware/rateLimit.js` (new)
**Why:** Core deliverable. Must be created before wiring into `index.js`.

### Function signature

```js
function createRateLimiter({ windowMs, max })
```

Returns an Express middleware function `(req, res, next)` with an attached `destroy()` method.

### Internal data structures

- `const hits = new Map();` — `Map<string, number[]>` where key = IP address, value = array of request timestamps (epoch ms).
- `const cleanupInterval = setInterval(cleanup, windowMs)` — periodic sweep that deletes entries whose newest timestamp is older than `windowMs` ago. Call `cleanupInterval.unref()` so it doesn't keep the Node.js process alive.

### Middleware logic (pseudocode)

```
1. const ip = req.ip
2. const now = Date.now()
3. let timestamps = hits.get(ip) || []
4. timestamps = timestamps.filter(t => t > now - windowMs)   // slide the window
5. if (timestamps.length >= max):
6.     const retryAfter = Math.ceil((timestamps[0] + windowMs - now) / 1000)
7.     res.set('Retry-After', String(retryAfter))
8.     return res.status(429).json({ error: 'Rate limit exceeded' })
9. timestamps.push(now)
10. hits.set(ip, timestamps)
11. next()
```

### `destroy()` method

```js
middleware.destroy = () => {
  clearInterval(cleanupInterval);
  hits.clear();
};
```

Attached to the middleware function object so callers (tests, graceful shutdown) can clean up.

### `cleanup()` function

```js
function cleanup() {
  const cutoff = Date.now() - windowMs;
  for (const [ip, timestamps] of hits) {
    if (timestamps[timestamps.length - 1] <= cutoff) {
      hits.delete(ip);
    }
  }
}
```

Only deletes entries where the *newest* timestamp is expired. Active IPs keep their arrays (which get filtered on the next request anyway).

### Complete file

```js
'use strict';

function createRateLimiter({ windowMs = 60000, max = 100 } = {}) {
  const hits = new Map();

  const cleanupInterval = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [ip, timestamps] of hits) {
      if (timestamps[timestamps.length - 1] <= cutoff) {
        hits.delete(ip);
      }
    }
  }, windowMs);
  cleanupInterval.unref();

  function middleware(req, res, next) {
    const ip = req.ip;
    const now = Date.now();
    let timestamps = hits.get(ip) || [];
    timestamps = timestamps.filter(t => t > now - windowMs);

    if (timestamps.length >= max) {
      const retryAfter = Math.ceil((timestamps[0] + windowMs - now) / 1000);
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({ error: 'Rate limit exceeded' });
    }

    timestamps.push(now);
    hits.set(ip, timestamps);
    next();
  }

  middleware.destroy = () => {
    clearInterval(cleanupInterval);
    hits.clear();
  };

  return middleware;
}

module.exports = createRateLimiter;
```

**Validation:** File requires cleanly (`node -e "require('./src/middleware/rateLimit')"`). No runtime side effects until called.

---

## Step 3: Wire rate limiter into `src/index.js`

**File:** `src/index.js`
**Why:** Connects the middleware to the Express pipeline. Must come after Step 2.

### Changes

1. **Line 2 (after `const auth = ...`):** Add require for the factory:
   ```js
   const createRateLimiter = require('./middleware/rateLimit');
   ```

2. **Line 9 (after `app.use(express.json());`, BEFORE `app.use(auth);`):** Create and mount the limiter:
   ```js
   app.use(createRateLimiter({ windowMs: config.rateLimitWindowMs, max: config.rateLimitMax }));
   ```

### Full file after edit

```js
const express = require('express');
const auth = require('./middleware/auth');
const createRateLimiter = require('./middleware/rateLimit');
const usersRouter = require('./routes/users');
const notificationsRouter = require('./routes/notifications');
const config = require('./config');

const app = express();
app.use(express.json());
app.use(createRateLimiter({ windowMs: config.rateLimitWindowMs, max: config.rateLimitMax }));
app.use(auth);
app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.use('/users', usersRouter);
app.use('/notifications', notificationsRouter);

if (require.main === module) {
  app.listen(config.port, () => console.log(`Gateway on :${config.port}`));
}

module.exports = app;
```

### Middleware order verification

The pipeline is now:
```
express.json() → rateLimit → auth → routes
```

This ensures rate limiting fires **before** auth, so brute-force API key attacks are throttled.

**Validation:** `npm test` — existing tests should still pass. The default limit is 100 req/min. The existing test files make 3-5 requests each, well under the limit. The rate limiter instance is shared across all test files via module caching of `src/index.js`, but with only ~12 total requests in the suite, there is no interference.

---

## Step 4: Create `tests/rateLimit.test.js`

**File:** `tests/rateLimit.test.js` (new)
**Why:** Satisfies the testing requirement. Creates isolated limiter instances via the factory — no shared state with other test files.

### Test strategy

The tests use the factory directly with **small limits** (`max: 3`) for efficiency rather than literally sending 101 requests. This validates the same boundary behavior (Nth request passes, N+1th is rejected) without slow test execution.

Use `jest.useFakeTimers()` to test window expiry without waiting 60 real seconds. Each test creates a fresh Express app with its own `createRateLimiter` instance, so tests are fully isolated.

### Test structure

```js
process.env.API_KEY = 'test-key';
const express = require('express');
const request = require('supertest');
const createRateLimiter = require('../src/middleware/rateLimit');

function createApp(opts) {
  const app = express();
  const limiter = createRateLimiter(opts);
  app.use(limiter);
  app.get('/test', (_req, res) => res.json({ ok: true }));
  return { app, limiter };
}
```

### Test cases

#### Test 1: Normal request passes through
```js
it('allows requests under the limit', async () => {
  const { app, limiter } = createApp({ windowMs: 60000, max: 3 });
  const res = await request(app).get('/test');
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ ok: true });
  limiter.destroy();
});
```
**Maps to requirement:** "normal request passes"

#### Test 2: Request exceeding limit is rejected with 429
```js
it('rejects requests over the limit with 429 and Retry-After', async () => {
  const { app, limiter } = createApp({ windowMs: 60000, max: 3 });
  // Send 3 allowed requests
  for (let i = 0; i < 3; i++) {
    const res = await request(app).get('/test');
    expect(res.status).toBe(200);
  }
  // 4th request should be rejected
  const res = await request(app).get('/test');
  expect(res.status).toBe(429);
  expect(res.body).toEqual({ error: 'Rate limit exceeded' });
  expect(res.headers['retry-after']).toBeDefined();
  const retryAfter = parseInt(res.headers['retry-after'], 10);
  expect(retryAfter).toBeGreaterThan(0);
  expect(retryAfter).toBeLessThanOrEqual(60);
  limiter.destroy();
});
```
**Maps to requirement:** "101st request in window is rejected" (validated with max=3, 4th request)

#### Test 3: Window resets after expiry
```js
it('resets the window after the time period elapses', async () => {
  jest.useFakeTimers();
  const { app, limiter } = createApp({ windowMs: 60000, max: 3 });
  // Exhaust the limit
  for (let i = 0; i < 3; i++) {
    await request(app).get('/test');
  }
  // Verify blocked
  let res = await request(app).get('/test');
  expect(res.status).toBe(429);
  // Advance time past the window
  jest.advanceTimersByTime(60001);
  // Should be allowed again
  res = await request(app).get('/test');
  expect(res.status).toBe(200);
  limiter.destroy();
  jest.useRealTimers();
});
```
**Maps to requirement:** "window resets after 1 minute"

#### Test 4: Retry-After header value is correct
```js
it('returns correct Retry-After seconds', async () => {
  jest.useFakeTimers();
  const { app, limiter } = createApp({ windowMs: 60000, max: 1 });
  await request(app).get('/test');  // uses up the limit
  jest.advanceTimersByTime(30000);  // advance 30 seconds
  const res = await request(app).get('/test');
  expect(res.status).toBe(429);
  // Original request was at t=0, window is 60s, we're at t=30s → ~30s remaining
  const retryAfter = parseInt(res.headers['retry-after'], 10);
  expect(retryAfter).toBe(30);
  limiter.destroy();
  jest.useRealTimers();
});
```
**Maps to requirement:** `Retry-After` header correctness

#### Test 5: Different IPs are tracked independently
```js
it('tracks IPs independently', async () => {
  const app = express();
  app.set('trust proxy', true);
  const limiter = createRateLimiter({ windowMs: 60000, max: 1 });
  app.use(limiter);
  app.get('/test', (_req, res) => res.json({ ok: true }));

  // First IP exhausts limit
  let res = await request(app).get('/test').set('X-Forwarded-For', '1.1.1.1');
  expect(res.status).toBe(200);
  res = await request(app).get('/test').set('X-Forwarded-For', '1.1.1.1');
  expect(res.status).toBe(429);

  // Second IP is unaffected
  res = await request(app).get('/test').set('X-Forwarded-For', '2.2.2.2');
  expect(res.status).toBe(200);
  limiter.destroy();
});
```

#### Test 6: Error response shape follows convention
```js
it('returns error in standard JSON shape', async () => {
  const { app, limiter } = createApp({ windowMs: 60000, max: 1 });
  await request(app).get('/test');
  const res = await request(app).get('/test');
  expect(res.status).toBe(429);
  expect(res.body).toEqual({ error: 'Rate limit exceeded' });
  expect(res.headers['content-type']).toMatch(/json/);
  limiter.destroy();
});
```

### Important: `jest.useFakeTimers()` interaction with Supertest

`jest.useFakeTimers()` replaces `Date.now()` and timer functions. Supertest's internal HTTP handling may have issues with fake timers in some configurations. If the implementer encounters hanging tests:
- Scope `jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] })` to avoid faking Node.js internals Supertest depends on.
- Alternatively, use `jest.spyOn(Date, 'now')` instead of full fake timers for the window-reset test.

### `destroy()` calls

Every test must call `limiter.destroy()` in either the test body or `afterEach` to prevent Jest open-handle warnings from lingering `setInterval` timers.

**Validation:** `npm test` — all new tests pass, all existing tests still pass.

---

## Step 5: Update `CLAUDE.md` with rate limiting documentation

**File:** `CLAUDE.md`
**Why:** Task requirement R7. This file serves as the project's README.

**Change:** Add a new section after "## Test" and before "## Conventions":

```markdown
## Rate Limiting

All routes are rate-limited per client IP address.

- **Limit:** 100 requests per minute (sliding window)
- **Scope:** Per IP, applied globally before authentication
- **Algorithm:** In-memory sliding window (timestamp array per IP)
- **429 response:** `{"error": "Rate limit exceeded"}` with `Retry-After` header (seconds until the window has capacity)
- **No external dependencies:** State is held in process memory. Resets on restart. Not shared across instances.

Override defaults via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `RATE_LIMIT_WINDOW_MS` | `60000` | Sliding window duration in milliseconds |
| `RATE_LIMIT_MAX` | `100` | Maximum requests per window per IP |
```

**Validation:** Visual review. No code impact.

---

## Execution Checklist

| # | Step | Files | Verify |
|---|------|-------|--------|
| 1 | Add config values | `src/config.js` | `npm test` passes (additive change) |
| 2 | Create rate limit factory | `src/middleware/rateLimit.js` | `node -e "require('./src/middleware/rateLimit')"` loads cleanly |
| 3 | Wire into Express pipeline | `src/index.js` | `npm test` passes (existing tests unaffected at 100 req/min) |
| 4 | Create rate limit tests | `tests/rateLimit.test.js` | `npm test` — all 6 new tests pass, all existing tests pass |
| 5 | Update README | `CLAUDE.md` | Visual review |

---

## Edge Cases the Implementer Should Watch For

1. **Fake timers + Supertest:** If tests hang, use `jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] })` to avoid faking Node internals that Supertest's HTTP stack relies on.

2. **`req.ip` in tests:** Supertest makes requests over `127.0.0.1`. All requests in a single test share the same IP. This is correct for per-IP testing but means the IP-independence test (Test 5) must use `X-Forwarded-For` with `trust proxy` enabled.

3. **Module caching:** `require('../src/index')` returns the same cached `app` instance across test files. The rate limiter mounted on this app persists across test files run in the same worker. With the default 100 req/min limit and ~12 total requests across the existing suite, this won't cause failures. But if the test suite grows substantially, the implementer should consider `jest.isolateModules()` or creating fresh app instances in test setup.

4. **Cleanup interval `unref()`:** The `cleanupInterval.unref()` call is critical. Without it, the Node process won't exit cleanly because the interval keeps the event loop alive. The `destroy()` method provides explicit cleanup, but `unref()` is the safety net for the production server where `destroy()` isn't called.

5. **Integer parsing in config:** `parseInt(..., 10)` with the radix parameter is required. Without it, leading-zero strings like `"010"` would be interpreted as octal in some engines (though modern V8 handles this correctly, explicit radix is defensive).

---

## What Is NOT In Scope

Per the spec's open questions (all decided as out-of-scope):
- `trust proxy` configuration (existing concern, not introduced by this task)
- `/health` endpoint exemption from rate limiting
- Informational `X-RateLimit-*` headers on successful responses
