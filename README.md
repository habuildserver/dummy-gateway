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
