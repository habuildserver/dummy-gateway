# Spec: Per-IP Rate Limiting Middleware

**Task:** 86d2p8bm0
**Repo:** dummy-gateway
**Status:** Approved (Approach A)

## Context

`dummy-gateway` is a small Node.js/Express API gateway. Today the request pipeline is:

```
express.json() → auth (X-API-Key check) → routes (/users, /notifications, /health)
```

There is no rate limiting. We need to add per-IP rate limiting that runs before auth so abusive clients cannot waste cycles on the auth check, and so unauthenticated probing traffic is throttled.

Conventions inherited from `CLAUDE.md`: async/await, env access only via `src/config.js`, error body shape `{"error": "<message>"}`, one file per middleware.

## Goal

A new Express middleware that:

- Rejects requests when a single IP exceeds **100 requests per 60-second sliding window**.
- Responds with HTTP **429**, header `Retry-After: <integer seconds>`, body `{"error": "Too many requests"}`.
- Runs **before** the existing `auth` middleware on every route, including `/health`.
- Uses an **in-memory** sliding-window-log algorithm. No Redis, no external dependency.
- Is unit-testable without real waits and without `jest.useFakeTimers()`.

## Approach: Sliding-window log

Per-IP state is `Map<string, number[]>` — an array of millisecond timestamps for requests in the current window. On each request:

1. Resolve the client IP from `req.ip`.
2. Read or create the array for that IP.
3. Drop any timestamps older than `now - windowMs`.
4. If `array.length >= max`: respond 429 with `Retry-After = ceil((oldestRemaining + windowMs - now) / 1000)`.
5. Otherwise: push `now` and call `next()`.

A lightweight sweep evicts fully-expired IPs to keep the map bounded (see "Memory management" below).

### Why sliding-window log (vs. counter)

- Precise: the 101st request in a 60-second window is rejected, no rounding.
- Memory is bounded — at most `max` (100) timestamps per active IP.
- Trivial to compute an accurate `Retry-After` from the oldest surviving timestamp.
- O(n) filter per request is negligible at n ≤ 100.

## Architecture & files

| File | Action | Purpose |
| --- | --- | --- |
| `src/middleware/rateLimit.js` | **new** | Exports `createRateLimiter({ windowMs, max, now })` returning an Express middleware. |
| `src/config.js` | edit | Add `rateLimitMax` and `rateLimitWindowMs` keys, env-overridable. |
| `src/index.js` | edit | Build limiter from config; `app.use(rateLimit)` **before** `app.use(auth)`. |
| `tests/middleware/rateLimit.test.js` | **new** | Jest unit tests over the middleware factory directly (no HTTP server). |
| `README.md` | **new** | Run/test instructions plus a "Rate limiting" section documenting the contract. |

The middleware factory pattern (rather than a singleton) is what makes the unit tests clean: each test constructs its own limiter with its own injected `now()` and its own private state map.

## Public interface

```js
// src/middleware/rateLimit.js
function createRateLimiter({ windowMs, max, now = Date.now }) { /* ... */ }
module.exports = createRateLimiter;
```

```js
// src/index.js — wiring order
app.use(express.json());
app.use(createRateLimiter({
  windowMs: config.rateLimitWindowMs,
  max: config.rateLimitMax,
}));
app.use(auth);
```

```js
// src/config.js — additions
rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX, 10) || 100,
rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60000,
```

## Error contract

When an IP exceeds its quota:

- Status: `429`
- Header: `Retry-After: <N>` where `N = Math.ceil((oldestTimestamp + windowMs - now) / 1000)`, minimum `1`.
- Body: `{"error": "Too many requests"}` (matches the existing convention).

The handler `return`s after sending — the request does not reach `auth`.

## IP source

`req.ip` from Express's default. This does **not** trust `X-Forwarded-For`. The README will call this out so operators behind a load balancer know to plan a follow-up (Approach C in the brainstorming notes).

## Memory management

Lazy sweep: each call increments an internal counter; every 1000 requests across the whole limiter, iterate the map and delete entries whose newest timestamp is older than `now - windowMs`. This keeps cleanup amortised O(1) per request and avoids `setInterval`, which would complicate tests and shutdown.

## Health endpoint

`/health` is rate-limited like every other route. The task specifies "all routes" and we are honouring that literally.

## Test strategy

Tests target the middleware factory directly, calling it as `limiter(req, res, next)` with stub `req`/`res`/`next` objects. This is far simpler than driving Supertest and lets us inject `now` cleanly:

```js
let clock = 1_000_000;
const limiter = createRateLimiter({ windowMs: 60000, max: 100, now: () => clock });
```

Each test mutates `clock` to advance time. No `setTimeout`, no `jest.useFakeTimers`.

Required cases:

1. **Normal request passes** — single call invokes `next()` and sets no status/header.
2. **101st request in window is rejected** — 100 calls pass; the 101st sets status 429, sets a `Retry-After` header with an integer string `≥ 1`, and sends `{error: "Too many requests"}`.
3. **Window resets after 60 seconds** — after rejection, advance `clock` past `windowMs`; the next call passes again.

Optional but cheap to add (and worth including for confidence): per-IP isolation — IP B is unaffected when IP A is throttled. The spec recommends this as a fourth test; the plan will include it.

## README

A new `README.md` will mirror the run/test guidance from `CLAUDE.md` and add a section:

> ### Rate limiting
>
> The gateway rate-limits every route (including `/health`) to **100 requests per 60 seconds per client IP** using a sliding-window log. When a client exceeds the limit, the gateway responds with `HTTP 429`, a `Retry-After` header (seconds until the oldest request in the window expires), and body `{"error": "Too many requests"}`.
>
> The limit and window are configurable via `RATE_LIMIT_MAX` and `RATE_LIMIT_WINDOW_MS` environment variables.
>
> The IP is taken from `req.ip` using Express's defaults — behind a load balancer, configure `trust proxy` and the `X-Forwarded-For` header accordingly. (Not handled in this iteration.)

## Out of scope

- Distributed rate limiting (no Redis, per the task).
- Proxy-aware IP extraction / `trust proxy` (deferrable; documented as a caveat).
- Per-route or per-method overrides.
- Per-API-key limits (rate limiting runs before auth on purpose).
- Sliding-window counter (precision trade-off was rejected in brainstorming).
