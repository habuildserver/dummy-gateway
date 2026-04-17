# dummy-gateway

API gateway service built with Node.js and Express. Validates `X-API-Key` on every request and proxies to `dummy-users` and `dummy-notifications` upstream services.

## Prerequisites

- Node.js 18+
- npm

## Setup

```bash
npm install
cp .env.example .env
# Edit .env and set API_KEY, USERS_SERVICE_URL, NOTIFICATIONS_SERVICE_URL
```

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Port the gateway listens on |
| `API_KEY` | `dev-secret` | Required `X-API-Key` header value |
| `USERS_SERVICE_URL` | `http://localhost:3001` | Base URL of the users service |
| `NOTIFICATIONS_SERVICE_URL` | `http://localhost:3002` | Base URL of the notifications service |
| `RATE_LIMIT_MAX` | `100` | Max requests per IP per window |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate limit window size in milliseconds (default: 1 minute) |

## Running

```bash
npm start
```

## Testing

```bash
npm test
```

No running downstream services are needed — all upstream calls are mocked in the test suite.

## Rate limiting

All routes are protected by a per-IP sliding-window rate limiter applied before authentication.

- **Limit:** `RATE_LIMIT_MAX` requests per `RATE_LIMIT_WINDOW_MS` milliseconds (default: 100 req/min)
- **Scope:** per client IP address (`req.ip`)
- **Algorithm:** exact sliding window — only requests within the last `RATE_LIMIT_WINDOW_MS` milliseconds are counted

When the limit is exceeded the gateway responds with:

```
HTTP 429 Too Many Requests
Retry-After: <seconds until oldest in-window request expires>
Content-Type: application/json

{"error": "Rate limit exceeded"}
```

## Authentication

Every request must include the `X-API-Key` header matching the configured `API_KEY`. Missing or incorrect keys receive `HTTP 401 Unauthorized`.

## Routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check — returns `{"status":"ok"}` |
| `*` | `/users/*` | Proxied to `USERS_SERVICE_URL` |
| `*` | `/notifications/*` | Proxied to `NOTIFICATIONS_SERVICE_URL` |
