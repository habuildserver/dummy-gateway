# Rate Limiting Middleware Implementation Plan

> **For agentic workers:** Implement this plan task-by-task using TDD. Each task is one commit. Steps use checkbox (`- [ ]`) syntax for tracking. Spec: `docs/specs/86d2p8bm0-rate-limiting.md`.

**Goal:** Add per-IP sliding-window rate limiting (100 requests / 60 seconds) to `dummy-gateway`, applied globally before auth, returning HTTP 429 + `Retry-After` on excess.

**Architecture:** A new middleware factory `createRateLimiter({ windowMs, max, now })` lives in `src/middleware/rateLimit.js`. It tracks per-IP request timestamps in a module-scoped `Map<string, number[]>`. On each request it filters out expired timestamps, rejects when the count exceeds `max`, otherwise records the request and calls `next()`. A lazy sweep reclaims memory from idle IPs.

**Tech Stack:** Node.js, Express 4, Jest 29, supertest 6. No new dependencies.

## File Map

| Path | Action | Purpose |
| --- | --- | --- |
| `src/middleware/rateLimit.js` | create | Middleware factory. |
| `src/config.js` | edit | Add `rateLimitMax`, `rateLimitWindowMs` keys. |
| `src/index.js` | edit | Wire limiter in **before** `auth`. |
| `tests/middleware/rateLimit.test.js` | create | Jest unit tests against the factory. |
| `README.md` | create | Run/test docs + rate-limit behaviour section. |

## Convention notes

- Tests construct the middleware directly and pass stub `req`/`res`/`next` objects — no Supertest, no HTTP server. This is intentional: the factory is the unit under test, not the wiring.
- The middleware exposes its internal state map as `middleware._state` for tests only. The leading underscore signals "test surface, not public API."
- Commit messages use conventional-commit prefixes (`feat:`, `test:`, `chore:`, `docs:`) — matching `auth`-style additions.

---

## Task 1: Scaffolding + first passing test ("normal request passes")

**Files:**
- Create: `tests/middleware/rateLimit.test.js`
- Create: `src/middleware/rateLimit.js`

- [ ] **Step 1: Create the test file with the first test**

Write `tests/middleware/rateLimit.test.js`:

```js
const createRateLimiter = require('../../src/middleware/rateLimit');

function makeReq(ip = '1.1.1.1') {
  return { ip };
}

function makeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    set(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.body = obj; return this; },
  };
}

describe('rateLimit middleware', () => {
  it('passes through a single request', () => {
    const limiter = createRateLimiter({ windowMs: 60000, max: 100, now: () => 1_000_000 });
    const req = makeReq();
    const res = makeRes();
    const next = jest.fn();

    limiter(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npx jest tests/middleware/rateLimit.test.js`
Expected: FAIL — `Cannot find module '../../src/middleware/rateLimit'`.

- [ ] **Step 3: Create the minimal middleware factory**

Write `src/middleware/rateLimit.js`:

```js
function createRateLimiter({ windowMs, max, now = Date.now, sweepEvery = 1000 }) {
  function middleware(req, res, next) {
    next();
  }
  return middleware;
}

module.exports = createRateLimiter;
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx jest tests/middleware/rateLimit.test.js`
Expected: PASS — 1 test passing.

- [ ] **Step 5: Commit**

```bash
git add tests/middleware/rateLimit.test.js src/middleware/rateLimit.js
git commit -m "feat: scaffold rateLimit middleware factory"
```

---

## Task 2: Reject the 101st request with 429 + Retry-After

**Files:**
- Modify: `tests/middleware/rateLimit.test.js`
- Modify: `src/middleware/rateLimit.js`

- [ ] **Step 1: Add the failing test**

Append inside the `describe('rateLimit middleware', ...)` block:

```js
  it('returns 429 with Retry-After on the 101st request within the window', () => {
    const limiter = createRateLimiter({ windowMs: 60000, max: 100, now: () => 1_000_000 });
    const req = makeReq();

    for (let i = 0; i < 100; i++) {
      const res = makeRes();
      const next = jest.fn();
      limiter(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.statusCode).toBe(200);
    }

    const res = makeRes();
    const next = jest.fn();
    limiter(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(429);
    expect(res.body).toEqual({ error: 'Too many requests' });
    expect(res.headers['Retry-After']).toBeDefined();
    const retryAfter = parseInt(res.headers['Retry-After'], 10);
    expect(Number.isInteger(retryAfter)).toBe(true);
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(60);
  });
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npx jest tests/middleware/rateLimit.test.js`
Expected: FAIL — the new test reaches `next` 101 times instead of getting 429.

- [ ] **Step 3: Implement the tracking + reject logic**

Replace the body of `src/middleware/rateLimit.js` with:

```js
function createRateLimiter({ windowMs, max, now = Date.now, sweepEvery = 1000 }) {
  const state = new Map();

  function middleware(req, res, next) {
    const ip = req.ip || 'unknown';
    const t = now();
    const timestamps = state.get(ip) || [];

    if (timestamps.length >= max) {
      const oldest = timestamps[0];
      const retryAfter = Math.max(1, Math.ceil((oldest + windowMs - t) / 1000));
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({ error: 'Too many requests' });
    }

    timestamps.push(t);
    state.set(ip, timestamps);
    next();
  }

  middleware._state = state;
  return middleware;
}

module.exports = createRateLimiter;
```

Note: this implementation does not yet expire old timestamps — that comes in Task 3. With a constant `now`, this is sufficient to pass both tests so far because all 100 timestamps are within the window.

- [ ] **Step 4: Run all tests in the file**

Run: `npx jest tests/middleware/rateLimit.test.js`
Expected: PASS — 2 tests passing.

- [ ] **Step 5: Commit**

```bash
git add tests/middleware/rateLimit.test.js src/middleware/rateLimit.js
git commit -m "feat: reject excess requests with 429 + Retry-After"
```

---

## Task 3: Window resets after 60 seconds

**Files:**
- Modify: `tests/middleware/rateLimit.test.js`
- Modify: `src/middleware/rateLimit.js`

- [ ] **Step 1: Add the failing test**

Append inside the `describe(...)` block:

```js
  it('allows requests again after the window expires', () => {
    let clock = 1_000_000;
    const limiter = createRateLimiter({ windowMs: 60000, max: 100, now: () => clock });
    const req = makeReq();

    for (let i = 0; i < 100; i++) {
      limiter(req, makeRes(), jest.fn());
    }

    const blocked = makeRes();
    limiter(req, blocked, jest.fn());
    expect(blocked.statusCode).toBe(429);

    clock += 60_001;

    const after = makeRes();
    const next = jest.fn();
    limiter(req, after, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(after.statusCode).toBe(200);
  });
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npx jest tests/middleware/rateLimit.test.js`
Expected: FAIL — the post-reset request still returns 429 because expired timestamps are not being dropped.

- [ ] **Step 3: Add sliding-window filtering**

In `src/middleware/rateLimit.js`, replace the body of `middleware` with the filtered version:

```js
  function middleware(req, res, next) {
    const ip = req.ip || 'unknown';
    const t = now();
    const cutoff = t - windowMs;
    const timestamps = (state.get(ip) || []).filter(ts => ts > cutoff);

    if (timestamps.length >= max) {
      const oldest = timestamps[0];
      const retryAfter = Math.max(1, Math.ceil((oldest + windowMs - t) / 1000));
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({ error: 'Too many requests' });
    }

    timestamps.push(t);
    state.set(ip, timestamps);
    next();
  }
```

The rest of the file is unchanged.

- [ ] **Step 4: Run all tests in the file**

Run: `npx jest tests/middleware/rateLimit.test.js`
Expected: PASS — 3 tests passing.

- [ ] **Step 5: Commit**

```bash
git add tests/middleware/rateLimit.test.js src/middleware/rateLimit.js
git commit -m "feat: expire timestamps outside the sliding window"
```

---

## Task 4: Per-IP isolation

**Files:**
- Modify: `tests/middleware/rateLimit.test.js`

- [ ] **Step 1: Add the test that proves IPs do not interfere**

Append inside the `describe(...)` block:

```js
  it('tracks IPs independently', () => {
    const limiter = createRateLimiter({ windowMs: 60000, max: 100, now: () => 1_000_000 });
    const reqA = makeReq('1.1.1.1');
    const reqB = makeReq('2.2.2.2');

    for (let i = 0; i < 100; i++) {
      limiter(reqA, makeRes(), jest.fn());
    }

    const aBlocked = makeRes();
    limiter(reqA, aBlocked, jest.fn());
    expect(aBlocked.statusCode).toBe(429);

    const bRes = makeRes();
    const bNext = jest.fn();
    limiter(reqB, bRes, bNext);

    expect(bNext).toHaveBeenCalledTimes(1);
    expect(bRes.statusCode).toBe(200);
  });
```

- [ ] **Step 2: Run all tests**

Run: `npx jest tests/middleware/rateLimit.test.js`
Expected: PASS — 4 tests passing. (No code change is required; the existing `state.get(ip)` keying already isolates IPs. This task documents that guarantee as a regression test.)

- [ ] **Step 3: Commit**

```bash
git add tests/middleware/rateLimit.test.js
git commit -m "test: lock per-IP isolation in rateLimit"
```

---

## Task 5: Memory sweep for idle IPs

**Files:**
- Modify: `tests/middleware/rateLimit.test.js`
- Modify: `src/middleware/rateLimit.js`

- [ ] **Step 1: Add the failing test**

Append inside the `describe(...)` block:

```js
  it('sweeps idle IPs from internal state', () => {
    let clock = 1_000_000;
    const limiter = createRateLimiter({
      windowMs: 60000,
      max: 100,
      now: () => clock,
      sweepEvery: 3,
    });

    limiter(makeReq('1.1.1.1'), makeRes(), jest.fn());
    limiter(makeReq('2.2.2.2'), makeRes(), jest.fn());
    expect(limiter._state.size).toBe(2);

    clock += 60_001;

    limiter(makeReq('3.3.3.3'), makeRes(), jest.fn());

    expect(limiter._state.has('3.3.3.3')).toBe(true);
    expect(limiter._state.has('1.1.1.1')).toBe(false);
    expect(limiter._state.has('2.2.2.2')).toBe(false);
  });
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npx jest tests/middleware/rateLimit.test.js`
Expected: FAIL — `_state` still contains the idle IPs because no sweep runs.

- [ ] **Step 3: Add the sweep counter and logic**

Replace `src/middleware/rateLimit.js` with the final version:

```js
function createRateLimiter({ windowMs, max, now = Date.now, sweepEvery = 1000 }) {
  const state = new Map();
  let counter = 0;

  function middleware(req, res, next) {
    const ip = req.ip || 'unknown';
    const t = now();
    const cutoff = t - windowMs;
    const timestamps = (state.get(ip) || []).filter(ts => ts > cutoff);

    if (timestamps.length >= max) {
      const oldest = timestamps[0];
      const retryAfter = Math.max(1, Math.ceil((oldest + windowMs - t) / 1000));
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({ error: 'Too many requests' });
    }

    timestamps.push(t);
    state.set(ip, timestamps);

    if (++counter % sweepEvery === 0) {
      for (const [key, ts] of state) {
        if (ts[ts.length - 1] <= cutoff) state.delete(key);
      }
    }

    next();
  }

  middleware._state = state;
  return middleware;
}

module.exports = createRateLimiter;
```

- [ ] **Step 4: Run all tests in the file**

Run: `npx jest tests/middleware/rateLimit.test.js`
Expected: PASS — 5 tests passing.

- [ ] **Step 5: Commit**

```bash
git add tests/middleware/rateLimit.test.js src/middleware/rateLimit.js
git commit -m "feat: sweep idle IPs from rateLimit state"
```

---

## Task 6: Wire into config and `index.js`

**Files:**
- Modify: `src/config.js`
- Modify: `src/index.js`
- Modify: `.env.example`

- [ ] **Step 1: Add config keys**

Replace `src/config.js` with:

```js
require('dotenv').config();

module.exports = {
  port: process.env.PORT || 3000,
  usersServiceUrl: process.env.USERS_SERVICE_URL || 'http://localhost:3001',
  notificationsServiceUrl: process.env.NOTIFICATIONS_SERVICE_URL || 'http://localhost:3002',
  apiKey: process.env.API_KEY || 'dev-secret',
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX, 10) || 100,
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60000,
};
```

- [ ] **Step 2: Wire the limiter into `src/index.js` before auth**

Replace `src/index.js` with:

```js
const express = require('express');
const auth = require('./middleware/auth');
const createRateLimiter = require('./middleware/rateLimit');
const usersRouter = require('./routes/users');
const notificationsRouter = require('./routes/notifications');
const config = require('./config');

const app = express();
app.use(express.json());
app.use(createRateLimiter({
  windowMs: config.rateLimitWindowMs,
  max: config.rateLimitMax,
}));
app.use(auth);
app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.use('/users', usersRouter);
app.use('/notifications', notificationsRouter);

if (require.main === module) {
  app.listen(config.port, () => console.log(`Gateway on :${config.port}`));
}

module.exports = app;
```

- [ ] **Step 3: Document the new env vars in `.env.example`**

Append to `.env.example`:

```
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW_MS=60000
```

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: PASS — all suites green. Existing `auth` and route tests make far fewer than 100 requests per process, so they remain unaffected. The rate-limit suite still has 5 passing tests.

- [ ] **Step 5: Commit**

```bash
git add src/config.js src/index.js .env.example
git commit -m "feat: apply rateLimit globally before auth"
```

---

## Task 7: README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write the README**

Create `README.md`:

```markdown
# dummy-gateway

API gateway microservice — routes to `dummy-users` and `dummy-notifications`. Validates `X-API-Key` and applies per-IP rate limiting.

## Run

```bash
npm install
cp .env.example .env   # set API_KEY, USERS_SERVICE_URL, NOTIFICATIONS_SERVICE_URL
npm start
```

## Test

```bash
npm test
```

Downstream calls are mocked — no running services needed.

## Rate limiting

Every route (including `/health`) is rate-limited to **100 requests per 60 seconds per client IP** using an in-memory sliding-window log. When a client exceeds the limit, the gateway responds with:

- `HTTP 429`
- `Retry-After: <seconds>` — integer seconds until the oldest request in the window expires (minimum `1`)
- Body: `{"error": "Too many requests"}`

Rate limiting runs **before** auth, so unauthenticated probes count against the limit and never reach the auth check.

The limit and window are configurable via environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `RATE_LIMIT_MAX` | `100` | Max requests per IP per window. |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Window length in milliseconds. |

Client IP is read from `req.ip` using Express's defaults. Behind a load balancer or reverse proxy, set Express's `trust proxy` and rely on `X-Forwarded-For` — not handled in this iteration.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Listen port. |
| `API_KEY` | `dev-secret` | Required `X-API-Key` header value. |
| `USERS_SERVICE_URL` | `http://localhost:3001` | Downstream users service base URL. |
| `NOTIFICATIONS_SERVICE_URL` | `http://localhost:3002` | Downstream notifications service base URL. |
| `RATE_LIMIT_MAX` | `100` | See "Rate limiting". |
| `RATE_LIMIT_WINDOW_MS` | `60000` | See "Rate limiting". |
```

- [ ] **Step 2: Verify the README renders**

Run: `cat README.md | head -20`
Expected: shows the heading and run instructions cleanly.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add README with rate-limit behaviour"
```

---

## Verification checklist

After all tasks:

- [ ] `npm test` — all suites green, including the 5 new `rateLimit` tests.
- [ ] `git log --oneline` shows 7 focused commits in order.
- [ ] `src/middleware/rateLimit.js`, `tests/middleware/rateLimit.test.js`, and `README.md` exist.
- [ ] `src/index.js` calls `createRateLimiter` **before** `auth`.
- [ ] `.env.example` lists `RATE_LIMIT_MAX` and `RATE_LIMIT_WINDOW_MS`.

## Spec coverage map

| Spec requirement | Task |
| --- | --- |
| Per-IP sliding-window log | Task 3 |
| 100 req / 60s default | Task 6 (config defaults) |
| 429 + `Retry-After` + `{error: 'Too many requests'}` | Task 2 |
| Applied globally before auth | Task 6 |
| `/health` rate-limited | Task 6 (no carve-out) |
| Configurable via env | Task 6 |
| Memory sweep for idle IPs | Task 5 |
| Injected clock for tests | Task 1 (factory signature), exercised Task 3+ |
| Jest unit tests: passes / 101st rejected / resets after 60s | Tasks 1, 2, 3 |
| Per-IP isolation (recommended) | Task 4 |
| README documents the contract | Task 7 |
