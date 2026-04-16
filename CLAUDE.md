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
