# Rate Limiting Middleware Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-IP sliding-window rate limiting to the API gateway: 100 requests per minute per IP, 429 + `Retry-After` on exceed, applied globally before auth, with `/health` exempt for load-balancer polling.

**Architecture:** A factory function `createRateLimiter({ limit, windowMs, now })` exported from `src/middleware/rateLimit.js` returns an Express middleware. Internal state is a closure-scoped `Map<string, number[]>` keyed by `req.ip`, holding millisecond timestamps of recent requests. On each request the middleware prunes timestamps older than `now() - windowMs`, rejects with 429 + `Retry-After` if the pruned list has `>= limit` entries, otherwise appends the current timestamp and calls `next()`. The `now` parameter (default `Date.now`) is injectable so tests can advance the clock without timer mocks. Limit and window are sourced from `src/config.js` per project convention.

**Tech Stack:** Node.js, Express 4.18, Jest 29, supertest 6.

**Approach decisions (locked from spec phase):**
- Sliding log algorithm (strict, simple, bounded at most 100 timestamps per IP at the configured cap).
- `req.ip` as-is — no `trust proxy` knob in scope.
- `/health` is registered before the limiter and before auth. It becomes public (no API key required), which matches the user's load-balancer-poll rationale and is required for the "exempt /health" decision to coexist with "limiter applied globally before auth."
- Documentation lives in `CLAUDE.md` only; no `README.md` will be created (project has no README convention).

---

## File Structure

**Create:**
- `src/middleware/rateLimit.js` — exports `createRateLimiter({ limit, windowMs, now })`.
- `tests/rateLimit.test.js` — three required Jest tests using injectable clock.

**Modify:**
- `src/config.js` — add `rateLimit: { limit: 100, windowMs: 60_000 }`.
- `src/index.js` — register `/health` before the limiter; mount limiter before auth.
- `tests/middleware.test.js` — rewrite auth tests against `/users` (since `/health` is now public); add a public-`/health` test.
- `CLAUDE.md` — add Rate limiting section.

---

## Middleware Contract

`createRateLimiter({ limit, windowMs, now })` returns `(req, res, next) => void` with these guarantees:

- **State:** closure-scoped `Map` from `req.ip` to ascending array of millisecond timestamps. Pruned on every access (no background sweep).
- **Pass path:** appends `now()` to the IP's array, calls `next()`. No response touched.
- **Reject path:** does NOT call `next()`. Sets `Retry-After: <seconds>` header (integer string, always `>= 1` and `<= ceil(windowMs / 1000)`). Sends `res.status(429).json({ error: 'Too Many Requests' })`.
- **Retry-After formula:** `Math.max(1, Math.ceil((oldest + windowMs - now()) / 1000))`, where `oldest` is the smallest timestamp in the pruned array.
- **No mutation of req beyond `req.ip` read.**
- **Defaults:** `now` defaults to `Date.now`. `limit` and `windowMs` are required (no defaults — caller passes from config).

---

## Task 1: Add rate-limit config block

**Files:**
- Modify: `src/config.js`

- [ ] **Step 1: Read current config**

Open `src/config.js`. Current contents:

```js
require('dotenv').config();

module.exports = {
  port: process.env.PORT || 3000,
  usersServiceUrl: process.env.USERS_SERVICE_URL || 'http://localhost:3001',
  notificationsServiceUrl: process.env.NOTIFICATIONS_SERVICE_URL || 'http://localhost:3002',
  apiKey: process.env.API_KEY || 'dev-secret',
};
```

- [ ] **Step 2: Add `rateLimit` block**

Replace the file contents with:

```js
require('dotenv').config();

module.exports = {
  port: process.env.PORT || 3000,
  usersServiceUrl: process.env.USERS_SERVICE_URL || 'http://localhost:3001',
  notificationsServiceUrl: process.env.NOTIFICATIONS_SERVICE_URL || 'http://localhost:3002',
  apiKey: process.env.API_KEY || 'dev-secret',
  rateLimit: {
    limit: 100,
    windowMs: 60_000,
  },
};
```

Note: not env-driven. Constants live in `config.js` per the project's "all config via `src/config.js`" convention, even though the task didn't ask for env knobs.

- [ ] **Step 3: Verify existing tests still pass**

Run: `npm test`
Expected: all existing tests pass (config change is additive).

- [ ] **Step 4: Commit**

```bash
git add src/config.js
git commit -m "feat(config): add rateLimit block (100 req / 60s)"
```

---

## Task 2: Rate limiter — first behaviour: normal request passes

**Files:**
- Create: `src/middleware/rateLimit.js`
- Create: `tests/rateLimit.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/rateLimit.test.js`:

```js
const express = require('express');
const request = require('supertest');
const createRateLimiter = require('../src/middleware/rateLimit');

function makeApp({ limit, windowMs, now }) {
  const app = express();
  app.use(createRateLimiter({ limit, windowMs, now }));
  app.get('/test', (_req, res) => res.json({ ok: true }));
  return app;
}

describe('rateLimit middleware', () => {
  it('allows a request under the limit through', async () => {
    const now = () => 1_700_000_000_000;
    const app = makeApp({ limit: 100, windowMs: 60_000, now });
    const res = await request(app).get('/test');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/rateLimit.test.js -v`
Expected: FAIL with "Cannot find module '../src/middleware/rateLimit'".

- [ ] **Step 3: Create the minimal middleware factory**

Create `src/middleware/rateLimit.js`:

```js
function createRateLimiter(_options) {
  // _options will be { limit, windowMs, now } — destructured and used in Task 3.
  return function rateLimit(_req, _res, next) {
    return next();
  };
}

module.exports = createRateLimiter;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/rateLimit.test.js -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/middleware/rateLimit.js tests/rateLimit.test.js
git commit -m "feat(rate-limit): scaffold createRateLimiter factory and first test"
```

---

## Task 3: Rate limiter — enforce limit (101st request rejected with Retry-After)

**Files:**
- Modify: `src/middleware/rateLimit.js`
- Modify: `tests/rateLimit.test.js`

- [ ] **Step 1: Add the failing test**

Append to the `describe('rateLimit middleware', ...)` block in `tests/rateLimit.test.js`:

```js
  it('rejects the 101st request in a window with 429 + Retry-After', async () => {
    const now = () => 1_700_000_000_000;
    const app = makeApp({ limit: 100, windowMs: 60_000, now });

    for (let i = 0; i < 100; i++) {
      const res = await request(app).get('/test');
      expect(res.status).toBe(200);
    }

    const res = await request(app).get('/test');
    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: 'Too Many Requests' });
    expect(res.headers['retry-after']).toMatch(/^\d+$/);
    const seconds = Number(res.headers['retry-after']);
    expect(seconds).toBeGreaterThan(0);
    expect(seconds).toBeLessThanOrEqual(60);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/rateLimit.test.js -v`
Expected: FAIL on the new test — all 101 requests currently return 200.

- [ ] **Step 3: Implement counting and rejection**

Replace the contents of `src/middleware/rateLimit.js` with:

```js
function createRateLimiter({ limit, windowMs, now = Date.now }) {
  const buckets = new Map();
  return function rateLimit(req, res, next) {
    const ip = req.ip;
    const t = now();
    const times = buckets.get(ip) || [];
    if (times.length >= limit) {
      const oldest = times[0];
      const retryAfter = Math.max(1, Math.ceil((oldest + windowMs - t) / 1000));
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({ error: 'Too Many Requests' });
    }
    times.push(t);
    buckets.set(ip, times);
    return next();
  };
}

module.exports = createRateLimiter;
```

- [ ] **Step 4: Run tests to verify both pass**

Run: `npx jest tests/rateLimit.test.js -v`
Expected: both tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/middleware/rateLimit.js tests/rateLimit.test.js
git commit -m "feat(rate-limit): enforce limit with 429 + Retry-After"
```

---

## Task 4: Rate limiter — sliding window (resets after windowMs)

**Files:**
- Modify: `src/middleware/rateLimit.js`
- Modify: `tests/rateLimit.test.js`

- [ ] **Step 1: Add the failing test**

Append to the `describe` block:

```js
  it('allows requests again after the window slides past', async () => {
    let t = 1_700_000_000_000;
    const now = () => t;
    const app = makeApp({ limit: 100, windowMs: 60_000, now });

    for (let i = 0; i < 100; i++) {
      const res = await request(app).get('/test');
      expect(res.status).toBe(200);
    }

    let res = await request(app).get('/test');
    expect(res.status).toBe(429);

    t += 60_001; // advance past the window

    res = await request(app).get('/test');
    expect(res.status).toBe(200);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/rateLimit.test.js -v`
Expected: FAIL on the new test — the post-advance request returns 429 because old timestamps are not pruned.

- [ ] **Step 3: Add prune-on-access**

Replace the contents of `src/middleware/rateLimit.js` with:

```js
function createRateLimiter({ limit, windowMs, now = Date.now }) {
  const buckets = new Map();
  return function rateLimit(req, res, next) {
    const ip = req.ip;
    const t = now();
    const cutoff = t - windowMs;
    const prev = buckets.get(ip) || [];
    const recent = prev.filter((ts) => ts > cutoff);
    if (recent.length >= limit) {
      const oldest = recent[0];
      const retryAfter = Math.max(1, Math.ceil((oldest + windowMs - t) / 1000));
      res.set('Retry-After', String(retryAfter));
      buckets.set(ip, recent);
      return res.status(429).json({ error: 'Too Many Requests' });
    }
    recent.push(t);
    buckets.set(ip, recent);
    return next();
  };
}

module.exports = createRateLimiter;
```

Notes on the change:
- `cutoff = t - windowMs`; we keep timestamps strictly greater than cutoff.
- The pruned array is also written back on the reject path so a long-stale bucket cannot accumulate forever.
- `Math.max(1, ...)` is defensive — given the strict-greater prune, the formula is mathematically `>= 1`, but the floor protects against any future arithmetic edge case.

- [ ] **Step 4: Run tests to verify all three pass**

Run: `npx jest tests/rateLimit.test.js -v`
Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/middleware/rateLimit.js tests/rateLimit.test.js
git commit -m "feat(rate-limit): prune timestamps to implement sliding window"
```

---

## Task 5: Wire middleware into the gateway and update auth tests

**Files:**
- Modify: `src/index.js`
- Modify: `tests/middleware.test.js`

This task changes middleware ordering so `/health` is registered before both the rate limiter and auth. Existing auth tests, which assert that `/health` requires an API key, must be updated to test against a real protected route (`/users`) with axios mocked, mirroring the pattern in `tests/routes/users.test.js`.

- [ ] **Step 1: Update `src/index.js`**

Replace the entire contents of `src/index.js` with:

```js
const express = require('express');
const auth = require('./middleware/auth');
const createRateLimiter = require('./middleware/rateLimit');
const usersRouter = require('./routes/users');
const notificationsRouter = require('./routes/notifications');
const config = require('./config');

const app = express();
app.use(express.json());

// Public — registered before the rate limiter so load-balancer health
// polls do not consume the per-IP budget, and before auth so no API key
// is required.
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.use(createRateLimiter(config.rateLimit));
app.use(auth);
app.use('/users', usersRouter);
app.use('/notifications', notificationsRouter);

if (require.main === module) {
  app.listen(config.port, () => console.log(`Gateway on :${config.port}`));
}

module.exports = app;
```

- [ ] **Step 2: Rewrite `tests/middleware.test.js`**

Replace the entire contents of `tests/middleware.test.js` with:

```js
process.env.API_KEY = 'test-key';
jest.mock('axios');
const request = require('supertest');
const axios = require('axios');
const app = require('../src/index');

let server;
beforeAll(() => { server = app.listen(0); });
afterAll(() => new Promise(resolve => server.close(resolve)));

describe('auth middleware', () => {
  it('returns 401 when X-API-Key header is missing on a protected route', async () => {
    const res = await request(server).get('/users');
    expect(res.status).toBe(401);
  });

  it('returns 401 when X-API-Key is wrong on a protected route', async () => {
    const res = await request(server).get('/users').set('X-API-Key', 'wrong');
    expect(res.status).toBe(401);
  });

  it('passes through with correct X-API-Key', async () => {
    axios.get.mockResolvedValue({ data: [] });
    const res = await request(server).get('/users').set('X-API-Key', 'test-key');
    expect(res.status).toBe(200);
  });
});

describe('/health endpoint', () => {
  it('is publicly accessible without an API key', async () => {
    const res = await request(server).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
```

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: all tests pass — `tests/rateLimit.test.js` (3 tests), `tests/middleware.test.js` (4 tests), `tests/routes/users.test.js`, `tests/routes/notifications.test.js`.

If `tests/routes/*.test.js` now fail because their per-test request volume crosses the limit, the cause is shared in-memory state across the integration `app`. The fix is module-scope: the rate limiter is constructed once at `require('../src/index')` and is shared across all integration tests. Inspect failure output before changing anything; the route tests as currently written make at most 4 requests each, well under 100, so this should not occur. If it does, see "Risk: cross-test rate-limit bleed" in the Notes section below.

- [ ] **Step 4: Commit**

```bash
git add src/index.js tests/middleware.test.js
git commit -m "feat(gateway): mount rate limiter; expose /health publicly; fix auth tests"
```

---

## Task 6: Document rate limiting in CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Read current CLAUDE.md**

Current contents (verbatim):

```markdown
# dummy-gateway

API gateway service (Node.js/Express). Validates `X-API-Key`, proxies requests to `dummy-users` and `dummy-notifications`.

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

## Conventions

- Async/await throughout. No callbacks.
- All env config via `src/config.js`. Never read `process.env` directly in routes.
- Error shape: `{"error": "<message>"}`.
- One file per middleware, one file per route group.
```

- [ ] **Step 2: Insert a "Rate limiting" section**

Insert the following section between the "Test" section and the "Conventions" section, so the final document reads top to bottom: heading → description → Run → Test → **Rate limiting** → Conventions.

```markdown
## Rate limiting

Per-IP sliding-window limiter applied globally before auth. Default: **100 requests per minute per IP**. Exceeding the limit returns **HTTP 429** with body `{"error": "Too Many Requests"}` and a `Retry-After` header carrying the integer number of seconds until the window slides past the oldest tracked request for that IP.

`/health` is exempt: it is registered before the limiter (and before auth), so load-balancer polls do not consume the budget and do not require an API key.

Limit and window come from `src/config.js` (`rateLimit.limit`, `rateLimit.windowMs`). State is in-memory — a process-local `Map` keyed by `req.ip` storing recent request timestamps. Restarts reset all counters; the limiter is per-process and does not coordinate across instances.

`req.ip` is read with Express defaults (no `trust proxy`). Behind a real load balancer, every client would map to the proxy's IP; configuring `trust proxy` is a follow-up if this gateway lands in such a topology.
```

- [ ] **Step 3: Verify**

Run: `npm test`
Expected: all tests still pass (docs change is non-functional).

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document rate limiting behaviour and /health exemption"
```

---

## Notes & Risks

**Risk: cross-test rate-limit bleed (low probability).** The integration test suite (`tests/middleware.test.js`, `tests/routes/users.test.js`, `tests/routes/notifications.test.js`) all `require('../src/index')`. Jest by default isolates modules per test file (each test file gets its own module registry), so each file gets its own `app` instance and its own rate-limiter Map. Within a file, all tests share the limiter. None of the existing files makes more than ~6 requests per file, so we are nowhere near 100. If this assumption ever breaks, the fix is to call `jest.resetModules()` in a `beforeEach` for the affected file, or to expose a `resetForTests()` helper from `rateLimit.js`. Do not pre-emptively add this — only if a real test fails.

**Memory:** sliding-log buckets self-prune for IPs that re-visit. An IP that visits exactly once leaks one timestamp forever. For a dummy-gateway demo this is irrelevant; in a long-running production process with high IP churn the right fix would be a periodic GC sweep — explicitly deferred per the spec phase decision (Approach 3 was considered and rejected as out of scope).

**`req.ip` source:** uses Express defaults — socket address. Not configured for `trust proxy`. Documented as a follow-up in CLAUDE.md.

**Algorithm:** sliding log, not sliding window counter. Filter on each access is O(n) where n ≤ limit; for limit=100 this is negligible.

**429 body shape:** `{"error": "Too Many Requests"}` matches the project's `{"error": "<message>"}` convention.

---

## Definition of Done

- [ ] `src/middleware/rateLimit.js` exists and exports `createRateLimiter`.
- [ ] `src/config.js` has `rateLimit: { limit: 100, windowMs: 60_000 }`.
- [ ] `src/index.js` mounts `/health` before the limiter, then limiter, then auth, then routers.
- [ ] `tests/rateLimit.test.js` has all three required tests passing: normal pass, 101st rejected with 429 + Retry-After, window reset.
- [ ] `tests/middleware.test.js` updated; auth tests use `/users`; new test asserts `/health` is public.
- [ ] `npm test` is green end-to-end.
- [ ] `CLAUDE.md` has a "Rate limiting" section documenting limit, window, 429 + Retry-After response, `/health` exemption, in-memory state, and the trust-proxy follow-up note.
