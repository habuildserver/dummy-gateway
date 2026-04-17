'use strict';

const config = require('../config');

/**
 * Factory that returns an Express rate-limiting middleware using an exact
 * sliding-window algorithm (timestamp array per IP).
 *
 * @param {object} [options]
 * @param {number} [options.limit]     Max requests per window (default: config.rateLimitMax)
 * @param {number} [options.windowMs]  Window size in ms (default: config.rateLimitWindowMs)
 * @param {Map}    [options.store]     Injectable store; defaults to a new Map
 * @returns {Function} Express middleware with a `.cleanup` property (clearInterval handle)
 */
function createRateLimiter({ limit, windowMs, store } = {}) {
  const resolvedLimit = limit !== undefined ? limit : config.rateLimitMax;
  const resolvedWindowMs = windowMs !== undefined ? windowMs : config.rateLimitWindowMs;
  const ipMap = store || new Map();

  function middleware(req, res, next) {
    const ip = req.ip;
    const now = Date.now();
    const windowStart = now - resolvedWindowMs;

    // Keep only timestamps within the current window, then record this request
    const timestamps = (ipMap.get(ip) || []).filter(ts => ts > windowStart);
    timestamps.push(now);
    ipMap.set(ip, timestamps);

    if (timestamps.length > resolvedLimit) {
      const oldest = timestamps[0];
      const retryAfter = Math.ceil((oldest + resolvedWindowMs - now) / 1000);
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({ error: 'Rate limit exceeded' });
    }

    next();
  }

  // Periodic sweep: remove IPs with no timestamps in the current window
  const cleanup = setInterval(() => {
    const windowStart = Date.now() - resolvedWindowMs;
    for (const [ip, timestamps] of ipMap.entries()) {
      const active = timestamps.filter(ts => ts > windowStart);
      if (active.length === 0) {
        ipMap.delete(ip);
      } else {
        ipMap.set(ip, active);
      }
    }
  }, 5 * 60 * 1000);

  // Don't block process exit on this interval
  if (cleanup.unref) cleanup.unref();

  middleware.cleanup = cleanup;

  return middleware;
}

module.exports = createRateLimiter;
