function createRateLimiter({ limit, windowMs, now = Date.now }) {
  const buckets = new Map();
  return function rateLimit(req, res, next) {
    const ip = req.ip;
    const t = now();
    const times = buckets.get(ip) || [];
    if (times.length >= limit) {
      const oldest = times[0];
      const retryAfter = Math.max(1, Math.ceil((oldest + windowMs - t) / 1000));
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({ error: 'Too Many Requests' });
    }
    times.push(t);
    buckets.set(ip, times);
    return next();
  };
}

module.exports = createRateLimiter;
