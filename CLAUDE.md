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

## Conventions

- Async/await throughout. No callbacks.
- All env config via `src/config.js`. Never read `process.env` directly in routes.
- Error shape: `{"error": "<message>"}`.
- One file per middleware, one file per route group.
