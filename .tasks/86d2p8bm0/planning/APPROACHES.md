# Approaches

## Approach 1: Sliding Window Rate Limiter (Recommended)

**Summary:** Create a standalone in-memory rate limiting middleware using a sliding window counter algorithm. One new middleware file, config additions, wiring change, dedicated test file, and new README.

### Files to change

1. **src/config.js** — Add rateLimitWindowMs (default 60000) and rateLimitMax (default 100) config entries from env vars RATE_LIMIT_WINDOW_MS and RATE_LIMIT_MAX.

2. **src/middleware/rateLimit.js** (new) — Implement sliding window rate limiter:
   - Maintain a Map of IP to Array of timestamps for request tracking per IP.
   - On each request, filter out timestamps older than the window, then check if count >= max.
   - If over limit: respond 429 with error JSON and Retry-After header (seconds until oldest timestamp in window expires).
   - If under limit: push current timestamp, call next().
   - Set X-RateLimit-Limit and X-RateLimit-Remaining response headers for observability.
   - Export both the middleware function and a _resetStore() helper (for test isolation).

3. **src/index.js** — Import and wire rateLimit middleware BEFORE auth.

4. **tests/rateLimit.test.js** (new) — Jest + supertest tests:
   - Normal request passes (status 200 with valid API key).
   - 101st request in same window returns 429 with Retry-After header.
   - After window resets (use jest.useFakeTimers / jest.advanceTimersByTime), requests succeed again.
   - Use beforeEach to call _resetStore() for test isolation.

5. **README.md** (new) — Project README documenting:
   - Project description, setup, run, test instructions.
   - Rate limiting behaviour: limits, response codes, headers, configuration via env vars.

6. **.env.example** — Add RATE_LIMIT_WINDOW_MS and RATE_LIMIT_MAX example values.

### Trade-offs
- Pros: Zero external dependencies, simple to understand, follows existing conventions exactly.
- Cons: In-memory store does not survive restarts and does not share across multiple instances. Acceptable per task requirements (no Redis/external dependency).

### Risks
- Memory growth if many unique IPs hit the server. Mitigated by periodic cleanup of expired entries (can add a cleanup interval or lazy cleanup on access).
