# gateway-agent

**Service:** dummy-gateway
**Stack:** Node.js 20, Express 4, Jest, Supertest
**Role:** API gateway — validates X-API-Key, proxies /users → dummy-users, /notifications → dummy-notifications

**Key files:**
- `src/index.js` — app entry, middleware wiring
- `src/config.js` — env config (single source of truth)
- `src/middleware/auth.js` — API key guard
- `src/routes/users.js` — proxy to users service
- `src/routes/notifications.js` — proxy to notifications service

**Test:** `npm test`
**Start:** `npm start`
