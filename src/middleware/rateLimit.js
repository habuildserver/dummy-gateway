'use strict';

function createRateLimiter({ windowMs = 60000, max = 100 } = {}) {
  const hits = new Map();

  const cleanupInterval = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [ip, timestamps] of hits) {
      if (timestamps[timestamps.length - 1] <= cutoff) {
        hits.delete(ip);
      }
    }
  }, windowMs);
  cleanupInterval.unref();

  function middleware(req, res, next) {
    const ip = req.ip;
    const now = Date.now();
    let timestamps = hits.get(ip) || [];
    timestamps = timestamps.filter(t => t > now - windowMs);

    if (timestamps.length >= max) {
      const retryAfter = Math.ceil((timestamps[0] + windowMs - now) / 1000);
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({ error: 'Rate limit exceeded' });
    }

    timestamps.push(now);
    hits.set(ip, timestamps);
    next();
  }

  middleware.destroy = () => {
    clearInterval(cleanupInterval);
    hits.clear();
  };

  return middleware;
}

module.exports = createRateLimiter;
