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

## Rate limiting

Per-IP sliding-window limiter applied globally before auth. Default: **100 requests per minute per IP**. Exceeding the limit returns **HTTP 429** with body `{"error": "Too Many Requests"}` and a `Retry-After` header carrying the integer number of seconds until the window slides past the oldest tracked request for that IP.

`/health` is exempt: it is registered before the limiter (and before auth), so load-balancer polls do not consume the budget and do not require an API key.

Limit and window come from `src/config.js` (`rateLimit.limit`, `rateLimit.windowMs`). State is in-memory — a process-local `Map` keyed by `req.ip` storing recent request timestamps. Restarts reset all counters; the limiter is per-process and does not coordinate across instances.

`req.ip` is read with Express defaults (no `trust proxy`). Behind a real load balancer, every client would map to the proxy's IP; configuring `trust proxy` is a follow-up if this gateway lands in such a topology.

## Conventions

- Async/await throughout. No callbacks.
- All env config via `src/config.js`. Never read `process.env` directly in routes.
- Error shape: `{"error": "<message>"}`.
- One file per middleware, one file per route group.
