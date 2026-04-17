# Task 86d2p8bm0: Add request rate limiting middleware to the API gateway

Implement per-IP rate limiting on all routes in the API gateway. Use a sliding window algorithm (in-memory, no Redis or external dependency). Limit to 100 requests per minute per IP. When the limit is exceeded, return HTTP 429 with a Retry-After header indicating seconds until the window resets. The middleware must be applied globally before auth. Add Jest unit tests covering: normal request passes, 101st request in window is rejected, window resets after 1 minute. Update the README with rate limiting behaviour.
