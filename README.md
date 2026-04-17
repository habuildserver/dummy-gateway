# dummy-gateway

API gateway microservice for routing requests to the `dummy-users` and `dummy-notifications` downstream services. Validates API keys and enforces per-IP rate limiting on all routes.

## Setup

```bash
npm install
cp .env.example .env
# Edit .env and set API_KEY, USERS_SERVICE_URL, NOTIFICATIONS_SERVICE_URL
```

## Run

```bash
npm start
# Gateway listens on PORT (default 3000)
```

## Test

```bash
npm test
```

Downstream service calls are mocked — no running services needed.

## Authentication

All routes require an `X-API-Key` header matching the configured `API_KEY`.  
Missing or incorrect key → `401 Unauthorized`.

## Rate Limiting

The gateway enforces **per-IP rate limiting** using an **in-memory sliding window** algorithm. No external dependency (e.g. Redis) is required.

| Parameter | Default | Environment variable |
|-----------|---------|----------------------|
| Window duration | 60 seconds | `RATE_LIMIT_WINDOW_MS` (milliseconds) |
| Max requests per window | 100 | `RATE_LIMIT_MAX` |

### Behaviour

- Rate limiting is applied **globally, before authentication**, on every route.
- Each request increments the counter for the client's IP address within the current sliding window.
- When the limit is not exceeded, the response includes:
  - `X-RateLimit-Limit` — the configured maximum.
  - `X-RateLimit-Remaining` — requests remaining in the current window.
- When the limit **is** exceeded:
  - HTTP **429 Too Many Requests** is returned.
  - Response body: `{"error": "Too Many Requests"}`
  - `Retry-After` header is set to the number of **seconds** until the oldest request in the window expires and capacity becomes available again.
  - `X-RateLimit-Remaining: 0` is also included.

### Example — limit exceeded

```
HTTP/1.1 429 Too Many Requests
Retry-After: 42
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 0
Content-Type: application/json

{"error":"Too Many Requests"}
```

### Notes

- The in-memory store is **not shared across multiple process instances**. For horizontally scaled deployments consider an external store (outside the scope of this service).
- The store does not persist across restarts.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Port the gateway listens on |
| `API_KEY` | `dev-secret` | Expected value of `X-API-Key` header |
| `USERS_SERVICE_URL` | `http://localhost:3001` | Base URL for the users service |
| `NOTIFICATIONS_SERVICE_URL` | `http://localhost:3002` | Base URL for the notifications service |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Sliding window size in milliseconds |
| `RATE_LIMIT_MAX` | `100` | Maximum requests per window per IP |
